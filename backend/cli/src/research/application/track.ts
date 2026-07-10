import path from "node:path"
import { mkdir, open, readFile, readdir, rename } from "node:fs/promises"
import { createHash } from "node:crypto"
import { LocalGit, type GitWorkspace } from "../adapters/git/local"
import { FilesystemLedger } from "../adapters/ledger/filesystem"
import { Canonical, type JsonValue } from "../domain/canonical"
import { Governance, ResearchCapability, type ResearchRole } from "../domain/governance"
import { ResearchID } from "../domain/id"
import { ResearchProject, ResearchTrack, TrackEnvironment, WorkspaceBinding, type Actor } from "../domain/schema"
import type { Signer } from "../domain/signature"
import { ResearchAudit } from "./audit"
import type { ResearchEvent } from "../domain/event"

function alias(value: string) {
  const normalized = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
  return normalized || "track"
}

async function atomic(file: string, value: JsonValue) {
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = file + ".tmp"
  const handle = await open(temporary, "w", 0o600)
  try {
    await handle.writeFile(Canonical.stringify(value) + "\n", "utf8")
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(temporary, file)
}

async function records<T>(directory: string, parse: (value: unknown) => T): Promise<T[]> {
  const names = await readdir(directory).catch(() => [])
  return Promise.all(
    names
      .filter((name) => name.endsWith(".json"))
      .map(async (name) => parse(JSON.parse(await readFile(path.join(directory, name), "utf8")))),
  )
}

async function workspace(input: {
  root: string
  kind: "none" | "current" | "new-worktree"
  branch?: string
  worktreePath?: string
}): Promise<GitWorkspace | null> {
  if (input.kind === "none") return null
  if (input.kind === "current") return LocalGit.inspect(input.root)
  if (!input.branch || !input.worktreePath) throw new Error("A branch and worktree path are required")
  return LocalGit.createWorktree({
    repositoryRoot: input.root,
    branch: input.branch,
    worktreePath: input.worktreePath,
  })
}

function replayedTrack(event: ResearchEvent) {
  if (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) {
    throw new Error(`Idempotent event ${event.eventId} has an invalid track payload`)
  }
  const payload = event.payload as Record<string, unknown>
  return {
    track: ResearchTrack.parse(payload.track),
    binding: payload.binding === null ? null : WorkspaceBinding.parse(payload.binding),
    environment: payload.environment ? TrackEnvironment.parse(payload.environment) : null,
    eventId: event.eventId,
    replayed: true,
  }
}

async function materializeTrack(projectRoot: string, value: ReturnType<typeof replayedTrack>) {
  const trackFile = path.join(projectRoot, `.openscience/research/tracks/${value.track.id}.json`)
  await readFile(trackFile, "utf8")
    .then((content) => ResearchTrack.parse(JSON.parse(content)))
    .catch(async (error: unknown) => {
      const code = error instanceof Error && "code" in error ? error.code : undefined
      if (code !== "ENOENT") throw error
      await atomic(trackFile, value.track as JsonValue)
    })
  if (value.binding) {
    const bindingFile = path.join(projectRoot, `.openscience/research/projections/workspaces/${value.binding.id}.json`)
    await readFile(bindingFile, "utf8")
      .then((content) => WorkspaceBinding.parse(JSON.parse(content)))
      .catch(async (error: unknown) => {
        const code = error instanceof Error && "code" in error ? error.code : undefined
        if (code !== "ENOENT") throw error
        await atomic(bindingFile, value.binding as JsonValue)
      })
  }
  if (value.environment) {
    const environmentFile = path.join(
      projectRoot,
      `.openscience/research/projections/environments/tracks/${value.environment.trackId}.json`,
    )
    await readFile(environmentFile, "utf8")
      .then((content) => TrackEnvironment.parse(JSON.parse(content)))
      .catch(async (error: unknown) => {
        const code = error instanceof Error && "code" in error ? error.code : undefined
        if (code !== "ENOENT") throw error
        await atomic(environmentFile, value.environment as JsonValue)
      })
  }
  return value
}

export namespace ResearchTrackService {
  export async function create(input: {
    projectRoot: string
    title: string
    objective: string
    alias?: string
    parentTrackIds?: string[]
    workspace: { kind: "none" | "current" | "new-worktree"; branch?: string; worktreePath?: string }
    actor: Actor
    role?: ResearchRole
    delegatedCapabilities?: ResearchCapability[]
    signer: Signer
    idempotencyKey?: string
  }) {
    Governance.authorize(input, ResearchCapability.trackCreate)
    const git = await LocalGit.inspect(input.projectRoot)
    await ResearchAudit.assertWritable(git.root)
    const project = ResearchProject.parse(
      JSON.parse(await readFile(path.join(git.root, ".openscience/research/project.json"), "utf8")),
    )
    const request: JsonValue = {
      actorId: input.actor.id,
      title: input.title,
      objective: input.objective,
      alias: input.alias ?? null,
      parentTrackIds: input.parentTrackIds ?? null,
      workspace: {
        kind: input.workspace.kind,
        branch: input.workspace.branch ?? null,
        worktreePath: input.workspace.worktreePath ?? null,
      },
    }
    const operation = async () => {
      if (input.idempotencyKey) {
        const existing = await FilesystemLedger.lookupIdempotency({
          projectRoot: git.root,
          projectId: project.id,
          type: "track.created",
          key: input.idempotencyKey,
          request,
        })
        if (existing) return materializeTrack(git.root, replayedTrack(existing))
      }
      const trackDirectory = path.join(git.root, ".openscience/research/tracks")
      const tracks = await records(trackDirectory, ResearchTrack.parse)
      const selectedAlias = alias(input.alias || input.title)
      if (tracks.some((track) => track.alias === selectedAlias))
        throw new Error(`Track alias ${selectedAlias} already exists`)
      const selectedWorkspace = await workspace({ root: git.root, ...input.workspace })
      const existingBindings = await records(
        path.join(git.root, ".openscience/research/projections/workspaces"),
        WorkspaceBinding.parse,
      )
      if (
        selectedWorkspace &&
        existingBindings.some(
          (binding) =>
            binding.active &&
            binding.worktreePath === selectedWorkspace.root &&
            binding.branch === selectedWorkspace.branch,
        )
      ) {
        throw new Error(`Workspace ${selectedWorkspace.branch} is already bound to an active track`)
      }

      const now = new Date().toISOString()
      const parentTrackIds = input.parentTrackIds ?? [project.coreTrackId]
      for (const parentTrackId of parentTrackIds) {
        if (!tracks.some((candidate) => candidate.id === parentTrackId)) {
          throw new Error(`Parent track ${parentTrackId} does not exist in this research project`)
        }
      }
      const track = ResearchTrack.parse({
        schemaVersion: 1,
        id: ResearchID.create("track"),
        projectId: project.id,
        alias: selectedAlias,
        title: input.title,
        objective: input.objective,
        state: "active",
        hidden: false,
        parentTrackIds,
        createdAt: now,
        createdBy: input.actor,
      })
      const binding = selectedWorkspace
        ? WorkspaceBinding.parse({
            schemaVersion: 1,
            id: ResearchID.create("workspace"),
            projectId: project.id,
            trackId: track.id,
            repositoryRoot: git.root,
            worktreePath: selectedWorkspace.root,
            branch: selectedWorkspace.branch,
            boundAtCommit: selectedWorkspace.commit,
            active: true,
            createdAt: now,
            createdBy: input.actor,
          })
        : null
      const parentTrackId = parentTrackIds[0] ?? project.coreTrackId
      const parentEnvironmentFile = path.join(
        git.root,
        `.openscience/research/projections/environments/tracks/${parentTrackId}.json`,
      )
      const parentEnvironment = await readFile(parentEnvironmentFile, "utf8")
        .then((content) => TrackEnvironment.parse(JSON.parse(content)))
        .catch(async (error: unknown) => {
          const code = error instanceof Error && "code" in error ? error.code : undefined
          if (code !== "ENOENT" || parentTrackId !== project.coreTrackId) throw error
          const portableSpecPath = ".openscience/research/environment.yml"
          const content = await readFile(path.join(git.root, portableSpecPath), "utf8")
          return TrackEnvironment.parse({
            schemaVersion: 1,
            projectId: project.id,
            trackId: project.coreTrackId,
            kind: "conda",
            name: project.defaultEnvironment.name,
            portableSpecPath,
            portableSpecHash: createHash("sha256").update(content).digest("hex"),
            state: "base",
            inheritedFromTrackId: null,
            createdAt: project.createdAt,
            createdBy: project.createdBy,
          })
        })
      const environment = TrackEnvironment.parse({
        ...parentEnvironment,
        trackId: track.id,
        state: "inherited",
        inheritedFromTrackId: parentEnvironment.trackId,
        createdAt: now,
        createdBy: input.actor,
      })
      const appended = input.idempotencyKey
        ? await FilesystemLedger.appendIdempotent({
            projectRoot: git.root,
            projectId: project.id,
            type: "track.created",
            actor: input.actor,
            payload: { track, binding, environment },
            signer: input.signer,
            occurredAt: now,
            key: input.idempotencyKey,
            request,
          })
        : {
            event: await FilesystemLedger.append({
              projectRoot: git.root,
              projectId: project.id,
              type: "track.created",
              actor: input.actor,
              payload: { track, binding, environment },
              signer: input.signer,
              occurredAt: now,
            }),
            replayed: false,
          }
      if (appended.replayed) return materializeTrack(git.root, replayedTrack(appended.event))
      return materializeTrack(git.root, {
        track,
        binding,
        environment,
        eventId: appended.event.eventId,
        replayed: false,
      })
    }
    if (!input.idempotencyKey) return operation()
    return FilesystemLedger.withIdempotencyLock({
      projectRoot: git.root,
      projectId: project.id,
      key: input.idempotencyKey,
      operation,
    })
  }

  export async function list(projectRoot: string) {
    const git = await LocalGit.inspect(projectRoot)
    return records(path.join(git.root, ".openscience/research/tracks"), ResearchTrack.parse)
  }
}
