import path from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { EnvironmentSnapshot } from "../../domain/schema"

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
    "  - nbclient=0.10.*",
    "  - nbformat=5.10.*",
    "  - nbconvert=7.16.*",
    "",
  ].join("\n")
}

function inside(root: string, file: string) {
  const resolved = path.resolve(root, file)
  const relative = path.relative(root, resolved)
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Conda specification must be inside the research project")
  }
  return resolved
}

function withName(content: string, name: string) {
  if (/^name\s*:/m.test(content)) return content.replace(/^name\s*:.*$/m, `name: ${name}`)
  return `name: ${name}\n${content}`
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

function sanitizeExplicit(value: string) {
  let redacted = false
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      if (line === "@EXPLICIT") return line
      let url: URL
      try {
        url = new URL(line)
      } catch {
        if (/^[a-zA-Z0-9_.=@+:/-]+$/.test(line)) return line
        throw new Error("Conda returned an unsafe resolved package entry")
      }
      const original = url.toString()
      if (url.protocol === "file:") {
        url.pathname = "/" + path.basename(url.pathname)
      }
      url.username = ""
      url.password = ""
      url.search = ""
      url.pathname = url.pathname.replace(/\/(t|token|auth)\/[^/]+/gi, "/$1/REDACTED")
      if (url.hash && !/^#[0-9a-f]{32,64}$/i.test(url.hash)) url.hash = ""
      if (url.toString() !== original) redacted = true
      return url.toString()
    })
  if (!lines.includes("@EXPLICIT")) throw new Error("Conda did not return an explicit resolved environment")
  return { content: lines.join("\n") + "\n", redacted }
}

export namespace CondaEnvironment {
  export async function prepare(input: { projectRoot: string; projectName: string; create: boolean }) {
    const name = environmentName(input.projectName)
    const directory = path.join(input.projectRoot, ".openscience/research")
    const file = path.join(directory, "environment.yml")
    const content = manifest(name)
    await mkdir(directory, { recursive: true })
    await writeFile(file, content, { mode: 0o644 })
    if (!input.create) return { name, file, specHash: digest(content), created: false }
    await execute("conda", ["--version"], { encoding: "utf8" }).catch(() => {
      throw new CondaUnavailableError()
    })
    await execute("conda", ["env", "create", "--file", file, "--yes"], { encoding: "utf8" })
    return { name, file, specHash: digest(content), created: true }
  }

  export async function snapshot(input: { projectRoot: string; name: string; portableSpecPath?: string }) {
    const portableSpecPath = input.portableSpecPath
      ? path.resolve(input.projectRoot, input.portableSpecPath)
      : path.join(input.projectRoot, ".openscience/research/environment.yml")
    const relativePortable = path.relative(input.projectRoot, portableSpecPath)
    if (relativePortable.startsWith("..") || path.isAbsolute(relativePortable)) {
      throw new Error("Conda portable specification must be inside the research project")
    }
    const portable = await readFile(portableSpecPath, "utf8")
    const result = await execute("conda", ["list", "--explicit", "--name", input.name], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    }).catch((error) => {
      const code = error instanceof Error && "code" in error ? error.code : undefined
      if (code === "ENOENT") throw new CondaUnavailableError()
      throw new Error(
        `Could not capture Conda environment ${input.name}: ${error instanceof Error ? error.message : error}`,
      )
    })
    const resolved = sanitizeExplicit(result.stdout)
    const resolvedSpecHash = digest(resolved.content)
    const directory = path.join(input.projectRoot, ".openscience/research/environments/snapshots")
    await mkdir(directory, { recursive: true })
    const resolvedSpecPath = path.join(directory, resolvedSpecHash + ".txt")
    await writeFile(resolvedSpecPath, resolved.content, { encoding: "utf8", mode: 0o644 })
    return EnvironmentSnapshot.parse({
      kind: "conda",
      name: input.name,
      portableSpecPath: relativePortable,
      portableSpecHash: digest(portable),
      resolvedSpecPath: path.relative(input.projectRoot, resolvedSpecPath),
      resolvedSpecHash,
      platform: `${process.platform}-${process.arch}`,
      captureConfidence: resolved.redacted ? "credential_redacted" : "complete",
    })
  }

  export async function isolate(input: {
    projectRoot: string
    projectName: string
    trackId: string
    sourceSpecPath: string
    create: boolean
  }) {
    const source = inside(input.projectRoot, input.sourceSpecPath)
    const name = environmentName(`${input.projectName}--${input.trackId.slice(-8)}`)
    const content = withName(await readFile(source, "utf8"), name)
    const file = path.join(
      input.projectRoot,
      `.openscience/research/environments/tracks/${input.trackId}/environment.yml`,
    )
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, content, { encoding: "utf8", mode: 0o644 })
    if (input.create) {
      await execute("conda", ["--version"], { encoding: "utf8" }).catch(() => {
        throw new CondaUnavailableError()
      })
      await execute("conda", ["env", "create", "--file", file, "--yes"], { encoding: "utf8" })
    }
    return {
      name,
      file,
      specHash: digest(content),
      created: input.create,
    }
  }
}
