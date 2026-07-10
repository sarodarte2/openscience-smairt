import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ResearchProjectService } from "../application/project"
import { ResearchTrackService } from "../application/track"
import { InvestigationService } from "../application/investigation"
import { ResearchAudit } from "../application/audit"
import { FilesystemLedger } from "../adapters/ledger/filesystem"
import { Ed25519 } from "../domain/signature"
import { ProjectMember } from "../domain/schema"
import { ResearchID } from "../domain/id"

const execute = promisify(execFile)
const actor = { kind: "human" as const, id: "local:test", displayName: "Test Researcher" }
const { signer } = Ed25519.generate()
let root: string

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "openscience-project-"))
  await execute("git", ["init", "-q", root])
  await execute("git", ["-C", root, "config", "user.name", "Test Researcher"])
  await execute("git", ["-C", root, "config", "user.email", "test@example.com"])
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe("Research project initialization", () => {
  it("adopts a Git repository with a project environment and hidden core track", async () => {
    const result = await ResearchProjectService.initialize({
      directory: root,
      mode: "adopt",
      name: "Foundation Model Study",
      description: "Compare two adaptation strategies",
      actor,
      signer,
      createCondaEnvironment: false,
    })

    expect(result.project.defaultEnvironment.name).toBe("foundation-model-study")
    expect(result.track).toMatchObject({ alias: "core", hidden: true, state: "active" })
    expect(result.member).toMatchObject({ role: "owner", gitEmail: "test@example.com" })
    expect(result.binding).toMatchObject({ active: true, boundAtCommit: null })
    expect(await readFile(path.join(root, ".openscience/research/environment.yml"), "utf8")).toContain(
      "name: foundation-model-study",
    )
    expect(await readFile(path.join(root, ".gitignore"), "utf8")).toContain(".openscience/research/private/")
    const ledger = await FilesystemLedger.inspect(root)
    expect(ledger.readOnly).toBeFalse()
    expect(ledger.events.map((event) => event.type)).toEqual(["project.created", "track.created"])

    const alternative = await ResearchTrackService.create({
      projectRoot: root,
      title: "Alternative parameters",
      objective: "Evaluate a distinct model architecture without rewriting core evidence",
      workspace: { kind: "none" },
      actor,
      role: "researcher",
      signer,
    })
    expect(alternative.track).toMatchObject({ alias: "alternative-parameters", hidden: false })
    expect(alternative.track.parentTrackIds).toEqual([result.project.coreTrackId])
    expect(alternative.binding).toBeNull()
    const investigation = await InvestigationService.createIteration({
      projectRoot: root,
      trackId: alternative.track.id,
      title: "Initial feasibility",
      question: "Does sparse adaptation preserve baseline performance?",
      decisionGoal: "Decide whether to proceed to a confirmatory comparison",
      content: {
        mode: "exploratory",
        aim: "Measure feasibility without making a confirmatory claim",
        intendedInputs: ["frozen baseline dataset"],
        intendedOutputs: ["performance table", "failure analysis"],
        decisionGoal: "Select or reject this approach for confirmatory study",
      },
      actor,
      role: "researcher",
      signer,
    })
    expect(investigation.protocol.frozenAt).toBeNull()
    const frozen = await InvestigationService.freezeProtocol({
      projectRoot: root,
      protocolId: investigation.protocol.id,
      actor,
      role: "owner",
      signer,
    })
    expect(frozen.frozenAt).not.toBeNull()
    const digest = "a".repeat(64)
    const run = await InvestigationService.declareRun({
      projectRoot: root,
      protocolId: frozen.id,
      workspaceStateHash: digest,
      environmentHash: digest,
      parameters: { learningRate: 0.0001 },
      seed: 42,
      execution: { command: "python", args: ["analysis.py"], cwd: root, timeoutMs: 60_000, environmentKeys: [] },
      actor,
      role: "researcher",
      signer,
    })
    expect(run).toMatchObject({ state: "declared", seed: 42, protocolId: frozen.id })
    expect((await FilesystemLedger.inspect(root)).events).toHaveLength(6)
    expect((await ResearchAudit.inspect(root)).readOnly).toBeFalse()

    const attacker = Ed25519.generate().signer
    await FilesystemLedger.append({
      projectRoot: root,
      projectId: result.project.id,
      type: "track.created",
      actor: { kind: "human", id: "unknown:attacker", displayName: "Unknown signer" },
      payload: { title: "Forged track" },
      signer: attacker,
    })
    const audit = await ResearchAudit.inspect(root)
    expect(audit.readOnly).toBeTrue()
    expect(audit.diagnostics.at(-1)).toMatchObject({ code: "untrusted_signer" })
  })

  it("applies member removal prospectively without invalidating concurrent branch work", async () => {
    const project = await ResearchProjectService.initialize({
      directory: root,
      mode: "adopt",
      name: "Collaborative Study",
      actor,
      signer,
      createCondaEnvironment: false,
    })
    const collaborator = Ed25519.generate().signer
    const memberActor = { kind: "human" as const, id: "local:collaborator", displayName: "Collaborator" }
    const member = ProjectMember.parse({
      schemaVersion: 1,
      id: ResearchID.create("member"),
      projectId: project.project.id,
      displayName: memberActor.displayName,
      role: "researcher",
      signingKeyId: collaborator.keyId,
      active: true,
      createdAt: new Date().toISOString(),
      createdBy: actor,
    })
    const added = await FilesystemLedger.append({
      projectRoot: root,
      projectId: project.project.id,
      type: "member.added",
      actor,
      payload: { member },
      signer,
    })
    const branchParent = [{ eventId: added.eventId, hash: added.eventHash }]
    await FilesystemLedger.append({
      projectRoot: root,
      projectId: project.project.id,
      type: "member.removed",
      actor,
      payload: { memberId: member.id },
      parents: branchParent,
      signer,
    })
    await FilesystemLedger.append({
      projectRoot: root,
      projectId: project.project.id,
      type: "analysis.recorded",
      actor: memberActor,
      payload: { result: "Completed concurrently before removal was observed" },
      parents: branchParent,
      signer: collaborator,
    })
    expect((await ResearchAudit.inspect(root)).readOnly).toBeFalse()

    await FilesystemLedger.append({
      projectRoot: root,
      projectId: project.project.id,
      type: "analysis.recorded",
      actor: memberActor,
      payload: { result: "Attempted after histories were reconciled" },
      signer: collaborator,
    })
    const reconciled = await ResearchAudit.inspect(root)
    expect(reconciled.readOnly).toBeTrue()
    expect(reconciled.diagnostics.at(-1)).toMatchObject({ code: "untrusted_signer" })
  })
})
