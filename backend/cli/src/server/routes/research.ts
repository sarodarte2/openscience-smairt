import path from "node:path"
import { readFile } from "node:fs/promises"
import { Hono } from "hono"
import { HTTPException } from "hono/http-exception"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { lazy } from "../../util/lazy"
import { Instance } from "../../project/instance"
import { LocalGit } from "../../research/adapters/git/local"
import { CondaUnavailableError } from "../../research/adapters/environment/conda"
import { IdempotencyConflictError } from "../../research/adapters/ledger/filesystem"
import { IdentityPassphraseRequiredError, LocalIdentity } from "../../research/adapters/identity/local"
import { ResearchProjectService } from "../../research/application/project"
import { ResearchTrackService } from "../../research/application/track"
import { ResearchAudit, ResearchAuditError } from "../../research/application/audit"
import {
  ProtocolContent,
  ProtocolRevision,
  Json,
  ResearchIteration,
  ResearchProject,
  ResearchTrack,
  RunAttempt,
  ArtifactManifest,
  ScientificAnalysis,
  ScientificClaim,
  TrackReview,
  EvidenceIntegration,
  TrackEnvironment,
  WorkspaceBinding,
} from "../../research/domain/schema"
import { ResearchEvent } from "../../research/domain/event"
import { Bus } from "../../bus"
import { ResearchEvents } from "../../research/events"
import { ProjectMembership } from "../../research/application/membership"
import { InvestigationService } from "../../research/application/investigation"
import { ResearchAuthorizationError } from "../../research/domain/governance"
import { NotebookValidationError, ResearchRunService, RunStateError } from "../../research/application/run"
import { ResearchEnvironmentService } from "../../research/application/environment"
import { ResearchEvidenceService } from "../../research/application/evidence"
import { ResearchReviewService } from "../../research/application/review"

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

const CreateIteration = z.object({
  trackId: z.string().min(1),
  title: z.string().min(1).max(200),
  question: z.string().min(1).max(12000),
  decisionGoal: z.string().min(1).max(8000),
  alias: z.string().max(80).optional(),
  content: ProtocolContent,
  passphrase: z.string().min(12).optional(),
  humanConfirmed: z.literal(true),
})

const FreezeProtocol = z.object({
  passphrase: z.string().min(12).optional(),
  humanConfirmed: z.literal(true),
})

const DeclareRun = z.object({
  protocolId: z.string().min(1),
  parameters: z.unknown().default({}),
  seed: z.number().int().optional(),
  execution: z.object({
    command: z.string().min(1).max(4000),
    args: z.array(z.string().max(12000)).max(1000).default([]),
    cwd: z.string().min(1).optional(),
    timeoutMs: z
      .number()
      .int()
      .min(100)
      .max(7 * 24 * 60 * 60 * 1000)
      .default(60 * 60 * 1000),
    environmentKeys: z
      .array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/))
      .max(64)
      .default([]),
  }),
  passphrase: z.string().min(12).optional(),
  humanConfirmed: z.literal(true),
})

const DeclareNotebookRun = z.object({
  protocolId: z.string().min(1),
  notebookPath: z.string().min(1).max(8000),
  parameters: z.unknown().default({}),
  seed: z.number().int().optional(),
  timeoutMs: z
    .number()
    .int()
    .min(1000)
    .max(7 * 24 * 60 * 60 * 1000)
    .default(60 * 60 * 1000),
  allowErrors: z.boolean().default(false),
  environmentKeys: z
    .array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/))
    .max(64)
    .default([]),
  passphrase: z.string().min(12).optional(),
  humanConfirmed: z.literal(true),
})

const ExecuteRun = z.object({
  passphrase: z.string().min(12).optional(),
  humanConfirmed: z.literal(true),
})

const IsolateEnvironment = z.object({
  passphrase: z.string().min(12).optional(),
  humanConfirmed: z.literal(true),
})

