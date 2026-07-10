import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { LocalProcessRunner } from "../adapters/process/local"

let root: string

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "openscience-runner-"))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe("Controlled process runner", () => {
  it("captures and hashes output without a shell", async () => {
    const result = await LocalProcessRunner.execute({
      projectRoot: root,
      runId: "rsr_success",
      command: process.execPath,
      args: ["-e", 'process.stdout.write("result")'],
      cwd: root,
      timeoutMs: 5000,
      environmentKeys: [],
    })
    expect(result).toMatchObject({ outcome: "succeeded", exitCode: 0 })
    expect(result.stdoutHash).toMatch(/^[0-9a-f]{64}$/)
    expect(await readFile(path.join(root, result.stdoutPath), "utf8")).toBe("result")
  })

  it("distinguishes nonzero exit and timeout", async () => {
    const failed = await LocalProcessRunner.execute({
      projectRoot: root,
      runId: "rsr_failed",
      command: process.execPath,
      args: ["-e", "process.exit(7)"],
      cwd: root,
      timeoutMs: 5000,
      environmentKeys: [],
    })
    const timedOut = await LocalProcessRunner.execute({
      projectRoot: root,
      runId: "rsr_timeout",
      command: process.execPath,
      args: ["-e", "setTimeout(() => {}, 5000)"],
      cwd: root,
      timeoutMs: 50,
      environmentKeys: [],
    })
    expect(failed).toMatchObject({ outcome: "failed", exitCode: 7 })
    expect(timedOut.outcome).toBe("timed_out")
  })

  it("rejects execution outside the project and implicit secret injection", async () => {
    await expect(
      LocalProcessRunner.execute({
        projectRoot: root,
        runId: "rsr_escape",
        command: process.execPath,
        args: ["-e", ""],
        cwd: os.tmpdir(),
        timeoutMs: 5000,
        environmentKeys: [],
      }),
    ).rejects.toThrow("inside the project")
    await expect(
      LocalProcessRunner.execute({
        projectRoot: root,
        runId: "rsr_secret",
        command: process.execPath,
        args: ["-e", ""],
        cwd: root,
        timeoutMs: 5000,
        environmentKeys: ["EXAMPLE_API_KEY"],
      }),
    ).rejects.toThrow("separate approval path")
  })

  it("bounds captured output", async () => {
    const result = await LocalProcessRunner.execute({
      projectRoot: root,
      runId: "rsr_output_limit",
      command: process.execPath,
      args: ["-e", 'process.stdout.write("unbounded")'],
      cwd: root,
      timeoutMs: 5000,
      environmentKeys: [],
      maxOutputBytes: 4,
    })
    expect(result).toMatchObject({ outcome: "failed", error: "Output capture exceeded 4 bytes" })
    expect(await readFile(path.join(root, result.stdoutPath), "utf8")).toBe("unbo")
  })
})
