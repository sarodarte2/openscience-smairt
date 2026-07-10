import { FilesystemLedger, type LedgerDiagnostic } from "../adapters/ledger/filesystem"
import { ProjectMember } from "../domain/schema"
import type { ResearchEvent } from "../domain/event"

export interface TrustDiagnostic {
  code:
    | "missing_genesis"
    | "duplicate_genesis"
    | "invalid_genesis_owner"
    | "untrusted_signer"
    | "unauthorized_member_add"
    | "unauthorized_member_remove"
    | "final_owner_remove"
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
  const members = new Map([[owner.signingKeyId, { role: owner.role, memberId: owner.id }]])
  for (const change of changes) {
    if (!ancestors.has(change.eventId)) continue
    if (change.kind === "add") {
      members.set(change.member.signingKeyId, { role: change.member.role, memberId: change.member.id })
      continue
    }
    for (const [keyId, member] of members) {
      if (member.memberId === change.memberId) members.delete(keyId)
    }
  }
  return members
}

export namespace ResearchAudit {
  export async function inspect(projectRoot: string): Promise<{
    events: Awaited<ReturnType<typeof FilesystemLedger.inspect>>["events"]
    diagnostics: (LedgerDiagnostic | TrustDiagnostic)[]
    readOnly: boolean
    heads: Awaited<ReturnType<typeof FilesystemLedger.inspect>>["heads"]
  }> {
    const ledger = await FilesystemLedger.inspect(projectRoot)
    if (ledger.readOnly) return ledger
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

    return {
      events: ledger.events,
      heads: ledger.heads,
      diagnostics: [...ledger.diagnostics, ...diagnostics],
      readOnly: diagnostics.length > 0,
    }
  }

  export async function assertWritable(projectRoot: string) {
    const audit = await inspect(projectRoot)
    if (audit.readOnly) throw new ResearchAuditError(audit.diagnostics)
    return audit
  }
}
