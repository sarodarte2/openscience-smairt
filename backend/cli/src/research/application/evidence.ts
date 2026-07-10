import path from "node:path"
import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { lstat, mkdir, open, readFile, readdir, realpath, rename } from "node:fs/promises"
import { FilesystemLedger } from "../adapters/ledger/filesystem"
import { LocalGit } from "../adapters/git/local"
import { Canonical, type JsonValue } from "../domain/canonical"
import { Governance, ResearchCapability, type ResearchRole } from "../domain/governance"
import { ResearchID } from "../domain/id"
import {
  ArtifactManifest,
  ResearchIteration,
  ResearchProject,
  RunAttempt,
  ScientificAnalysis,
  type Actor,
} from "../domain/schema"
import type { Signer } from "../domain/signature"
import { ResearchAudit } from "./audit"

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

async function context(projectRoot: string) {
  const git = await LocalGit.inspect(projectRoot)
  await ResearchAudit.assertWritable(git.root)
  const project = await load(path.join(git.root, ".openscience/research/project.json"), ResearchProject.parse)
  return { root: git.root, project }
}

function contained(root: string, file: string) {
  const relative = path.relative(root, file)
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
}

async function digest(file: string) {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest("hex")
}

async function ensureIteration(root: string, projectId: string, iterationId: string) {
  const value = await load(
    path.join(root, `.openscience/research/iterations/${iterationId}.json`),
    ResearchIteration.parse,
  )
  if (value.projectId !== projectId) throw new Error("Iteration belongs to a different research project")
  return value
}

async function ensureReferences(
  root: string,
  projectId: string,
  iterationId: string,
  runIds: string[],
  artifactIds: string[],
) {
  await ensureIteration(root, projectId, iterationId)
  for (const runId of new Set(runIds)) {
    const run = await load(path.join(root, `.openscience/research/projections/runs/${runId}.json`), RunAttempt.parse)
    if (run.projectId !== projectId || run.iterationId !== iterationId) {
      throw new Error(`Run ${runId} does not belong to iteration ${iterationId}`)
    }
  }
  for (const artifactId of new Set(artifactIds)) {
    const artifact = await load(
      path.join(root, `.openscience/research/artifacts/${artifactId}.json`),
      ArtifactManifest.parse,
    )
    if (artifact.projectId !== projectId || artifact.iterationId !== iterationId) {
      throw new Error(`Artifact ${artifactId} does not belong to iteration ${iterationId}`)
    }
  }
}

export namespace ResearchEvidenceService {
  export async function listArtifacts(projectRoot: string, iterationId?: string) {
    const git = await LocalGit.inspect(projectRoot)
    const directory = path.join(git.root, ".openscience/research/artifacts")
    const names = await readdir(directory).catch(() => [])
    const values = await Promise.all(
      names
        .filter((name) => name.endsWith(".json"))
        .map((name) => load(path.join(directory, name), ArtifactManifest.parse)),
    )
    return values.filter((value) => !iterationId || value.iterationId === iterationId)
  }

  export async function listAnalyses(projectRoot: string, iterationId?: string) {
    const git = await LocalGit.inspect(projectRoot)
    const directory = path.join(git.root, ".openscience/research/analyses")
    const names = await readdir(directory).catch(() => [])
    const values = await Promise.all(
      names
        .filter((name) => name.endsWith(".json"))
        .map((name) => load(path.join(directory, name), ScientificAnalysis.parse)),
    )
    return values.filter((value) => !iterationId || value.iterationId === iterationId)
  }

  export async function registerArtifact(
    input: Authorization & {
      projectRoot: string
      iterationId: string
      file: string
      artifactRole: ArtifactManifest["role"]
      mediaType: string
      runId?: string
    },
  ) {
    Governance.authorize(input, ResearchCapability.analysisWrite)
    const { root, project } = await context(input.projectRoot)
    await ensureReferences(root, project.id, input.iterationId, input.runId ? [input.runId] : [], [])
    const requested = path.resolve(root, input.file)
    const resolved = await realpath(requested)
    if (!contained(root, resolved)) throw new Error("Artifact must resolve to a regular file inside the project")
    const stat = await lstat(resolved)
    if (!stat.isFile()) throw new Error("Artifact must resolve to a regular file inside the project")
    const now = new Date().toISOString()
    const artifact = ArtifactManifest.parse({
      schemaVersion: 1,
      id: ResearchID.create("artifact"),
      projectId: project.id,
      iterationId: input.iterationId,
      runId: input.runId ?? null,
      path: path.relative(root, requested),
      role: input.artifactRole,
      mediaType: input.mediaType,
      byteLength: stat.size,
      contentHash: await digest(resolved),
      captureConfidence: "complete",
      createdAt: now,
      createdBy: input.actor,
    })
    const event = await FilesystemLedger.append({
      projectRoot: root,
      projectId: project.id,
      type: "artifact.registered",
      actor: input.actor,
      payload: { artifact },
      signer: input.signer,
      occurredAt: now,
    })
    await atomic(path.join(root, `.openscience/research/artifacts/${artifact.id}.json`), artifact as JsonValue)
    return { artifact, eventId: event.eventId }
  }

  export async function verifyArtifacts(projectRoot: string) {
    const git = await LocalGit.inspect(projectRoot)
    const directory = path.join(git.root, ".openscience/research/artifacts")
    const names = await readdir(directory).catch(() => [])
    return Promise.all(
      names
        .filter((name) => name.endsWith(".json"))
        .map(async (name) => {
          const artifact = await load(path.join(directory, name), ArtifactManifest.parse)
          const file = path.resolve(git.root, artifact.path)
          try {
            const resolved = await realpath(file)
            if (!contained(git.root, resolved)) throw new Error("path escapes project")
            const stat = await lstat(resolved)
            const actualHash = stat.isFile() ? await digest(resolved) : null
            return {
              artifact,
              valid: actualHash === artifact.contentHash && stat.size === artifact.byteLength,
              actualHash,
            }
          } catch {
            return { artifact, valid: false, actualHash: null }
          }
        }),
    )
  }

  export async function createAnalysis(
    input: Authorization & {
      projectRoot: string
      iterationId: string
      title: string
      summary: string
      methods: string
      findings: string[]
      limitations: string[]
      runIds: string[]
      artifactIds: string[]
      finalize?: boolean
    },
  ) {
    Governance.authorize(input, ResearchCapability.analysisWrite)
    const { root, project } = await context(input.projectRoot)
    await ensureReferences(root, project.id, input.iterationId, input.runIds, input.artifactIds)
    const now = new Date().toISOString()
    const analysis = ScientificAnalysis.parse({
      schemaVersion: 1,
      id: ResearchID.create("analysis"),
      projectId: project.id,
      iterationId: input.iterationId,
      title: input.title,
      summary: input.summary,
      methods: input.methods,
      findings: input.findings,
      limitations: input.limitations,
      runIds: [...new Set(input.runIds)],
      artifactIds: [...new Set(input.artifactIds)],
      state: input.finalize ? "finalized" : "draft",
      finalizedAt: input.finalize ? now : null,
      createdAt: now,
      createdBy: input.actor,
    })
    const event = await FilesystemLedger.append({
      projectRoot: root,
      projectId: project.id,
      type: input.finalize ? "analysis.finalized" : "analysis.created",
      actor: input.actor,
      payload: { analysis },
      signer: input.signer,
      occurredAt: now,
    })
    await atomic(path.join(root, `.openscience/research/analyses/${analysis.id}.json`), analysis as JsonValue)
    return { analysis, eventId: event.eventId }
  }
}
