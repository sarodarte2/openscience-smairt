import path from "node:path"
import { lstat, readdir } from "node:fs/promises"
import { LocalGit } from "../adapters/git/local"

export type AdoptionCategory = "environment" | "notebook" | "source" | "data" | "result" | "document" | "unknown"
export type AdoptionConfidence = "captured" | "attested" | "imported-unverified"

export interface AdoptionCandidate {
  path: string
  category: AdoptionCategory
  confidence: AdoptionConfidence
  reason: string
}

const ignored = new Set([".git", ".openscience", "node_modules", ".venv", "venv", "__pycache__", "dist", "build"])
const environment = new Set([
  "environment.yml",
  "environment.yaml",
  "conda-lock.yml",
  "requirements.txt",
  "pyproject.toml",
  "renv.lock",
  "project.toml",
])
const source = new Set([".py", ".r", ".jl", ".ts", ".tsx", ".js", ".m", ".c", ".cc", ".cpp", ".f", ".f90", ".sh"])
const data = new Set([
  ".csv",
  ".tsv",
  ".parquet",
  ".feather",
  ".h5",
  ".hdf5",
  ".npy",
  ".npz",
  ".jsonl",
  ".vcf",
  ".fastq",
  ".fasta",
])
const results = new Set([".png", ".jpg", ".jpeg", ".svg", ".pdf", ".html", ".log", ".out"])
const documents = new Set([".md", ".txt", ".rst", ".tex", ".docx"])

function classify(relative: string): Omit<AdoptionCandidate, "path"> {
  const name = path.basename(relative).toLowerCase()
  const extension = path.extname(name)
  if (environment.has(name))
    return { category: "environment", confidence: "captured", reason: "recognized environment declaration" }
  if (extension === ".ipynb")
    return {
      category: "notebook",
      confidence: "attested",
      reason: "notebook execution history is not independently verified",
    }
  if (source.has(extension))
    return { category: "source", confidence: "captured", reason: "recognized computational source file" }
  if (data.has(extension))
    return {
      category: "data",
      confidence: "imported-unverified",
      reason: "data origin and integrity require researcher attestation",
    }
  if (results.has(extension))
    return {
      category: "result",
      confidence: "imported-unverified",
      reason: "result provenance cannot be reconstructed from the file alone",
    }
  if (documents.has(extension))
    return { category: "document", confidence: "attested", reason: "recognized research documentation" }
  return {
    category: "unknown",
    confidence: "imported-unverified",
    reason: "unrecognized material is never assigned inferred provenance",
  }
}

export namespace ResearchAdoptionService {
  export async function scan(directory: string) {
    const git = await LocalGit.inspect(directory)
    const candidates: AdoptionCandidate[] = []
    const conflicts: string[] = []
    const visit = async (current: string) => {
      const entries = await readdir(current, { withFileTypes: true })
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (ignored.has(entry.name)) continue
        const file = path.join(current, entry.name)
        const relative = path.relative(git.root, file)
        if (entry.isDirectory()) {
          await visit(file)
          continue
        }
        if (!entry.isFile()) {
          conflicts.push(`${relative}: symbolic links and special files require explicit review`)
          continue
        }
        const stat = await lstat(file)
        if (stat.size > 10 * 1024 * 1024 * 1024) {
          conflicts.push(`${relative}: file exceeds the 10 GiB adoption scan limit`)
          continue
        }
        candidates.push({ path: relative, ...classify(relative) })
      }
    }
    await visit(git.root)
    const recognized = candidates.filter((value) => value.category !== "unknown")
    const uncertain = candidates.filter((value) => value.confidence !== "captured")
    return {
      root: git.root,
      initialized: await Bun.file(path.join(git.root, ".openscience/research/project.json")).exists(),
      candidates,
      recognized,
      uncertain,
      ignored: [...ignored].sort(),
      conflicts,
      counts: {
        scanned: candidates.length,
        recognized: recognized.length,
        uncertain: uncertain.length,
        conflicts: conflicts.length,
      },
    }
  }
}
