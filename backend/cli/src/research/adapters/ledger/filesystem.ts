import path from "node:path"
import { randomUUID } from "node:crypto"
import { access, mkdir, open, readFile, readdir, rename, rm, writeFile } from "node:fs/promises"
import { Canonical, type JsonValue } from "../../domain/canonical"
import { Event, type EventParent, type ResearchEvent } from "../../domain/event"
import { ResearchID } from "../../domain/id"
import type { Actor } from "../../domain/schema"
import type { Signer } from "../../domain/signature"

export interface LedgerDiagnostic {
  code:
    | "invalid_json"
    | "invalid_event"
    | "filename_mismatch"
    | "missing_parent"
    | "parent_hash_mismatch"
    | "cyclic_parent"
    | "project_mismatch"
  file: string
  message: string
}

export interface LedgerSnapshot {
  events: ResearchEvent[]
  diagnostics: LedgerDiagnostic[]
  readOnly: boolean
  heads: EventParent[]
}

export class LedgerIntegrityError extends Error {
  constructor(readonly diagnostics: LedgerDiagnostic[]) {
    super("Research ledger failed integrity verification and is read-only")
  }
}

export class LedgerLockTimeoutError extends Error {
  constructor(readonly lockPath: string) {
    super(`Timed out waiting for the research ledger lock at ${lockPath}`)
  }
}

export class LedgerProjectMismatchError extends Error {
  constructor(
    readonly expected: string,
    readonly received: string,
  ) {
    super(`Research ledger belongs to ${expected}, not ${received}`)
  }
}

export class IdempotencyConflictError extends Error {
  constructor(readonly keyHash: string) {
    super("Idempotency key was already used for a different research mutation")
  }
}

const ROOT = ".openscience/research"

function paths(projectRoot: string) {
  const root = path.join(projectRoot, ROOT)
  return {
    root,
    events: path.join(root, "ledger/events"),
    lock: path.join(root, ".write.lock"),
  }
}

function idempotency(projectId: string, key: string, request: JsonValue) {
  return {
    keyHash: Canonical.hash({ projectId, key }),
    requestHash: Canonical.hash(request),
  }
}

function replay(snapshot: LedgerSnapshot, type: string, value: { keyHash: string; requestHash: string }) {
  const event = snapshot.events.find((candidate) => candidate.idempotency?.keyHash === value.keyHash)
  if (!event) return null
  if (event.type !== type || event.idempotency?.requestHash !== value.requestHash) {
    throw new IdempotencyConflictError(value.keyHash)
  }
  return event
}

function wait(duration: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, duration))
}

async function acquire(lockPath: string, deadline: number): Promise<AsyncDisposable> {
  try {
    await mkdir(lockPath)
    await writeFile(
      path.join(lockPath, "owner.json"),
      JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }) + "\n",
      { flag: "wx" },
    )
    return {
      async [Symbol.asyncDispose]() {
        await rm(lockPath, { recursive: true, force: true })
      },
    }
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : undefined
    if (code !== "EEXIST") throw error
    if (Date.now() >= deadline) throw new LedgerLockTimeoutError(lockPath)
    await wait(40)
    return acquire(lockPath, deadline)
  }
}

function heads(events: ResearchEvent[]): EventParent[] {
  const parents = new Set(events.flatMap((event) => event.parents.map((parent) => parent.eventId)))
  return events
    .filter((event) => !parents.has(event.eventId))
    .map((event) => ({ eventId: event.eventId, hash: event.eventHash }))
    .sort((a, b) => a.eventId.localeCompare(b.eventId))
}

function topological(events: ResearchEvent[], diagnostics: LedgerDiagnostic[]) {
  const byId = new Map(events.map((event) => [event.eventId, event]))
  const visited = new Set<string>()
  const visiting = new Set<string>()
  const ordered: ResearchEvent[] = []

  function visit(event: ResearchEvent) {
    if (visited.has(event.eventId)) return
    if (visiting.has(event.eventId)) {
      diagnostics.push({ code: "cyclic_parent", file: event.eventId, message: "Event parent graph contains a cycle" })
      return
    }
    visiting.add(event.eventId)
    for (const parent of event.parents) {
      const found = byId.get(parent.eventId)
      if (found) visit(found)
    }
    visiting.delete(event.eventId)
    visited.add(event.eventId)
    ordered.push(event)
  }

  for (const event of [...events].sort((a, b) => a.eventId.localeCompare(b.eventId))) visit(event)
  return ordered
}