const RegisterArtifact = z.object({
  iterationId: z.string().min(1),
  file: z.string().min(1).max(8000),
  role: ArtifactManifest.shape.role,
  mediaType: z.string().min(1).max(300),
  runId: z.string().min(1).optional(),
  passphrase: z.string().min(12).optional(),
  humanConfirmed: z.literal(true),
})

const CreateAnalysis = z.object({
  iterationId: z.string().min(1),
  title: z.string().min(1).max(300),
  summary: z.string().min(1).max(24000),
  methods: z.string().min(1).max(24000),
  findings: z.array(z.string().min(1).max(8000)).min(1),
  limitations: z.array(z.string().min(1).max(8000)).min(1),
  runIds: z.array(z.string()),
  artifactIds: z.array(z.string()),
  finalize: z.boolean().default(false),
  passphrase: z.string().min(12).optional(),
  humanConfirmed: z.literal(true),
})

const CreateClaim = z.object({
  iterationId: z.string().min(1),
  statement: z.string().min(1).max(12000),
  scope: z.string().min(1).max(8000),
  uncertainties: z.array(z.string().min(1).max(8000)).min(1),
  analysisIds: z.array(z.string()).min(1),
  artifactIds: z.array(z.string()),
  finalize: z.boolean().default(false),
  passphrase: z.string().min(12).optional(),
  humanConfirmed: z.literal(true),
})

const ReviewTrack = z.object({
  trackId: z.string().min(1),
  claimIds: z.array(z.string()).min(1),
  analysisIds: z.array(z.string()).min(1),
  outcome: TrackReview.shape.outcome,
  rationale: z.string().min(1).max(24000),
  passphrase: z.string().min(12).optional(),
  humanConfirmed: z.literal(true),
})

const IntegrateEvidence = z.object({
  reviewId: z.string().min(1),
  passphrase: z.string().min(12).optional(),
  humanConfirmed: z.literal(true),
})

const IdempotencyHeader = z.object({
  "idempotency-key": z.string().min(8).max(200),
})

const PublicResearchEvent = ResearchEvent.omit({ payload: true }).extend({ payload: z.unknown() })
const PublicRunAttempt = RunAttempt.omit({ parameters: true }).extend({ parameters: z.unknown() })

async function researchProject(root: string) {
  return ResearchProject.parse(
    JSON.parse(await readFile(path.join(root, ".openscience/research/project.json"), "utf8")),
  )
}

