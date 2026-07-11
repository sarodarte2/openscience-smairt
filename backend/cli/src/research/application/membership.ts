import path from "node:path"
import { mkdir, open, readFile, readdir, rename } from "node:fs/promises"
import { FilesystemLedger } from "../adapters/ledger/filesystem"
import { Canonical, type JsonValue } from "../domain/canonical"
import { Governance, ResearchCapability, type ResearchRole } from "../domain/governance"
import { ResearchID } from "../domain/id"
import { MemberRole, ProjectMember, ResearchProject, type Actor } from "../domain/schema"
import type { Signer } from "../domain/signature"
import { ResearchAudit } from "./audit"

type Authorization = { actor: Actor; role?: ResearchRole; signer: Signer }

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

export namespace ProjectMembership {
  export async function list(projectRoot: string) {
    const directory = path.join(projectRoot, ".openscience/research/projections/members")
    const names = await readdir(directory).catch(() => [])
    return Promise.all(
      names
        .filter((name) => name.endsWith(".json"))
        .map(async (name) => ProjectMember.parse(JSON.parse(await readFile(path.join(directory, name), "utf8")))),
    )
  }

  export async function localMember(projectRoot: string, keyId: string) {
    const audit = await ResearchAudit.inspect(projectRoot)
    if (audit.readOnly) return null
    const trusted = audit.members.find((candidate) => candidate.keyId === keyId)
    if (!trusted) return null
    return (
      (await list(projectRoot)).find(
        (candidate) =>
          candidate.active &&
          candidate.id === trusted.memberId &&
          candidate.signingKeyId === trusted.keyId &&
          candidate.role === trusted.role,
      ) ?? null
    )
  }

  export async function add(
    input: Authorization & {
      projectRoot: string
      displayName: string
      email?: string
      memberRole: ResearchRole
      signingKeyId: string
      idempotencyKey?: string
    },
  ) {
    Governance.authorize(input, ResearchCapability.membershipManage)
    await ResearchAudit.assertWritable(input.projectRoot)
    const project = ResearchProject.parse(
      JSON.parse(await readFile(path.join(input.projectRoot, ".openscience/research/project.json"), "utf8")),
    )
    const request: JsonValue = {
      actorId: input.actor.id,
      displayName: input.displayName,
      email: input.email ?? null,
      role: input.memberRole,
      signingKeyId: input.signingKeyId,
    }
    if (input.idempotencyKey) {
      const existing = await FilesystemLedger.lookupIdempotency({
        projectRoot: input.projectRoot,
        projectId: project.id,
        type: "member.added",
        key: input.idempotencyKey,
        request,
      })
      if (existing) {
        const member = ProjectMember.parse((existing.payload as Record<string, unknown>).member)
        await atomic(
          path.join(input.projectRoot, `.openscience/research/projections/members/${member.id}.json`),
          member as JsonValue,
        )
        return { member, eventId: existing.eventId, replayed: true }
      }
    }
    if ((await list(input.projectRoot)).some((value) => value.active && value.signingKeyId === input.signingKeyId)) {
      throw new Error("An active member already uses this signing key")
    }
    const now = new Date().toISOString()
    const memberId = ResearchID.create("member")
    const member = ProjectMember.parse({
      schemaVersion: 1,
      id: memberId,
      actorId: memberId,
      projectId: project.id,
      displayName: input.displayName,
      ...(input.email ? { email: input.email } : {}),
      role: MemberRole.parse(input.memberRole),
      signingKeyId: input.signingKeyId,
      active: true,
      createdAt: now,
      createdBy: input.actor,
    })
    const appended = input.idempotencyKey
      ? await FilesystemLedger.appendIdempotent({
          projectRoot: input.projectRoot,
          projectId: project.id,
          type: "member.added",
          actor: input.actor,
          payload: { member },
          signer: input.signer,
          key: input.idempotencyKey,
          request,
          occurredAt: now,
        })
      : {
          event: await FilesystemLedger.append({
            projectRoot: input.projectRoot,
            projectId: project.id,
            type: "member.added",
            actor: input.actor,
            payload: { member },
            signer: input.signer,
            occurredAt: now,
          }),
          replayed: false,
        }
    const value = appended.replayed
      ? ProjectMember.parse((appended.event.payload as Record<string, unknown>).member)
      : member
    await atomic(
      path.join(input.projectRoot, `.openscience/research/projections/members/${value.id}.json`),
      value as JsonValue,
    )
    return { member: value, eventId: appended.event.eventId, replayed: appended.replayed }
  }

