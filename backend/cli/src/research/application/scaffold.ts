import path from "node:path"
import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises"
import z from "zod"
import { Global } from "@/global"
import { ResearchID } from "../domain/id"
import { IterationMode, ProtocolContent, ResearchProject, type Actor } from "../domain/schema"
import type { Signer } from "../domain/signature"
import { environmentManifest, environmentName } from "../adapters/environment/conda"
import { ResearchProjectService } from "./project"
import { InvestigationService } from "./investigation"

const Profile = z
  .object({
    question: z.string().min(1).max(12000),
    domain: z.string().min(1).max(120),
    dataPhase: z.enum(["synthetic", "downloaded", "real"]),
    license: z.enum(["MIT", "BSD-3-Clause", "Apache-2.0", "GPL-3.0", "proprietary"]),
    paperWorkspace: z.literal(true).default(true),
    networkMode: z.enum(["offline", "ask", "allowed"]),
    egressPolicy: z.enum(["public", "restricted", "air-gapped"]),
    hpc: z
      .object({
        enabled: z.boolean(),
        scheduler: z.enum(["slurm", "pbs", "sge"]).optional(),
        clusterName: z.string().max(200).optional(),
        account: z.string().max(200).optional(),
        partition: z.string().max(200).optional(),
        modules: z.array(z.string().min(1).max(300)).default([]),
        scratchPath: z.string().max(2000).optional(),
        validated: z.literal(false).default(false),
      })
      .strict(),
  })
  .strict()

export const ResearchScaffoldRequest = z
  .object({
    destination: z.string().min(1).max(8000),
    repositoryMode: z.enum(["new", "existing", "later"]),
    name: z.string().min(1).max(120),
    description: z.string().max(4000).default(""),
    author: z.object({ displayName: z.string().min(1).max(200), email: z.string().email().optional() }).strict(),
    profile: Profile,
    initialIteration: z
      .object({
        title: z.string().min(1).max(200),
        mode: IterationMode,
        question: z.string().min(1).max(12000),
        decisionGoal: z.string().min(1).max(8000),
        content: ProtocolContent,
      })
      .strict(),
    environment: z
      .object({
        create: z.boolean(),
        python: z.string().regex(/^3\.(10|11|12|13)$/),
        condaPackages: z.array(z.string()).max(200).default([]),
        pipPackages: z.array(z.string()).max(200).default([]),
      })
      .strict(),
  })
  .strict()
export type ResearchScaffoldRequest = z.infer<typeof ResearchScaffoldRequest>

const Stage = z.enum([
  "queued",
  "validating",
  "preparing_repository",
  "writing_scaffold",
  "creating_identity",
  "writing_environment",
  "solving_environment",
  "bootstrapping_ledger",
  "verifying",
  "ready",
  "draft",
  "paused",
  "cancelled",
  "failed",
])

export const ResearchScaffoldOperation = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().startsWith("rso_"),
    request: ResearchScaffoldRequest,
    stage: Stage,
    state: z.enum(["queued", "running", "completed", "paused", "cancelled", "failed"]),
    message: z.string(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    projectId: z.string().optional(),
    error: z.string().optional(),
  })
  .strict()
export type ResearchScaffoldOperation = z.infer<typeof ResearchScaffoldOperation>

const controllers = new Map<string, AbortController>()

function operationDirectory() {
  return process.env.OPENSCIENCE_TEST_HOME
    ? path.join(process.env.OPENSCIENCE_TEST_HOME, "data", "research-scaffolds")
    : path.join(Global.Path.data, "research-scaffolds")
}

function file(id: string) {
  return path.join(operationDirectory(), `${id}.json`)
}

async function atomic(target: string, value: unknown) {
  await mkdir(path.dirname(target), { recursive: true })
  const temporary = target + ".tmp"
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 })
  await rename(temporary, target)
}

async function save(operation: ResearchScaffoldOperation) {
  const value = ResearchScaffoldOperation.parse({ ...operation, updatedAt: new Date().toISOString() })
  await atomic(file(value.id), value)
  return value
}

