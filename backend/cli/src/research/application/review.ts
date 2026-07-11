import path from "node:path"
import { mkdir, open, readFile, readdir, rename } from "node:fs/promises"
import { FilesystemLedger } from "../adapters/ledger/filesystem"
import { LocalGit } from "../adapters/git/local"
import { Canonical, type JsonValue } from "../domain/canonical"
import { Governance, ResearchCapability, type ResearchRole } from "../domain/governance"
import { ResearchID } from "../domain/id"
import {
  ArtifactManifest,
  EvidenceIntegration,
  ResearchIteration,
  ResearchProject,
  ResearchTrack,
  ScientificAnalysis,
  ScientificClaim,
  TrackReview,
  WorkspaceBinding,
  type Actor,
} from "../domain/schema"
import type { Signer } from "../domain/signature"
import { ResearchAudit } from "./audit"
import { ResearchEvidenceService } from "./evidence"

type Authorization = { actor: Actor; role?: ResearchRole; delegatedCapabilities?: ResearchCapability[]; signer: Signer }

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

async function list<T>(directory: string, parse: (value: unknown) => T) {
  const names = await readdir(directory).catch(() => [])
  return Promise.all(
    names.filter((name) => name.endsWith(".json")).map((name) => load(path.join(directory, name), parse)),
  )
}

async function context(projectRoot: string) {
  const git = await LocalGit.inspect(projectRoot)
  await ResearchAudit.assertWritable(git.root)
  const project = await load(path.join(git.root, ".openscience/research/project.json"), ResearchProject.parse)
  return { root: git.root, project }
}

async function iteration(root: string, projectId: string, iterationId: string) {
  const value = await load(
    path.join(root, `.openscience/research/iterations/${iterationId}.json`),
    ResearchIteration.parse,
  )
  if (value.projectId !== projectId) throw new Error("Iteration belongs to a different research project")
  return value
}

export namespace ResearchReviewService {
  export async function listClaims(projectRoot: string, iterationId?: string) {
    const git = await LocalGit.inspect(projectRoot)
    const values = await list(path.join(git.root, ".openscience/research/claims"), ScientificClaim.parse)
    return values.filter((value) => !iterationId || value.iterationId === iterationId)
  }

  export async function listReviews(projectRoot: string, trackId?: string) {
    const git = await LocalGit.inspect(projectRoot)
    const values = await list(path.join(git.root, ".openscience/research/reviews"), TrackReview.parse)
    return values.filter((value) => !trackId || value.trackId === trackId)
  }

  export async function listIntegrations(projectRoot: string, trackId?: string) {
    const git = await LocalGit.inspect(projectRoot)
    const values = await list(path.join(git.root, ".openscience/research/integrations"), EvidenceIntegration.parse)
    return values.filter((value) => !trackId || value.sourceTrackId === trackId)
  }

