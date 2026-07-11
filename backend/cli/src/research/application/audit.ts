import { FilesystemLedger, type LedgerDiagnostic } from "../adapters/ledger/filesystem"
import path from "node:path"
import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { lstat, readFile, readdir, realpath } from "node:fs/promises"
import {
  ArtifactManifest,
  EvidenceIntegration,
  FoundationRevision,
  ProtocolRevision,
  ProjectMember,
  ResearchIteration,
  ResearchProject,
  RunAttempt,
  ScientificAnalysis,
  ScientificClaim,
  TrackEnvironment,
  TrackReview,
} from "../domain/schema"
import type { ResearchEvent } from "../domain/event"
import { Canonical } from "../domain/canonical"
import { Governance, ResearchCapability, type ResearchRole } from "../domain/governance"

export interface TrustDiagnostic {
  code:
    | "missing_genesis"
    | "duplicate_genesis"
    | "invalid_genesis_owner"
    | "untrusted_signer"
    | "unauthorized_member_add"
    | "unauthorized_member_remove"
    | "final_owner_remove"
    | "unauthorized_event"
  file: string
  message: string
}

export interface ScientificDiagnostic {
  code:
    | "invalid_projection"
    | "artifact_missing"
    | "artifact_hash_mismatch"
    | "artifact_size_mismatch"
    | "claim_missing_analysis"
    | "claim_missing_artifact"
    | "claim_unfinalized_analysis"
    | "review_missing_claim"
    | "review_missing_analysis"
    | "integration_missing_review"
    | "integration_missing_artifact"
    | "analysis_missing_run"
    | "run_missing_protocol"
    | "run_missing_iteration"
    | "run_environment_missing"
    | "run_output_missing"
    | "run_output_hash_mismatch"
    | "foundation_missing_artifact"
    | "foundation_missing_integration"
    | "foundation_missing_event"
    | "foundation_environment_missing"
    | "active_foundation_missing"
    | "environment_spec_missing"
    | "environment_spec_hash_mismatch"
    | "projection_ledger_mismatch"
  file: string
  message: string
}

export class ResearchAuditError extends Error {
  constructor(readonly diagnostics: (LedgerDiagnostic | TrustDiagnostic)[]) {
    super("Research project is read-only because its ledger trust chain is invalid")
  }
}

function field(payload: unknown, name: string) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined
  return (payload as Record<string, unknown>)[name]
}

type Member = ReturnType<typeof ProjectMember.parse>
type MembershipChange =
  | { eventId: string; kind: "add"; member: Member }
  | { eventId: string; kind: "update"; member: Member }
  | { eventId: string; kind: "remove"; memberId: string }

function ancestorResolver(events: ResearchEvent[]) {
  const byId = new Map(events.map((event) => [event.eventId, event]))
  const memo = new Map<string, Set<string>>()
  function ancestors(event: ResearchEvent): Set<string> {
    const found = memo.get(event.eventId)
    if (found) return found
    const result = new Set<string>()
    memo.set(event.eventId, result)
    for (const parent of event.parents) {
      result.add(parent.eventId)
      const parentEvent = byId.get(parent.eventId)
      if (parentEvent) for (const eventId of ancestors(parentEvent)) result.add(eventId)
    }
    return result
  }
  return ancestors
}

function membership(owner: Member, ancestors: Set<string>, changes: MembershipChange[]) {
  const members = new Map([
    [owner.signingKeyId, { role: owner.role, memberId: owner.id, actorId: owner.actorId ?? owner.id }],
  ])
  for (const change of changes.filter((value) => value.kind !== "remove")) {
    if (!ancestors.has(change.eventId)) continue
    members.set(change.member.signingKeyId, {
      role: change.member.role,
      memberId: change.member.id,
      actorId: change.member.actorId ?? change.member.id,
    })
  }
  for (const change of changes.filter((value) => value.kind === "remove")) {
    if (!ancestors.has(change.eventId)) continue
    for (const [keyId, member] of members) {
      if (member.memberId === change.memberId) members.delete(keyId)
    }
  }
  return members
}

