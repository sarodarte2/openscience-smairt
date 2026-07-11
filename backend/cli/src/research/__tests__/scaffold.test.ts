import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ResearchScaffoldService, type ResearchScaffoldRequest } from "../application/scaffold"
import { ResearchAudit } from "../application/audit"
import { ResearchWorkflowService } from "../application/workflow"
import { Ed25519 } from "../domain/signature"

const actor = { kind: "human" as const, id: "local:scaffold-test", displayName: "Scaffold Researcher" }
const { signer } = Ed25519.generate()
let root: string

function request(destination: string): ResearchScaffoldRequest {
  return {
    destination,
    repositoryMode: "new",
    name: "Frontier Study",
    description: "A GUI-created computational study",
    author: { displayName: actor.displayName, email: "researcher@example.com" },
    profile: {
      question: "Can the proposed method improve the declared baseline?",
      domain: "machine_learning",
      dataPhase: "synthetic",
      license: "MIT",
      paperWorkspace: true,
      networkMode: "ask",
      egressPolicy: "public",
      hpc: { enabled: true, scheduler: "slurm", modules: ["python"], validated: false },
    },
    initialIteration: {
      title: "Initial feasibility",
      mode: "exploratory",
      question: "Does the method work on controlled synthetic data?",
      decisionGoal: "Decide whether benchmark validation is justified",
      content: {
        mode: "exploratory",
        aim: "Test feasibility without making a confirmatory claim",
        intendedInputs: ["synthetic dataset"],
        intendedOutputs: ["metrics and diagnostic figures"],
        decisionGoal: "Continue only if the success criteria are met",
      },
    },
    environment: {
      create: false,
      python: "3.12",
      condaPackages: ["numpy", "pandas"],
      pipPackages: ["polars"],
    },
  }
}

async function completed(id: string) {
  const operation = await ResearchScaffoldService.get(id)
  if (["completed", "failed", "cancelled"].includes(operation.state)) return operation
  await Bun.sleep(20)
  return completed(id)
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "openscience-scaffold-"))
  process.env.OPENSCIENCE_TEST_HOME = root
})

afterEach(async () => {
  delete process.env.OPENSCIENCE_TEST_HOME
  await rm(root, { recursive: true, force: true })
})

describe("Research scaffold", () => {
  it("previews exact environment and creates a verified SMAIRT study", async () => {
    const destination = path.join(root, "frontier-study")
    const input = request(destination)
    const preview = ResearchScaffoldService.preview(input)
    expect(preview).toMatchObject({ slug: "frontier-study", environmentName: "frontier-study" })
    expect(preview.environmentYml).toContain("  - numpy")
    expect(preview.environmentYml).toContain("      - polars")
    expect(preview.directories).toContain("hpc/templates")

    const started = await ResearchScaffoldService.start(input, actor, signer)
    const operation = await completed(started.id)
    expect(operation).toMatchObject({ state: "completed", stage: "ready" })
    expect((await stat(path.join(destination, ".git"))).isDirectory()).toBeTrue()
    expect(await readFile(path.join(destination, "KNOWN_PATTERNS.md"), "utf8")).toContain("Known patterns")
    expect(await readFile(path.join(destination, ".openscience/research/environment.yml"), "utf8")).toContain(
      "  - pandas",
    )
    expect((await ResearchAudit.inspect(destination)).readOnly).toBeFalse()
    expect(await ResearchWorkflowService.derive(destination)).toMatchObject({
      currentStage: "plan",
      nextActions: [{ id: "protocol.freeze", enabled: true }],
    })
  })
})
