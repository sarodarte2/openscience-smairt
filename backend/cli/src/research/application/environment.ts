import path from "node:path"
import { mkdir, open, readFile, readdir, rename } from "node:fs/promises"
import { CondaEnvironment } from "../adapters/environment/conda"
import { LocalGit } from "../adapters/git/local"
import { FilesystemLedger } from "../adapters/ledger/filesystem"
import { Canonical, type JsonValue } from "../domain/canonical"
import { Governance, ResearchCapability, type ResearchRole } from "../domain/governance"
import { ResearchProject, ResearchTrack, TrackEnvironment, type Actor } from "../domain/schema"
import type { Signer } from "../domain/signature"
import type { ResearchEvent } from "../domain/event"
import { ResearchAudit } from "./audit"

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

async function project(root: string) {
  return ResearchProject.parse(
    JSON.parse(await readFile(path.join(root, ".openscience/research/project.json"), "utf8")),
  )
}

function replayedEnvironment(event: ResearchEvent) {
  if (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) {
    throw new Error(`Idempotent event ${event.eventId} has an invalid environment payload`)
  }
  return {
    environment: TrackEnvironment.parse((event.payload as Record<string, unknown>).environment),
    eventId: event.eventId,
    replayed: true,
  }
}

async function materialize(root: string, value: ReturnType<typeof replayedEnvironment>) {
  const file = path.join(
    root,
    `.openscience/research/projections/environments/tracks/${value.environment.trackId}.json`,
  )
  const current = await readFile(file, "utf8")
    .then((content) => TrackEnvironment.parse(JSON.parse(content)))
    .catch((error: unknown) => {
      const code = error instanceof Error && "code" in error ? error.code : undefined
      if (code === "ENOENT") return null
      throw error
    })
  if (!current || current.state !== "diverged") {
    await atomic(file, value.environment as JsonValue)
    return value
  }
  if (current.name !== value.environment.name || current.portableSpecHash !== value.environment.portableSpecHash) {
    throw new Error(`Track ${value.environment.trackId} has a newer divergent environment binding`)
  }
  return value
}

export namespace ResearchEnvironmentService {
  export async function isolate(input: {
    projectRoot: string
    trackId: string
    actor: Actor
    role?: ResearchRole
    delegatedCapabilities?: ResearchCapability[]
    signer: Signer
    idempotencyKey?: string
  }) {
    Governance.authorize(input, ResearchCapability.environmentManage)
    const git = await LocalGit.inspect(input.projectRoot)
    await ResearchAudit.assertWritable(git.root)
    const currentProject = await project(git.root)
    const request: JsonValue = { actorId: input.actor.id, trackId: input.trackId }
    const operation = async () => {
      if (input.idempotencyKey) {
        const existing = await FilesystemLedger.lookupIdempotency({
          projectRoot: git.root,
          projectId: currentProject.id,
          type: "environment.diverged",
          key: input.idempotencyKey,
          request,
        })
        if (existing) return materialize(git.root, replayedEnvironment(existing))
      }
      const track = ResearchTrack.parse(
        JSON.parse(await readFile(path.join(git.root, `.openscience/research/tracks/${input.trackId}.json`), "utf8")),
      )
      if (track.projectId !== currentProject.id) throw new Error("Track belongs to a different research project")
      const bindingFile = path.join(git.root, `.openscience/research/projections/environments/tracks/${track.id}.json`)
      const current = TrackEnvironment.parse(JSON.parse(await readFile(bindingFile, "utf8")))
      if (current.state === "diverged") throw new Error(`Track ${track.id} already has an isolated environment`)
      const isolated = await CondaEnvironment.isolate({
        projectRoot: git.root,
        projectName: currentProject.name,
        trackId: track.id,
        sourceSpecPath: current.portableSpecPath,
        create: false,
      })
      const now = new Date().toISOString()
      const environment = TrackEnvironment.parse({
        ...current,
        name: isolated.name,
        portableSpecPath: path.relative(git.root, isolated.file),
        portableSpecHash: isolated.specHash,
        state: "diverged",
        createdAt: now,
        createdBy: input.actor,
      })
      const appended = input.idempotencyKey
        ? await FilesystemLedger.appendIdempotent({
            projectRoot: git.root,
            projectId: currentProject.id,
            type: "environment.diverged",
            actor: input.actor,
            payload: { environment },
            signer: input.signer,
            occurredAt: now,
            key: input.idempotencyKey,
            request,
          })
        : {
            event: await FilesystemLedger.append({
              projectRoot: git.root,
              projectId: currentProject.id,
              type: "environment.diverged",
              actor: input.actor,
              payload: { environment },
              signer: input.signer,
              occurredAt: now,
            }),
            replayed: false,
          }
      const value = appended.replayed
        ? replayedEnvironment(appended.event)
        : { environment, eventId: appended.event.eventId, replayed: false }
      return materialize(git.root, value)
    }
    const result = input.idempotencyKey
      ? await FilesystemLedger.withIdempotencyLock({
          projectRoot: git.root,
          projectId: currentProject.id,
          key: input.idempotencyKey,
          operation,
        })
      : await operation()
    return {
      ...result,
      provision: {
        command: "conda",
        args: ["env", "create", "--file", result.environment.portableSpecPath, "--yes"],
      },
    }
  }

  export async function list(projectRoot: string) {
    const git = await LocalGit.inspect(projectRoot)
    const directory = path.join(git.root, ".openscience/research/projections/environments/tracks")
    const names = await readdir(directory).catch(() => [])
    return Promise.all(
      names
        .filter((name) => name.endsWith(".json"))
        .map(async (name) => TrackEnvironment.parse(JSON.parse(await readFile(path.join(directory, name), "utf8")))),
    )
  }
}
