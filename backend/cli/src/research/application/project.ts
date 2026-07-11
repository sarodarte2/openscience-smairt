import path from "node:path"
import { access, mkdir, open, readFile, rename, writeFile } from "node:fs/promises"
import { Canonical, type JsonValue } from "../domain/canonical"
import { ResearchID } from "../domain/id"
import {
  ProjectMember,
  ResearchProject,
  ResearchTrack,
  TrackEnvironment,
  WorkspaceBinding,
  type Actor,
} from "../domain/schema"
import type { Signer } from "../domain/signature"
import { FilesystemLedger } from "../adapters/ledger/filesystem"
import { LocalGit } from "../adapters/git/local"
import { CondaEnvironment } from "../adapters/environment/conda"

const IGNORE = [
  ".openscience/research/cache/",
  ".openscience/research/private/",
  ".openscience/research/runs/",
  ".openscience/research/.write.lock/",
]

async function exists(file: string) {
  return access(file)
    .then(() => true)
    .catch(() => false)
}

async function atomicJson(file: string, value: JsonValue) {
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

async function updateIgnore(root: string) {
  const file = path.join(root, ".gitignore")
  const current = await readFile(file, "utf8").catch(() => "")
  const missing = IGNORE.filter((line) => !current.split(/\r?\n/).includes(line))
  if (missing.length === 0) return
  const separator = current.length > 0 && !current.endsWith("\n") ? "\n" : ""
  await writeFile(file, current + separator + missing.join("\n") + "\n", "utf8")
}

export class ProjectAlreadyInitializedError extends Error {
  constructor(readonly projectRoot: string) {
    super(`OpenScience Research is already initialized at ${projectRoot}`)
  }
}

export namespace ResearchProjectService {
  export async function initialize(input: {
    directory: string
    mode: "new" | "adopt"
    name: string
    description?: string
    actor: Actor
    signer: Signer
    createCondaEnvironment?: boolean
  }) {
    if (input.actor.kind !== "human") throw new Error("A human owner must initialize a research project")
    const requested = path.resolve(input.directory)
    if (input.mode === "new") await mkdir(requested, { recursive: false })
    const git = input.mode === "new" ? await LocalGit.initialize(requested) : await LocalGit.inspect(requested)
    const configFile = path.join(git.root, ".openscience/research/project.json")
    if (await exists(configFile)) throw new ProjectAlreadyInitializedError(git.root)

    const now = new Date().toISOString()
    const projectId = ResearchID.create("project")
    const coreTrackId = ResearchID.create("track")
    const memberId = ResearchID.create("member")
    const environment = await CondaEnvironment.prepare({
      projectRoot: git.root,
      projectName: input.name,
      create: input.createCondaEnvironment ?? true,
    })
    const project = ResearchProject.parse({
      schemaVersion: 1,
      id: projectId,
      projectId,
      name: input.name,
      description: input.description ?? "",
      defaultEnvironment: { kind: "conda", name: environment.name },
      coreTrackId,
      activeFoundationId: null,
      createdAt: now,
      createdBy: input.actor,
    })
    const track = ResearchTrack.parse({
      schemaVersion: 1,
      id: coreTrackId,
      projectId,
      alias: "core",
      title: "Core research track",
      objective: input.description || input.name,
      state: "active",
      hidden: true,
      parentTrackIds: [],
      createdAt: now,
      createdBy: input.actor,
    })
    const member = ProjectMember.parse({
      schemaVersion: 1,
      id: memberId,
      actorId: input.actor.id,
      projectId,
      displayName: input.actor.displayName,
      email: git.user.email ?? undefined,
      gitName: git.user.name ?? undefined,
      gitEmail: git.user.email ?? undefined,
      role: "owner",
      signingKeyId: input.signer.keyId,
      active: true,
      createdAt: now,
      createdBy: input.actor,
    })
    const binding = WorkspaceBinding.parse({
      schemaVersion: 1,
      id: ResearchID.create("workspace"),
      projectId,
      trackId: coreTrackId,
      repositoryRoot: git.root,
      worktreePath: git.root,
      branch: git.branch,
      boundAtCommit: git.commit,
      active: true,
      createdAt: now,
      createdBy: input.actor,
    })
    const trackEnvironment = TrackEnvironment.parse({
      schemaVersion: 1,
      projectId,
      trackId: coreTrackId,
      kind: "conda",
      name: environment.name,
      portableSpecPath: path.relative(git.root, environment.file),
      portableSpecHash: environment.specHash,
      state: "base",
      inheritedFromTrackId: null,
      createdAt: now,
      createdBy: input.actor,
    })

    await FilesystemLedger.appendBatch({
      projectRoot: git.root,
      projectId,
      actor: input.actor,
      signer: input.signer,
      entries: [
        { type: "project.created", payload: { project, owner: member, environment }, occurredAt: now },
        { type: "track.created", payload: { track, binding, environment: trackEnvironment }, occurredAt: now },
      ],
    })

    await atomicJson(configFile, project as JsonValue)
    await atomicJson(path.join(git.root, `.openscience/research/tracks/${coreTrackId}.json`), track as JsonValue)
    await atomicJson(
      path.join(git.root, `.openscience/research/projections/members/${memberId}.json`),
      member as JsonValue,
    )
    await atomicJson(
      path.join(git.root, `.openscience/research/projections/workspaces/${binding.id}.json`),
      binding as JsonValue,
    )
    await atomicJson(
      path.join(git.root, `.openscience/research/projections/environments/tracks/${coreTrackId}.json`),
      trackEnvironment as JsonValue,
    )
    await updateIgnore(git.root)
    return { project, track, member, binding, environment, trackEnvironment, root: git.root }
  }
}