async function read(projectRoot: string): Promise<LedgerSnapshot> {
  const directory = paths(projectRoot).events
  const names = await readdir(directory).catch((error: unknown) => {
    const code = error instanceof Error && "code" in error ? error.code : undefined
    if (code === "ENOENT") return []
    throw error
  })
  const files = names.filter((name) => name.endsWith(".json")).sort()
  const events: ResearchEvent[] = []
  const diagnostics: LedgerDiagnostic[] = []

  for (const name of files) {
    const file = path.join(directory, name)
    const content = await readFile(file, "utf8")
    try {
      const value: unknown = JSON.parse(content)
      const result = Event.verify(value)
      if (!result.valid) {
        diagnostics.push({ code: "invalid_event", file, message: result.reason })
        continue
      }
      if (name !== result.event.eventId + ".json") {
        diagnostics.push({ code: "filename_mismatch", file, message: "Event ID does not match its filename" })
        continue
      }
      events.push(result.event)
    } catch (error) {
      diagnostics.push({
        code: "invalid_json",
        file,
        message: error instanceof Error ? error.message : "Event is not valid JSON",
      })
    }
  }

  const byId = new Map(events.map((event) => [event.eventId, event]))
  const projectId = events[0]?.projectId
  for (const event of events) {
    if (projectId && event.projectId !== projectId) {
      diagnostics.push({
        code: "project_mismatch",
        file: event.eventId,
        message: `Event belongs to ${event.projectId}; expected ${projectId}`,
      })
    }
    for (const parent of event.parents) {
      const found = byId.get(parent.eventId)
      if (!found) {
        diagnostics.push({ code: "missing_parent", file: event.eventId, message: `Missing parent ${parent.eventId}` })
        continue
      }
      if (found.eventHash !== parent.hash) {
        diagnostics.push({
          code: "parent_hash_mismatch",
          file: event.eventId,
          message: `Parent hash does not match ${parent.eventId}`,
        })
      }
    }
  }

  const ordered = topological(events, diagnostics)
  return { events: ordered, diagnostics, readOnly: diagnostics.length > 0, heads: heads(ordered) }
}

