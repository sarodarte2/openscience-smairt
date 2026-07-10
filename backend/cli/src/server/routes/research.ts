import path from "node:path"
import { readFile, readdir } from "node:fs/promises"
import { Hono } from "hono"
import { HTTPException } from "hono/http-exception"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { lazy } from "../../util/lazy"
import { Instance } from "../../project/instance"
import { LocalGit } from "../../research/adapters/git/local"
import { IdentityPassphraseRequiredError, LocalIdentity } from "../../research/adapters/identity/local"
import { ResearchProjectService } from "../../research/application/project"
import { ResearchTrackService } from "../../research/application/track"
import { ResearchAudit } from "../../research/application/audit"
import { ProjectMember, ResearchProject, ResearchTrack, WorkspaceBinding } from "../../research/domain/schema"
import { ResearchEvent } from "../../research/domain/event"

const Status = z.discriminatedUnion("initialized", [
  z.object({ initialized: z.literal(false), root: z.string() }),
  z.object({
    initialized: z.literal(true),
    root: z.string(),
    project: ResearchProject,
    eventCount: z.number().int().nonnegative(),
    readOnly: z.boolean(),
    diagnostics: z.array(z.object({ code: z.string(), file: z.string(), message: z.string() })),
  }),
])

const Initialize = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(4000).optional(),
  createCondaEnvironment: z.boolean().default(true),
  passphrase: z.string().min(12).optional(),
  humanConfirmed: z.literal(true),
})

const CreateTrack = z.object({
  title: z.string().min(1).max(200),
  objective: z.string().min(1).max(8000),
  alias: z.string().max(80).optional(),
  parentTrackIds: z.array(z.string()).optional(),
  workspace: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("none") }),
    z.object({ kind: z.literal("current") }),
    z.object({ kind: z.literal("new-worktree"), branch: z.string().min(1), worktreePath: z.string().min(1) }),
  ]),
  passphrase: z.string().min(12).optional(),
  humanConfirmed: z.literal(true),
})

async function status(root: string): Promise<z.infer<typeof Status>> {
  const file = path.join(root, ".openscience/research/project.json")
  const content = await readFile(file, "utf8").catch(() => null)
  if (!content) return { initialized: false, root }
  const project = ResearchProject.parse(JSON.parse(content))
  const ledger = await ResearchAudit.inspect(root)
  const mismatch = ledger.events.some((event) => event.projectId !== project.id)
  const diagnostics = mismatch
    ? [
        ...ledger.diagnostics,
        { code: "project_projection_mismatch", file, message: "Project projection does not match the signed ledger" },
      ]
    : ledger.diagnostics
  return {
    initialized: true,
    root,
    project,
    eventCount: ledger.events.length,
    readOnly: ledger.readOnly || mismatch,
    diagnostics,
  }
}

async function localMember(root: string, keyId: string) {
  const directory = path.join(root, ".openscience/research/projections/members")
  const names = await readdir(directory)
  const members = await Promise.all(
    names
      .filter((name) => name.endsWith(".json"))
      .map(async (name) => ProjectMember.parse(JSON.parse(await readFile(path.join(directory, name), "utf8")))),
  )
  const member = members.find((candidate) => candidate.active && candidate.signingKeyId === keyId)
  if (!member) throw new HTTPException(403, { message: "The local signing identity is not an active project member" })
  return member
}

export const ResearchRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "Get OpenScience Research status",
        operationId: "research.status",
        responses: {
          200: {
            description: "Research project status",
            content: { "application/json": { schema: resolver(Status) } },
          },
        },
      }),
      async (c) => c.json(await status(Instance.directory)),
    )
    .get(
      "/ledger",
      describeRoute({
        summary: "Verify and read the local research ledger",
        operationId: "research.ledger",
        responses: {
          200: {
            description: "Verified research events and diagnostics",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    events: z.array(ResearchEvent),
                    diagnostics: z.array(z.object({ code: z.string(), file: z.string(), message: z.string() })),
                    readOnly: z.boolean(),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const ledger = await ResearchAudit.inspect(Instance.directory)
        return c.json({ events: ledger.events, diagnostics: ledger.diagnostics, readOnly: ledger.readOnly })
      },
    )
    .post(
      "/initialize",
      describeRoute({
        summary: "Adopt the current Git repository as a research project",
        operationId: "research.initialize",
        responses: {
          200: {
            description: "Initialized research project",
            content: { "application/json": { schema: resolver(Status) } },
          },
          422: { description: "Signing identity needs a passphrase" },
        },
      }),
      validator("json", Initialize),
      async (c) => {
        const body = c.req.valid("json")
        const git = await LocalGit.inspect(Instance.directory)
        const displayName = git.user.name || git.user.email || "Local researcher"
        const actor = { kind: "human" as const, id: `git:${git.user.email || displayName}`, displayName }
        const signer = await LocalIdentity.loadOrCreate({ passphrase: body.passphrase }).catch((error) => {
          if (error instanceof IdentityPassphraseRequiredError) {
            throw new HTTPException(422, { message: error.message })
          }
          throw error
        })
        await ResearchProjectService.initialize({
          directory: git.root,
          mode: "adopt",
          name: body.name,
          description: body.description,
          actor,
          signer,
          createCondaEnvironment: body.createCondaEnvironment,
        })
        return c.json(await status(git.root))
      },
    )
    .get(
      "/tracks",
      describeRoute({
        summary: "List stable scientific tracks",
        operationId: "research.track.list",
        responses: {
          200: {
            description: "Research tracks",
            content: { "application/json": { schema: resolver(z.array(ResearchTrack)) } },
          },
        },
      }),
      async (c) => c.json(await ResearchTrackService.list(Instance.directory)),
    )
    .post(
      "/tracks",
      describeRoute({
        summary: "Create a scientific track and optionally bind a Git worktree",
        operationId: "research.track.create",
        responses: {
          200: {
            description: "Created track",
            content: {
              "application/json": {
                schema: resolver(z.object({ track: ResearchTrack, binding: WorkspaceBinding.nullable() })),
              },
            },
          },
        },
      }),
      validator("json", CreateTrack),
      async (c) => {
        const body = c.req.valid("json")
        const signer = await LocalIdentity.loadOrCreate({ passphrase: body.passphrase })
        const member = await localMember(Instance.directory, signer.keyId)
        const actor = { kind: "human" as const, id: member.id, displayName: member.displayName }
        return c.json(
          await ResearchTrackService.create({
            projectRoot: Instance.directory,
            title: body.title,
            objective: body.objective,
            alias: body.alias,
            parentTrackIds: body.parentTrackIds,
            workspace: body.workspace,
            actor,
            role: member.role,
            signer,
          }),
        )
      },
    ),
)
