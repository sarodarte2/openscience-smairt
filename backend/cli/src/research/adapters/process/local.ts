import path from "node:path"
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { mkdir, open, realpath } from "node:fs/promises"
import type { Readable } from "node:stream"

export type ProcessOutcome = "succeeded" | "failed" | "timed_out" | "cancelled" | "lost"

export interface ProcessResult {
  outcome: ProcessOutcome
  exitCode: number | null
  signal: string | null
  stdoutHash: string
  stderrHash: string
  stdoutPath: string
  stderrPath: string
  startedAt: string
  finishedAt: string
  durationMs: number
  error?: string
}

const BASE_ENV = ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "CONDA_EXE", "CONDA_PREFIX"]
const SECRET = /(TOKEN|SECRET|PASSWORD|PASSCODE|API[_-]?KEY|PRIVATE[_-]?KEY|CREDENTIAL)/i

function environment(keys: string[]) {
  const selected = new Set([...BASE_ENV, ...keys])
  const result: Record<string, string> = {}
  for (const key of selected) {
    if (SECRET.test(key)) throw new Error(`Secret-like environment variable ${key} requires a separate approval path`)
    const value = process.env[key]
    if (value !== undefined) result[key] = value
  }
  return result
}

async function contained(root: string, cwd: string) {
  const [parent, child] = await Promise.all([realpath(root), realpath(cwd)])
  const relative = path.relative(parent, child)
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error("Formal runs must execute inside the project")
  return child
}

async function digest(file: string) {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest("hex")
}

export namespace LocalProcessRunner {
  export async function execute(input: {
    projectRoot: string
    runId: string
    command: string
    args: string[]
    cwd: string
    timeoutMs: number
    environmentKeys: string[]
    maxOutputBytes?: number
    signal?: AbortSignal
  }): Promise<ProcessResult> {
    const cwd = await contained(input.projectRoot, input.cwd)
    const env = environment(input.environmentKeys)
    const directory = path.join(input.projectRoot, `.openscience/research/runs/${input.runId}`)
    await mkdir(path.dirname(directory), { recursive: true })
    await mkdir(directory, { recursive: false })
    const stdoutFile = path.join(directory, "stdout.log")
    const stderrFile = path.join(directory, "stderr.log")
    const stdout = await open(stdoutFile, "wx", 0o600)
    const stderr = await open(stderrFile, "wx", 0o600)
    const started = Date.now()
    const startedAt = new Date(started).toISOString()
    const state = {
      timedOut: false,
      cancelled: input.signal?.aborted ?? false,
      spawnError: "",
      outputLimit: false,
      outputBytes: 0,
    }
    const maxOutputBytes = input.maxOutputBytes ?? 100 * 1024 * 1024
    const child = spawn(input.command, input.args, {
      cwd,
      env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    })
    const terminate = () => {
      child.kill("SIGTERM")
      setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL")
      }, 2000).unref()
    }
    const timeout = setTimeout(() => {
      state.timedOut = true
      terminate()
    }, input.timeoutMs)
    const cancel = () => {
      state.cancelled = true
      terminate()
    }
    input.signal?.addEventListener("abort", cancel, { once: true })
    if (state.cancelled) cancel()
    child.on("error", (error) => {
      state.spawnError = error.message
    })
    const capture = async (stream: Readable, handle: typeof stdout) => {
      for await (const chunk of stream) {
        const bytes = Buffer.from(chunk)
        const remaining = maxOutputBytes - state.outputBytes
        if (remaining <= 0) {
          state.outputLimit = true
          terminate()
          continue
        }
        const selected = bytes.subarray(0, remaining)
        await handle.write(selected)
        state.outputBytes += selected.byteLength
        if (selected.byteLength < bytes.byteLength) {
          state.outputLimit = true
          terminate()
        }
      }
    }
    const output = Promise.all([capture(child.stdout, stdout), capture(child.stderr, stderr)])
    const closed = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      child.on("close", (code, signal) => resolve({ code, signal }))
    })
    clearTimeout(timeout)
    input.signal?.removeEventListener("abort", cancel)
    await output
    await Promise.all([stdout.sync(), stderr.sync()])
    await Promise.all([stdout.close(), stderr.close()])
    const finished = Date.now()
    const outcome: ProcessOutcome = state.cancelled
      ? "cancelled"
      : state.timedOut
        ? "timed_out"
        : state.spawnError
          ? "lost"
          : state.outputLimit
            ? "failed"
            : closed.code === 0
              ? "succeeded"
              : "failed"
    return {
      outcome,
      exitCode: closed.code,
      signal: closed.signal,
      stdoutHash: await digest(stdoutFile),
      stderrHash: await digest(stderrFile),
      stdoutPath: path.relative(input.projectRoot, stdoutFile),
      stderrPath: path.relative(input.projectRoot, stderrFile),
      startedAt,
      finishedAt: new Date(finished).toISOString(),
      durationMs: finished - started,
      ...(state.spawnError
        ? { error: state.spawnError }
        : state.outputLimit
          ? { error: `Output capture exceeded ${maxOutputBytes} bytes` }
          : {}),
    }
  }
}
