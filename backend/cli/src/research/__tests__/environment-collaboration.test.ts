import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import os from "node:os"
import path from "node:path"
import { ResearchProjectService } from "../application/project"
import { ResearchEnvironmentService } from "../application/environment"
import { ResearchCollaborationService } from "../application/collaboration"
import { ProjectMembership } from "../application/membership"
import { ResearchAudit } from "../application/audit"
import { ResearchWorkflowService } from "../application/workflow"
import { ResearchNetworkPolicy } from "../application/network"
import { Ed25519 } from "../domain/signature"

const execute = promisify(execFile)
const ownerActor = { kind: "human" as const, id: "local:owner", displayName: "Owner" }
const { signer: ownerSigner } = Ed25519.generate()
let root: string

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "openscience-environment-"))
  await execute("git", ["init", "-q", root])
  await execute("git", ["-C", root, "config", "user.name", "Owner"])
  await execute("git", ["-C", root, "config", "user.email", "owner@example.com"])
})

afterEach(async () => rm(root, { recursive: true, force: true }))

describe("Environment plans and offline collaboration", () => {
  it("previews and signs a package update without running Conda", async () => {
    const initialized = await ResearchProjectService.initialize({
      directory: root,
      mode: "adopt",
      name: "Environment Study",
      actor: ownerActor,
      signer: ownerSigner,
      createCondaEnvironment: false,
    })
    const plan = await ResearchEnvironmentService.plan({
      projectRoot: root,
      trackId: initialized.project.coreTrackId,
      python: "3.12",
      condaPackages: ["numpy=2.*"],
      pipPackages: ["polars"],
      solve: false,
    })
    expect(plan).toMatchObject({ additions: ["numpy=2.*", "polars"], canApply: true })
    const applied = await ResearchEnvironmentService.apply({
      projectRoot: root,
      trackId: initialized.project.coreTrackId,
      python: "3.12",
      condaPackages: ["numpy=2.*"],
      pipPackages: ["polars"],
      expectedSpecHash: plan.currentSpecHash,
      actor: ownerActor,
      role: "owner",
      signer: ownerSigner,
      idempotencyKey: "environment-update-numpy-polars",
    })
    expect(applied.additions).toEqual(["numpy=2.*", "polars"])
    expect(await readFile(path.join(root, applied.environment.portableSpecPath), "utf8")).toContain("numpy=2.*")
    expect((await ResearchAudit.inspect(root)).readOnly).toBeFalse()

    const spec = path.join(root, applied.environment.portableSpecPath)
    const forged = (await readFile(spec, "utf8")) + "  - scipy\n"
    await writeFile(spec, forged)
    const projection = path.join(
      root,
      `.openscience/research/projections/environments/tracks/${applied.environment.trackId}.json`,
    )
    await writeFile(
      projection,
      JSON.stringify({ ...applied.environment, portableSpecHash: createHash("sha256").update(forged).digest("hex") }),
    )
    expect((await ResearchAudit.inspectScientific(root)).diagnostics).toContainEqual(
      expect.objectContaining({ code: "projection_ledger_mismatch", file: applied.environment.trackId }),
    )
    expect(await ResearchWorkflowService.derive(root)).toMatchObject({
      blockers: [expect.objectContaining({ code: "projection_ledger_mismatch" })],
      nextActions: [{ enabled: false }],
    })
  })

  it("rejects environment paths outside the study and enforces offline egress", async () => {
    const initialized = await ResearchProjectService.initialize({
      directory: root,
      mode: "adopt",
      name: "Offline Study",
      actor: ownerActor,
      signer: ownerSigner,
      createCondaEnvironment: false,
      profile: {
        question: "Can this run without network egress?",
        domain: "testing",
        dataPhase: "synthetic",
        license: "MIT",
        paperWorkspace: true,
        networkMode: "offline",
        egressPolicy: "air-gapped",
        hpc: { enabled: false, modules: [], validated: false },
      },
    })
    const projection = path.join(
      root,
      `.openscience/research/projections/environments/tracks/${initialized.project.coreTrackId}.json`,
    )
    expect(
      await ResearchEnvironmentService.plan({
        projectRoot: root,
        trackId: initialized.project.coreTrackId,
        solve: true,
      }),
    ).toMatchObject({ solve: { state: "conflict" }, canApply: false })
    await writeFile(projection, JSON.stringify({ ...initialized.trackEnvironment, portableSpecPath: "../victim.txt" }))
    await expect(
      ResearchEnvironmentService.plan({ projectRoot: root, trackId: initialized.project.coreTrackId }),
    ).rejects.toThrow("must stay inside")
    await expect(
      ResearchNetworkPolicy.assertModelRequest({
        projectRoot: root,
        providerId: "external-provider",
        baseURL: "https://api.example.com/v1",
      }),
    ).rejects.toThrow("network policy blocks")
    await expect(
      ResearchNetworkPolicy.assertModelRequest({
        projectRoot: root,
        providerId: "local-provider",
        baseURL: "http://127.0.0.1:11434/v1",
      }),
    ).resolves.toBeUndefined()

    const projectFile = path.join(root, ".openscience/research/project.json")
    const mutable = JSON.parse(await readFile(projectFile, "utf8"))
    await writeFile(
      projectFile,
      JSON.stringify({ ...mutable, profile: { ...mutable.profile, networkMode: "allowed", egressPolicy: "public" } }),
    )
    await expect(
      ResearchNetworkPolicy.assertModelRequest({
        projectRoot: root,
        providerId: "external-provider",
        baseURL: "https://api.example.com/v1",
      }),
    ).rejects.toThrow("network policy blocks")

    const outside = await mkdtemp(path.join(os.tmpdir(), "openscience-environment-outside-"))
    const escape = path.join(root, ".openscience/research/escape")
    await symlink(outside, escape)
    await writeFile(
      projection,
      JSON.stringify({
        ...initialized.trackEnvironment,
        portableSpecPath: ".openscience/research/escape/victim.yml",
      }),
    )
    await expect(
      ResearchEnvironmentService.plan({ projectRoot: root, trackId: initialized.project.coreTrackId }),
    ).rejects.toThrow("symlink outside")
    await rm(outside, { recursive: true, force: true })
  })

  it("verifies proof of key possession before the owner accepts a collaborator", async () => {
    await ResearchProjectService.initialize({
      directory: root,
      mode: "adopt",
      name: "Collaborative Study",
      actor: ownerActor,
      signer: ownerSigner,
      createCondaEnvironment: false,
    })
    const { signer: collaborator } = Ed25519.generate()
    const join = await ResearchCollaborationService.createJoinRequest({
      projectRoot: root,
      displayName: "Collaborator",
      email: "collaborator@example.com",
      signer: collaborator,
    })
    const verified = await ResearchCollaborationService.verifyJoinRequest({ projectRoot: root, bundle: join.bundle })
    expect(verified.signingKeyId).toBe(collaborator.keyId)
    const added = await ProjectMembership.add({
      projectRoot: root,
      displayName: verified.displayName,
      email: verified.email,
      memberRole: "researcher",
      signingKeyId: verified.signingKeyId,
      actor: ownerActor,
      role: "owner",
      signer: ownerSigner,
    })
    expect(added.member).toMatchObject({ displayName: "Collaborator", role: "researcher", active: true })
    await expect(
      ResearchCollaborationService.verifyJoinRequest({ projectRoot: root, bundle: join.bundle.slice(0, -2) + "aa" }),
    ).rejects.toThrow()
  })
})
