import path from "node:path"
import { mkdir, open, readFile, readdir, rename } from "node:fs/promises"
import { FilesystemLedger } from "../adapters/ledger/filesystem"
import { LocalGit } from "../adapters/git/local"
import { Canonical, type JsonValue } from "../domain/canonical"
import { Governance, ResearchCapability, type ResearchRole } from "../domain/governance"
import { ResearchID } from "../domain/id"
import {
  ProtocolContent,
  ProtocolRevision,
  ResearchIteration,
  ResearchProject,
  ResearchTrack,
  type Actor,
} from "../domain/schema"
import type { Signer } from "../domain/signature"
import { ResearchAudit } from "./audit"
import type { ResearchEvent } from "../domain/event"

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

async function load<T>(file: string, parse: (value: unknown) => T) {
  return parse(JSON.parse(await readFile(file, "utf8")))
}

async function ensureProjection<T>(file: string, value: T, parse: (value: unknown) => T) {
  try {
    return await load(file, parse)
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : undefined
    if (code !== "ENOENT") throw error
    await atomic(file, value as JsonValue)
    return value
  }
}

async function project(root: string) {
  return load(path.join(root, ".openscience/research/project.json"), ResearchProject.parse)
}

function slug(value: string) {
  return (
    value
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "iteration"
  )
}

type Authorization = { actor: Actor; role?: ResearchRole; delegatedCapabilities?: ResearchCapability[]; signer: Signer }

function replayedIteration(event: ResearchEvent) {
  if (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) {
    throw new Error(`Idempotent event ${event.eventId} has an invalid iteration payload`)
  }
  const payload = event.payload as Record<string, unknown>
  return {
    iteration: ResearchIteration.parse(payload.iteration),
    protocol: ProtocolRevision.parse(payload.protocol),
    eventId: event.eventId,
    replayed: true,
  }
}

async function materializeIteration(projectRoot: string, value: ReturnType<typeof replayedIteration>) {
  await ensureProjection(
    path.join(projectRoot, `.openscience/research/iterations/${value.iteration.id}.json`),
    value.iteration,
    ResearchIteration.parse,
  )
  await ensureProjection(
    path.join(projectRoot, `.openscience/research/projections/protocols/${value.protocol.id}.json`),
    value.protocol,
    ProtocolRevision.parse,
  )
  return value
}

function replayedProtocolFreeze(event: ResearchEvent) {
  if (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) {
    throw new Error(`Idempotent event ${event.eventId} has an invalid protocol payload`)
  }
  const payload = event.payload as Record<string, unknown>
  return {
    iteration: ResearchIteration.parse(payload.iteration),
    protocol: ProtocolRevision.parse(payload.protocol),
    eventId: event.eventId,
    replayed: true,
  }
}

