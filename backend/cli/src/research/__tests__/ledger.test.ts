import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  FilesystemLedger,
  IdempotencyConflictError,
  LedgerIntegrityError,
  LedgerProjectMismatchError,
} from "../adapters/ledger/filesystem"
import { ResearchID } from "../domain/id"
import { Ed25519 } from "../domain/signature"

const actor = { kind: "human" as const, id: "local:test", displayName: "Test Researcher" }
const projectId = ResearchID.create("project")
const { signer } = Ed25519.generate()
let root: string

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "openscience-research-ledger-"))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe("Filesystem research ledger", () => {
  it("appends immutable event files and links the current head", async () => {
    const first = await FilesystemLedger.append({
      projectRoot: root,
      projectId,
      type: "project.created",
      actor,
      payload: { name: "Study" },
      signer,
    })
    const second = await FilesystemLedger.append({
      projectRoot: root,
      projectId,
      type: "track.created",
      actor,
      payload: { alias: "core" },
      signer,
    })
    const snapshot = await FilesystemLedger.inspect(root)
    expect(snapshot.readOnly).toBeFalse()
    expect(snapshot.events).toHaveLength(2)
    expect(second.parents).toEqual([{ eventId: first.eventId, hash: first.eventHash }])
    expect(snapshot.heads).toEqual([{ eventId: second.eventId, hash: second.eventHash }])
  })

  it("opens read-only and identifies a damaged event", async () => {
    const event = await FilesystemLedger.append({
      projectRoot: root,
      projectId,
      type: "project.created",
      actor,
      payload: { name: "Study" },
      signer,
    })
    const directory = path.join(root, ".openscience/research/ledger/events")
    const file = path.join(directory, event.eventId + ".json")
    const original = await readFile(file, "utf8")
    await writeFile(file, original.replace("Study", "Damaged"))

    const snapshot = await FilesystemLedger.inspect(root)
    expect(snapshot.readOnly).toBeTrue()
    expect(snapshot.diagnostics[0]).toMatchObject({ code: "invalid_event", file })
    expect(
      FilesystemLedger.append({
        projectRoot: root,
        projectId,
        type: "track.created",
        actor,
        payload: { alias: "blocked" },
        signer,
      }),
    ).rejects.toBeInstanceOf(LedgerIntegrityError)
    expect((await readdir(directory)).filter((name) => name.endsWith(".json"))).toHaveLength(1)
  })

  it("rejects a second project identity in the same repository", async () => {
    await FilesystemLedger.append({
      projectRoot: root,
      projectId,
      type: "project.created",
      actor,
      payload: { name: "Study" },
      signer,
    })
    await expect(
      FilesystemLedger.append({
        projectRoot: root,
        projectId: ResearchID.create("project"),
        type: "project.created",
        actor,
        payload: { name: "Competing identity" },
        signer,
      }),
    ).rejects.toBeInstanceOf(LedgerProjectMismatchError)
  })

  it("replays one mutation for the same idempotency key and rejects changed input", async () => {
    const first = await FilesystemLedger.appendIdempotent({
      projectRoot: root,
      projectId,
      type: "track.created",
      actor,
      payload: { trackId: "stable-result" },
      signer,
      key: "request-12345678",
      request: { title: "Alternative" },
    })
    const replayed = await FilesystemLedger.appendIdempotent({
      projectRoot: root,
      projectId,
      type: "track.created",
      actor,
      payload: { trackId: "would-have-been-different" },
      signer,
      key: "request-12345678",
      request: { title: "Alternative" },
    })
    expect(first.replayed).toBeFalse()
    expect(replayed).toEqual({ event: first.event, replayed: true })
    expect((await FilesystemLedger.inspect(root)).events).toHaveLength(1)
    await expect(
      FilesystemLedger.appendIdempotent({
        projectRoot: root,
        projectId,
        type: "track.created",
        actor,
        payload: { trackId: "conflict" },
        signer,
        key: "request-12345678",
        request: { title: "Changed" },
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError)
  })
})