async function operation<T>(
  input: { operationId: string; projectId: string; kind: string },
  execute: () => Promise<T>,
) {
  const publish = (state: "started" | "succeeded" | "failed", message?: string) =>
    Bus.publish(ResearchEvents.OperationUpdated, {
      version: 1,
      operationId: input.operationId,
      projectId: input.projectId,
      state,
      kind: input.kind,
      ...(message ? { message } : {}),
    }).catch(() => undefined)
  await publish("started")
  try {
    const result = await execute()
    await publish("succeeded")
    return result
  } catch (error) {
    await publish("failed", error instanceof Error ? error.message : String(error))
    if (error instanceof HTTPException) throw error
    if (error instanceof IdentityPassphraseRequiredError) {
      throw new HTTPException(422, { message: error.message })
    }
    if (error instanceof ResearchAuthorizationError) {
      throw new HTTPException(403, { message: error.message })
    }
    if (error instanceof IdempotencyConflictError) {
      throw new HTTPException(409, { message: error.message })
    }
    if (error instanceof RunStateError) {
      throw new HTTPException(409, { message: error.message })
    }
    if (error instanceof NotebookValidationError) {
      throw new HTTPException(422, { message: error.message })
    }
    if (error instanceof ResearchAuditError) {
      throw new HTTPException(409, { message: error.message })
    }
    if (error instanceof CondaUnavailableError) {
      throw new HTTPException(422, { message: error.message })
    }
    throw error
  }
}

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
                    events: z.array(PublicResearchEvent),
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
                schema: resolver(
                  z.object({
                    track: ResearchTrack,
                    binding: WorkspaceBinding.nullable(),
                    environment: TrackEnvironment.nullable(),
                    eventId: z.string(),
                    replayed: z.boolean(),
                  }),
                ),
              },
            },
          },
          403: { description: "Signing identity is not an active member or lacks permission" },
          409: { description: "Idempotency conflict or read-only research record" },
          422: { description: "Signing identity needs a passphrase" },
        },
      }),
      validator("header", IdempotencyHeader),
      validator("json", CreateTrack),
      async (c) => {
        const body = c.req.valid("json")
        const idempotencyKey = c.req.valid("header")["idempotency-key"]
        const project = await researchProject(Instance.directory)
        const result = await operation(
          { operationId: idempotencyKey, projectId: project.id, kind: "track.create" },
          async () => {
            const signer = await LocalIdentity.loadOrCreate({ passphrase: body.passphrase })
            const member = await ProjectMembership.localMember(Instance.directory, signer.keyId)
            if (!member) {
              throw new HTTPException(403, { message: "The local signing identity is not an active project member" })
            }
            return ResearchTrackService.create({
              projectRoot: Instance.directory,
              title: body.title,
              objective: body.objective,
              alias: body.alias,
              parentTrackIds: body.parentTrackIds,
              workspace: body.workspace,
              actor: { kind: "human", id: member.id, displayName: member.displayName },
              role: member.role,
              signer,
              idempotencyKey,
            })
          },
        )
        await Bus.publish(ResearchEvents.TrackUpdated, {
          version: 1,
          projectId: project.id,
          trackId: result.track.id,
          eventId: result.eventId,
          action: "created",
          replayed: result.replayed,
        })
        return c.json(result)
      },
    )
    .get(
      "/iterations",
      describeRoute({
        summary: "List scientific iterations",
        operationId: "research.iteration.list",
        responses: {
          200: {
            description: "Research iterations",
            content: { "application/json": { schema: resolver(z.array(ResearchIteration)) } },
          },
        },
      }),
      validator("query", z.object({ trackId: z.string().optional(), directory: z.string().optional() })),
      async (c) => {
        const query = c.req.valid("query")
        return c.json(await InvestigationService.listIterations(Instance.directory, query.trackId))
      },
    )
    .post(
      "/iterations",
      describeRoute({
        summary: "Create an iteration with a mode-specific draft protocol",
        operationId: "research.iteration.create",
        responses: {
          200: {
            description: "Created iteration and draft protocol",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    iteration: ResearchIteration,
                    protocol: ProtocolRevision,
                    eventId: z.string(),
                    replayed: z.boolean(),
                  }),
                ),
              },
            },
          },
          403: { description: "Signing identity is not an active member or lacks permission" },
          409: { description: "Idempotency conflict or read-only research record" },
          422: { description: "Signing identity needs a passphrase" },
        },
      }),
      validator("header", IdempotencyHeader),
      validator("json", CreateIteration),
      async (c) => {
        const body = c.req.valid("json")
        const idempotencyKey = c.req.valid("header")["idempotency-key"]
        const project = await researchProject(Instance.directory)
        const result = await operation(
          { operationId: idempotencyKey, projectId: project.id, kind: "iteration.create" },
          async () => {
            const signer = await LocalIdentity.loadOrCreate({ passphrase: body.passphrase })
            const member = await ProjectMembership.localMember(Instance.directory, signer.keyId)
            if (!member) {
              throw new HTTPException(403, { message: "The local signing identity is not an active project member" })
            }
            return InvestigationService.createIteration({
              projectRoot: Instance.directory,
              trackId: body.trackId,
              title: body.title,
              question: body.question,
              decisionGoal: body.decisionGoal,
              alias: body.alias,
              content: body.content,
              actor: { kind: "human", id: member.id, displayName: member.displayName },
              role: member.role,
              signer,
              idempotencyKey,
            })
          },
        )
        await Bus.publish(ResearchEvents.IterationUpdated, {
          version: 1,
          projectId: result.iteration.projectId,
          iterationId: result.iteration.id,
          eventId: result.eventId,
          action: "created",
          replayed: result.replayed,
        })
        return c.json(result)
      },
    )
    .get(
      "/protocols",
      describeRoute({
        summary: "List protocol revisions",
        operationId: "research.protocol.list",
        responses: {
          200: {
            description: "Protocol revisions",
            content: { "application/json": { schema: resolver(z.array(ProtocolRevision)) } },
          },
        },
      }),
      validator("query", z.object({ iterationId: z.string().optional(), directory: z.string().optional() })),
      async (c) => {
        const query = c.req.valid("query")
        return c.json(await InvestigationService.listProtocols(Instance.directory, query.iterationId))
      },
    )
    .post(
      "/protocols/:protocolId/freeze",
      describeRoute({
        summary: "Freeze a protocol revision after explicit human review",
        operationId: "research.protocol.freeze",
        responses: {
          200: {
            description: "Frozen protocol and updated iteration",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    protocol: ProtocolRevision,
                    iteration: ResearchIteration,
                    eventId: z.string(),
                    replayed: z.boolean(),
                  }),
                ),
              },
            },
          },
          403: { description: "Signing identity is not an active member or lacks permission" },
          409: { description: "Idempotency conflict or read-only research record" },
          422: { description: "Signing identity needs a passphrase" },
        },
      }),
      validator("param", z.object({ protocolId: z.string().min(1) })),
      validator("header", IdempotencyHeader),
      validator("json", FreezeProtocol),
      async (c) => {
        const body = c.req.valid("json")
        const protocolId = c.req.valid("param").protocolId
        const idempotencyKey = c.req.valid("header")["idempotency-key"]
        const project = await researchProject(Instance.directory)
        const result = await operation(
          { operationId: idempotencyKey, projectId: project.id, kind: "protocol.freeze" },
          async () => {
            const signer = await LocalIdentity.loadOrCreate({ passphrase: body.passphrase })
            const member = await ProjectMembership.localMember(Instance.directory, signer.keyId)
            if (!member) {
              throw new HTTPException(403, { message: "The local signing identity is not an active project member" })
            }
            return InvestigationService.freezeProtocol({
              projectRoot: Instance.directory,
              protocolId,
              actor: { kind: "human", id: member.id, displayName: member.displayName },
              role: member.role,
              signer,
              idempotencyKey,
            })
          },
        )
        await Bus.publish(ResearchEvents.IterationUpdated, {
          version: 1,
          projectId: result.iteration.projectId,
          iterationId: result.iteration.id,
          eventId: result.eventId,
          action: "protocol_frozen",
          replayed: result.replayed,
        })
        return c.json(result)
      },
    )
    .get(
      "/environments",
      describeRoute({
        summary: "List per-track Conda environment bindings",
        operationId: "research.environment.list",
        responses: {
          200: {
            description: "Track environment bindings",
            content: { "application/json": { schema: resolver(z.array(TrackEnvironment)) } },
          },
        },
      }),
      async (c) => c.json(await ResearchEnvironmentService.list(Instance.directory)),
    )
    .post(
      "/environments/:trackId/isolate",
      describeRoute({
        summary: "Create a track-specific Conda specification without mutating its parent environment",
        operationId: "research.environment.isolate",
        responses: {
          200: {
            description: "Divergent track environment and explicit provisioning command",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    environment: TrackEnvironment,
                    eventId: z.string(),
                    replayed: z.boolean(),
                    provision: z.object({ command: z.literal("conda"), args: z.array(z.string()) }),
                  }),
                ),
              },
            },
          },
          403: { description: "Only an authorized human project member may isolate an environment" },
          409: { description: "Idempotency conflict, existing divergence, or read-only research record" },
          422: { description: "Signing identity needs a passphrase" },
        },
      }),
      validator("param", z.object({ trackId: z.string().min(1) })),
      validator("header", IdempotencyHeader),
      validator("json", IsolateEnvironment),
      async (c) => {
        const body = c.req.valid("json")
        const trackId = c.req.valid("param").trackId
        const idempotencyKey = c.req.valid("header")["idempotency-key"]
        const project = await researchProject(Instance.directory)
        const result = await operation(
          { operationId: idempotencyKey, projectId: project.id, kind: "environment.isolate" },
          async () => {
            const signer = await LocalIdentity.loadOrCreate({ passphrase: body.passphrase })
            const member = await ProjectMembership.localMember(Instance.directory, signer.keyId)
            if (!member) {
              throw new HTTPException(403, { message: "The local signing identity is not an active project member" })
            }
            return ResearchEnvironmentService.isolate({
              projectRoot: Instance.directory,
              trackId,
              actor: { kind: "human", id: member.id, displayName: member.displayName },
              role: member.role,
              signer,
              idempotencyKey,
            })
          },
        )
        await Bus.publish(ResearchEvents.TrackUpdated, {
          version: 1,
          projectId: result.environment.projectId,
          trackId: result.environment.trackId,
          eventId: result.eventId,
          action: "environment_diverged",
          replayed: result.replayed,
        })
        return c.json(result)
      },
    )
    .get(
      "/runs",
      describeRoute({
        summary: "List formal run attempts",
        operationId: "research.run.list",
        responses: {
          200: {
            description: "Formal run attempts",
            content: { "application/json": { schema: resolver(z.array(PublicRunAttempt)) } },
          },
        },
      }),
      validator("query", z.object({ iterationId: z.string().optional(), directory: z.string().optional() })),
      async (c) => {
        const query = c.req.valid("query")
        return c.json(await ResearchRunService.list(Instance.directory, query.iterationId))
      },
    )
    .post(
      "/runs/notebooks",
      describeRoute({
        summary: "Capture provenance and declare a clean-kernel formal notebook run",
        operationId: "research.run.notebook.declare",
        responses: {
          200: {
            description: "Declared formal notebook run",
            content: {
              "application/json": {
                schema: resolver(z.object({ run: PublicRunAttempt, eventId: z.string(), replayed: z.boolean() })),
              },
            },
          },
          403: { description: "Signing identity is not an active member or lacks permission" },
          409: { description: "Idempotency conflict or read-only research record" },
          422: { description: "Notebook, Conda environment, or signing identity needs attention" },
        },
      }),
      validator("header", IdempotencyHeader),
      validator("json", DeclareNotebookRun),
      async (c) => {
        const body = c.req.valid("json")
        const idempotencyKey = c.req.valid("header")["idempotency-key"]
        const project = await researchProject(Instance.directory)
        const result = await operation(
          { operationId: idempotencyKey, projectId: project.id, kind: "run.notebook.declare" },
          async () => {
            const signer = await LocalIdentity.loadOrCreate({ passphrase: body.passphrase })
            const member = await ProjectMembership.localMember(Instance.directory, signer.keyId)
            if (!member) {
              throw new HTTPException(403, { message: "The local signing identity is not an active project member" })
            }
            return ResearchRunService.declareNotebook({
              projectRoot: Instance.directory,
              protocolId: body.protocolId,
              notebookPath: body.notebookPath,
              parameters: Json.parse(body.parameters),
              seed: body.seed,
              timeoutMs: body.timeoutMs,
              allowErrors: body.allowErrors,
              environmentKeys: body.environmentKeys,
              actor: { kind: "human", id: member.id, displayName: member.displayName },
              role: member.role,
              signer,
              idempotencyKey,
            })
          },
        )
        await Bus.publish(ResearchEvents.RunUpdated, {
          version: 1,
          projectId: result.run.projectId,
          runId: result.run.id,
          eventId: result.eventId,
          state: result.run.state,
          replayed: result.replayed,
        })
        return c.json(result)
      },
    )
    .post(
      "/runs",
      describeRoute({
        summary: "Capture provenance and declare a formal run intent",
        operationId: "research.run.declare",
        responses: {
          200: {
            description: "Declared formal run",
            content: {
              "application/json": {
                schema: resolver(z.object({ run: PublicRunAttempt, eventId: z.string(), replayed: z.boolean() })),
              },
            },
          },
          403: { description: "Signing identity is not an active member or lacks permission" },
          409: { description: "Idempotency conflict or read-only research record" },
          422: { description: "Conda environment or signing identity needs attention" },
        },
      }),
      validator("header", IdempotencyHeader),
      validator("json", DeclareRun),
      async (c) => {
        const body = c.req.valid("json")
        const idempotencyKey = c.req.valid("header")["idempotency-key"]
        const project = await researchProject(Instance.directory)
        const result = await operation(
          { operationId: idempotencyKey, projectId: project.id, kind: "run.declare" },
          async () => {
            const signer = await LocalIdentity.loadOrCreate({ passphrase: body.passphrase })
            const member = await ProjectMembership.localMember(Instance.directory, signer.keyId)
            if (!member) {
              throw new HTTPException(403, { message: "The local signing identity is not an active project member" })
            }
            return ResearchRunService.declare({
              projectRoot: Instance.directory,
              protocolId: body.protocolId,
              parameters: Json.parse(body.parameters),
              seed: body.seed,
              execution: { ...body.execution, cwd: body.execution.cwd ?? Instance.directory },
              actor: { kind: "human", id: member.id, displayName: member.displayName },
              role: member.role,
              signer,
              idempotencyKey,
            })
          },
        )
        await Bus.publish(ResearchEvents.RunUpdated, {
          version: 1,
          projectId: result.run.projectId,
          runId: result.run.id,
          eventId: result.eventId,
          state: result.run.state,
          replayed: result.replayed,
        })
        return c.json(result)
      },
    )
    .post(
      "/runs/:runId/execute",
      describeRoute({
        summary: "Execute one declared run through the controlled Conda runner",
        operationId: "research.run.execute",
        responses: {
          200: {
            description: "Completed or previously completed formal run",
            content: {
              "application/json": {
                schema: resolver(z.object({ run: PublicRunAttempt, eventId: z.string(), replayed: z.boolean() })),
              },
            },
          },
          403: { description: "Signing identity is not an active member or lacks permission" },
          409: { description: "Run is already active, unsafe to retry, or record is read-only" },
          422: { description: "Signing identity needs a passphrase" },
        },
      }),
      validator("param", z.object({ runId: z.string().min(1) })),
      validator("json", ExecuteRun),
      async (c) => {
        const body = c.req.valid("json")
        const runId = c.req.valid("param").runId
        const project = await researchProject(Instance.directory)
        const result = await operation(
          { operationId: `execute:${runId}`, projectId: project.id, kind: "run.execute" },
          async () => {
            const signer = await LocalIdentity.loadOrCreate({ passphrase: body.passphrase })
            const member = await ProjectMembership.localMember(Instance.directory, signer.keyId)
            if (!member) {
              throw new HTTPException(403, { message: "The local signing identity is not an active project member" })
            }
            return ResearchRunService.execute({
              projectRoot: Instance.directory,
              runId,
              actor: { kind: "human", id: member.id, displayName: member.displayName },
              role: member.role,
              signer,
              signal: c.req.raw.signal,
            })
          },
        )
        await Bus.publish(ResearchEvents.RunUpdated, {
          version: 1,
          projectId: result.run.projectId,
          runId: result.run.id,
          eventId: result.eventId,
          state: result.run.state,
          replayed: result.replayed,
        })
        return c.json(result)
      },
    )
    .get(
      "/artifacts",
      describeRoute({
        summary: "List registered research artifacts",
        operationId: "research.artifact.list",
        responses: {
          200: {
            description: "Artifact manifests",
            content: { "application/json": { schema: resolver(z.array(ArtifactManifest)) } },
          },
        },
      }),
      validator("query", z.object({ iterationId: z.string().optional() })),
      async (c) =>
        c.json(await ResearchEvidenceService.listArtifacts(Instance.directory, c.req.valid("query").iterationId)),
    )
    .post(
      "/artifacts",
      describeRoute({
        summary: "Hash and register a project-local artifact",
        operationId: "research.artifact.register",
        responses: {
          200: {
            description: "Signed artifact manifest",
            content: {
              "application/json": { schema: resolver(z.object({ artifact: ArtifactManifest, eventId: z.string() })) },
            },
          },
        },
      }),
      validator("json", RegisterArtifact),
      async (c) => {
        const body = c.req.valid("json")
        const signer = await LocalIdentity.loadOrCreate({ passphrase: body.passphrase })
        const member = await ProjectMembership.localMember(Instance.directory, signer.keyId)
        if (!member)
          throw new HTTPException(403, { message: "The local signing identity is not an active project member" })
        const result = await ResearchEvidenceService.registerArtifact({
          projectRoot: Instance.directory,
          iterationId: body.iterationId,
          file: body.file,
          artifactRole: body.role,
          mediaType: body.mediaType,
          runId: body.runId,
          actor: { kind: "human", id: member.id, displayName: member.displayName },
          role: member.role,
          signer,
        })
        await Bus.publish(ResearchEvents.EvidenceUpdated, {
          version: 1,
          projectId: result.artifact.projectId,
          subjectType: "artifact",
          subjectId: result.artifact.id,
          eventId: result.eventId,
          action: "registered",
          replayed: false,
        })
        return c.json(result)
      },
    )
    .get(
      "/analyses",
      describeRoute({
        summary: "List scientific analyses",
        operationId: "research.analysis.list",
        responses: {
          200: {
            description: "Scientific analyses",
            content: { "application/json": { schema: resolver(z.array(ScientificAnalysis)) } },
          },
        },
      }),
      validator("query", z.object({ iterationId: z.string().optional() })),
      async (c) =>
        c.json(await ResearchEvidenceService.listAnalyses(Instance.directory, c.req.valid("query").iterationId)),
    )
    .post(
      "/analyses",
      describeRoute({
        summary: "Create a traceable scientific analysis",
        operationId: "research.analysis.create",
        responses: {
          200: {
            description: "Signed analysis",
            content: {
              "application/json": { schema: resolver(z.object({ analysis: ScientificAnalysis, eventId: z.string() })) },
            },
          },
        },
      }),
      validator("json", CreateAnalysis),
      async (c) => {
        const body = c.req.valid("json")
        const signer = await LocalIdentity.loadOrCreate({ passphrase: body.passphrase })
        const member = await ProjectMembership.localMember(Instance.directory, signer.keyId)
        if (!member)
          throw new HTTPException(403, { message: "The local signing identity is not an active project member" })
        const result = await ResearchEvidenceService.createAnalysis({
          ...body,
          projectRoot: Instance.directory,
          actor: { kind: "human", id: member.id, displayName: member.displayName },
          role: member.role,
          signer,
        })
        await Bus.publish(ResearchEvents.EvidenceUpdated, {
          version: 1,
          projectId: result.analysis.projectId,
          subjectType: "analysis",
          subjectId: result.analysis.id,
          eventId: result.eventId,
          action: result.analysis.state === "finalized" ? "finalized" : "created",
          replayed: false,
        })
        return c.json(result)
      },
    )
    .get(
      "/claims",
      describeRoute({
        summary: "List scientific claims",
        operationId: "research.claim.list",
        responses: {
          200: {
            description: "Scientific claims",
            content: { "application/json": { schema: resolver(z.array(ScientificClaim)) } },
          },
        },
      }),
      validator("query", z.object({ iterationId: z.string().optional() })),
      async (c) => c.json(await ResearchReviewService.listClaims(Instance.directory, c.req.valid("query").iterationId)),
    )
    .post(
      "/claims",
      describeRoute({
        summary: "Create or finalize an evidence-backed claim",
        operationId: "research.claim.create",
        responses: {
          200: {
            description: "Signed claim",
            content: {
              "application/json": { schema: resolver(z.object({ claim: ScientificClaim, eventId: z.string() })) },
            },
          },
        },
      }),
      validator("json", CreateClaim),
      async (c) => {
        const body = c.req.valid("json")
        const signer = await LocalIdentity.loadOrCreate({ passphrase: body.passphrase })
        const member = await ProjectMembership.localMember(Instance.directory, signer.keyId)
        if (!member)
          throw new HTTPException(403, { message: "The local signing identity is not an active project member" })
        return c.json(
          await ResearchReviewService.createClaim({
            ...body,
            projectRoot: Instance.directory,
            actor: { kind: "human", id: member.id, displayName: member.displayName },
            role: member.role,
            signer,
          }),
        )
      },
    )
    .get(
      "/reviews",
      describeRoute({
        summary: "List signed track reviews",
        operationId: "research.review.list",
        responses: {
          200: {
            description: "Track reviews",
            content: { "application/json": { schema: resolver(z.array(TrackReview)) } },
          },
        },
      }),
      validator("query", z.object({ trackId: z.string().optional() })),
      async (c) => c.json(await ResearchReviewService.listReviews(Instance.directory, c.req.valid("query").trackId)),
    )
    .post(
      "/reviews",
      describeRoute({
        summary: "Record an explicit human track review",
        operationId: "research.review.create",
        responses: {
          200: {
            description: "Signed review decision",
            content: {
              "application/json": {
                schema: resolver(z.object({ review: TrackReview, track: ResearchTrack, eventId: z.string() })),
              },
            },
          },
        },
      }),
      validator("json", ReviewTrack),
      async (c) => {
        const body = c.req.valid("json")
        const signer = await LocalIdentity.loadOrCreate({ passphrase: body.passphrase })
        const member = await ProjectMembership.localMember(Instance.directory, signer.keyId)
        if (!member)
          throw new HTTPException(403, { message: "The local signing identity is not an active project member" })
        return c.json(
          await ResearchReviewService.reviewTrack({
            ...body,
            projectRoot: Instance.directory,
            actor: { kind: "human", id: member.id, displayName: member.displayName },
            role: member.role,
            signer,
          }),
        )
      },
    )
    .get(
      "/integrations",
      describeRoute({
        summary: "List evidence-only integrations",
        operationId: "research.integration.list",
        responses: {
          200: {
            description: "Evidence integrations",
            content: { "application/json": { schema: resolver(z.array(EvidenceIntegration)) } },
          },
        },
      }),
      validator("query", z.object({ trackId: z.string().optional() })),
      async (c) =>
        c.json(await ResearchReviewService.listIntegrations(Instance.directory, c.req.valid("query").trackId)),
    )
    .post(
      "/integrations/evidence",
      describeRoute({
        summary: "Integrate reviewed evidence without changing code",
        operationId: "research.integration.evidence",
        responses: {
          200: {
            description: "Signed evidence-only integration",
            content: {
              "application/json": {
                schema: resolver(z.object({ integration: EvidenceIntegration, eventId: z.string() })),
              },
            },
          },
        },
      }),
      validator("json", IntegrateEvidence),
      async (c) => {
        const body = c.req.valid("json")
        const signer = await LocalIdentity.loadOrCreate({ passphrase: body.passphrase })
        const member = await ProjectMembership.localMember(Instance.directory, signer.keyId)
        if (!member)
          throw new HTTPException(403, { message: "The local signing identity is not an active project member" })
        return c.json(
          await ResearchReviewService.integrateEvidenceOnly({
            projectRoot: Instance.directory,
            reviewId: body.reviewId,
            actor: { kind: "human", id: member.id, displayName: member.displayName },
            role: member.role,
            signer,
          }),
        )
      },
    ),
)
