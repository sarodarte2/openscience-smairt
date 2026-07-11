import type { Actor } from "./schema"

export const ResearchCapability = {
  projectConfigure: "project.configure",
  membershipManage: "membership.manage",
  trackCreate: "track.create",
  iterationCreate: "iteration.create",
  protocolEdit: "protocol.edit",
  protocolFreeze: "protocol.freeze",
  protocolApprove: "protocol.approve",
  environmentManage: "environment.manage",
  runExecute: "run.execute",
  runCancel: "run.cancel",
  analysisWrite: "analysis.write",
  claimFinalize: "claim.finalize",
  trackReview: "track.review",
  evidenceIntegrate: "evidence.integrate",
  codeMergePropose: "code.merge.propose",
  foundationPromote: "foundation.promote",
  exportCreate: "export.create",
  publicationWrite: "publication.write",
  publicationApprove: "publication.approve",
  overrideGate: "gate.override",
  transcriptDecrypt: "transcript.decrypt",
} as const

export type ResearchCapability = (typeof ResearchCapability)[keyof typeof ResearchCapability]
export type ResearchRole = "owner" | "researcher" | "reviewer" | "viewer"

const owner = new Set<ResearchCapability>(Object.values(ResearchCapability))
const researcher = new Set<ResearchCapability>([
  ResearchCapability.trackCreate,
  ResearchCapability.iterationCreate,
  ResearchCapability.protocolEdit,
  ResearchCapability.protocolFreeze,
  ResearchCapability.environmentManage,
  ResearchCapability.runExecute,
  ResearchCapability.runCancel,
  ResearchCapability.analysisWrite,
  ResearchCapability.claimFinalize,
  ResearchCapability.trackReview,
  ResearchCapability.evidenceIntegrate,
  ResearchCapability.codeMergePropose,
  ResearchCapability.exportCreate,
  ResearchCapability.publicationWrite,
])
const reviewer = new Set<ResearchCapability>([
  ResearchCapability.protocolApprove,
  ResearchCapability.analysisWrite,
  ResearchCapability.claimFinalize,
  ResearchCapability.trackReview,
  ResearchCapability.evidenceIntegrate,
  ResearchCapability.exportCreate,
  ResearchCapability.publicationWrite,
  ResearchCapability.publicationApprove,
])
const viewer = new Set<ResearchCapability>()

const roles: Record<ResearchRole, Set<ResearchCapability>> = { owner, researcher, reviewer, viewer }
const humanOnly = new Set<ResearchCapability>([
  ResearchCapability.projectConfigure,
  ResearchCapability.membershipManage,
  ResearchCapability.protocolFreeze,
  ResearchCapability.protocolApprove,
  ResearchCapability.environmentManage,
  ResearchCapability.claimFinalize,
  ResearchCapability.trackReview,
  ResearchCapability.evidenceIntegrate,
  ResearchCapability.codeMergePropose,
  ResearchCapability.foundationPromote,
  ResearchCapability.publicationApprove,
  ResearchCapability.overrideGate,
  ResearchCapability.transcriptDecrypt,
])

export class ResearchAuthorizationError extends Error {
  constructor(
    readonly capability: ResearchCapability,
    reason: string,
  ) {
    super(reason)
  }
}

export namespace Governance {
  export function can(
    input: { actor: Actor; role?: ResearchRole; delegatedCapabilities?: ResearchCapability[] },
    capability: ResearchCapability,
  ) {
    if (input.actor.kind === "agent") {
      if (humanOnly.has(capability)) return false
      if (!input.role || !roles[input.role].has(capability)) return false
      return new Set(input.delegatedCapabilities ?? []).has(capability)
    }
    if (input.actor.kind === "system") return false
    if (!input.role) return false
    return roles[input.role].has(capability)
  }

  export function authorize(
    input: { actor: Actor; role?: ResearchRole; delegatedCapabilities?: ResearchCapability[] },
    capability: ResearchCapability,
  ) {
    if (can(input, capability)) return
    throw new ResearchAuthorizationError(capability, `${input.actor.kind} actor may not perform ${capability}`)
  }
}