function requiredCapability(type: string): ResearchCapability | null {
  if (type === "track.created") return ResearchCapability.trackCreate
  if (type === "iteration.created") return ResearchCapability.iterationCreate
  if (type === "protocol.frozen") return ResearchCapability.protocolFreeze
  if (type === "environment.diverged" || type === "environment.updated") return ResearchCapability.environmentManage
  if (type.startsWith("run.")) return ResearchCapability.runExecute
  if (type === "artifact.registered" || type.startsWith("analysis.")) return ResearchCapability.analysisWrite
  if (type === "claim.finalized") return ResearchCapability.claimFinalize
  if (type === "claim.created") return ResearchCapability.analysisWrite
  if (type === "track.reviewed") return ResearchCapability.trackReview
  if (type === "evidence.integrated") return ResearchCapability.evidenceIntegrate
  if (type === "code.merge_proposed") return ResearchCapability.codeMergePropose
  if (type === "foundation.promoted") return ResearchCapability.foundationPromote
  if (type === "publication.drafted") return ResearchCapability.publicationWrite
  if (type === "publication.approved") return ResearchCapability.publicationApprove
  if (type.startsWith("member.")) return ResearchCapability.membershipManage
  return null
}

export namespace ResearchAudit {
  export async function inspectScientific(projectRoot: string) {
    const canonicalRoot = await realpath(projectRoot).catch(() => path.resolve(projectRoot))
    const diagnostics: ScientificDiagnostic[] = []
    const loadDirectory = async <T>(relative: string, parse: (value: unknown) => T) => {
      const directory = path.join(projectRoot, relative)
      const names = await readdir(directory).catch(() => [])
      const values: T[] = []
      for (const name of names.filter((value) => value.endsWith(".json"))) {
        const file = path.join(directory, name)
        try {
          values.push(parse(JSON.parse(await readFile(file, "utf8"))))
        } catch (error) {
          diagnostics.push({
            code: "invalid_projection",
            file,
            message: error instanceof Error ? error.message : "Invalid projection",
          })
        }
      }
      return values
    }
    const [artifacts, analyses, claims, reviews, integrations, foundations, protocols, runs, iterations, environments] =
      await Promise.all([
        loadDirectory(".openscience/research/artifacts", ArtifactManifest.parse),
        loadDirectory(".openscience/research/analyses", ScientificAnalysis.parse),
        loadDirectory(".openscience/research/claims", ScientificClaim.parse),
        loadDirectory(".openscience/research/reviews", TrackReview.parse),
        loadDirectory(".openscience/research/integrations", EvidenceIntegration.parse),
        loadDirectory(".openscience/research/foundations", FoundationRevision.parse),
        loadDirectory(".openscience/research/projections/protocols", ProtocolRevision.parse),
        loadDirectory(".openscience/research/projections/runs", RunAttempt.parse),
        loadDirectory(".openscience/research/iterations", ResearchIteration.parse),
        loadDirectory(".openscience/research/projections/environments/tracks", TrackEnvironment.parse),
      ])
    const artifactById = new Map(artifacts.map((value) => [value.id, value]))
    const analysisById = new Map(analyses.map((value) => [value.id, value]))
    const claimById = new Map(claims.map((value) => [value.id, value]))
    const reviewById = new Map(reviews.map((value) => [value.id, value]))
    const integrationById = new Map(integrations.map((value) => [value.id, value]))
    const protocolById = new Map(protocols.map((value) => [value.id, value]))
    const runById = new Map(runs.map((value) => [value.id, value]))
    const iterationById = new Map(iterations.map((value) => [value.id, value]))
    const ledger = await ResearchAudit.inspect(projectRoot)
    const signed = new Map<string, string>()
    for (const event of ledger.events) {
      if (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) continue
      const payload = event.payload as Record<string, unknown>
      const records = [
        ["artifact", ArtifactManifest.safeParse(payload.artifact)],
        ["analysis", ScientificAnalysis.safeParse(payload.analysis)],
        ["claim", ScientificClaim.safeParse(payload.claim)],
        ["review", TrackReview.safeParse(payload.review)],
        ["integration", EvidenceIntegration.safeParse(payload.integration)],
        ["foundation", FoundationRevision.safeParse(payload.foundation)],
      ] as const
      for (const [key, result] of records) {
        if (result.success) signed.set(`${key}:${result.data.id}`, Canonical.hash(result.data))
      }
      const environment = TrackEnvironment.safeParse(payload.environment)
      if (environment.success) {
        signed.set(`environment:${environment.data.trackId}`, Canonical.hash(environment.data))
      }
    }
    const reconcile = (key: string, values: { id: string }[]) => {
      for (const value of values) {
        if (signed.get(`${key}:${value.id}`) === Canonical.hash(value)) continue
        diagnostics.push({
          code: "projection_ledger_mismatch",
          file: value.id,
          message: `${key} projection does not match its signed ledger record`,
        })
      }
    }
    reconcile("artifact", artifacts)
    reconcile("analysis", analyses)
    reconcile("claim", claims)
    reconcile("review", reviews)
    reconcile("integration", integrations)
    reconcile("foundation", foundations)
    for (const environment of environments) {
      if (signed.get(`environment:${environment.trackId}`) !== Canonical.hash(environment)) {
        diagnostics.push({
          code: "projection_ledger_mismatch",
          file: environment.trackId,
          message: "environment projection does not match its latest signed ledger record",
        })
      }
      const file = path.resolve(canonicalRoot, environment.portableSpecPath)
      const resolved = await realpath(file).catch(() => null)
      if (
        !resolved ||
        path.relative(canonicalRoot, resolved).startsWith("..") ||
        path.isAbsolute(path.relative(canonicalRoot, resolved))
      ) {
        diagnostics.push({
          code: "environment_spec_missing",
          file: environment.trackId,
          message: `Missing or unsafe environment specification ${environment.portableSpecPath}`,
        })
        continue
      }
      const content = await readFile(resolved)
      if (createHash("sha256").update(content).digest("hex") !== environment.portableSpecHash) {
        diagnostics.push({
          code: "environment_spec_hash_mismatch",
          file: environment.trackId,
          message: `Environment specification ${environment.portableSpecPath} differs from the signed record`,
        })
      }
    }
    for (const artifact of artifacts) {
      const file = path.resolve(canonicalRoot, artifact.path)
      try {
        const resolved = await realpath(file)
        const relative = path.relative(canonicalRoot, resolved)
        if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Artifact path escapes project")
        const stat = await lstat(resolved)
        if (!stat.isFile()) throw new Error("Artifact is not a regular file")
        if (stat.size !== artifact.byteLength)
          diagnostics.push({
            code: "artifact_size_mismatch",
            file: artifact.id,
            message: `Expected ${artifact.byteLength} bytes; found ${stat.size}`,
          })
        const hash = createHash("sha256")
        for await (const chunk of createReadStream(resolved)) hash.update(chunk)
        const actual = hash.digest("hex")
        if (actual !== artifact.contentHash)
          diagnostics.push({
            code: "artifact_hash_mismatch",
            file: artifact.id,
            message: `Expected ${artifact.contentHash}; found ${actual}`,
          })
      } catch (error) {
        diagnostics.push({
          code: "artifact_missing",
          file: artifact.id,
          message: error instanceof Error ? error.message : "Artifact unavailable",
        })
      }
    }
    for (const claim of claims) {
      for (const id of claim.analysisIds) {
        const analysis = analysisById.get(id)
        if (!analysis)
          diagnostics.push({ code: "claim_missing_analysis", file: claim.id, message: `Missing analysis ${id}` })
        else if (claim.state === "finalized" && analysis.state !== "finalized")
          diagnostics.push({
            code: "claim_unfinalized_analysis",
            file: claim.id,
            message: `Analysis ${id} is not finalized`,
          })
      }
      for (const id of claim.artifactIds)
        if (!artifactById.has(id))
          diagnostics.push({ code: "claim_missing_artifact", file: claim.id, message: `Missing artifact ${id}` })
    }
    for (const analysis of analyses) {
      for (const id of analysis.runIds)
        if (!runById.has(id))
          diagnostics.push({ code: "analysis_missing_run", file: analysis.id, message: `Missing run ${id}` })
    }
    const digest = async (file: string) => {
      const hash = createHash("sha256")
      for await (const chunk of createReadStream(file)) hash.update(chunk)
      return hash.digest("hex")
    }
    for (const run of runs) {
      if (!protocolById.has(run.protocolId))
        diagnostics.push({ code: "run_missing_protocol", file: run.id, message: `Missing protocol ${run.protocolId}` })
      if (!iterationById.has(run.iterationId))
        diagnostics.push({
          code: "run_missing_iteration",
          file: run.id,
          message: `Missing iteration ${run.iterationId}`,
        })
      const environment = path.resolve(canonicalRoot, run.environment.resolvedSpecPath)
      if (!(await realpath(environment).catch(() => null)))
        diagnostics.push({
          code: "run_environment_missing",
          file: run.id,
          message: `Missing environment ${run.environment.resolvedSpecPath}`,
        })
      if (!run.result) continue
      for (const output of run.execution.outputs) {
        const file = path.resolve(run.execution.cwd, output.path)
        if (!(await realpath(file).catch(() => null)))
          diagnostics.push({
            code: "run_output_missing",
            file: run.id,
            message: `Missing declared output ${output.path}`,
          })
      }
      for (const output of [
        { path: run.result.stdoutPath, hash: run.result.stdoutHash },
        { path: run.result.stderrPath, hash: run.result.stderrHash },
      ]) {
        const file = path.resolve(canonicalRoot, output.path)
        const resolved = await realpath(file).catch(() => null)
        if (!resolved) {
          diagnostics.push({ code: "run_output_missing", file: run.id, message: `Missing run output ${output.path}` })
          continue
        }
        const relative = path.relative(canonicalRoot, resolved)
        if (relative.startsWith("..") || path.isAbsolute(relative) || (await digest(resolved)) !== output.hash)
          diagnostics.push({
            code: "run_output_hash_mismatch",
            file: run.id,
            message: `Run output does not match ${output.path}`,
          })
      }
    }
    for (const review of reviews) {
      for (const id of review.claimIds)
        if (!claimById.has(id))
          diagnostics.push({ code: "review_missing_claim", file: review.id, message: `Missing claim ${id}` })
      for (const id of review.analysisIds)
        if (!analysisById.has(id))
          diagnostics.push({ code: "review_missing_analysis", file: review.id, message: `Missing analysis ${id}` })
    }
    for (const integration of integrations) {
      if (!reviewById.has(integration.reviewId))
        diagnostics.push({
          code: "integration_missing_review",
          file: integration.id,
          message: `Missing review ${integration.reviewId}`,
        })
      for (const id of integration.artifactIds)
        if (!artifactById.has(id))
          diagnostics.push({
            code: "integration_missing_artifact",
            file: integration.id,
            message: `Missing artifact ${id}`,
          })
    }
    const eventIds = new Set(ledger.events.map((value) => value.eventId))
    for (const foundation of foundations) {
      for (const id of foundation.artifactIds)
        if (!artifactById.has(id))
          diagnostics.push({
            code: "foundation_missing_artifact",
            file: foundation.id,
            message: `Missing artifact ${id}`,
          })
      for (const id of foundation.integrationIds)
        if (!integrationById.has(id))
          diagnostics.push({
            code: "foundation_missing_integration",
            file: foundation.id,
            message: `Missing integration ${id}`,
          })
      for (const id of foundation.supportingEventIds)
        if (!eventIds.has(id))
          diagnostics.push({ code: "foundation_missing_event", file: foundation.id, message: `Missing event ${id}` })
      if (!(await realpath(path.resolve(canonicalRoot, foundation.environmentSpecPath)).catch(() => null)))
        diagnostics.push({
          code: "foundation_environment_missing",
          file: foundation.id,
          message: `Missing environment ${foundation.environmentSpecPath}`,
        })
    }
    const projectFile = path.join(projectRoot, ".openscience/research/project.json")
    const project = await readFile(projectFile, "utf8")
      .then((value) => ResearchProject.parse(JSON.parse(value)))
      .catch(() => null)
    if (project?.activeFoundationId && !foundations.some((value) => value.id === project.activeFoundationId)) {
      diagnostics.push({
        code: "active_foundation_missing",
        file: projectFile,
        message: `Missing active foundation ${project.activeFoundationId}`,
      })
    }
    return {
      diagnostics,
      valid: diagnostics.length === 0,
      counts: {
        artifacts: artifacts.length,
        analyses: analyses.length,
        claims: claims.length,
        reviews: reviews.length,
        integrations: integrations.length,
        foundations: foundations.length,
        protocols: protocols.length,
        runs: runs.length,
      },
    }
  }

