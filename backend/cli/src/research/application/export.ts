import path from "node:path"
import { createHash } from "node:crypto"
import { copyFile, mkdir, open, readFile, readdir, realpath, rename } from "node:fs/promises"
import { LocalGit } from "../adapters/git/local"
import { Canonical, type JsonValue } from "../domain/canonical"
import { Governance, ResearchCapability, type ResearchRole } from "../domain/governance"
import {
  ArtifactManifest,
  EvidenceIntegration,
  FoundationRevision,
  Json,
  ProtocolRevision,
  ResearchIteration,
  ResearchProject,
  ResearchPublication,
  ResearchTrack,
  RunAttempt,
  ScientificAnalysis,
  ScientificClaim,
  TrackReview,
  type Actor,
} from "../domain/schema"
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

async function loadDirectory<T>(root: string, relative: string, parse: (value: unknown) => T) {
  const directory = path.join(root, relative)
  const names = await readdir(directory).catch(() => [])
  return Promise.all(
    names
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map(async (name) => parse(JSON.parse(await readFile(path.join(directory, name), "utf8")))),
  )
}

async function hash(file: string) {
  return createHash("sha256")
    .update(await readFile(file))
    .digest("hex")
}

async function files(directory: string, relative = ""): Promise<string[]> {
  const entries = await readdir(path.join(directory, relative), { withFileTypes: true })
  const nested = await Promise.all(
    entries.map((entry) => {
      const name = path.join(relative, entry.name)
      return entry.isDirectory() ? files(directory, name) : Promise.resolve([name])
    }),
  )
  return nested.flat().sort()
}

export namespace ResearchExportService {
  export async function create(input: Authorization & { projectRoot: string; destination: string }) {
    Governance.authorize(input, ResearchCapability.exportCreate)
    const git = await LocalGit.inspect(input.projectRoot)
    const destination = path.resolve(input.destination)
    if (await Bun.file(destination).exists()) throw new Error(`Export destination already exists: ${destination}`)
    await mkdir(destination, { recursive: false })
    const project = ResearchProject.parse(
      JSON.parse(await readFile(path.join(git.root, ".openscience/research/project.json"), "utf8")),
    )
    const [
      ledger,
      scientific,
      tracks,
      iterations,
      protocols,
      runs,
      artifacts,
      analyses,
      claims,
      reviews,
      integrations,
      foundations,
      publications,
    ] = await Promise.all([
      ResearchAudit.inspect(git.root),
      ResearchAudit.inspectScientific(git.root),
      loadDirectory(git.root, ".openscience/research/tracks", ResearchTrack.parse),
      loadDirectory(git.root, ".openscience/research/iterations", ResearchIteration.parse),
      loadDirectory(git.root, ".openscience/research/projections/protocols", ProtocolRevision.parse),
      loadDirectory(git.root, ".openscience/research/projections/runs", RunAttempt.parse),
      loadDirectory(git.root, ".openscience/research/artifacts", ArtifactManifest.parse),
      loadDirectory(git.root, ".openscience/research/analyses", ScientificAnalysis.parse),
      loadDirectory(git.root, ".openscience/research/claims", ScientificClaim.parse),
      loadDirectory(git.root, ".openscience/research/reviews", TrackReview.parse),
      loadDirectory(git.root, ".openscience/research/integrations", EvidenceIntegration.parse),
      loadDirectory(git.root, ".openscience/research/foundations", FoundationRevision.parse),
      loadDirectory(git.root, ".openscience/research/publications", ResearchPublication.parse),
    ])
    const report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      projectId: project.id,
      integrity: { ledgerValid: !ledger.readOnly, scientificValid: scientific.valid },
      ledgerDiagnostics: ledger.diagnostics,
      scientificDiagnostics: scientific.diagnostics,
      counts: scientific.counts,
    }
    const research = {
      project,
      tracks,
      iterations,
      protocols,
      runs,
      artifacts,
      analyses,
      claims,
      reviews,
      integrations,
      foundations,
      publications,
    }
    await atomic(path.join(destination, "audit.json"), Json.parse(report))
    await atomic(path.join(destination, "research.json"), Json.parse(research))
    await mkdir(path.join(destination, "ledger/events"), { recursive: true })
    for (const event of ledger.events)
      await atomic(path.join(destination, `ledger/events/${event.eventId}.json`), event as JsonValue)
    const verified = new Map(
      (
        await Promise.all(
          artifacts.map(
            async (artifact) =>
              [artifact.id, await hash(path.join(git.root, artifact.path)).catch(() => null)] as const,
          ),
        )
      ).filter((value) => value[1]),
    )
    for (const artifact of artifacts) {
      if (verified.get(artifact.id) !== artifact.contentHash) continue
      const target = path.join(destination, "artifacts", artifact.id, path.basename(artifact.path))
      await mkdir(path.dirname(target), { recursive: true })
      const source = await realpath(path.join(git.root, artifact.path))
      const relative = path.relative(await realpath(git.root), source)
      if (relative.startsWith("..") || path.isAbsolute(relative)) continue
      await copyFile(source, target)
    }
    const crate = {
      "@context": "https://w3id.org/ro/crate/1.1/context",
      "@graph": [
        {
          "@id": "ro-crate-metadata.json",
          "@type": "CreativeWork",
          about: { "@id": "./" },
          conformsTo: { "@id": "https://w3id.org/ro/crate/1.1" },
        },
        {
          "@id": "./",
          "@type": "Dataset",
          name: project.name,
          description: project.description,
          datePublished: report.generatedAt,
          identifier: project.id,
          hasPart: [
            "research.json",
            "audit.json",
            ...artifacts.map((artifact) => `artifacts/${artifact.id}/${path.basename(artifact.path)}`),
          ].map((id) => ({ "@id": id })),
        },
        ...artifacts.map((artifact) => ({
          "@id": `artifacts/${artifact.id}/${path.basename(artifact.path)}`,
          "@type": "File",
          sha256: artifact.contentHash,
          contentSize: artifact.byteLength,
          encodingFormat: artifact.mediaType,
        })),
      ],
    }
    await atomic(path.join(destination, "ro-crate-metadata.json"), Json.parse(crate))
    await Bun.write(
      path.join(destination, "README.md"),
      `# ${project.name} research export\n\nThis bundle verifies file and ledger integrity; it does not claim that scientific conclusions are valid or that every computation is replayable. See audit.json for explicit limitations and diagnostics.\n`,
    )
    const manifestFiles = await files(destination)
    const manifest = await Promise.all(
      manifestFiles.map(async (file) => `${await hash(path.join(destination, file))}  ${file}`),
    )
    await Bun.write(path.join(destination, "MANIFEST.sha256"), manifest.join("\n") + "\n")
    return { destination, report, fileCount: manifestFiles.length + 1, manifest: "MANIFEST.sha256" }
  }
}