  export async function createClaim(
    input: Authorization & {
      projectRoot: string
      iterationId: string
      statement: string
      scope: string
      uncertainties: string[]
      analysisIds: string[]
      artifactIds: string[]
      finalize?: boolean
      idempotencyKey?: string
    },
  ) {
    Governance.authorize(input, input.finalize ? ResearchCapability.claimFinalize : ResearchCapability.analysisWrite)
    const { root, project } = await context(input.projectRoot)
    await iteration(root, project.id, input.iterationId)
    const analyses = await Promise.all(
      input.analysisIds.map((id) =>
        load(path.join(root, `.openscience/research/analyses/${id}.json`), ScientificAnalysis.parse),
      ),
    )
    const artifacts = await Promise.all(
      input.artifactIds.map((id) =>
        load(path.join(root, `.openscience/research/artifacts/${id}.json`), ArtifactManifest.parse),
      ),
    )
    if (
      [...analyses, ...artifacts].some(
        (value) => value.projectId !== project.id || value.iterationId !== input.iterationId,
      )
    ) {
      throw new Error("Claim evidence must belong to the same project and iteration")
    }
    if (input.finalize && analyses.some((value) => value.state !== "finalized")) {
      throw new Error("A finalized claim may reference only finalized analyses")
    }
    if (input.finalize) {
      const integrity = await ResearchEvidenceService.verifyArtifacts(root)
      const selected = new Set(input.artifactIds)
      if (integrity.some((entry) => selected.has(entry.artifact.id) && !entry.valid)) {
        throw new Error("A finalized claim may not reference missing or corrupted artifacts")
      }
    }
    const request: JsonValue = {
      actorId: input.actor.id,
      iterationId: input.iterationId,
      statement: input.statement,
      scope: input.scope,
      uncertainties: input.uncertainties,
      analysisIds: [...new Set(input.analysisIds)],
      artifactIds: [...new Set(input.artifactIds)],
      finalize: input.finalize ?? false,
    }
    const now = new Date().toISOString()
    const claim = ScientificClaim.parse({
      schemaVersion: 1,
      id: ResearchID.create("claim"),
      projectId: project.id,
      iterationId: input.iterationId,
      statement: input.statement,
      scope: input.scope,
      uncertainties: input.uncertainties,
      analysisIds: [...new Set(input.analysisIds)],
      artifactIds: [...new Set(input.artifactIds)],
      state: input.finalize ? "finalized" : "draft",
      finalizedAt: input.finalize ? now : null,
      createdAt: now,
      createdBy: input.actor,
    })
    const type = input.finalize ? "claim.finalized" : "claim.created"
    const appended = input.idempotencyKey
      ? await FilesystemLedger.appendIdempotent({
          projectRoot: root,
          projectId: project.id,
          type,
          actor: input.actor,
          payload: { claim },
          signer: input.signer,
          occurredAt: now,
          key: input.idempotencyKey,
          request,
        })
      : {
          event: await FilesystemLedger.append({
            projectRoot: root,
            projectId: project.id,
            type,
            actor: input.actor,
            payload: { claim },
            signer: input.signer,
            occurredAt: now,
          }),
          replayed: false,
        }
    const value = appended.replayed
      ? ScientificClaim.parse((appended.event.payload as Record<string, unknown>).claim)
      : claim
    await atomic(path.join(root, `.openscience/research/claims/${value.id}.json`), value as JsonValue)
    return { claim: value, eventId: appended.event.eventId, replayed: appended.replayed }
  }

  export async function reviewTrack(
    input: Authorization & {
      projectRoot: string
      trackId: string
      claimIds: string[]
      analysisIds: string[]
      outcome: TrackReview["outcome"]
      rationale: string
      idempotencyKey?: string
    },
  ) {
    Governance.authorize(input, ResearchCapability.trackReview)
    const { root, project } = await context(input.projectRoot)
    const trackFile = path.join(root, `.openscience/research/tracks/${input.trackId}.json`)
    const track = await load(trackFile, ResearchTrack.parse)
    if (track.projectId !== project.id) throw new Error("Track belongs to a different research project")
    const claims = await Promise.all(
      input.claimIds.map((id) =>
        load(path.join(root, `.openscience/research/claims/${id}.json`), ScientificClaim.parse),
      ),
    )
    const analyses = await Promise.all(
      input.analysisIds.map((id) =>
        load(path.join(root, `.openscience/research/analyses/${id}.json`), ScientificAnalysis.parse),
      ),
    )
    const iterations = await list(path.join(root, ".openscience/research/iterations"), ResearchIteration.parse)
    const iterationIds = new Set(iterations.filter((value) => value.trackId === track.id).map((value) => value.id))
    if (claims.some((value) => value.state !== "finalized" || !iterationIds.has(value.iterationId))) {
      throw new Error("Track review requires finalized claims from the reviewed track")
    }
    if (analyses.some((value) => value.state !== "finalized" || !iterationIds.has(value.iterationId))) {
      throw new Error("Track review requires finalized analyses from the reviewed track")
    }
    const request: JsonValue = {
      actorId: input.actor.id,
      trackId: input.trackId,
      claimIds: [...new Set(input.claimIds)],
      analysisIds: [...new Set(input.analysisIds)],
      outcome: input.outcome,
      rationale: input.rationale,
    }
    const now = new Date().toISOString()
    const review = TrackReview.parse({
      schemaVersion: 1,
      id: ResearchID.create("review"),
      projectId: project.id,
      trackId: track.id,
      claimIds: [...new Set(input.claimIds)],
      analysisIds: [...new Set(input.analysisIds)],
      outcome: input.outcome,
      rationale: input.rationale,
      reviewedAt: now,
      createdAt: now,
      createdBy: input.actor,
    })
    const state = input.outcome === "return_for_changes" ? "review_ready" : input.outcome
    const updatedTrack = ResearchTrack.parse({ ...track, state })
    const appended = input.idempotencyKey
      ? await FilesystemLedger.appendIdempotent({
          projectRoot: root,
          projectId: project.id,
          type: "track.reviewed",
          actor: input.actor,
          payload: { review, track: updatedTrack },
          signer: input.signer,
          occurredAt: now,
          key: input.idempotencyKey,
          request,
        })
      : {
          event: await FilesystemLedger.append({
            projectRoot: root,
            projectId: project.id,
            type: "track.reviewed",
            actor: input.actor,
            payload: { review, track: updatedTrack },
            signer: input.signer,
            occurredAt: now,
          }),
          replayed: false,
        }
    const payload = appended.event.payload as Record<string, unknown>
    const reviewValue = appended.replayed ? TrackReview.parse(payload.review) : review
    const trackValue = appended.replayed ? ResearchTrack.parse(payload.track) : updatedTrack
    await atomic(path.join(root, `.openscience/research/reviews/${reviewValue.id}.json`), reviewValue as JsonValue)
    await atomic(trackFile, trackValue as JsonValue)
    return { review: reviewValue, track: trackValue, eventId: appended.event.eventId, replayed: appended.replayed }
  }

