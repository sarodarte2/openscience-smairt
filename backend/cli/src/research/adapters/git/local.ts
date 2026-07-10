import { execFile } from "node:child_process"
import { promisify } from "node:util"
import path from "node:path"

const execute = promisify(execFile)

async function git(root: string, args: string[]) {
  const result = await execute("git", ["-C", root, ...args], { encoding: "utf8" })
  return result.stdout.trim()
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

export namespace LocalGit {
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
}
