import path from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { mkdir, writeFile } from "node:fs/promises"

const execute = promisify(execFile)

export class CondaUnavailableError extends Error {
  constructor() {
    super("Conda is required to create the project environment but was not found on PATH")
  }
}

export function environmentName(name: string) {
  const normalized = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
  return normalized || "openscience-project"
}

function manifest(name: string) {
  return [
    `name: ${name}`,
    "channels:",
    "  - conda-forge",
    "dependencies:",
    "  - python=3.12",
    "  - pip",
    "  - ipykernel",
    "  - jupyterlab",
    "",
  ].join("\n")
}

export namespace CondaEnvironment {
  export async function prepare(input: { projectRoot: string; projectName: string; create: boolean }) {
    const name = environmentName(input.projectName)
    const directory = path.join(input.projectRoot, ".openscience/research")
    const file = path.join(directory, "environment.yml")
    await mkdir(directory, { recursive: true })
    await writeFile(file, manifest(name), { mode: 0o644 })
    if (!input.create) return { name, file, created: false }
    await execute("conda", ["--version"], { encoding: "utf8" }).catch(() => {
      throw new CondaUnavailableError()
    })
    await execute("conda", ["env", "create", "--file", file, "--yes"], { encoding: "utf8" })
    return { name, file, created: true }
  }
}
