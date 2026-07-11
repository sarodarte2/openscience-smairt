import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ResearchAdoptionService } from "../application/adopt"
import { ResearchExportService } from "../application/export"
import { ResearchProjectService } from "../application/project"
import { ProjectMembership } from "../application/membership"
import { ResearchAudit } from "../application/audit"
import { FilesystemLedger } from "../adapters/ledger/filesystem"
import { Ed25519 } from "../domain/signature"

const execute = promisify(execFile)
const actor = { kind: "human" as const, id: "local:trust-test", displayName: "Trust Researcher" }
const { signer } = Ed25519.generate()
let base: string
let root: string

beforeEach(async () => {
  base = await mkdtemp(path.join(os.tmpdir(), "openscience-trust-"))
  root = path.join(base, "study")
  await execute("git", ["init", "-q", root])
  await execute("git", ["-C", root, "config", "user.name", "Trust Researcher"])
  await execute("git", ["-C", root, "config", "user.email", "trust@example.com"])
})

afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

describe("Research trust workflows", () => {
  it("scans adoption candidates without changing the repository", async () => {
    await writeFile(path.join(root, "analysis.py"), "print('analysis')\n")
    await writeFile(path.join(root, "results.csv"), "metric,value\naccuracy,0.9\n")
    const before = await execute("git", ["-C", root, "status", "--porcelain=v1"])
    const report = await ResearchAdoptionService.scan(root)
    const after = await execute("git", ["-C", root, "status", "--porcelain=v1"])
    expect(after.stdout).toBe(before.stdout)
    expect(report).toMatchObject({
      initialized: false,
      counts: { scanned: 2, recognized: 2, uncertain: 1, conflicts: 0 },
    })
    expect(report.candidates).toContainEqual({
      path: "results.csv",
      category: "data",
      confidence: "imported-unverified",
      reason: "data origin and integrity require researcher attestation",
    })
  })

  it("creates a self-verifying RO-Crate-style export without claiming scientific validity", async () => {
    await ResearchProjectService.initialize({
      directory: root,
      mode: "adopt",
      name: "Trust Study",
      actor,
      signer,
      createCondaEnvironment: false,
    })
    const destination = path.join(base, "export")
    const result = await ResearchExportService.create({
      projectRoot: root,
      destination,
      actor,
      role: "owner",
      signer,
    })
    expect(result).toMatchObject({ destination, manifest: "MANIFEST.sha256" })
    expect(await readdir(destination)).toEqual(
      expect.arrayContaining([
        "MANIFEST.sha256",
        "README.md",
        "audit.json",
        "ledger",
        "research.json",
        "ro-crate-metadata.json",
      ]),
    )
    expect(await readFile(path.join(destination, "README.md"), "utf8")).toContain("does not claim")
    const manifest = await readFile(path.join(destination, "MANIFEST.sha256"), "utf8")
    expect(manifest).toContain("ro-crate-metadata.json")
    expect(JSON.parse(await readFile(path.join(destination, "audit.json"), "utf8"))).toMatchObject({
      integrity: { ledgerValid: true, scientificValid: true },
    })
  })

  it("supports signed membership changes while protecting the final owner", async () => {
    const project = await ResearchProjectService.initialize({
      directory: root,
      mode: "adopt",
      name: "Collaborative Trust Study",
      actor,
      signer,
      createCondaEnvironment: false,
    })
    const ownerFile = path.join(root, `.openscience/research/projections/members/${project.member.id}.json`)
    await writeFile(ownerFile, JSON.stringify({ ...project.member, role: "reviewer" }) + "\n")
    expect(await ProjectMembership.localMember(root, signer.keyId)).toBeNull()
    await writeFile(ownerFile, JSON.stringify(project.member) + "\n")
    const collaborator = Ed25519.generate().signer
    const added = await ProjectMembership.add({
      projectRoot: root,
      displayName: "Second Owner",
      email: "second@example.com",
      memberRole: "researcher",
      signingKeyId: collaborator.keyId,
      actor,
      role: "owner",
      signer,
      idempotencyKey: "add-second-owner",
    })
    expect(
      await ProjectMembership.add({
        projectRoot: root,
        displayName: "Second Owner",
        email: "second@example.com",
        memberRole: "researcher",
        signingKeyId: collaborator.keyId,
        actor,
        role: "owner",
        signer,
        idempotencyKey: "add-second-owner",
      }),
    ).toMatchObject({ member: { id: added.member.id }, replayed: true })
    await ProjectMembership.changeRole({
      projectRoot: root,
      memberId: added.member.id,
      newRole: "owner",
      actor,
      role: "owner",
      signer,
      idempotencyKey: "promote-second-owner",
    })
    await ProjectMembership.remove({
      projectRoot: root,
      memberId: project.member.id,
      actor,
      role: "owner",
      signer,
      idempotencyKey: "remove-first-owner",
    })
    await expect(
      ProjectMembership.remove({
        projectRoot: root,
        memberId: added.member.id,
        actor,
        role: "owner",
        signer,
      }),
    ).rejects.toThrow("final owner")
  })

  it("rejects privileged or impersonated events signed by a lower-privilege member", async () => {
    const project = await ResearchProjectService.initialize({
      directory: root,
      mode: "adopt",
      name: "Authorization Study",
      actor,
      signer,
      createCondaEnvironment: false,
    })
    const reviewer = Ed25519.generate().signer
    const added = await ProjectMembership.add({
      projectRoot: root,
      displayName: "Project Reviewer",
      memberRole: "reviewer",
      signingKeyId: reviewer.keyId,
      actor,
      role: "owner",
      signer,
      idempotencyKey: "add-project-reviewer",
    })
    await FilesystemLedger.append({
      projectRoot: root,
      projectId: project.project.id,
      type: "foundation.promoted",
      actor,
      payload: { foundationId: "forged" },
      signer: reviewer,
    })
    const audit = await ResearchAudit.inspect(root)
    expect(added.member.role).toBe("reviewer")
    expect(audit.readOnly).toBeTrue()
    expect(audit.diagnostics.at(-1)).toMatchObject({ code: "unauthorized_event" })
  })
})