  export async function inspect(projectRoot: string): Promise<{
    events: Awaited<ReturnType<typeof FilesystemLedger.inspect>>["events"]
    diagnostics: (LedgerDiagnostic | TrustDiagnostic)[]
    readOnly: boolean
    heads: Awaited<ReturnType<typeof FilesystemLedger.inspect>>["heads"]
    members: { keyId: string; role: string; memberId: string }[]
  }> {
    const ledger = await FilesystemLedger.inspect(projectRoot)
    if (ledger.readOnly) return { ...ledger, members: [] }
    const diagnostics: TrustDiagnostic[] = []
    const genesis = ledger.events.filter((event) => event.type === "project.created")
    if (genesis.length === 0) {
      diagnostics.push({
        code: "missing_genesis",
        file: projectRoot,
        message: "No signed project genesis event exists",
      })
    }
    if (genesis.length > 1) {
      diagnostics.push({
        code: "duplicate_genesis",
        file: genesis[1].eventId,
        message: "The ledger contains more than one project genesis event",
      })
    }
    const first = genesis[0]
    const owner = first ? ProjectMember.safeParse(field(first.payload, "owner")) : null
    if (first) {
      if (!owner?.success || owner.data.role !== "owner" || owner.data.signingKeyId !== first.signature.keyId) {
        diagnostics.push({
          code: "invalid_genesis_owner",
          file: first.eventId,
          message: "Genesis signer does not match its declared owner",
        })
      }
    }

    const trustedOwner = owner?.success && owner.data.role === "owner" ? owner.data : null
    const ancestors = ancestorResolver(ledger.events)
    const changes: MembershipChange[] = []
    for (const event of ledger.events) {
      if (event === first) continue
      if (!trustedOwner) continue
      const members = membership(trustedOwner, ancestors(event), changes)
      const signer = members.get(event.signature.keyId)
      if (!signer) {
        diagnostics.push({
          code: "untrusted_signer",
          file: event.eventId,
          message: `Signing key ${event.signature.keyId} has no trusted project membership`,
        })
        continue
      }
      if (event.actor.kind !== "human" || event.actor.id !== signer.actorId) {
        diagnostics.push({
          code: "unauthorized_event",
          file: event.eventId,
          message: `Event actor does not match signing member ${signer.memberId}`,
        })
        continue
      }
      const required = requiredCapability(event.type)
      const authorized =
        required &&
        Governance.can(
          {
            actor: { kind: "human", id: signer.actorId, displayName: signer.memberId },
            role: signer.role as ResearchRole,
          },
          required,
        )
      if (!authorized) {
        diagnostics.push({
          code: "unauthorized_event",
          file: event.eventId,
          message: `${signer.role} member may not sign ${event.type}`,
        })
        continue
      }
      if (event.type === "member.added") {
        const member = ProjectMember.safeParse(field(event.payload, "member"))
        if (signer.role !== "owner" || !member.success) {
          diagnostics.push({
            code: "unauthorized_member_add",
            file: event.eventId,
            message: "Only an owner may add a valid project member",
          })
          continue
        }
        changes.push({ eventId: event.eventId, kind: "add", member: member.data })
        continue
      }
      if (event.type === "member.role_changed") {
        const member = ProjectMember.safeParse(field(event.payload, "member"))
        if (
          signer.role !== "owner" ||
          !member.success ||
          ![...members.values()].some((value) => value.memberId === member.data.id)
        ) {
          diagnostics.push({
            code: "unauthorized_member_add",
            file: event.eventId,
            message: "Only an owner may change an active member role",
          })
          continue
        }
        const target = [...members.values()].find((value) => value.memberId === member.data.id)
        const otherOwners = [...members.values()].filter(
          (value) => value.memberId !== member.data.id && value.role === "owner",
        )
        if (target?.role === "owner" && member.data.role !== "owner" && otherOwners.length === 0) {
          diagnostics.push({
            code: "final_owner_remove",
            file: event.eventId,
            message: "The final owner cannot change role without another active owner",
          })
          continue
        }
        changes.push({ eventId: event.eventId, kind: "update", member: member.data })
        continue
      }
      if (event.type !== "member.removed") continue
      const memberId = field(event.payload, "memberId")
      if (signer.role !== "owner" || typeof memberId !== "string") {
        diagnostics.push({
          code: "unauthorized_member_remove",
          file: event.eventId,
          message: "Only an owner may remove a valid project member",
        })
        continue
      }
      const target = [...members.values()].find((member) => member.memberId === memberId)
      if (!target) {
        diagnostics.push({
          code: "unauthorized_member_remove",
          file: event.eventId,
          message: "Member removal does not reference an active member in this event's lineage",
        })
        continue
      }
      const removingOwner = [...members.values()].some(
        (member) => member.memberId === memberId && member.role === "owner",
      )
      const otherOwners = [...members.values()].filter(
        (member) => member.memberId !== memberId && member.role === "owner",
      )
      if (removingOwner && otherOwners.length === 0) {
        diagnostics.push({
          code: "final_owner_remove",
          file: event.eventId,
          message: "The final owner cannot be removed without a signed ownership transfer",
        })
        continue
      }
      changes.push({ eventId: event.eventId, kind: "remove", memberId })
    }

    const tips = trustedOwner
      ? ledger.heads
          .map((head) => ledger.events.find((event) => event.eventId === head.eventId))
          .filter((event): event is ResearchEvent => !!event)
          .map((event) => membership(trustedOwner, new Set([...ancestors(event), event.eventId]), changes))
      : []
    const trusted = tips[0] ?? new Map<string, { role: string; memberId: string; actorId: string }>()
    const members = [...trusted]
      .filter(([keyId, member]) =>
        tips.every((tip) => {
          const value = tip.get(keyId)
          return value?.memberId === member.memberId && value.role === member.role && value.actorId === member.actorId
        }),
      )
      .map(([keyId, member]) => ({ keyId, ...member }))
    return {
      events: ledger.events,
      heads: ledger.heads,
      diagnostics: [...ledger.diagnostics, ...diagnostics],
      readOnly: diagnostics.length > 0,
      members: diagnostics.length > 0 ? [] : members,
    }
  }

  export async function assertWritable(projectRoot: string) {
    const audit = await inspect(projectRoot)
    if (audit.readOnly) throw new ResearchAuditError(audit.diagnostics)
    return audit
  }
}
