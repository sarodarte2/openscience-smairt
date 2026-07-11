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
import { ResearchFoundationService } from "../application/foundation"
import { ResearchIntegrationService } from "../application/integration"
import { ResearchPublicationService } from "../application/publication"
import { ResearchAudit } from "../application/audit"
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
      idempotencyKey: "artifact-results-table",
    })
    expect(registered.artifact).toMatchObject({ path: "results.csv", role: "table", captureConfidence: "complete" })
    expect(await ResearchEvidenceService.verifyArtifacts(root)).toMatchObject([
      { artifact: { id: registered.artifact.id }, valid: true },
    ])
    const replayedArtifact = await ResearchEvidenceService.registerArtifact({
      projectRoot: root,
      iterationId: current.iteration.id,
      file: "results.csv",
      artifactRole: "table",
      mediaType: "text/csv",
      actor,
      role: "researcher",
      signer,
      idempotencyKey: "artifact-results-table",
    })
    expect(replayedArtifact).toMatchObject({
      artifact: { id: registered.artifact.id },
      eventId: registered.eventId,
      replayed: true,
    })

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
      idempotencyKey: "analysis-integrity-result",
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
      idempotencyKey: "claim-integrity-result",
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
      idempotencyKey: "review-integrity-track",
    })
    const integration = await ResearchReviewService.integrateEvidenceOnly({
      projectRoot: root,
      reviewId: review.review.id,
      actor,
      role: "reviewer",
      signer,
      idempotencyKey: "integrate-integrity-evidence",
    })
    expect(integration.integration).toMatchObject({
      mode: "evidence_only",
      reviewId: review.review.id,
      claimIds: [claim.claim.id],
      artifactIds: [registered.artifact.id],
    })
    const publication = await ResearchPublicationService.create({
      projectRoot: root,
      title: "Artifact integrity result",
      abstract: "A bounded report of an inconclusive integrity exercise.",
      claimIds: [claim.claim.id],
      artifactIds: [registered.artifact.id],
      aiUseStatement: "AI assisted with drafting; the signed scientific decisions are human-authored.",
      contributionStatement: "The local researcher designed, executed, reviewed, and approved the study record.",
      actor,
      role: "researcher",
      signer,
      idempotencyKey: "publication-integrity-draft",
    })
    expect(publication.publication).toMatchObject({ state: "draft", supportState: "unresolved" })
    await expect(
      ResearchPublicationService.approve({
        projectRoot: root,
        publicationId: publication.publication.id,
        actor,
        role: "reviewer",
        signer,
      }),
    ).rejects.toThrow("Unresolved claims")
    await execute("git", ["-C", root, "add", "results.csv", ".gitignore"])
    await execute("git", ["-C", root, "commit", "-qm", "Add verified result"])
    const commit = (await execute("git", ["-C", root, "rev-parse", "HEAD"])).stdout.trim()
    const proposal = await ResearchIntegrationService.proposeCodeMerge({
      projectRoot: root,
      evidenceIntegrationId: integration.integration.id,
      sourceCommit: commit,
      targetBranch: "main",
      targetCommit: commit,
      actor,
      role: "researcher",
      signer,
      idempotencyKey: "proposal-integrity-code",
    })
    expect(proposal).toMatchObject({
      proposal: {
        evidenceIntegrationId: integration.integration.id,
        sourceCommit: commit,
        targetCommit: commit,
        state: "proposed",
      },
      replayed: false,
    })
    expect(proposal.proposal.instructions).toContain("does not merge code or promote a foundation")
    const promoted = await ResearchFoundationService.promote({
      projectRoot: root,
      expectedGitCommit: commit,
      environmentTrackId: current.iteration.trackId,
      artifactIds: [registered.artifact.id],
      integrationIds: [integration.integration.id],
      actor,
      role: "owner",
      signer,
      idempotencyKey: "foundation-integrity-result",
    })
    expect(promoted).toMatchObject({
      foundation: {
        gitCommit: commit,
        artifactIds: [registered.artifact.id],
        integrationIds: [integration.integration.id],
      },
      project: { activeFoundationId: promoted.foundation.id },
      replayed: false,
    })
    const replayedFoundation = await ResearchFoundationService.promote({
      projectRoot: root,
      expectedGitCommit: commit,
      environmentTrackId: current.iteration.trackId,
      artifactIds: [registered.artifact.id],
      integrationIds: [integration.integration.id],
      actor,
      role: "owner",
      signer,
      idempotencyKey: "foundation-integrity-result",
    })
    expect(replayedFoundation).toMatchObject({ foundation: { id: promoted.foundation.id }, replayed: true })

    await writeFile(result, "metric,value\naccuracy,0.99\n")
    expect(await ResearchEvidenceService.verifyArtifacts(root)).toMatchObject([
      { artifact: { id: registered.artifact.id }, valid: false },
    ])
    expect(await ResearchAudit.inspectScientific(root)).toMatchObject({
      valid: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: "artifact_hash_mismatch", file: registered.artifact.id }),
      ]),
    })
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
