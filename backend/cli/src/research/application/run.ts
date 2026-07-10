import path from "node:path"
import { createHash } from "node:crypto"
import { mkdir, open, readFile, readdir, realpath, rename } from "node:fs/promises"
import { LocalGit } from "../adapters/git/local"
import { FilesystemLedger } from "../adapters/ledger/filesystem"
import { LocalProcessRunner } from "../adapters/process/local"
import { CondaEnvironment } from "../adapters/environment/conda"
import { Canonical, type JsonValue } from "../domain/canonical"
import { Governance, ResearchCapability, type ResearchRole } from "../domain/governance"
import {
  Json,
  ProtocolRevision,
  ResearchIteration,
  ResearchProject,
  RunAttempt,
  TrackEnvironment,
  type Actor,
} from "../domain/schema"
import { ResearchID } from "../domain/id"
import type { Signer } from "../domain/signature"
import { ResearchAudit } from "./audit"
import type { ResearchEvent } from "../domain/event"

export class RunStateError extends Error {
  constructor(
    readonly runId: string,
    message: string,
  ) {
    super(message)
  }
}

export class NotebookValidationError extends Error {}

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

function replayedRun(event: ResearchEvent) {
  if (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) {
    throw new Error(`Idempotent event ${event.eventId} has an invalid run payload`)
  }
  return {
    run: RunAttempt.parse((event.payload as Record<string, unknown>).run),
    eventId: event.eventId,
    replayed: true,
  }
}

async function materialize(projectRoot: string, value: ReturnType<typeof replayedRun>) {
  const file = path.join(projectRoot, `.openscience/research/projections/runs/${value.run.id}.json`)
  let current: RunAttempt | null = null
  try {
    current = RunAttempt.parse(JSON.parse(await readFile(file, "utf8")))
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : undefined
    if (code !== "ENOENT") throw error
  }
  if (!current) {
    await atomic(file, value.run as JsonValue)
    return value
  }
  if (current.id !== value.run.id || current.projectId !== value.run.projectId) {
    throw new Error(`Run projection ${value.run.id} conflicts with its signed event`)
  }
  const terminal = new Set(["succeeded", "failed", "timed_out", "cancelled", "lost"])
  if (terminal.has(value.run.state) && !terminal.has(current.state)) {
    await atomic(file, value.run as JsonValue)
  }
  return value
}

function recordedRun(events: ResearchEvent[], type: string, runId: string) {
  for (const event of [...events].reverse()) {
    if (event.type !== type || !event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) {
      continue
    }
    const parsed = RunAttempt.safeParse((event.payload as Record<string, unknown>).run)
    if (parsed.success && parsed.data.id === runId) return { run: parsed.data, eventId: event.eventId }
  }
  return null
}

async function contained(root: string, cwd: string) {
  const requested = path.isAbsolute(cwd) ? cwd : path.resolve(root, cwd)
  const [parent, child] = await Promise.all([realpath(root), realpath(requested)])
  const relative = path.relative(parent, child)
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Formal runs must execute inside the project")
  }
  return child
}

const NOTEBOOK_SOURCE = "{notebookSource}"
const RUN_DIRECTORY = "{runDirectory}"

async function inspectNotebook(root: string, sourcePath: string) {
  const source = await contained(root, sourcePath).catch((error) => {
    throw new NotebookValidationError(
      `Notebook ${sourcePath} is unavailable or outside the project: ${error instanceof Error ? error.message : error}`,
    )
  })
  if (path.extname(source).toLowerCase() !== ".ipynb") {
    throw new NotebookValidationError("Formal notebook source must end in .ipynb")
  }
  const relative = path.relative(root, source)
  if (relative === ".openscience/research" || relative.startsWith(`.openscience/research${path.sep}`)) {
    throw new NotebookValidationError("Formal notebook source must be outside OpenScience runtime metadata")
  }
  const content = await readFile(source)
  let notebook: unknown
  try {
    notebook = JSON.parse(content.toString("utf8"))
  } catch {
    throw new NotebookValidationError(`Notebook ${relative} is not valid JSON`)
  }
  if (
    !notebook ||
    typeof notebook !== "object" ||
    Array.isArray(notebook) ||
    !Array.isArray((notebook as Record<string, unknown>).cells) ||
    typeof (notebook as Record<string, unknown>).nbformat !== "number"
  ) {
    throw new NotebookValidationError(`Notebook ${relative} is not a valid nbformat document`)
  }
  return { source, relative, hash: createHash("sha256").update(content).digest("hex") }
}