  export async function integrateEvidenceOnly(
    input: Authorization & { projectRoot: string; reviewId: string; idempotencyKey?: string },
  ) {
    Governance.authorize(input, ResearchCapability.evidenceIntegrate)
    const { root, project } = await context(input.projectRoot)
    const review = await load(
      path.join(root, `.openscience/research/reviews/${input.reviewId}.json`),
      TrackReview.parse,
    )
    if (review.projectId !== project.id) throw new Error("Review belongs to a different research project")
    if (review.outcome === "return_for_changes")
      throw new Error("A returned track is not ready for evidence integration")
    const bindings = await list(path.join(root, ".openscience/research/projections/workspaces"), WorkspaceBinding.parse)
    const binding = bindings.find((value) => value.trackId === review.trackId && value.active)
    const claims = await Promise.all(
      review.claimIds.map((id) =>
        load(path.join(root, `.openscience/research/claims/${id}.json`), ScientificClaim.parse),
      ),
    )
    const artifactIds = [...new Set(claims.flatMap((claim) => claim.artifactIds))]
    const integrity = await ResearchEvidenceService.verifyArtifacts(root)
    const selected = new Set(artifactIds)
    if (integrity.some((entry) => selected.has(entry.artifact.id) && !entry.valid)) {
      throw new Error("Evidence integration is blocked by missing or corrupted artifacts")
    }
    const audit = await ResearchAudit.inspect(root)
    const related = new Set([...review.claimIds, ...review.analysisIds, ...artifactIds, review.id])
    const supportingEventIds = audit.events
      .filter((event) => [...related].some((id) => JSON.stringify(event.payload).includes(id)))
      .map((event) => event.eventId)
    const request: JsonValue = { actorId: input.actor.id, reviewId: input.reviewId }
    const now = new Date().toISOString()
    const content = {
      sourceTrackId: review.trackId,
      reviewId: review.id,
      mode: "evidence_only" as const,
      sourceBranch: binding?.branch ?? "unbound",
      sourceCommit: binding?.boundAtCommit ?? null,
      baseFoundationId: project.activeFoundationId,
      claimIds: review.claimIds,
      analysisIds: review.analysisIds,
      artifactIds,
      supportingEventIds,
    }
    const integration = EvidenceIntegration.parse({
      schemaVersion: 1,
      id: ResearchID.create("integration"),
      projectId: project.id,
      ...content,
      bundleHash: Canonical.hash(content),
      createdAt: now,
      createdBy: input.actor,
    })
    const appended = input.idempotencyKey
      ? await FilesystemLedger.appendIdempotent({
          projectRoot: root,
          projectId: project.id,
          type: "evidence.integrated",
          actor: input.actor,
          payload: { integration },
          signer: input.signer,
          occurredAt: now,
          key: input.idempotencyKey,
          request,
        })
      : {
          event: await FilesystemLedger.append({
            projectRoot: root,
            projectId: project.id,
            type: "evidence.integrated",
            actor: input.actor,
            payload: { integration },
            signer: input.signer,
            occurredAt: now,
          }),
          replayed: false,
        }
    const value = appended.replayed
      ? EvidenceIntegration.parse((appended.event.payload as Record<string, unknown>).integration)
      : integration
    await atomic(path.join(root, `.openscience/research/integrations/${value.id}.json`), value as JsonValue)
    return { integration: value, eventId: appended.event.eventId, replayed: appended.replayed }
  }
}
