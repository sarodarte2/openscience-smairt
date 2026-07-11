import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ResearchProjectService } from "../application/project"
import { ResearchTrackService } from "../application/track"
import { InvestigationService } from "../application/investigation"
import { ResearchRunService } from "../application/run"
import { ResearchEnvironmentService } from "../application/environment"
import { ResearchAudit } from "../application/audit"
import { FilesystemLedger } from "../adapters/ledger/filesystem"
import { Ed25519 } from "../domain/signature"
import { ProjectMember } from "../domain/schema"
import { ResearchID } from "../domain/id"

const execute = promisify(execFile)
const actor = { kind: "human" as const, id: "local:test", displayName: "Test Researcher" }
const { signer } = Ed25519.generate()
let root: string

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "openscience-project-"))
  await execute("git", ["init", "-q", root])
  await execute("git", ["-C", root, "config", "user.name", "Test Researcher"])
  await execute("git", ["-C", root, "config", "user.email", "test@example.com"])
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe("Research project initialization", () => {
  it("adopts a Git repository with a project environment and hidden core track", async () => {
    const result = await ResearchProjectService.initialize({
      directory: root,
      mode: "adopt",
      name: "Foundation Model Study",
      description: "Compare two adaptation strategies",
      actor,
      signer,
      createCondaEnvironment: false,
    })

    expect(result.project.defaultEnvironment.name).toBe("foundation-model-study")
    expect(result.trackEnvironment).toMatchObject({
      trackId: result.project.coreTrackId,
      name: "foundation-model-study",
      state: "base",
      inheritedFromTrackId: null,
    })
    expect(result.track).toMatchObject({ alias: "core", hidden: true, state: "active" })
    expect(result.member).toMatchObject({ role: "owner", gitEmail: "test@example.com" })
    expect(result.binding).toMatchObject({ active: true, boundAtCommit: null })
    expect(await readFile(path.join(root, ".openscience/research/environment.yml"), "utf8")).toContain(
      "name: foundation-model-study",
    )
    expect(await readFile(path.join(root, ".gitignore"), "utf8")).toContain(".openscience/research/private/")
    const ledger = await FilesystemLedger.inspect(root)
    expect(ledger.readOnly).toBeFalse()
    expect(ledger.events.map((event) => event.type)).toEqual(["project.created", "track.created"])

    const alternative = await ResearchTrackService.create({
      projectRoot: root,
      title: "Alternative parameters",
      objective: "Evaluate a distinct model architecture without rewriting core evidence",
      workspace: { kind: "none" },
      actor,
      role: "researcher",
      signer,
      idempotencyKey: "track-alternative-parameters",
    })
    expect(alternative.track).toMatchObject({ alias: "alternative-parameters", hidden: false })
    expect(alternative.track.parentTrackIds).toEqual([result.project.coreTrackId])
    expect(alternative.binding).toBeNull()
    expect(alternative.environment).toMatchObject({
      trackId: alternative.track.id,
      name: "foundation-model-study",
      state: "inherited",
      inheritedFromTrackId: result.project.coreTrackId,
    })
    await rm(path.join(root, `.openscience/research/tracks/${alternative.track.id}.json`))
    const replayedTrack = await ResearchTrackService.create({
      projectRoot: root,
      title: "Alternative parameters",
      objective: "Evaluate a distinct model architecture without rewriting core evidence",
      workspace: { kind: "none" },
      actor,
      role: "researcher",
      signer,
      idempotencyKey: "track-alternative-parameters",
    })
    expect(replayedTrack).toMatchObject({ track: { id: alternative.track.id }, replayed: true })
    expect(
      JSON.parse(await readFile(path.join(root, `.openscience/research/tracks/${alternative.track.id}.json`), "utf8")),
    ).toMatchObject({ id: alternative.track.id })
    const isolated = await ResearchEnvironmentService.isolate({
      projectRoot: root,
      trackId: alternative.track.id,
      actor,
      role: "researcher",
      signer,
      idempotencyKey: "environment-alternative-parameters",
    })
    expect(isolated.environment).toMatchObject({
      trackId: alternative.track.id,
      state: "diverged",
      inheritedFromTrackId: result.project.coreTrackId,
    })
    expect(await readFile(path.join(root, isolated.environment.portableSpecPath), "utf8")).toContain(
      `name: ${isolated.environment.name}`,
    )
    const replayedIsolation = await ResearchEnvironmentService.isolate({
      projectRoot: root,
      trackId: alternative.track.id,
      actor,
      role: "researcher",
      signer,
      idempotencyKey: "environment-alternative-parameters",
    })
    expect(replayedIsolation).toMatchObject({
      environment: { name: isolated.environment.name },
      eventId: isolated.eventId,
      replayed: true,
    })
    const investigation = await InvestigationService.createIteration({
      projectRoot: root,
      trackId: alternative.track.id,
      title: "Initial feasibility",
      question: "Does sparse adaptation preserve baseline performance?",
      decisionGoal: "Decide whether to proceed to a confirmatory comparison",
      content: {
        mode: "exploratory",
        aim: "Measure feasibility without making a confirmatory claim",
        intendedInputs: ["frozen baseline dataset"],
        intendedOutputs: ["performance table", "failure analysis"],
        decisionGoal: "Select or reject this approach for confirmatory study",
      },
      actor,
      role: "researcher",
      signer,
      idempotencyKey: "iteration-initial-feasibility",
    })
    expect(investigation.protocol.frozenAt).toBeNull()
    await Promise.all([
      rm(path.join(root, `.openscience/research/iterations/${investigation.iteration.id}.json`)),
      rm(path.join(root, `.openscience/research/projections/protocols/${investigation.protocol.id}.json`)),
    ])
    const replayedInvestigation = await InvestigationService.createIteration({
      projectRoot: root,
      trackId: alternative.track.id,
      title: "Initial feasibility",
      question: "Does sparse adaptation preserve baseline performance?",
      decisionGoal: "Decide whether to proceed to a confirmatory comparison",
      content: {
        mode: "exploratory",
        aim: "Measure feasibility without making a confirmatory claim",
        intendedInputs: ["frozen baseline dataset"],
        intendedOutputs: ["performance table", "failure analysis"],
        decisionGoal: "Select or reject this approach for confirmatory study",
      },
      actor,
      role: "researcher",
      signer,
      idempotencyKey: "iteration-initial-feasibility",
    })
    expect(replayedInvestigation).toMatchObject({
      iteration: { id: investigation.iteration.id },
      protocol: { id: investigation.protocol.id },
      replayed: true,
    })
    expect(
      JSON.parse(
        await readFile(
          path.join(root, `.openscience/research/projections/protocols/${investigation.protocol.id}.json`),
          "utf8",
        ),
      ),
    ).toMatchObject({ id: investigation.protocol.id })
    const frozen = await InvestigationService.freezeProtocol({
      projectRoot: root,
      protocolId: investigation.protocol.id,
      actor,
      role: "owner",
      signer,
      idempotencyKey: "freeze-initial-feasibility",
    })
    expect(frozen.protocol.frozenAt).not.toBeNull()
    expect(frozen.iteration.state).toBe("protocol_ready")
    await Promise.all([
      rm(path.join(root, `.openscience/research/iterations/${frozen.iteration.id}.json`)),
      rm(path.join(root, `.openscience/research/projections/protocols/${frozen.protocol.id}.json`)),
    ])
    const replayedFreeze = await InvestigationService.freezeProtocol({
      projectRoot: root,
      protocolId: investigation.protocol.id,
      actor,
      role: "owner",
      signer,
      idempotencyKey: "freeze-initial-feasibility",
    })
    expect(replayedFreeze).toMatchObject({
      protocol: { id: frozen.protocol.id, frozenAt: frozen.protocol.frozenAt },
      iteration: { id: frozen.iteration.id, state: "protocol_ready" },
      eventId: frozen.eventId,
      replayed: true,
    })
    expect(await InvestigationService.listProtocols(root, investigation.iteration.id)).toHaveLength(1)
    await expect(
      ResearchRunService.declare({
        projectRoot: root,
        protocolId: frozen.protocol.id,
        parameters: {},
        execution: {
          command: "python",
          args: [],
          cwd: root,
          timeoutMs: 60_000,
          environmentKeys: ["PRIVATE_API_KEY"],
        },
        actor,
        role: "researcher",
        signer,
        idempotencyKey: "run-rejected-secret-environment",
      }),
    ).rejects.toThrow("requires a separate approval path")
    const bin = path.join(root, "test-bin")
    await mkdir(bin)
    const conda = path.join(bin, "conda")
    await writeFile(
      conda,
      [
        "#!/bin/sh",
        'if [ "$1" = "list" ]; then',
        "  printf '@EXPLICIT\\nhttps://user:secret@conda.example.test/t/private-token/linux-64/python-3.12.0-0.conda?auth=private#0123456789abcdef0123456789abcdef\\n'",
        "  exit 0",
        "fi",
        'if [ "$1" = "run" ]; then',
        "  shift",
        '  if [ "$1" = "--no-capture-output" ]; then shift; fi',
        '  if [ "$1" = "--name" ]; then shift 2; fi',
        '  if [ "$1" = "jupyter" ]; then',
        "    shift",
        '    source_file=""',
        '    output_dir=""',
        '    while [ "$#" -gt 0 ]; do',
        '      if [ "$1" = "--output-dir" ]; then shift; output_dir="$1"',
        '      elif [ -z "$source_file" ] && [ "${1##*.}" = "ipynb" ]; then source_file="$1"',
        "      fi",
        "      shift",
        "    done",
        '    cp "$source_file" "$output_dir/executed.ipynb"',
        "    exit 0",
        "  fi",
        '  exec "$@"',
        "fi",
        "exit 2",
        "",
      ].join("\n"),
    )
    await chmod(conda, 0o755)
    const previousPath = process.env.PATH
    process.env.PATH = `${bin}:${previousPath ?? ""}`
    let declared: Awaited<ReturnType<typeof ResearchRunService.declare>>
    let completed: Awaited<ReturnType<typeof ResearchRunService.execute>>
    let replayedExecution: Awaited<ReturnType<typeof ResearchRunService.execute>>
    try {
      declared = await ResearchRunService.declare({
        projectRoot: root,
        protocolId: frozen.protocol.id,
        parameters: { learningRate: 0.0001 },
        seed: 42,
        execution: {
          command: "/usr/bin/touch",
          args: ["formal-output.txt"],
          cwd: root,
          timeoutMs: 60_000,
          environmentKeys: [],
          outputs: [{ path: "formal-output.txt", role: "output", mediaType: "text/plain" }],
        },
        actor,
        role: "researcher",
        signer,
        idempotencyKey: "run-initial-feasibility-42",
      })
      const projection = path.join(root, `.openscience/research/projections/runs/${declared.run.id}.json`)
      await writeFile(
        projection,
        JSON.stringify({
          ...declared.run,
          execution: { ...declared.run.execution, command: "/usr/bin/false", args: [] },
        }) + "\n",
      )
      await expect(
        ResearchRunService.execute({
          projectRoot: root,
          runId: declared.run.id,
          actor,
          role: "researcher",
          signer,
        }),
      ).rejects.toThrow("does not match its signed intent")
      await writeFile(projection, JSON.stringify(declared.run) + "\n")
      const drift = path.join(root, "uncommitted-drift.txt")
      await writeFile(drift, "changed after declaration\n")
      await expect(
        ResearchRunService.execute({
          projectRoot: root,
          runId: declared.run.id,
          actor,
          role: "researcher",
          signer,
        }),
      ).rejects.toThrow("Workspace changed after run")
      await rm(drift)
      completed = await ResearchRunService.execute({
        projectRoot: root,
        runId: declared.run.id,
        actor,
        role: "researcher",
        signer,
      })
      replayedExecution = await ResearchRunService.execute({
        projectRoot: root,
        runId: declared.run.id,
        actor,
        role: "researcher",
        signer,
      })
    } finally {
      process.env.PATH = previousPath
    }
    expect(declared.run).toMatchObject({ state: "declared", seed: 42, protocolId: frozen.protocol.id })
    expect(declared.run.execution).toMatchObject({
      command: "conda",
      args: ["run", "--no-capture-output", "--name", isolated.environment.name, "/usr/bin/touch", "formal-output.txt"],
    })
    expect(declared.run.workspace.captureConfidence).toBe("best_effort")
    expect(declared.run.environment.captureConfidence).toBe("credential_redacted")
    const resolvedEnvironment = await readFile(path.join(root, declared.run.environment.resolvedSpecPath), "utf8")
    expect(resolvedEnvironment).not.toContain("secret")
    expect(resolvedEnvironment).not.toContain("private-token")
    expect(resolvedEnvironment).not.toContain("auth=private")
    expect(declared.run.intentEventId).toBe(declared.eventId)
    const replayedRun = await ResearchRunService.declare({
      projectRoot: root,
      protocolId: frozen.protocol.id,
      parameters: { learningRate: 0.0001 },
      seed: 42,
      execution: {
        command: "/usr/bin/touch",
        args: ["formal-output.txt"],
        cwd: root,
        timeoutMs: 60_000,
        environmentKeys: [],
        outputs: [{ path: "formal-output.txt", role: "output", mediaType: "text/plain" }],
      },
      actor,
      role: "researcher",
      signer,
      idempotencyKey: "run-initial-feasibility-42",
    })
    expect(replayedRun).toMatchObject({ run: { id: declared.run.id }, eventId: declared.eventId, replayed: true })
    expect(await ResearchRunService.list(root, investigation.iteration.id)).toMatchObject([
      { id: declared.run.id, state: "succeeded" },
    ])
    expect(completed).toMatchObject({
      run: { state: "succeeded", result: { outcome: "succeeded" } },
      artifacts: [{ runId: declared.run.id, path: "formal-output.txt", role: "output" }],
      missingOutputs: [],
      replayed: false,
    })
    expect(replayedExecution).toMatchObject({
      run: { id: declared.run.id, state: "succeeded" },
      eventId: completed.eventId,
      replayed: true,
    })
    expect(await readFile(path.join(root, `.openscience/research/runs/${declared.run.id}/stdout.log`), "utf8")).toBe("")
    const notebookPath = path.join(root, "analysis.ipynb")
    await writeFile(
      notebookPath,
      JSON.stringify({
        cells: [{ cell_type: "code", execution_count: null, metadata: {}, outputs: [], source: ["1+1"] }],
        metadata: {},
        nbformat: 4,
        nbformat_minor: 5,
      }),
    )
    process.env.PATH = `${bin}:${previousPath ?? ""}`
    let notebookDeclared: Awaited<ReturnType<typeof ResearchRunService.declareNotebook>>
    let notebookCompleted: Awaited<ReturnType<typeof ResearchRunService.execute>>
    try {
      notebookDeclared = await ResearchRunService.declareNotebook({
        projectRoot: root,
        protocolId: frozen.protocol.id,
        notebookPath,
        parameters: { purpose: "formal notebook smoke test" },
        timeoutMs: 60_000,
        allowErrors: false,
        actor,
        role: "researcher",
        signer,
        idempotencyKey: "notebook-initial-feasibility",
      })
      notebookCompleted = await ResearchRunService.execute({
        projectRoot: root,
        runId: notebookDeclared.run.id,
        actor,
        role: "researcher",
        signer,
      })
    } finally {
      process.env.PATH = previousPath
    }
    expect(notebookDeclared.run).toMatchObject({ kind: "notebook", notebook: { allowErrors: false } })
    expect(notebookCompleted.run).toMatchObject({
      state: "succeeded",
      kind: "notebook",
      notebook: { sourcePath: "analysis.ipynb" },
    })
    expect(notebookCompleted.run.notebook?.executedHash).toMatch(/^[0-9a-f]{64}$/)
    expect(await readFile(path.join(root, notebookCompleted.run.notebook!.originalPath), "utf8")).toBe(
      await readFile(notebookPath, "utf8"),
    )
    expect(await readFile(path.join(root, notebookCompleted.run.notebook!.executedPath), "utf8")).toBe(
      await readFile(notebookPath, "utf8"),
    )
    expect((await FilesystemLedger.inspect(root)).events).toHaveLength(13)
    expect((await ResearchAudit.inspect(root)).readOnly).toBeFalse()

    const attacker = Ed25519.generate().signer
    await FilesystemLedger.append({
      projectRoot: root,
      projectId: result.project.id,
      type: "track.created",
      actor: { kind: "human", id: "unknown:attacker", displayName: "Unknown signer" },
      payload: { title: "Forged track" },
      signer: attacker,
    })
    const audit = await ResearchAudit.inspect(root)
    expect(audit.readOnly).toBeTrue()
    expect(audit.diagnostics.at(-1)).toMatchObject({ code: "untrusted_signer" })
  })

  it("applies member removal prospectively without invalidating concurrent branch work", async () => {
    const project = await ResearchProjectService.initialize({
      directory: root,
      mode: "adopt",
      name: "Collaborative Study",
      actor,
      signer,
      createCondaEnvironment: false,
    })
    const collaborator = Ed25519.generate().signer
    const memberActor = { kind: "human" as const, id: "local:collaborator", displayName: "Collaborator" }
    const member = ProjectMember.parse({
      schemaVersion: 1,
      id: ResearchID.create("member"),
      actorId: memberActor.id,
      projectId: project.project.id,
      displayName: memberActor.displayName,
      role: "researcher",
      signingKeyId: collaborator.keyId,
      active: true,
      createdAt: new Date().toISOString(),
      createdBy: actor,
    })
    const added = await FilesystemLedger.append({
      projectRoot: root,
      projectId: project.project.id,
      type: "member.added",
      actor,
      payload: { member },
      signer,
    })
    const branchParent = [{ eventId: added.eventId, hash: added.eventHash }]
    await FilesystemLedger.append({
      projectRoot: root,
      projectId: project.project.id,
      type: "member.removed",
      actor,
      payload: { memberId: member.id },
      parents: branchParent,
      signer,
    })
    await FilesystemLedger.append({
      projectRoot: root,
      projectId: project.project.id,
      type: "analysis.recorded",
      actor: memberActor,
      payload: { result: "Completed concurrently before removal was observed" },
      parents: branchParent,
      signer: collaborator,
    })
    expect((await ResearchAudit.inspect(root)).readOnly).toBeFalse()

    await FilesystemLedger.append({
      projectRoot: root,
      projectId: project.project.id,
      type: "analysis.recorded",
      actor: memberActor,
      payload: { result: "Attempted after histories were reconciled" },
      signer: collaborator,
    })
    const reconciled = await ResearchAudit.inspect(root)
    expect(reconciled.readOnly).toBeTrue()
    expect(reconciled.diagnostics.at(-1)).toMatchObject({ code: "untrusted_signer" })
  })
})
