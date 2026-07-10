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
  RunAttempt,
  type Actor,
} from "../domain/schema"
import type { Signer } from "../domain/signature"
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

async function load<T>(file: string, parse: (value: unknown) => T) {
  return parse(JSON.parse(await readFile(file, "utf8")))
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
    await FilesystemLedger.append({
      projectRoot: git.root,
      projectId: currentProject.id,
      type: "iteration.created",
      actor: input.actor,
      payload: { iteration, protocol },
      signer: input.signer,
      occurredAt: now,
    })
    await atomic(path.join(iterationDirectory, iteration.id + ".json"), iteration as JsonValue)
    await atomic(
      path.join(git.root, `.openscience/research/projections/protocols/${protocol.id}.json`),
      protocol as JsonValue,
    )
    return { iteration, protocol }
  }

  export async function freezeProtocol(input: Authorization & { projectRoot: string; protocolId: string }) {
    Governance.authorize(input, ResearchCapability.protocolFreeze)
    const git = await LocalGit.inspect(input.projectRoot)
    await ResearchAudit.assertWritable(git.root)
    const currentProject = await project(git.root)
    const file = path.join(git.root, `.openscience/research/projections/protocols/${input.protocolId}.json`)
    const protocol = await load(file, ProtocolRevision.parse)
    if (protocol.frozenAt) throw new Error(`Protocol ${protocol.id} is already frozen`)
    const frozen = ProtocolRevision.parse({ ...protocol, frozenAt: new Date().toISOString() })
    await FilesystemLedger.append({
      projectRoot: git.root,
      projectId: currentProject.id,
      type: "protocol.frozen",
      actor: input.actor,
      payload: { protocolId: frozen.id, revision: frozen.revision, contentHash: Canonical.hash(frozen.content) },
      signer: input.signer,
      occurredAt: frozen.frozenAt!,
    })
    await atomic(file, frozen as JsonValue)
    return frozen
  }

  export async function declareRun(
    input: Authorization & {
      projectRoot: string
      protocolId: string
      workspaceStateHash: string
      environmentHash: string
      parameters: JsonValue
      seed?: number
      execution: { command: string; args: string[]; cwd: string; timeoutMs: number; environmentKeys: string[] }
    },
  ) {
    Governance.authorize(input, ResearchCapability.runExecute)
    const git = await LocalGit.inspect(input.projectRoot)
    await ResearchAudit.assertWritable(git.root)
    const currentProject = await project(git.root)
    const protocol = await load(
      path.join(git.root, `.openscience/research/projections/protocols/${input.protocolId}.json`),
      ProtocolRevision.parse,
    )
    if (!protocol.frozenAt) throw new Error("Freeze the protocol before declaring a formal run")
    const now = new Date().toISOString()
    const runId = ResearchID.create("run")
    const intent = await FilesystemLedger.append({
      projectRoot: git.root,
      projectId: currentProject.id,
      type: "run.intent_declared",
      actor: input.actor,
      payload: {
        runId,
        iterationId: protocol.iterationId,
        protocolId: protocol.id,
        workspaceStateHash: input.workspaceStateHash,
        environmentHash: input.environmentHash,
        parameters: input.parameters,
        seed: input.seed ?? null,
        execution: input.execution,
      },
      signer: input.signer,
      occurredAt: now,
    })
    const run = RunAttempt.parse({
      schemaVersion: 1,
      id: runId,
      projectId: currentProject.id,
      iterationId: protocol.iterationId,
      protocolId: protocol.id,
      intentEventId: intent.eventId,
      workspaceStateHash: input.workspaceStateHash,
      environmentHash: input.environmentHash,
      parameters: input.parameters,
      seed: input.seed,
      execution: input.execution,
      state: "declared",
      createdAt: now,
      createdBy: input.actor,
    })
    await atomic(path.join(git.root, `.openscience/research/projections/runs/${run.id}.json`), run as JsonValue)
    return run
  }
}