export namespace ResearchRunService {
  export async function declare(input: {
    projectRoot: string
    protocolId: string
    parameters: JsonValue
    seed?: number
    execution: {
      command: string
      args: string[]
      cwd: string
      timeoutMs: number
      environmentKeys: string[]
      notebook?: { sourcePath: string; allowErrors: boolean }
    }
    actor: Actor
    role?: ResearchRole
    delegatedCapabilities?: ResearchCapability[]
    signer: Signer
    idempotencyKey?: string
  }) {
    Governance.authorize(input, ResearchCapability.runExecute)
    const git = await LocalGit.inspect(input.projectRoot)
    await ResearchAudit.assertWritable(git.root)
    const project = ResearchProject.parse(
      JSON.parse(await readFile(path.join(git.root, ".openscience/research/project.json"), "utf8")),
    )
    if (input.execution.command.includes("\0") || input.execution.args.some((argument) => argument.includes("\0"))) {
      throw new Error("Formal run argv cannot contain null bytes")
    }
    LocalProcessRunner.validateEnvironmentKeys(input.execution.environmentKeys)
    const parameters = Json.parse(input.parameters)
    const cwd = await contained(git.root, input.execution.cwd)
    const notebook = input.execution.notebook
      ? await inspectNotebook(git.root, input.execution.notebook.sourcePath)
      : null
    const request: JsonValue = {
      actorId: input.actor.id,
      protocolId: input.protocolId,
      parameters,
      seed: input.seed ?? null,
      execution: {
        command: input.execution.command,
        args: input.execution.args,
        cwd,
        timeoutMs: input.execution.timeoutMs,
        environmentKeys: input.execution.environmentKeys,
        notebook: notebook
          ? {
              sourcePath: notebook.relative,
              sourceHash: notebook.hash,
              allowErrors: input.execution.notebook!.allowErrors,
            }
          : null,
      },
    }
    const operation = async () => {
      if (input.idempotencyKey) {
        const existing = await FilesystemLedger.lookupIdempotency({
          projectRoot: git.root,
          projectId: project.id,
          type: "run.intent_declared",
          key: input.idempotencyKey,
          request,
        })
        if (existing) return materialize(git.root, replayedRun(existing))
      }
      const protocol = ProtocolRevision.parse(
        JSON.parse(
          await readFile(
            path.join(git.root, `.openscience/research/projections/protocols/${input.protocolId}.json`),
            "utf8",
          ),
        ),
      )
      if (protocol.projectId !== project.id) throw new Error("Protocol belongs to a different research project")
      if (!protocol.frozenAt) throw new Error("Freeze the protocol before declaring a formal run")
      const iteration = ResearchIteration.parse(
        JSON.parse(
          await readFile(path.join(git.root, `.openscience/research/iterations/${protocol.iterationId}.json`), "utf8"),
        ),
      )
      const trackEnvironment = await readFile(
        path.join(git.root, `.openscience/research/projections/environments/tracks/${iteration.trackId}.json`),
        "utf8",
      )
        .then((content) => TrackEnvironment.parse(JSON.parse(content)))
        .catch(async (error: unknown) => {
          const code = error instanceof Error && "code" in error ? error.code : undefined
          if (code !== "ENOENT") throw error
          const portableSpecPath = ".openscience/research/environment.yml"
          const portable = await readFile(path.join(git.root, portableSpecPath), "utf8")
          return TrackEnvironment.parse({
            schemaVersion: 1,
            projectId: project.id,
            trackId: iteration.trackId,
            kind: "conda",
            name: project.defaultEnvironment.name,
            portableSpecPath,
            portableSpecHash: createHash("sha256").update(portable).digest("hex"),
            state: iteration.trackId === project.coreTrackId ? "base" : "inherited",
            inheritedFromTrackId: iteration.trackId === project.coreTrackId ? null : project.coreTrackId,
            createdAt: iteration.createdAt,
            createdBy: iteration.createdBy,
          })
        })
      const [workspace, environment] = await Promise.all([
        LocalGit.snapshot(git.root),
        CondaEnvironment.snapshot({
          projectRoot: git.root,
          name: trackEnvironment.name,
          portableSpecPath: trackEnvironment.portableSpecPath,
        }),
      ])
      const now = new Date().toISOString()
      const eventId = ResearchID.create("event")
      const runId = ResearchID.create("run")
      const currentNotebook = notebook ? await inspectNotebook(git.root, notebook.source) : null
      if (currentNotebook && currentNotebook.hash !== notebook!.hash) {
        throw new Error("Notebook changed during formal run declaration; retry after saving")
      }
      const runDirectory = path.join(git.root, `.openscience/research/runs/${runId}`)
      const executionArgs = input.execution.args.map((argument) =>
        argument
          .replaceAll(NOTEBOOK_SOURCE, currentNotebook?.source ?? NOTEBOOK_SOURCE)
          .replaceAll(RUN_DIRECTORY, runDirectory),
      )
      const run = RunAttempt.parse({
        schemaVersion: 1,
        id: runId,
        projectId: project.id,
        iterationId: protocol.iterationId,
        protocolId: protocol.id,
        intentEventId: eventId,
        workspaceStateHash: Canonical.hash(workspace as JsonValue),
        environmentHash: Canonical.hash(environment as JsonValue),
        workspace,
        environment,
        ...(currentNotebook
          ? {
              kind: "notebook",
              notebook: {
                sourcePath: currentNotebook.relative,
                sourceHash: currentNotebook.hash,
                originalPath: path.relative(git.root, path.join(runDirectory, "original.ipynb")),
                executedPath: path.relative(git.root, path.join(runDirectory, "executed.ipynb")),
                executedHash: null,
                allowErrors: input.execution.notebook!.allowErrors,
              },
            }
          : { kind: "command" }),
        parameters,
        ...(input.seed !== undefined ? { seed: input.seed } : {}),
        execution: {
          command: "conda",
          args: [
            "run",
            "--no-capture-output",
            "--name",
            trackEnvironment.name,
            input.execution.command,
            ...executionArgs,
          ],
          cwd,
          timeoutMs: input.execution.timeoutMs,
          environmentKeys: input.execution.environmentKeys,
        },
        state: "declared",
        createdAt: now,
        createdBy: input.actor,
      })
      const appended = input.idempotencyKey
        ? await FilesystemLedger.appendIdempotent({
            projectRoot: git.root,
            projectId: project.id,
            eventId,
            type: "run.intent_declared",
            actor: input.actor,
            payload: { run },
            signer: input.signer,
            occurredAt: now,
            key: input.idempotencyKey,
            request,
          })
        : {
            event: await FilesystemLedger.append({
              projectRoot: git.root,
              projectId: project.id,
              eventId,
              type: "run.intent_declared",
              actor: input.actor,
              payload: { run },
              signer: input.signer,
              occurredAt: now,
            }),
            replayed: false,
          }
      if (appended.replayed) return materialize(git.root, replayedRun(appended.event))
      return materialize(git.root, { run, eventId: appended.event.eventId, replayed: false })
    }
    if (!input.idempotencyKey) return operation()
    return FilesystemLedger.withIdempotencyLock({
      projectRoot: git.root,
      projectId: project.id,
      key: input.idempotencyKey,
      operation,
    })
  }