export namespace InvestigationService {
  export async function createIteration(
    input: Authorization & {
      projectRoot: string
      trackId: string
      title: string
      question: string
      decisionGoal: string
      content: ProtocolContent
      alias?: string
      idempotencyKey?: string
    },
  ) {
    Governance.authorize(input, ResearchCapability.iterationCreate)
    Governance.authorize(input, ResearchCapability.protocolEdit)
    const git = await LocalGit.inspect(input.projectRoot)
    await ResearchAudit.assertWritable(git.root)
    const currentProject = await project(git.root)
    const track = await load(
      path.join(git.root, `.openscience/research/tracks/${input.trackId}.json`),
      ResearchTrack.parse,
    )
    if (track.projectId !== currentProject.id) throw new Error("Track belongs to a different research project")
    const content = ProtocolContent.parse(input.content)
    const request: JsonValue = {
      actorId: input.actor.id,
      trackId: track.id,
      title: input.title,
      question: input.question,
      decisionGoal: input.decisionGoal,
      alias: input.alias ?? null,
      content: content as JsonValue,
    }
    const operation = async () => {
      if (input.idempotencyKey) {
        const existing = await FilesystemLedger.lookupIdempotency({
          projectRoot: git.root,
          projectId: currentProject.id,
          type: "iteration.created",
          key: input.idempotencyKey,
          request,
        })
        if (existing) return materializeIteration(git.root, replayedIteration(existing))
      }
      const iterationDirectory = path.join(git.root, ".openscience/research/iterations")
      const names = await readdir(iterationDirectory).catch(() => [])
      const iterations = await Promise.all(
        names
          .filter((name) => name.endsWith(".json"))
          .map((name) => load(path.join(iterationDirectory, name), ResearchIteration.parse)),
      )
      const selectedAlias = slug(input.alias || input.title)
      if (iterations.some((iteration) => iteration.trackId === track.id && iteration.alias === selectedAlias)) {
        throw new Error(`Iteration alias ${selectedAlias} already exists in this track`)
      }
      const now = new Date().toISOString()
      const iteration = ResearchIteration.parse({
        schemaVersion: 1,
        id: ResearchID.create("iteration"),
        projectId: currentProject.id,
        trackId: track.id,
        alias: selectedAlias,
        title: input.title,
        mode: content.mode,
        question: input.question,
        decisionGoal: input.decisionGoal,
        state: "draft",
        createdAt: now,
        createdBy: input.actor,
      })
      const protocol = ProtocolRevision.parse({
        schemaVersion: 1,
        id: ResearchID.create("protocol"),
        projectId: currentProject.id,
        iterationId: iteration.id,
        revision: 1,
        mode: content.mode,
        content,
        frozenAt: null,
        resultsViewedBeforeAmendment: false,
        createdAt: now,
        createdBy: input.actor,
      })
      const appended = input.idempotencyKey
        ? await FilesystemLedger.appendIdempotent({
            projectRoot: git.root,
            projectId: currentProject.id,
            type: "iteration.created",
            actor: input.actor,
            payload: { iteration, protocol },
            signer: input.signer,
            occurredAt: now,
            key: input.idempotencyKey,
            request,
          })
        : {
            event: await FilesystemLedger.append({
              projectRoot: git.root,
              projectId: currentProject.id,
              type: "iteration.created",
              actor: input.actor,
              payload: { iteration, protocol },
              signer: input.signer,
              occurredAt: now,
            }),
            replayed: false,
          }
      if (appended.replayed) return materializeIteration(git.root, replayedIteration(appended.event))
      return materializeIteration(git.root, {
        iteration,
        protocol,
        eventId: appended.event.eventId,
        replayed: false,
      })
    }
    if (!input.idempotencyKey) return operation()
    return FilesystemLedger.withIdempotencyLock({
      projectRoot: git.root,
      projectId: currentProject.id,
      key: input.idempotencyKey,
      operation,
    })
  }