async function update(id: string, patch: Partial<ResearchScaffoldOperation>) {
  return save(ResearchScaffoldOperation.parse({ ...(await loadOperation(id)), ...patch }))
}

async function loadOperation(id: string) {
  const operation = ResearchScaffoldOperation.parse(JSON.parse(await readFile(file(id), "utf8")))
  if (operation.state !== "running" || controllers.has(id)) return operation
  return save({
    ...operation,
    state: "paused",
    stage: "paused",
    message: "Creation was interrupted and can be resumed.",
  })
}

function folders(phase: ResearchScaffoldRequest["profile"]["dataPhase"], hpc: boolean) {
  const phases =
    phase === "synthetic"
      ? ["01_synthetic", "02_downloaded", "03_real_data"]
      : phase === "downloaded"
        ? ["02_downloaded", "03_real_data"]
        : ["03_real_data"]
  return [
    "background",
    "hypotheses",
    "analysis",
    "plans",
    "results/logs",
    "results/figures",
    "data/synthetic",
    "data/downloaded",
    "data/real",
    "paper/outline",
    "paper/drafts",
    "paper/reviewer_feedback",
    "scripts/shared",
    ...phases.map((value) => `experiments/${value}`),
    ...(hpc ? ["hpc/templates", "hpc/logs"] : []),
  ]
}

async function writeSeed(root: string, relative: string, content: string) {
  const target = path.join(root, relative)
  if (await Bun.file(target).exists()) return
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, content, "utf8")
}

async function scaffold(root: string, request: ResearchScaffoldRequest) {
  await Promise.all(
    folders(request.profile.dataPhase, request.profile.hpc.enabled).map((value) =>
      mkdir(path.join(root, value), { recursive: true }),
    ),
  )
  await Promise.all([
    writeSeed(root, "KNOWN_PATTERNS.md", "# Known patterns\n\nRecord reusable methods and resolved errors here.\n"),
    writeSeed(
      root,
      "intellectual_contribution.md",
      "# Intellectual contributions\n\nRecord substantive human framing, pivots, and interpretation.\n",
    ),
    writeSeed(root, "research-state.md", `# Research state\n\nQuestion: ${request.profile.question}\n`),
    writeSeed(
      root,
      "paper/outline/README.md",
      "# Publication outline\n\nPublications consume approved evidence; they do not change scientific lifecycle state.\n",
    ),
    writeSeed(
      root,
      ".openscience/research-contract.md",
      "# OpenScience SMAIRT contract\n\nUse the signed research record for iterations, formal runs, evidence, review, and decisions. Read `KNOWN_PATTERNS.md` before writing research code.\n",
    ),
  ])
}