async function persist(projectRoot: string, event: ResearchEvent) {
  const directory = paths(projectRoot).events
  await mkdir(directory, { recursive: true })
  const target = path.join(directory, event.eventId + ".json")
  await access(target)
    .then(() => {
      throw new Error(`Event ${event.eventId} already exists`)
    })
    .catch((error: unknown) => {
      const code = error instanceof Error && "code" in error ? error.code : undefined
      if (code !== "ENOENT") throw error
    })
  const temporary = path.join(directory, `.${event.eventId}.${randomUUID()}.tmp`)
  const handle = await open(temporary, "wx", 0o600)
  try {
    await handle.writeFile(Canonical.stringify(event as JsonValue) + "\n", "utf8")
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await rename(temporary, target)
    const directoryHandle = await open(directory, "r")
    try {
      await directoryHandle.sync()
    } finally {
      await directoryHandle.close()
    }
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}

export namespace FilesystemLedger {
  export const inspect = read

  function assertWritable(snapshot: LedgerSnapshot, projectId: string) {
    if (snapshot.readOnly) throw new LedgerIntegrityError(snapshot.diagnostics)
    const existingProject = snapshot.events[0]?.projectId
    if (existingProject && existingProject !== projectId) {
      throw new LedgerProjectMismatchError(existingProject, projectId)
    }
  }

  export async function append(input: {
    projectRoot: string
    projectId: string
    eventId?: string
    type: string
    actor: Actor
    payload: JsonValue
    signer: Signer
    parents?: EventParent[]
    occurredAt?: string
    lockTimeoutMs?: number
  }): Promise<ResearchEvent> {
    const project = paths(input.projectRoot)
    await mkdir(project.root, { recursive: true })
    await using lock = await acquire(project.lock, Date.now() + (input.lockTimeoutMs ?? 5000))
    const snapshot = await read(input.projectRoot)
    assertWritable(snapshot, input.projectId)
    const event = await Event.create({
      eventId: input.eventId ? ResearchID.schema("event").parse(input.eventId) : ResearchID.create("event"),
      projectId: input.projectId,
      type: input.type,
      parents: input.parents ?? snapshot.heads,
      actor: input.actor,
      occurredAt: input.occurredAt ?? new Date().toISOString(),
      payload: input.payload,
      signer: input.signer,
    })
    await persist(input.projectRoot, event)
    return event
  }

  export async function lookupIdempotency(input: {
    projectRoot: string
    projectId: string
    type: string
    key: string
    request: JsonValue
  }) {
    const snapshot = await read(input.projectRoot)
    assertWritable(snapshot, input.projectId)
    return replay(snapshot, input.type, idempotency(input.projectId, input.key, input.request))
  }

  export async function withIdempotencyLock<T>(input: {
    projectRoot: string
    projectId: string
    key: string
    lockTimeoutMs?: number
    operation: () => Promise<T>
  }) {
    const value = idempotency(input.projectId, input.key, null)
    const directory = path.join(paths(input.projectRoot).root, "cache/idempotency-locks")
    await mkdir(directory, { recursive: true })
    await using lock = await acquire(
      path.join(directory, value.keyHash + ".lock"),
      Date.now() + (input.lockTimeoutMs ?? 5000),
    )
    return input.operation()
  }

  export async function appendIdempotent(input: {
    projectRoot: string
    projectId: string
    eventId?: string
    type: string
    actor: Actor
    payload: JsonValue
    signer: Signer
    key: string
    request: JsonValue
    parents?: EventParent[]
    occurredAt?: string
    lockTimeoutMs?: number
  }): Promise<{ event: ResearchEvent; replayed: boolean }> {
    const project = paths(input.projectRoot)
    await mkdir(project.root, { recursive: true })
    await using lock = await acquire(project.lock, Date.now() + (input.lockTimeoutMs ?? 5000))
    const snapshot = await read(input.projectRoot)
    assertWritable(snapshot, input.projectId)
    const value = idempotency(input.projectId, input.key, input.request)
    const existing = replay(snapshot, input.type, value)
    if (existing) return { event: existing, replayed: true }
    const event = await Event.create({
      eventId: input.eventId ? ResearchID.schema("event").parse(input.eventId) : ResearchID.create("event"),
      projectId: input.projectId,
      type: input.type,
      parents: input.parents ?? snapshot.heads,
      actor: input.actor,
      occurredAt: input.occurredAt ?? new Date().toISOString(),
      payload: input.payload,
      idempotency: value,
      signer: input.signer,
    })
    await persist(input.projectRoot, event)
    return { event, replayed: false }
  }

  export async function appendBatch(input: {
    projectRoot: string
    projectId: string
    actor: Actor
    signer: Signer
    entries: { type: string; payload: JsonValue; occurredAt?: string }[]
    lockTimeoutMs?: number
  }) {
    if (input.entries.length === 0) return []
    const project = paths(input.projectRoot)
    await mkdir(project.root, { recursive: true })
    await using lock = await acquire(project.lock, Date.now() + (input.lockTimeoutMs ?? 5000))
    const snapshot = await read(input.projectRoot)
    assertWritable(snapshot, input.projectId)
    const appended: ResearchEvent[] = []
    const current = [...snapshot.events]
    for (const entry of input.entries) {
      const event = await Event.create({
        eventId: ResearchID.create("event"),
        projectId: input.projectId,
        type: entry.type,
        parents: heads(current),
        actor: input.actor,
        occurredAt: entry.occurredAt ?? new Date().toISOString(),
        payload: entry.payload,
        signer: input.signer,
      })
      await persist(input.projectRoot, event)
      current.push(event)
      appended.push(event)
    }
    return appended
  }
}