  export async function declareNotebook(input: {
    projectRoot: string
    protocolId: string
    notebookPath: string
    parameters: JsonValue
    seed?: number
    timeoutMs: number
    allowErrors: boolean
    environmentKeys?: string[]
    actor: Actor
    role?: ResearchRole
    delegatedCapabilities?: ResearchCapability[]
    signer: Signer
    idempotencyKey?: string
  }) {
    const timeoutSeconds = Math.max(1, Math.floor(input.timeoutMs / 1000))
    return ResearchRunService.declare({
      projectRoot: input.projectRoot,
      protocolId: input.protocolId,
      parameters: input.parameters,
      seed: input.seed,
      execution: {
        command: "jupyter",
        args: [
          "nbconvert",
          "--to",
          "notebook",
          "--execute",
          NOTEBOOK_SOURCE,
          "--output",
          "executed.ipynb",
          "--output-dir",
          RUN_DIRECTORY,
          `--ExecutePreprocessor.timeout=${timeoutSeconds}`,
          ...(input.allowErrors ? ["--allow-errors"] : []),
        ],
        cwd: input.projectRoot,
        timeoutMs: input.timeoutMs,
        environmentKeys: input.environmentKeys ?? [],
        notebook: { sourcePath: input.notebookPath, allowErrors: input.allowErrors },
      },
      actor: input.actor,
      role: input.role,
      delegatedCapabilities: input.delegatedCapabilities,
      signer: input.signer,
      idempotencyKey: input.idempotencyKey,
    })
  }

  export async function list(projectRoot: string, iterationId?: string) {
    const git = await LocalGit.inspect(projectRoot)
    const directory = path.join(git.root, ".openscience/research/projections/runs")
    const names = await readdir(directory).catch(() => [])
    const values = await Promise.all(
      names
        .filter((name) => name.endsWith(".json"))
        .map(async (name) => RunAttempt.parse(JSON.parse(await readFile(path.join(directory, name), "utf8")))),
    )
    return values.filter((run) => !iterationId || run.iterationId === iterationId)
  }

