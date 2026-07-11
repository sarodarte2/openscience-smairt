import path from "node:path"
import { mkdir, open, readFile, readdir, rename } from "node:fs/promises"
import { FilesystemLedger } from "../adapters/ledger/filesystem"
import { LocalGit } from "../adapters/git/local"
import { Canonical, type JsonValue } from "../domain/canonical"
import { Governance, ResearchCapability, type ResearchRole } from "../domain/governance"
import { ResearchID } from "../domain/id"
import {
  ArtifactManifest,
  ResearchProject,
  ResearchPublication,
  ScientificClaim,
  TrackReview,
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

export namespace ResearchPublicationService {
  export async function list(projectRoot: string) {
    const git = await LocalGit.inspect(projectRoot)
    const directory = path.join(git.root, ".openscience/research/publications")
    const names = await readdir(directory).catch(() => [])
    return Promise.all(
      names
        .filter((name) => name.endsWith(".json"))
        .map((name) => load(path.join(directory, name), ResearchPublication.parse)),
    )
  }

  export async function create(
    input: Authorization & {
      projectRoot: string
      title: string
      abstract: string
      claimIds: string[]
      artifactIds: string[]
      aiUseStatement: string
      contributionStatement: string
      idempotencyKey?: string
    },
  ) {
    Governance.authorize(input, ResearchCapability.publicationWrite)
    const git = await LocalGit.inspect(input.projectRoot)
    await ResearchAudit.assertWritable(git.root)
    const project = await load(path.join(git.root, ".openscience/research/project.json"), ResearchProject.parse)
    const claims = await Promise.all(
      [...new Set(input.claimIds)].map((id) =>
        load(path.join(git.root, `.openscience/research/claims/${id}.json`), ScientificClaim.parse),
      ),
    )
    if (claims.some((value) => value.projectId !== project.id || value.state !== "finalized")) {
      throw new Error("Publication drafts require finalized claims from this project")
    }
    const artifacts = await Promise.all(
      [...new Set(input.artifactIds)].map((id) =>
        load(path.join(git.root, `.openscience/research/artifacts/${id}.json`), ArtifactManifest.parse),
      ),
    )
    if (artifacts.some((value) => value.projectId !== project.id))
      throw new Error("Publication artifact belongs to another project")
    const reviewDirectory = path.join(git.root, ".openscience/research/reviews")
    const reviewNames = await readdir(reviewDirectory).catch(() => [])
    const reviews = await Promise.all(
      reviewNames
        .filter((name) => name.endsWith(".json"))
        .map((name) => load(path.join(reviewDirectory, name), TrackReview.parse)),
    )
    const accepted = new Set(reviews.filter((value) => value.outcome === "accepted").flatMap((value) => value.claimIds))
    const supportState = claims.every((value) => accepted.has(value.id)) ? "approved" : "unresolved"
    const request: JsonValue = {
      actorId: input.actor.id,
      title: input.title,
      abstract: input.abstract,
      claimIds: claims.map((value) => value.id),
      artifactIds: artifacts.map((value) => value.id),
      aiUseStatement: input.aiUseStatement,
      contributionStatement: input.contributionStatement,
    }
    const now = new Date().toISOString()
    const publication = ResearchPublication.parse({
      schemaVersion: 1,
      id: ResearchID.create("publication"),
      projectId: project.id,
      title: input.title,
      abstract: input.abstract,
      claimIds: claims.map((value) => value.id),
      artifactIds: artifacts.map((value) => value.id),
      supportState,
      state: "draft",
      aiUseStatement: input.aiUseStatement,
      contributionStatement: input.contributionStatement,
      approvedAt: null,
      createdAt: now,
      createdBy: input.actor,
    })
    const appended = input.idempotencyKey
      ? await FilesystemLedger.appendIdempotent({
          projectRoot: git.root,
          projectId: project.id,
          type: "publication.drafted",
          actor: input.actor,
          payload: { publication },
          signer: input.signer,
          key: input.idempotencyKey,
          request,
          occurredAt: now,
        })
      : {
          event: await FilesystemLedger.append({
            projectRoot: git.root,
            projectId: project.id,
            type: "publication.drafted",
            actor: input.actor,
            payload: { publication },
            signer: input.signer,
            occurredAt: now,
          }),
          replayed: false,
        }
    const value = appended.replayed
      ? ResearchPublication.parse((appended.event.payload as Record<string, unknown>).publication)
      : publication
    await atomic(path.join(git.root, `.openscience/research/publications/${value.id}.json`), value as JsonValue)
    return { publication: value, eventId: appended.event.eventId, replayed: appended.replayed }
  }

  export async function approve(
    input: Authorization & { projectRoot: string; publicationId: string; idempotencyKey?: string },
  ) {
    Governance.authorize(input, ResearchCapability.publicationApprove)
    const git = await LocalGit.inspect(input.projectRoot)
    await ResearchAudit.assertWritable(git.root)
    const file = path.join(git.root, `.openscience/research/publications/${input.publicationId}.json`)
    const current = await load(file, ResearchPublication.parse)
    if (current.supportState !== "approved")
      throw new Error("Unresolved claims cannot be exported as an approved publication")
    const request: JsonValue = { actorId: input.actor.id, publicationId: current.id }
    const publication = ResearchPublication.parse({
      ...current,
      state: "approved",
      approvedAt: new Date().toISOString(),
    })
    const appended = input.idempotencyKey
      ? await FilesystemLedger.appendIdempotent({
          projectRoot: git.root,
          projectId: current.projectId,
          type: "publication.approved",
          actor: input.actor,
          payload: { publication },
          signer: input.signer,
          key: input.idempotencyKey,
          request,
        })
      : {
          event: await FilesystemLedger.append({
            projectRoot: git.root,
            projectId: current.projectId,
            type: "publication.approved",
            actor: input.actor,
            payload: { publication },
            signer: input.signer,
          }),
          replayed: false,
        }
    const value = appended.replayed
      ? ResearchPublication.parse((appended.event.payload as Record<string, unknown>).publication)
      : publication
    await atomic(file, value as JsonValue)
    return { publication: value, eventId: appended.event.eventId, replayed: appended.replayed }
  }
}
