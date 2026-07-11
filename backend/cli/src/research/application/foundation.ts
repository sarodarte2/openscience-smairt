import path from "node:path"
import { mkdir, open, readFile, readdir, rename } from "node:fs/promises"
import { FilesystemLedger } from "../adapters/ledger/filesystem"
import { LocalGit } from "../adapters/git/local"
import { Canonical, type JsonValue } from "../domain/canonical"
import { Governance, ResearchCapability, type ResearchRole } from "../domain/governance"
import { ResearchID } from "../domain/id"
import {
  ArtifactManifest,
  EvidenceIntegration,
  FoundationRevision,
  ResearchProject,
  TrackEnvironment,
  type Actor,
} from "../domain/schema"
import type { Signer } from "../domain/signature"
import { ResearchAudit } from "./audit"
import { ResearchEvidenceService } from "./evidence"

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

export namespace ResearchFoundationService {
  export async function preview(projectRoot: string) {
    const git = await LocalGit.inspect(projectRoot)
    const project = await load(path.join(git.root, ".openscience/research/project.json"), ResearchProject.parse)
    const snapshot = await LocalGit.snapshot(git.root)
    const environmentDirectory = path.join(git.root, ".openscience/research/projections/environments/tracks")
    const environmentNames = await readdir(environmentDirectory).catch(() => [])
    const environments = await Promise.all(
      environmentNames
        .filter((name) => name.endsWith(".json"))
        .map((name) => load(path.join(environmentDirectory, name), TrackEnvironment.parse)),
    )
    const integrationDirectory = path.join(git.root, ".openscience/research/integrations")
    const integrationNames = await readdir(integrationDirectory).catch(() => [])
    const integrations = await Promise.all(
      integrationNames
        .filter((name) => name.endsWith(".json"))
        .map((name) => load(path.join(integrationDirectory, name), EvidenceIntegration.parse)),
    )
    const artifacts = await ResearchEvidenceService.verifyArtifacts(git.root)
    return {
      projectId: project.id,
      activeFoundationId: project.activeFoundationId,
      git: {
        commit: snapshot.commit,
        branch: snapshot.branch,
        dirty: snapshot.dirty,
        codeSnapshotHash: snapshot.trackedFilesHash,
      },
      environments,
      integrations,
      artifacts: artifacts.map((value) => ({ ...value.artifact, integrityValid: value.valid })),
      ready: !!snapshot.commit && !snapshot.dirty && integrations.length > 0 && artifacts.every((value) => value.valid),
    }
  }

  export async function list(projectRoot: string) {
    const git = await LocalGit.inspect(projectRoot)
    const directory = path.join(git.root, ".openscience/research/foundations")
    const names = await readdir(directory).catch(() => [])
    return Promise.all(
      names
        .filter((name) => name.endsWith(".json"))
        .map((name) => load(path.join(directory, name), FoundationRevision.parse)),
    )
  }

