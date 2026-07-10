import path from "node:path"
import { open, readFile, rename } from "node:fs/promises"
import { LocalGit } from "../adapters/git/local"
import { FilesystemLedger } from "../adapters/ledger/filesystem"
import { LocalProcessRunner } from "../adapters/process/local"
import { Canonical, type JsonValue } from "../domain/canonical"
import { Governance, ResearchCapability, type ResearchRole } from "../domain/governance"
import { ResearchProject, RunAttempt, type Actor } from "../domain/schema"
import type { Signer } from "../domain/signature"
import { ResearchAudit } from "./audit"

async function atomic(file: string, value: JsonValue) {
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

export namespace ResearchRunService {
  export async function execute(input: {
    projectRoot: string
    runId: string
    actor: Actor
    role?: ResearchRole
    delegatedCapabilities?: ResearchCapability[]
    signer: Signer
    signal?: AbortSignal
  }) {
    Governance.authorize(input, ResearchCapability.runExecute)
    const git = await LocalGit.inspect(input.projectRoot)
    await ResearchAudit.assertWritable(git.root)
    const project = ResearchProject.parse(
      JSON.parse(await readFile(path.join(git.root, ".openscience/research/project.json"), "utf8")),
    )
    const file = path.join(git.root, `.openscience/research/projections/runs/${input.runId}.json`)
    const declared = RunAttempt.parse(JSON.parse(await readFile(file, "utf8")))
    if (declared.state !== "declared" && declared.state !== "queued") {
      throw new Error(`Run ${declared.id} cannot execute from state ${declared.state}`)
    }
    const started = RunAttempt.parse({ ...declared, state: "running" })
    await FilesystemLedger.append({
      projectRoot: git.root,
      projectId: project.id,
      type: "run.started",
      actor: input.actor,
      payload: { runId: declared.id, execution: declared.execution },
      signer: input.signer,
    })
    await atomic(file, started as JsonValue)
    const result = await LocalProcessRunner.execute({
      projectRoot: git.root,
      runId: declared.id,
      ...declared.execution,
      signal: input.signal,
    })
    const completed = RunAttempt.parse({ ...started, state: result.outcome, result })
    await FilesystemLedger.append({
      projectRoot: git.root,
      projectId: project.id,
      type: "run.completed",
      actor: input.actor,
      payload: { runId: declared.id, result: result as unknown as JsonValue },
      signer: input.signer,
    })
    await atomic(file, completed as JsonValue)
    return completed
  }
}
