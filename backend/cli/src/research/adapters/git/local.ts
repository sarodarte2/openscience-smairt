import { execFile } from "node:child_process"
import { promisify } from "node:util"
import path from "node:path"
import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { lstat, readlink } from "node:fs/promises"
import { WorkspaceSnapshot } from "../../domain/schema"

const execute = promisify(execFile)
const SCIENCE_CODE_PATHSPEC = ["--", ".", ":(exclude).openscience/research/**"]

async function git(root: string, args: string[]) {
  const result = await execute("git", ["-C", root, ...args], { encoding: "utf8" })
  return result.stdout.trim()
}

async function raw(root: string, args: string[]) {
  const result = await execute("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  return result.stdout
}

async function optional(root: string, args: string[]) {
  return git(root, args).catch(() => null)
}

export interface GitWorkspace {
  root: string
  branch: string
  commit: string | null
  user: { name: string | null; email: string | null }
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

function safe(root: string, relative: string) {
  const full = path.resolve(root, relative)
  const resolved = path.relative(root, full)
  if (!relative || path.isAbsolute(relative) || resolved.startsWith("..") || path.isAbsolute(resolved)) {
    throw new Error(`Git returned an unsafe workspace path: ${relative}`)
  }
  return full
}

async function tree(root: string, files: string[]) {
  const hash = createHash("sha256")
  for (const relative of files) {
    const full = safe(root, relative)
    const stat = await lstat(full)
    const mode = stat.isSymbolicLink() ? "symlink" : stat.mode & 0o111 ? "executable" : "file"
    hash.update(`${Buffer.byteLength(relative)}:${relative}\0${mode}\0`)
    if (stat.isSymbolicLink()) {
      hash.update(await readlink(full))
      hash.update("\0")
      continue
    }
    if (!stat.isFile()) throw new Error(`Formal workspace capture does not support ${relative}`)
    for await (const chunk of createReadStream(full)) hash.update(chunk)
    hash.update("\0")
  }
  return hash.digest("hex")
}

export namespace LocalGit {
  export async function diffHash(root: string, targetCommit: string, sourceCommit: string) {
    await Promise.all([
      git(root, ["cat-file", "-e", `${targetCommit}^{commit}`]),
      git(root, ["cat-file", "-e", `${sourceCommit}^{commit}`]),
    ]).catch(() => {
      throw new Error("Code proposal references an unknown Git commit")
    })
    return digest(await raw(root, ["diff", "--binary", targetCommit, sourceCommit, ...SCIENCE_CODE_PATHSPEC]))
  }

  export async function initialize(root: string) {
    await execute("git", ["init", "-q", root], { encoding: "utf8" })
    return inspect(root)
  }

  export async function inspect(root: string): Promise<GitWorkspace> {
    const repositoryRoot = await git(root, ["rev-parse", "--show-toplevel"])
    const branch =
      (await optional(repositoryRoot, ["branch", "--show-current"])) ||
      (await optional(repositoryRoot, ["symbolic-ref", "--short", "HEAD"])) ||
      "main"
    return {
      root: repositoryRoot,
      branch,
      commit: await optional(repositoryRoot, ["rev-parse", "HEAD"]),
      user: {
        name: await optional(repositoryRoot, ["config", "user.name"]),
        email: await optional(repositoryRoot, ["config", "user.email"]),
      },
    }
  }

  export async function createWorktree(input: {
    repositoryRoot: string
    worktreePath: string
    branch: string
    startPoint?: string
  }) {
    const commit = await optional(input.repositoryRoot, ["rev-parse", input.startPoint ?? "HEAD"])
    if (!commit) throw new Error("Create the first project commit before creating a track worktree")
    const project = await optional(input.repositoryRoot, [
      "ls-files",
      "--error-unmatch",
      ".openscience/research/project.json",
    ])
    const changes = await optional(input.repositoryRoot, ["status", "--porcelain", "--", ".openscience/research"])
    if (!project || changes) {
      throw new Error("Commit the current OpenScience Research metadata before creating a track worktree")
    }
    await git(input.repositoryRoot, [
      "worktree",
      "add",
      "-b",
      input.branch,
      path.resolve(input.worktreePath),
      input.startPoint ?? "HEAD",
    ])
    return inspect(path.resolve(input.worktreePath))
  }

  export async function snapshot(root: string) {
    const workspace = await inspect(root)
    const before = await raw(workspace.root, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
      ...SCIENCE_CODE_PATHSPEC,
    ])
    const [tracked, untracked] = await Promise.all([
      raw(workspace.root, ["ls-files", "-z", ...SCIENCE_CODE_PATHSPEC]),
      raw(workspace.root, ["ls-files", "--others", "--exclude-standard", "-z", ...SCIENCE_CODE_PATHSPEC]),
    ])
    const [trackedFilesHash, untrackedFilesHash] = await Promise.all([
      tree(workspace.root, tracked.split("\0").filter(Boolean)),
      tree(workspace.root, untracked.split("\0").filter(Boolean)),
    ])
    const after = await raw(workspace.root, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
      ...SCIENCE_CODE_PATHSPEC,
    ])
    if (before !== after) throw new Error("Workspace changed during provenance capture; retry the run declaration")
    const dirty = after.length > 0
    return WorkspaceSnapshot.parse({
      kind: "git",
      branch: workspace.branch,
      commit: workspace.commit,
      dirty,
      statusHash: digest(after),
      trackedFilesHash,
      untrackedFilesHash,
      captureConfidence: dirty ? "best_effort" : "complete",
    })
  }
}