  export async function promote(
    input: Authorization & {
      projectRoot: string
      expectedGitCommit: string
      environmentTrackId: string
      artifactIds: string[]
      integrationIds: string[]
      supportingEventIds?: string[]
      idempotencyKey?: string
    },
  ) {
    Governance.authorize(input, ResearchCapability.foundationPromote)
    const git = await LocalGit.inspect(input.projectRoot)
    await ResearchAudit.assertWritable(git.root)
    const projectFile = path.join(git.root, ".openscience/research/project.json")
    const project = await load(projectFile, ResearchProject.parse)
    const snapshot = await LocalGit.snapshot(git.root)
    if (!snapshot.commit) throw new Error("Foundation promotion requires a committed Git workspace")
    if (snapshot.dirty) throw new Error("Foundation promotion requires a clean Git workspace")
    if (snapshot.commit !== input.expectedGitCommit) {
      throw new Error(`Git commit changed before foundation promotion; expected ${input.expectedGitCommit}`)
    }
    const environment = await load(
      path.join(git.root, `.openscience/research/projections/environments/tracks/${input.environmentTrackId}.json`),
      TrackEnvironment.parse,
    )
    if (environment.projectId !== project.id) throw new Error("Environment belongs to a different research project")
    const integrations = await Promise.all(
      [...new Set(input.integrationIds)].map((id) =>
        load(path.join(git.root, `.openscience/research/integrations/${id}.json`), EvidenceIntegration.parse),
      ),
    )
    if (integrations.some((value) => value.projectId !== project.id)) {
      throw new Error("Foundation integrations must belong to this research project")
    }
    const artifacts = await Promise.all(
      [...new Set(input.artifactIds)].map((id) =>
        load(path.join(git.root, `.openscience/research/artifacts/${id}.json`), ArtifactManifest.parse),
      ),
    )
    if (artifacts.some((value) => value.projectId !== project.id)) {
      throw new Error("Foundation artifacts must belong to this research project")
    }
    const integratedArtifacts = new Set(integrations.flatMap((value) => value.artifactIds))
    if (artifacts.some((value) => !integratedArtifacts.has(value.id))) {
      throw new Error("Every foundation artifact must be present in a selected evidence integration")
    }
    const integrity = await ResearchEvidenceService.verifyArtifacts(git.root)
    const selectedArtifacts = new Set(artifacts.map((value) => value.id))
    if (integrity.some((value) => selectedArtifacts.has(value.artifact.id) && !value.valid)) {
      throw new Error("Foundation promotion is blocked by missing or corrupted artifacts")
    }
    const audit = await ResearchAudit.inspect(git.root)
    const eventIds = new Set(audit.events.map((value) => value.eventId))
    const integrationEventIds = audit.events
      .filter(
        (event) =>
          event.type === "evidence.integrated" &&
          integrations.some((value) => JSON.stringify(event.payload).includes(value.id)),
      )
      .map((event) => event.eventId)
    const supportingEventIds = [...new Set([...integrationEventIds, ...(input.supportingEventIds ?? [])])]
    if (supportingEventIds.some((id) => !eventIds.has(id))) throw new Error("Foundation references an unknown event")
    const request: JsonValue = {
      actorId: input.actor.id,
      expectedGitCommit: input.expectedGitCommit,
      environmentTrackId: input.environmentTrackId,
      artifactIds: artifacts.map((value) => value.id),
      integrationIds: integrations.map((value) => value.id),
      supportingEventIds,
    }
    const now = new Date().toISOString()
    const promotedByEventId = ResearchID.create("event")
    const foundation = FoundationRevision.parse({
      schemaVersion: 1,
      id: ResearchID.create("foundation"),
      projectId: project.id,
      parentFoundationId: project.activeFoundationId,
      gitCommit: snapshot.commit,
      codeSnapshotHash: snapshot.trackedFilesHash,
      environmentHash: environment.portableSpecHash,
      environmentSpecPath: environment.portableSpecPath,
      artifactIds: artifacts.map((value) => value.id),
      integrationIds: integrations.map((value) => value.id),
      supportingEventIds,
      promotedByEventId,
      createdAt: now,
      createdBy: input.actor,
    })
    const appended = input.idempotencyKey
      ? await FilesystemLedger.appendIdempotent({
          projectRoot: git.root,
          projectId: project.id,
          eventId: promotedByEventId,
          type: "foundation.promoted",
          actor: input.actor,
          payload: { foundation },
          signer: input.signer,
          occurredAt: now,
          key: input.idempotencyKey,
          request,
        })
      : {
          event: await FilesystemLedger.append({
            projectRoot: git.root,
            projectId: project.id,
            eventId: promotedByEventId,
            type: "foundation.promoted",
            actor: input.actor,
            payload: { foundation },
            signer: input.signer,
            occurredAt: now,
          }),
          replayed: false,
        }
    const value = appended.replayed
      ? FoundationRevision.parse((appended.event.payload as Record<string, unknown>).foundation)
      : foundation
    const updatedProject = ResearchProject.parse({ ...project, activeFoundationId: value.id })
    await atomic(path.join(git.root, `.openscience/research/foundations/${value.id}.json`), value as JsonValue)
    await atomic(projectFile, updatedProject as JsonValue)
    return { foundation: value, project: updatedProject, eventId: appended.event.eventId, replayed: appended.replayed }
  }
}
