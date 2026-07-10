import path from "node:path"
import { mkdir, open, readFile, readdir, rename } from "node:fs/promises"
import { LocalGit, type GitWorkspace } from "../adapters/git/local"
import { FilesystemLedger } from "../adapters/ledger/filesystem"
import { Canonical, type JsonValue } from "../domain/canonical"
import { Governance, ResearchCapability, type ResearchRole } from "../domain/governance"
import { ResearchID } from "../domain/id"
import { ResearchProject, ResearchTrack, WorkspaceBinding, type Actor } from "../domain/schema"
import type { Signer } from "../domain/signature"
import { ResearchAudit } from "./audit"

function alias(value: string) {
  const normalized = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
  return normalized || "track"
}

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

async function records<T>(directory: string, parse: (value: unknown) => T): Promise<T[]> {
  const names = await readdir(directory).catch(() => [])
  return Promise.all(
    names
      .filter((name) => name.endsWith(".json"))
      .map(async (name) => parse(JSON.parse(await readFile(path.join(directory, name), "utf8")))),
  )
}

async function workspace(input: {
  root: string
  kind: "none" | "current" | "new-worktree"
  branch?: string
  worktreePath?: string
}): Promise<GitWorkspace | null> {
  if (input.kind === "none") return null
  if (input.kind === "current") return LocalGit.inspect(input.root)
  if (!input.branch || !input.worktreePath) throw new Error("A branch and worktree path are required")
  return LocalGit.createWorktree({
    repositoryRoot: input.root,
    branch: input.branch,
    worktreePath: input.worktreePath,
  })
}

export namespace ResearchTrackService {
  export async function create(input: {
    projectRoot: string
    title: string
    objective: string
    alias?: string
    parentTrackIds?: string[]
    workspace: { kind: "none" | "current" | "new-worktree"; branch?: string; worktreePath?: string }
    actor: Actor
    role?: ResearchRole
    delegatedCapabilities?: ResearchCapability[]
    signer: Signer
  }) {
    Governance.authorize(input, ResearchCapability.trackCreate)
    const git = await LocalGit.inspect(input.projectRoot)
    await ResearchAudit.assertWritable(git.root)
    const project = ResearchProject.parse(
      JSON.parse(await readFile(path.join(git.root, ".openscience/research/project.json"), "utf8")),
    )
    const trackDirectory = path.join(git.root, ".openscience/research/tracks")
    const tracks = await records(trackDirectory, ResearchTrack.parse)
    const selectedAlias = alias(input.alias || input.title)
    if (tracks.some((track) => track.alias === selectedAlias))
      throw new Error(`Track alias ${selectedAlias} already exists`)
    const selectedWorkspace = await workspace({ root: git.root, ...input.workspace })
    const existingBindings = await records(
      path.join(git.root, ".openscience/research/projections/workspaces"),
      WorkspaceBinding.parse,
    )
    if (
      selectedWorkspace &&
      existingBindings.some(
        (binding) =>
          binding.active &&
          binding.worktreePath === selectedWorkspace.root &&
          binding.branch === selectedWorkspace.branch,
      )
    ) {
      throw new Error(`Workspace ${selectedWorkspace.branch} is already bound to an active track`)
    }

    const now = new Date().toISOString()
    const track = ResearchTrack.parse({
      schemaVersion: 1,
      id: ResearchID.create("track"),
      projectId: project.id,
      alias: selectedAlias,
      title: input.title,
      objective: input.objective,
      state: "active",
      hidden: false,
      parentTrackIds: input.parentTrackIds ?? [project.coreTrackId],
      createdAt: now,
      createdBy: input.actor,
    })
    const binding = selectedWorkspace
      ? WorkspaceBinding.parse({
          schemaVersion: 1,
          id: ResearchID.create("workspace"),
          projectId: project.id,
          trackId: track.id,
          repositoryRoot: git.root,
          worktreePath: selectedWorkspace.root,
          branch: selectedWorkspace.branch,
          boundAtCommit: selectedWorkspace.commit,
          active: true,
          createdAt: now,
          createdBy: input.actor,
        })
      : null
    await FilesystemLedger.append({
      projectRoot: git.root,
      projectId: project.id,
      type: "track.created",
      actor: input.actor,
      payload: { track, binding },
      signer: input.signer,
      occurredAt: now,
    })
    await atomic(path.join(trackDirectory, track.id + ".json"), track as JsonValue)
    if (binding) {
      await atomic(
        path.join(git.root, `.openscience/research/projections/workspaces/${binding.id}.json`),
        binding as JsonValue,
      )
    }
    return { track, binding }
  }

  export async function list(projectRoot: string) {
    const git = await LocalGit.inspect(projectRoot)
    return records(path.join(git.root, ".openscience/research/tracks"), ResearchTrack.parse)
  }
}