  export async function changeRole(
    input: Authorization & { projectRoot: string; memberId: string; newRole: ResearchRole; idempotencyKey?: string },
  ) {
    Governance.authorize(input, ResearchCapability.membershipManage)
    await ResearchAudit.assertWritable(input.projectRoot)
    const members = await list(input.projectRoot)
    const current = members.find((value) => value.id === input.memberId && value.active)
    if (!current) throw new Error("Active project member not found")
    if (
      current.role === "owner" &&
      input.newRole !== "owner" &&
      members.filter((value) => value.active && value.role === "owner").length === 1
    ) {
      throw new Error("Transfer ownership before changing the final owner's role")
    }
    const member = ProjectMember.parse({ ...current, role: MemberRole.parse(input.newRole) })
    const request: JsonValue = { actorId: input.actor.id, memberId: input.memberId, role: input.newRole }
    const project = ResearchProject.parse(
      JSON.parse(await readFile(path.join(input.projectRoot, ".openscience/research/project.json"), "utf8")),
    )
    const appended = input.idempotencyKey
      ? await FilesystemLedger.appendIdempotent({
          projectRoot: input.projectRoot,
          projectId: project.id,
          type: "member.role_changed",
          actor: input.actor,
          payload: { member },
          signer: input.signer,
          key: input.idempotencyKey,
          request,
        })
      : {
          event: await FilesystemLedger.append({
            projectRoot: input.projectRoot,
            projectId: project.id,
            type: "member.role_changed",
            actor: input.actor,
            payload: { member },
            signer: input.signer,
          }),
          replayed: false,
        }
    const value = appended.replayed
      ? ProjectMember.parse((appended.event.payload as Record<string, unknown>).member)
      : member
    await atomic(
      path.join(input.projectRoot, `.openscience/research/projections/members/${value.id}.json`),
      value as JsonValue,
    )
    return { member: value, eventId: appended.event.eventId, replayed: appended.replayed }
  }

  export async function remove(
    input: Authorization & { projectRoot: string; memberId: string; idempotencyKey?: string },
  ) {
    Governance.authorize(input, ResearchCapability.membershipManage)
    await ResearchAudit.assertWritable(input.projectRoot)
    const members = await list(input.projectRoot)
    const project = ResearchProject.parse(
      JSON.parse(await readFile(path.join(input.projectRoot, ".openscience/research/project.json"), "utf8")),
    )
    const request: JsonValue = { actorId: input.actor.id, memberId: input.memberId }
    if (input.idempotencyKey) {
      const existing = await FilesystemLedger.lookupIdempotency({
        projectRoot: input.projectRoot,
        projectId: project.id,
        type: "member.removed",
        key: input.idempotencyKey,
        request,
      })
      if (existing) {
        const member = members.find((value) => value.id === input.memberId)
        if (!member) throw new Error("Removed member projection is missing")
        return { member, eventId: existing.eventId, replayed: true }
      }
    }
    const current = members.find((value) => value.id === input.memberId && value.active)
    if (!current) throw new Error("Active project member not found")
    if (current.role === "owner" && members.filter((value) => value.active && value.role === "owner").length === 1) {
      throw new Error("Transfer ownership before removing the final owner")
    }
    const appended = input.idempotencyKey
      ? await FilesystemLedger.appendIdempotent({
          projectRoot: input.projectRoot,
          projectId: project.id,
          type: "member.removed",
          actor: input.actor,
          payload: { memberId: input.memberId },
          signer: input.signer,
          key: input.idempotencyKey,
          request,
        })
      : {
          event: await FilesystemLedger.append({
            projectRoot: input.projectRoot,
            projectId: project.id,
            type: "member.removed",
            actor: input.actor,
            payload: { memberId: input.memberId },
            signer: input.signer,
          }),
          replayed: false,
        }
    const member = ProjectMember.parse({ ...current, active: false })
    await atomic(
      path.join(input.projectRoot, `.openscience/research/projections/members/${member.id}.json`),
      member as JsonValue,
    )
    return { member, eventId: appended.event.eventId, replayed: appended.replayed }
  }
}
