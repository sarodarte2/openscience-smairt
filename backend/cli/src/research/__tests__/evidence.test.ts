import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ResearchProjectService } from "../application/project"
import { InvestigationService } from "../application/investigation"
import { ResearchEvidenceService } from "../application/evidence"
import { ResearchReviewService } from "../application/review"
import { Ed25519 } from "../domain/signature"

const execute = promisify(execFile)
const actor = { kind: "human" as const, id: "local:evidence-test", displayName: "Evidence Researcher" }
const { signer } = Ed25519.generate()
let root: string

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "openscience-evidence-"))
  await execute("git", ["init", "-q", root])
  await execute("git", ["-C", root, "config", "user.name", "Evidence Researcher"])
  await execute("git", ["-C", root, "config", "user.email", "evidence@example.com"])
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function investigation() {
  const initialized = await ResearchProjectService.initialize({
    directory: root,
    mode: "adopt",
    name: "Evidence Study",
    actor,
    signer,
    createCondaEnvironment: false,
  })
  return InvestigationService.createIteration({
    projectRoot: root,
    trackId: initialized.project.coreTrackId,
    title: "Artifact integrity",
    question: "Can evidence corruption be localized?",
    decisionGoal: "Accept only independently verifiable evidence",
    content: {
      mode: "exploratory",
      aim: "Exercise the evidence integrity boundary",
      intendedInputs: ["result table"],
      intendedOutputs: ["verified manifest"],
      decisionGoal: "Determine whether the evidence record is trustworthy",
    },
    actor,
    role: "researcher",
    signer,
  })
}

describe("Research evidence", () => {
  it("registers immutable manifests and identifies exact corruption", async () => {
    const current = await investigation()
    const result = path.join(root, "results.csv")
    await writeFile(result, "metric,value\naccuracy,0.91\n")
    const registered = await ResearchEvidenceService.registerArtifact({
      projectRoot: root,
      iterationId: current.iteration.id,
      file: "results.csv",
      artifactRole: "table",
      mediaType: "text/csv",
      actor,
      role: "researcher",
      signer,
    })
    expect(registered.artifact).toMatchObject({ path: "results.csv", role: "table", captureConfidence: "complete" })
    expect(await ResearchEvidenceService.verifyArtifacts(root)).toMatchObject([
      { artifact: { id: registered.artifact.id }, valid: true },
    ])

    const analysis = await ResearchEvidenceService.createAnalysis({
      projectRoot: root,
      iterationId: current.iteration.id,
      title: "Integrity result",
      summary: "The registered result is internally consistent before mutation.",
      methods: "Compare the current bytes and byte length to the signed manifest.",
      findings: ["The original artifact matches its manifest."],
      limitations: ["This check does not establish whether the source data were scientifically appropriate."],
      runIds: [],
      artifactIds: [registered.artifact.id],
      finalize: true,
      actor,
      role: "researcher",
      signer,
    })
    expect(analysis.analysis).toMatchObject({ state: "finalized", artifactIds: [registered.artifact.id] })

    const claim = await ResearchReviewService.createClaim({
      projectRoot: root,
      iterationId: current.iteration.id,
      statement: "The registered artifact matched its signed manifest at analysis time.",
      scope: "Integrity of this artifact only; not scientific validity of the underlying experiment.",
      uncertainties: ["The source data and analysis choices require separate scientific review."],
      analysisIds: [analysis.analysis.id],
      artifactIds: [registered.artifact.id],
      finalize: true,
      actor,
      role: "researcher",
      signer,
    })
    const review = await ResearchReviewService.reviewTrack({
      projectRoot: root,
      trackId: current.iteration.trackId,
      claimIds: [claim.claim.id],
      analysisIds: [analysis.analysis.id],
      outcome: "inconclusive",
      rationale: "Retain the integrity result as negative/inconclusive evidence without promoting code.",
      actor,
      role: "reviewer",
      signer,
    })
    const integration = await ResearchReviewService.integrateEvidenceOnly({
      projectRoot: root,
      reviewId: review.review.id,
      actor,
      role: "reviewer",
      signer,
    })
    expect(integration.integration).toMatchObject({
      mode: "evidence_only",
      reviewId: review.review.id,
      claimIds: [claim.claim.id],
      artifactIds: [registered.artifact.id],
    })

    await writeFile(result, "metric,value\naccuracy,0.99\n")
    expect(await ResearchEvidenceService.verifyArtifacts(root)).toMatchObject([
      { artifact: { id: registered.artifact.id }, valid: false },
    ])
  })

  it("rejects artifact paths outside the project", async () => {
    const current = await investigation()
    const outside = path.join(os.tmpdir(), `outside-${Date.now()}.txt`)
    await writeFile(outside, "not project evidence")
    try {
      await expect(
        ResearchEvidenceService.registerArtifact({
          projectRoot: root,
          iterationId: current.iteration.id,
          file: outside,
          artifactRole: "other",
          mediaType: "text/plain",
          actor,
          role: "researcher",
          signer,
        }),
      ).rejects.toThrow("inside the project")
    } finally {
      await rm(outside, { force: true })
    }
  })
})