async function execute(id: string, actor: Actor, signer: Signer) {
  const controller = new AbortController()
  controllers.set(id, controller)
  const operation = await loadOperation(id)
  const request = operation.request
  const stage = (value: z.infer<typeof Stage>, message: string) =>
    update(id, { stage: value, state: "running", message })
  try {
    await stage("validating", "Validating the destination and study contract.")
    const requested = path.resolve(request.destination)
    const parent = await realpath(path.dirname(requested))
    const destination = path.join(parent, path.basename(requested))
    if (controller.signal.aborted) throw new DOMException("Cancelled", "AbortError")
    if (request.repositoryMode === "later") {
      await mkdir(destination, { recursive: true })
      await atomic(path.join(destination, ".openscience/research/scaffold-draft.json"), request)
      await update(id, {
        stage: "draft",
        state: "completed",
        message: "Draft saved. Link a Git repository to continue.",
      })
      return
    }
    await stage(
      "preparing_repository",
      request.repositoryMode === "new"
        ? "Initializing the study Git repository."
        : "Validating the existing Git repository.",
    )
    const existing = await Bun.file(path.join(destination, ".openscience/research/project.json")).exists()
    await stage("creating_identity", "Creating the local signing identity and project owner.")
    const initialized = existing
      ? {
          project: ResearchProject.parse(
            JSON.parse(await readFile(path.join(destination, ".openscience/research/project.json"), "utf8")),
          ),
        }
      : await ResearchProjectService.initialize({
          directory: destination,
          mode:
            request.repositoryMode === "new" && !(await Bun.file(path.join(destination, ".git")).exists())
              ? "new"
              : "adopt",
          name: request.name,
          description: request.description,
          profile: request.profile,
          environment: request.environment,
          actor,
          signer,
          createCondaEnvironment: request.environment.create,
          signal: controller.signal,
        })
    await stage("writing_scaffold", "Writing the OpenScience–SMAIRT project structure.")
    if (request.repositoryMode === "new") await scaffold(destination, request)
    await stage(
      request.environment.create ? "solving_environment" : "writing_environment",
      request.environment.create
        ? "Solving and creating the project-named Conda environment."
        : "Writing the portable Conda specification.",
    )
    const iterations = await InvestigationService.listIterations(destination)
    if (!iterations.length) {
      await stage("bootstrapping_ledger", "Signing the initial iteration and protocol draft.")
      await InvestigationService.createIteration({
        projectRoot: destination,
        trackId: initialized.project.coreTrackId,
        title: request.initialIteration.title,
        question: request.initialIteration.question,
        decisionGoal: request.initialIteration.decisionGoal,
        content: request.initialIteration.content,
        actor,
        role: "owner",
        signer,
      })
    }
    await stage("verifying", "Verifying the scaffold and signed research record.")
    await update(id, { stage: "ready", state: "completed", message: "Study ready.", projectId: initialized.project.id })
  } catch (error) {
    const cancelled = controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")
    await update(id, {
      stage: cancelled ? "cancelled" : "failed",
      state: cancelled ? "cancelled" : "failed",
      message: cancelled
        ? "Creation cancelled. Completed stages were preserved for resume."
        : "Study creation stopped safely.",
      ...(cancelled ? {} : { error: error instanceof Error ? error.message : String(error) }),
    })
  } finally {
    controllers.delete(id)
  }
}

export namespace ResearchScaffoldService {
  export function preview(value: ResearchScaffoldRequest) {
    const request = ResearchScaffoldRequest.parse(value)
    const name = environmentName(request.name)
    return {
      request,
      slug: name,
      destination: path.resolve(request.destination),
      environmentName: name,
      environmentYml: environmentManifest({
        name,
        python: request.environment.python,
        condaPackages: request.environment.condaPackages,
        pipPackages: request.environment.pipPackages,
      }),
      directories: folders(request.profile.dataPhase, request.profile.hpc.enabled),
      stages: Stage.options.slice(1, 10),
    }
  }

  export async function start(value: ResearchScaffoldRequest, actor: Actor, signer: Signer) {
    const request = ResearchScaffoldRequest.parse(value)
    const now = new Date().toISOString()
    const operation = await save({
      schemaVersion: 1,
      id: ResearchID.create("operation"),
      request,
      stage: "queued",
      state: "queued",
      message: "Study creation queued.",
      createdAt: now,
      updatedAt: now,
    })
    void execute(operation.id, actor, signer)
    return operation
  }

  export const get = loadOperation

  export async function cancel(id: string) {
    controllers.get(id)?.abort()
    const operation = await loadOperation(id)
    if (operation.state !== "queued" && operation.state !== "paused") return operation
    return update(id, { stage: "cancelled", state: "cancelled", message: "Creation cancelled before execution." })
  }

  export async function resume(id: string, actor: Actor, signer: Signer) {
    const operation = await loadOperation(id)
    if (!["paused", "failed", "cancelled"].includes(operation.state)) return operation
    const resumed = await update(id, {
      stage: "queued",
      state: "queued",
      message: "Study creation queued for resume.",
      error: undefined,
    })
    void execute(id, actor, signer)
    return resumed
  }
}