  export async function execute(input: {
    projectRoot: string
    runId: string
    actor: Actor
    role?: ResearchRole
    delegatedCapabilities?: ResearchCapability[]
    signer: Signer
    signal?: AbortSignal
  }) {
    Governance.authorize(input, ResearchCapability.runExecute)
    const git = await LocalGit.inspect(input.projectRoot)
    await ResearchAudit.assertWritable(git.root)
    const project = ResearchProject.parse(
      JSON.parse(await readFile(path.join(git.root, ".openscience/research/project.json"), "utf8")),
    )
    const operation = async () => {
      const audit = await ResearchAudit.assertWritable(git.root)
      const file = path.join(git.root, `.openscience/research/projections/runs/${input.runId}.json`)
      const declared = RunAttempt.parse(JSON.parse(await readFile(file, "utf8")))
      if (declared.projectId !== project.id) throw new Error("Run belongs to a different research project")
      const completedEvent = recordedRun(audit.events, "run.completed", declared.id)
      if (completedEvent) {
        return materialize(git.root, { ...completedEvent, replayed: true })
      }
      if (["succeeded", "failed", "timed_out", "cancelled", "lost"].includes(declared.state)) {
        throw new RunStateError(
          declared.id,
          `Run ${declared.id} has terminal state ${declared.state} without a signed completion event`,
        )
      }
      if (declared.state === "running") {
        throw new RunStateError(declared.id, `Run ${declared.id} started previously; automatic re-execution is unsafe`)
      }
      if (declared.state !== "declared" && declared.state !== "queued") {
        throw new RunStateError(declared.id, `Run ${declared.id} cannot execute from state ${declared.state}`)
      }
      const [workspace, environment] = await Promise.all([
        LocalGit.snapshot(git.root),
        CondaEnvironment.snapshot({
          projectRoot: git.root,
          name: declared.environment.name,
          portableSpecPath: declared.environment.portableSpecPath,
        }),
      ])
      if (Canonical.hash(workspace as JsonValue) !== declared.workspaceStateHash) {
        throw new RunStateError(
          declared.id,
          `Workspace changed after run ${declared.id} was declared; declare a new run`,
        )
      }
      if (Canonical.hash(environment as JsonValue) !== declared.environmentHash) {
        throw new RunStateError(
          declared.id,
          `Conda environment changed after run ${declared.id} was declared; declare a new run`,
        )
      }
      if (declared.notebook) {
        const source = await inspectNotebook(git.root, declared.notebook.sourcePath)
        if (source.hash !== declared.notebook.sourceHash) {
          throw new RunStateError(
            declared.id,
            `Notebook changed after run ${declared.id} was declared; declare a new run`,
          )
        }
      }
      const started = RunAttempt.parse({ ...declared, state: "running" })
      const start = await FilesystemLedger.appendIdempotent({
        projectRoot: git.root,
        projectId: project.id,
        type: "run.started",
        actor: input.actor,
        payload: { run: started },
        signer: input.signer,
        key: `internal:run-start:${declared.id}`,
        request: { runId: declared.id, intentEventId: declared.intentEventId },
      })
      if (start.replayed) {
        await atomic(file, started as JsonValue)
        throw new RunStateError(declared.id, `Run ${declared.id} started previously; automatic re-execution is unsafe`)
      }
      await atomic(file, started as JsonValue)
      const result = await LocalProcessRunner.execute({
        projectRoot: git.root,
        runId: declared.id,
        ...declared.execution,
        preserveInputs: declared.notebook
          ? [
              {
                sourcePath: declared.notebook.sourcePath,
                destinationName: "original.ipynb",
                expectedHash: declared.notebook.sourceHash,
              },
            ]
          : undefined,
        signal: input.signal,
      })
      let completedResult = result
      let notebook = started.notebook
      if (notebook) {
        const executedFile = path.join(git.root, notebook.executedPath)
        const executedHash = await readFile(executedFile)
          .then((content) => createHash("sha256").update(content).digest("hex"))
          .catch((error: unknown) => {
            const code = error instanceof Error && "code" in error ? error.code : undefined
            if (code === "ENOENT") return null
            throw error
          })
        notebook = { ...notebook, executedHash }
        if (result.outcome === "succeeded" && !executedHash) {
          completedResult = {
            ...result,
            outcome: "failed",
            error: "Notebook runner exited successfully without producing executed.ipynb",
          }
        }
      }
      const completed = RunAttempt.parse({
        ...started,
        state: completedResult.outcome,
        result: completedResult,
        notebook,
      })
      const completion = await FilesystemLedger.appendIdempotent({
        projectRoot: git.root,
        projectId: project.id,
        type: "run.completed",
        actor: input.actor,
        payload: { run: completed },
        signer: input.signer,
        key: `internal:run-complete:${declared.id}`,
        request: { runId: declared.id, result: completedResult as unknown as JsonValue },
      })
      const value = completion.replayed
        ? replayedRun(completion.event)
        : {
            run: completed,
            eventId: completion.event.eventId,
            replayed: false,
          }
      return materialize(git.root, value)
    }
    return FilesystemLedger.withIdempotencyLock({
      projectRoot: git.root,
      projectId: project.id,
      key: `internal:run-execute:${input.runId}`,
      operation,
    })
  }
}