  export async function freezeProtocol(
    input: Authorization & { projectRoot: string; protocolId: string; idempotencyKey?: string },
  ) {
    Governance.authorize(input, ResearchCapability.protocolFreeze)
    const git = await LocalGit.inspect(input.projectRoot)
    await ResearchAudit.assertWritable(git.root)
    const currentProject = await project(git.root)
    const request: JsonValue = { actorId: input.actor.id, protocolId: input.protocolId }
    const materialize = async (value: ReturnType<typeof replayedProtocolFreeze>) => {
      const protocolFile = path.join(git.root, `.openscience/research/projections/protocols/${value.protocol.id}.json`)
      const currentProtocol = await ensureProjection(protocolFile, value.protocol, ProtocolRevision.parse)
      if (!currentProtocol.frozenAt) await atomic(protocolFile, value.protocol as JsonValue)
      if (Canonical.hash(currentProtocol.content) !== Canonical.hash(value.protocol.content)) {
        throw new Error(`Protocol projection ${value.protocol.id} conflicts with its signed freeze event`)
      }
      const iterationFile = path.join(git.root, `.openscience/research/iterations/${value.iteration.id}.json`)
      const currentIteration = await ensureProjection(iterationFile, value.iteration, ResearchIteration.parse)
      if (currentIteration.state === "draft") await atomic(iterationFile, value.iteration as JsonValue)
      return value
    }
    const operation = async () => {
      if (input.idempotencyKey) {
        const existing = await FilesystemLedger.lookupIdempotency({
          projectRoot: git.root,
          projectId: currentProject.id,
          type: "protocol.frozen",
          key: input.idempotencyKey,
          request,
        })
        if (existing) return materialize(replayedProtocolFreeze(existing))
      }
      const file = path.join(git.root, `.openscience/research/projections/protocols/${input.protocolId}.json`)
      const protocol = await load(file, ProtocolRevision.parse)
      if (protocol.projectId !== currentProject.id) throw new Error("Protocol belongs to a different research project")
      if (protocol.frozenAt) throw new Error(`Protocol ${protocol.id} is already frozen`)
      const iteration = await load(
        path.join(git.root, `.openscience/research/iterations/${protocol.iterationId}.json`),
        ResearchIteration.parse,
      )
      if (iteration.projectId !== currentProject.id) {
        throw new Error("Iteration belongs to a different research project")
      }
      if (iteration.state !== "draft") {
        throw new Error(`Iteration ${iteration.id} cannot freeze a protocol from state ${iteration.state}`)
      }
      const now = new Date().toISOString()
      const frozen = ProtocolRevision.parse({ ...protocol, frozenAt: now })
      const ready = ResearchIteration.parse({ ...iteration, state: "protocol_ready" })
      const appended = input.idempotencyKey
        ? await FilesystemLedger.appendIdempotent({
            projectRoot: git.root,
            projectId: currentProject.id,
            type: "protocol.frozen",
            actor: input.actor,
            payload: { protocol: frozen, iteration: ready, contentHash: Canonical.hash(frozen.content) },
            signer: input.signer,
            occurredAt: now,
            key: input.idempotencyKey,
            request,
          })
        : {
            event: await FilesystemLedger.append({
              projectRoot: git.root,
              projectId: currentProject.id,
              type: "protocol.frozen",
              actor: input.actor,
              payload: { protocol: frozen, iteration: ready, contentHash: Canonical.hash(frozen.content) },
              signer: input.signer,
              occurredAt: now,
            }),
            replayed: false,
          }
      if (appended.replayed) return materialize(replayedProtocolFreeze(appended.event))
      return materialize({
        protocol: frozen,
        iteration: ready,
        eventId: appended.event.eventId,
        replayed: false,
      })
    }
    if (!input.idempotencyKey) return operation()
    return FilesystemLedger.withIdempotencyLock({
      projectRoot: git.root,
      projectId: currentProject.id,
      key: input.idempotencyKey,
      operation,
    })
  }

  export async function listIterations(projectRoot: string, trackId?: string) {
    const git = await LocalGit.inspect(projectRoot)
    const directory = path.join(git.root, ".openscience/research/iterations")
    const names = await readdir(directory).catch(() => [])
    const values = await Promise.all(
      names
        .filter((name) => name.endsWith(".json"))
        .map((name) => load(path.join(directory, name), ResearchIteration.parse)),
    )
    return values.filter((iteration) => !trackId || iteration.trackId === trackId)
  }

  export async function listProtocols(projectRoot: string, iterationId?: string) {
    const git = await LocalGit.inspect(projectRoot)
    const directory = path.join(git.root, ".openscience/research/projections/protocols")
    const names = await readdir(directory).catch(() => [])
    const values = await Promise.all(
      names
        .filter((name) => name.endsWith(".json"))
        .map((name) => load(path.join(directory, name), ProtocolRevision.parse)),
    )
    return values
      .filter((protocol) => !iterationId || protocol.iterationId === iterationId)
      .sort((a, b) => a.iterationId.localeCompare(b.iterationId) || a.revision - b.revision)
  }
}
