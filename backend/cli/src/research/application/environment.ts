import path from "node:path"
import { mkdir, open, readFile, readdir, realpath, rename } from "node:fs/promises"
import { CondaEnvironment } from "../adapters/environment/conda"
import { LocalGit } from "../adapters/git/local"
import { FilesystemLedger } from "../adapters/ledger/filesystem"
import { Canonical, type JsonValue } from "../domain/canonical"
import { Governance, ResearchCapability, type ResearchRole } from "../domain/governance"
import { ResearchProject, ResearchTrack, TrackEnvironment, type Actor } from "../domain/schema"
import type { Signer } from "../domain/signature"
import type { ResearchEvent } from "../domain/event"
import { ResearchAudit } from "./audit"
import { ResearchRunService } from "./run"
import { ResearchID } from "../domain/id"
import { ResearchNetworkPolicy } from "./network"

export class EnvironmentUpdateConflictError extends Error {}

function dependencyLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- ") && !line.startsWith("- python=") && line !== "- pip" && line !== "- pip:")
    .map((line) => line.slice(2))
}

async function spec(root: string, relative: string) {
  const file = path.resolve(root, relative)
  const value = path.relative(root, file)
  if (value.startsWith("..") || path.isAbsolute(value)) {
    throw new EnvironmentUpdateConflictError("Environment specification must stay inside the research project")
  }
  const [canonicalRoot, canonicalParent] = await Promise.all([realpath(root), realpath(path.dirname(file))])
  const parent = path.relative(canonicalRoot, canonicalParent)
  if (parent.startsWith("..") || path.isAbsolute(parent)) {
    throw new EnvironmentUpdateConflictError("Environment specification may not traverse a symlink outside the project")
  }
  return file
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

async function atomicText(file: string, value: string) {
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = file + ".tmp"
  const handle = await open(temporary, "w", 0o600)
  try {
    await handle.writeFile(value, "utf8")
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
  export async function plan(input: {
    projectRoot: string
    trackId: string
    python?: string
    condaPackages?: string[]
    pipPackages?: string[]
    solve?: boolean
  }) {
    if (!ResearchID.is("track", input.trackId)) throw new EnvironmentUpdateConflictError("Invalid research track")
    const git = await LocalGit.inspect(input.projectRoot)
    const currentProject = await project(git.root)
    const binding = TrackEnvironment.parse(
      JSON.parse(
        await readFile(
          path.join(git.root, `.openscience/research/projections/environments/tracks/${input.trackId}.json`),
          "utf8",
        ),
      ),
    )
    if (binding.projectId !== currentProject.id) throw new Error("Environment belongs to a different project")
    const current = await readFile(await spec(git.root, binding.portableSpecPath), "utf8")
    const restricted = input.solve && (await ResearchNetworkPolicy.restricted(git.root))
    const proposed = await CondaEnvironment.plan({
      name: binding.name,
      python: input.python,
      condaPackages: input.condaPackages,
      pipPackages: input.pipPackages,
      solve: input.solve && !restricted,
    })
    const solve = restricted
      ? {
          state: "conflict" as const,
          error: "Offline or air-gapped study policy blocks a network-capable Conda solve.",
        }
      : proposed.solve
    const before = new Set(dependencyLines(current))
    const after = new Set(dependencyLines(proposed.content))
    const runs = await ResearchRunService.list(git.root)
    const blockingRuns = runs
      .filter((run) => ["declared", "queued", "running"].includes(run.state))
      .map((run) => ({ id: run.id, state: run.state, iterationId: run.iterationId }))
    return {
      trackId: input.trackId,
      environmentName: binding.name,
      portableSpecPath: binding.portableSpecPath,
      currentEnvironmentYml: current,
      proposedEnvironmentYml: proposed.content,
      currentSpecHash: binding.portableSpecHash,
      proposedSpecHash: proposed.specHash,
      additions: [...after].filter((value) => !before.has(value)),
      removals: [...before].filter((value) => !after.has(value)),
      solve,
      blockingRuns,
      canApply: blockingRuns.length === 0 && solve.state !== "conflict",
    }
  }

  export async function apply(input: {
    projectRoot: string
    trackId: string
    python?: string
    condaPackages?: string[]
    pipPackages?: string[]
    expectedSpecHash: string
    actor: Actor
    role?: ResearchRole
    delegatedCapabilities?: ResearchCapability[]
    signer: Signer
    idempotencyKey?: string
  }) {
    if (!ResearchID.is("track", input.trackId)) throw new EnvironmentUpdateConflictError("Invalid research track")
    Governance.authorize(input, ResearchCapability.environmentManage)
    const git = await LocalGit.inspect(input.projectRoot)
    await ResearchAudit.assertWritable(git.root)
    const currentProject = await project(git.root)
    const binding = TrackEnvironment.parse(
      JSON.parse(
        await readFile(
          path.join(git.root, `.openscience/research/projections/environments/tracks/${input.trackId}.json`),
          "utf8",
        ),
      ),
    )
    const candidate = await CondaEnvironment.plan({
      name: binding.name,
      python: input.python,
      condaPackages: input.condaPackages,
      pipPackages: input.pipPackages,
      solve: false,
    })
    const request: JsonValue = {
      actorId: input.actor.id,
      trackId: input.trackId,
      expectedSpecHash: input.expectedSpecHash,
      proposedSpecHash: candidate.specHash,
    }

    const operation = async () => {
      if (input.idempotencyKey) {
        const existing = await FilesystemLedger.lookupIdempotency({
          projectRoot: git.root,
          projectId: currentProject.id,
          type: "environment.updated",
          key: input.idempotencyKey,
          request,
        })
        if (existing) {
          const payload = existing.payload as Record<string, unknown>
          const environment = TrackEnvironment.parse(payload.environment)
          await atomic(
            path.join(git.root, `.openscience/research/projections/environments/tracks/${environment.trackId}.json`),
            environment as JsonValue,
          )
          return {
            environment,
            eventId: existing.eventId,
            replayed: true,
            additions: Array.isArray(payload.additions) ? payload.additions.map(String) : [],
            removals: Array.isArray(payload.removals) ? payload.removals.map(String) : [],
            rollback: `Restore ${environment.portableSpecPath} from Git and submit a new reviewed environment plan.`,
          }
        }
      }
      const preview = await plan({ ...input, solve: false })
      if (preview.currentSpecHash !== input.expectedSpecHash) {
        throw new EnvironmentUpdateConflictError(
          "Environment changed after preview; review the latest plan before applying",
        )
      }
      if (preview.blockingRuns.length) {
        throw new EnvironmentUpdateConflictError(
          "Environment cannot change while declared, queued, or running formal runs depend on it",
        )
      }
      const current = TrackEnvironment.parse(
        JSON.parse(
          await readFile(
            path.join(git.root, `.openscience/research/projections/environments/tracks/${input.trackId}.json`),
            "utf8",
          ),
        ),
      )
      const now = new Date().toISOString()
      const environment = TrackEnvironment.parse({
        ...current,
        portableSpecHash: preview.proposedSpecHash,
        createdAt: now,
        createdBy: input.actor,
      })
      const file = await spec(git.root, environment.portableSpecPath)
      await atomicText(file, preview.proposedEnvironmentYml)
      const appended = await (
        input.idempotencyKey
          ? FilesystemLedger.appendIdempotent({
              projectRoot: git.root,
              projectId: currentProject.id,
              type: "environment.updated",
              actor: input.actor,
              payload: { environment, additions: preview.additions, removals: preview.removals },
              signer: input.signer,
              key: input.idempotencyKey,
              request,
              occurredAt: now,
            })
          : FilesystemLedger.append({
              projectRoot: git.root,
              projectId: currentProject.id,
              type: "environment.updated",
              actor: input.actor,
              payload: { environment, additions: preview.additions, removals: preview.removals },
              signer: input.signer,
              occurredAt: now,
            }).then((event) => ({ event, replayed: false }))
      ).catch(async (error) => {
        await atomicText(file, preview.currentEnvironmentYml)
        throw error
      })
      await atomic(
        path.join(git.root, `.openscience/research/projections/environments/tracks/${environment.trackId}.json`),
        environment as JsonValue,
      )
      return {
        environment,
        eventId: appended.event.eventId,
        replayed: appended.replayed,
        additions: preview.additions,
        removals: preview.removals,
        rollback: `Restore ${environment.portableSpecPath} from Git and submit a new reviewed environment plan.`,
      }
    }
    return input.idempotencyKey
      ? FilesystemLedger.withIdempotencyLock({
          projectRoot: git.root,
          projectId: currentProject.id,
          key: input.idempotencyKey,
          operation,
        })
      : operation()
  }

  export async function isolate(input: {
    projectRoot: string
    trackId: string
    actor: Actor
    role?: ResearchRole
    delegatedCapabilities?: ResearchCapability[]
    signer: Signer
    idempotencyKey?: string
  }) {
    if (!ResearchID.is("track", input.trackId)) throw new EnvironmentUpdateConflictError("Invalid research track")
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
