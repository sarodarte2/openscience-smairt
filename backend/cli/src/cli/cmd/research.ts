import path from "node:path"
import * as prompts from "@clack/prompts"
import { cmd } from "./cmd"
import { LocalGit } from "../../research/adapters/git/local"
import { ResearchAudit } from "../../research/application/audit"
import { IdentityPassphraseRequiredError, LocalIdentity } from "../../research/adapters/identity/local"
import { ResearchProjectService } from "../../research/application/project"
import { ResearchTrackService } from "../../research/application/track"
import { InvestigationService } from "../../research/application/investigation"
import { ResearchRunService } from "../../research/application/run"
import { ResearchEnvironmentService } from "../../research/application/environment"
import { ResearchEvidenceService } from "../../research/application/evidence"
import { ResearchReviewService } from "../../research/application/review"
import { ProjectMembership } from "../../research/application/membership"
import { ResearchProject } from "../../research/domain/schema"
import { readFile } from "node:fs/promises"

type Format = "text" | "json"

function output(format: Format, value: unknown, text: () => void) {
  if (format === "json") {
    process.stdout.write(JSON.stringify(value, null, 2) + "\n")
    return
  }
  text()
}

async function current(directory: string) {
  const git = await LocalGit.inspect(path.resolve(directory))
  const project = ResearchProject.parse(
    JSON.parse(await readFile(path.join(git.root, ".openscience/research/project.json"), "utf8")),
  )
  return { git, project }
}

async function identity() {
  try {
    return await LocalIdentity.loadOrCreate()
  } catch (error) {
    if (!(error instanceof IdentityPassphraseRequiredError)) throw error
    const passphrase = await prompts.password({
      message: "Signing-key passphrase (12+ characters)",
      validate(value) {
        if (!value || value.length < 12) return "Use at least 12 characters"
      },
    })
    if (prompts.isCancel(passphrase)) throw new Error("Research initialization cancelled")
    return LocalIdentity.loadOrCreate({ passphrase })
  }
}

const ResearchInitCommand = cmd({
  command: "init [directory]",
  describe: "create or adopt a Git repository as an OpenScience Research project",
  builder: (yargs) =>
    yargs
      .positional("directory", { type: "string", default: process.cwd() })
      .option("new", { type: "boolean", default: false, describe: "create a new directory and Git repository" })
      .option("name", { type: "string", describe: "research project name" })
      .option("description", { type: "string", describe: "primary research objective" })
      .option("conda", { type: "boolean", default: true, describe: "create the project-named Conda environment" })
      .option("format", { choices: ["text", "json"] as const, default: "text" }),
  async handler(args) {
    const directory = path.resolve(args.directory as string)
    const name = (args.name as string | undefined) || path.basename(directory)
    const mode = args.new ? "new" : "adopt"
    const git = mode === "adopt" ? await LocalGit.inspect(directory) : null
    const displayName = git?.user.name || git?.user.email || "Local researcher"
    const actor = { kind: "human" as const, id: `git:${git?.user.email || displayName}`, displayName }
    const signer = await identity()
    const result = await ResearchProjectService.initialize({
      directory,
      mode,
      name,
      description: args.description as string | undefined,
      actor,
      signer,
      createCondaEnvironment: args.conda,
    })
    output(args.format as Format, result, () => {
      prompts.log.success(`OpenScience Research initialized at ${result.root}`)
      prompts.log.info(`Conda environment: ${result.environment.name}`)
      prompts.log.info("The core scientific track is ready; review and commit the scaffold when you choose.")
    })
  },
})

const ResearchVerifyCommand = cmd({
  command: "verify [directory]",
  describe: "verify signatures, hashes, and lineage in the local research ledger",
  builder: (yargs) =>
    yargs
      .positional("directory", { type: "string", default: process.cwd() })
      .option("format", { choices: ["text", "json"] as const, default: "text" }),
  async handler(args) {
    const root = (await LocalGit.inspect(path.resolve(args.directory as string))).root
    const ledger = await ResearchAudit.inspect(root)
    output(args.format as Format, ledger, () => {
      if (!ledger.readOnly) {
        prompts.log.success(`Verified ${ledger.events.length} signed research events`)
        return
      }
      for (const diagnostic of ledger.diagnostics) prompts.log.error(`${diagnostic.code}: ${diagnostic.file}`)
    })
    if (!ledger.readOnly) return
    process.exitCode = 2
  },
})

const ResearchStatusCommand = cmd({
  command: "status [directory]",
  describe: "show project, track, and integrity context",
  builder: (yargs) =>
    yargs
      .positional("directory", { type: "string", default: process.cwd() })
      .option("format", { choices: ["text", "json"] as const, default: "text" }),
  async handler(args) {
    const { git, project } = await current(args.directory as string)
    const [tracks, audit] = await Promise.all([ResearchTrackService.list(git.root), ResearchAudit.inspect(git.root)])
    const result = { project, tracks, integrity: { readOnly: audit.readOnly, diagnostics: audit.diagnostics } }
    output(args.format as Format, result, () => {
      prompts.log.info(`${project.name} (${project.id})`)
      prompts.log.info(`${tracks.filter((track) => !track.hidden).length} scientific tracks`)
      if (audit.readOnly) prompts.log.error(`${audit.diagnostics.length} integrity diagnostics; project is read-only`)
      if (!audit.readOnly) prompts.log.success(`Verified ${audit.events.length} signed research events`)
    })
  },
})

const ResearchTrackListCommand = cmd({
  command: "list [directory]",
  describe: "list stable scientific tracks",
  builder: (yargs) =>
    yargs
      .positional("directory", { type: "string", default: process.cwd() })
      .option("all", { type: "boolean", default: false, describe: "include the hidden core track" })
      .option("format", { choices: ["text", "json"] as const, default: "text" }),
  async handler(args) {
    const { git } = await current(args.directory as string)
    const tracks = (await ResearchTrackService.list(git.root)).filter((track) => args.all || !track.hidden)
    output(args.format as Format, tracks, () => {
      for (const track of tracks) prompts.log.info(`${track.alias} · ${track.state} · ${track.title} (${track.id})`)
    })
  },
})

const ResearchTrackCreateCommand = cmd({
  command: "create [directory]",
  describe: "create a scientific track with an optional Git workspace binding",
  builder: (yargs) =>
    yargs
      .positional("directory", { type: "string", default: process.cwd() })
      .option("title", { type: "string", demandOption: true })
      .option("objective", { type: "string", demandOption: true })
      .option("alias", { type: "string" })
      .option("workspace", { choices: ["none", "current", "new-worktree"] as const, default: "none" })
      .option("branch", { type: "string", describe: "branch name for a new worktree" })
      .option("worktree-path", { type: "string", describe: "filesystem path for a new worktree" })
      .option("idempotency-key", { type: "string", describe: "reuse this key when retrying the same mutation" })
      .option("format", { choices: ["text", "json"] as const, default: "text" }),
  async handler(args) {
    const { git } = await current(args.directory as string)
    const signer = await identity()
    const member = await ProjectMembership.localMember(git.root, signer.keyId)
    if (!member) throw new Error("The local signing identity is not an active project member")
    const kind = args.workspace as "none" | "current" | "new-worktree"
    const workspace = {
      kind,
      ...(kind === "new-worktree"
        ? { branch: args.branch as string | undefined, worktreePath: args.worktreePath as string | undefined }
        : {}),
    }
    const result = await ResearchTrackService.create({
      projectRoot: git.root,
      title: args.title as string,
      objective: args.objective as string,
      alias: args.alias as string | undefined,
      workspace,
      actor: { kind: "human", id: member.id, displayName: member.displayName },
      role: member.role,
      signer,
      idempotencyKey: (args.idempotencyKey as string | undefined) ?? crypto.randomUUID(),
    })
    output(args.format as Format, result, () => {
      prompts.log.success(`${result.replayed ? "Reused" : "Created"} ${result.track.title} (${result.track.id})`)
      if (result.binding) prompts.log.info(`Workspace: ${result.binding.branch} at ${result.binding.worktreePath}`)
    })
  },
})

const ResearchTrackCommand = cmd({
  command: "track",
  describe: "manage scientific tracks independently from Git branch identity",
  builder: (yargs) => yargs.command(ResearchTrackListCommand).command(ResearchTrackCreateCommand).demandCommand(),
  async handler() {},
})

const ResearchProtocolListCommand = cmd({
  command: "list [directory]",
  describe: "list draft and frozen protocol revisions",
  builder: (yargs) =>
    yargs
      .positional("directory", { type: "string", default: process.cwd() })
      .option("iteration", { type: "string", describe: "limit results to one iteration ID" })
      .option("format", { choices: ["text", "json"] as const, default: "text" }),
  async handler(args) {
    const { git } = await current(args.directory as string)
    const protocols = await InvestigationService.listProtocols(git.root, args.iteration as string | undefined)
    output(args.format as Format, protocols, () => {
      for (const protocol of protocols) {
        prompts.log.info(
          `${protocol.mode} · revision ${protocol.revision} · ${protocol.frozenAt ? "frozen" : "draft"} · ${protocol.id}`,
        )
      }
    })
  },
})

const ResearchProtocolFreezeCommand = cmd({
  command: "freeze <protocol-id> [directory]",
  describe: "review, sign, and irreversibly freeze a protocol revision",
  builder: (yargs) =>
    yargs
      .positional("protocol-id", { type: "string", demandOption: true })
      .positional("directory", { type: "string", default: process.cwd() })
      .option("yes", { type: "boolean", default: false, describe: "confirm review non-interactively" })
      .option("idempotency-key", { type: "string", describe: "reuse this key when retrying the same mutation" })
      .option("format", { choices: ["text", "json"] as const, default: "text" }),
  async handler(args) {
    const { git } = await current(args.directory as string)
    const protocolId = args.protocolId as string
    const protocol = (await InvestigationService.listProtocols(git.root)).find((item) => item.id === protocolId)
    if (!protocol) throw new Error(`Protocol ${protocolId} was not found`)
    if (!args.yes) {
      prompts.log.info(JSON.stringify(protocol.content, null, 2))
      const confirmed = await prompts.confirm({
        message: "I reviewed this protocol and intend to freeze it before viewing formal results",
        initialValue: false,
      })
      if (prompts.isCancel(confirmed) || !confirmed) throw new Error("Protocol freeze cancelled")
    }
    const signer = await identity()
    const member = await ProjectMembership.localMember(git.root, signer.keyId)
    if (!member) throw new Error("The local signing identity is not an active project member")
    const result = await InvestigationService.freezeProtocol({
      projectRoot: git.root,
      protocolId,
      actor: { kind: "human", id: member.id, displayName: member.displayName },
      role: member.role,
      signer,
      idempotencyKey: (args.idempotencyKey as string | undefined) ?? crypto.randomUUID(),
    })
    output(args.format as Format, result, () => {
      prompts.log.success(
        `${result.replayed ? "Reused freeze for" : "Frozen"} protocol revision ${result.protocol.revision}`,
      )
      prompts.log.info(`Iteration state: ${result.iteration.state}`)
    })
  },
})

const ResearchProtocolCommand = cmd({
  command: "protocol",
  describe: "review and freeze immutable protocol revisions",
  builder: (yargs) => yargs.command(ResearchProtocolListCommand).command(ResearchProtocolFreezeCommand).demandCommand(),
  async handler() {},
})

const ResearchEnvironmentListCommand = cmd({
  command: "list [directory]",
  describe: "list inherited and divergent track Conda environments",
  builder: (yargs) =>
    yargs
      .positional("directory", { type: "string", default: process.cwd() })
      .option("format", { choices: ["text", "json"] as const, default: "text" }),
  async handler(args) {
    const { git } = await current(args.directory as string)
    const environments = await ResearchEnvironmentService.list(git.root)
    output(args.format as Format, environments, () => {
      for (const environment of environments) {
        prompts.log.info(`${environment.state} · ${environment.name} · ${environment.trackId}`)
      }
    })
  },
})

const ResearchEnvironmentIsolateCommand = cmd({
  command: "isolate <track-id> [directory]",
  describe: "create a track-specific Conda specification without changing its parent",
  builder: (yargs) =>
    yargs
      .positional("track-id", { type: "string", demandOption: true })
      .positional("directory", { type: "string", default: process.cwd() })
      .option("yes", { type: "boolean", default: false, describe: "confirm environment isolation non-interactively" })
      .option("idempotency-key", { type: "string", describe: "reuse this key when retrying the same mutation" })
      .option("format", { choices: ["text", "json"] as const, default: "text" }),
  async handler(args) {
    const { git } = await current(args.directory as string)
    if (!args.yes) {
      const confirmed = await prompts.confirm({
        message: "Create a separate Conda specification for this track? The parent environment will not change.",
        initialValue: false,
      })
      if (prompts.isCancel(confirmed) || !confirmed) throw new Error("Environment isolation cancelled")
    }
    const signer = await identity()
    const member = await ProjectMembership.localMember(git.root, signer.keyId)
    if (!member) throw new Error("The local signing identity is not an active project member")
    const result = await ResearchEnvironmentService.isolate({
      projectRoot: git.root,
      trackId: args.trackId as string,
      actor: { kind: "human", id: member.id, displayName: member.displayName },
      role: member.role,
      signer,
      idempotencyKey: (args.idempotencyKey as string | undefined) ?? crypto.randomUUID(),
    })
    output(args.format as Format, result, () => {
      prompts.log.success(`${result.replayed ? "Reused" : "Created"} ${result.environment.name}`)
      prompts.log.info(`Specification: ${result.environment.portableSpecPath}`)
      prompts.log.info(`Provision when ready: ${result.provision.command} ${result.provision.args.join(" ")}`)
    })
  },
})

const ResearchEnvironmentCommand = cmd({
  command: "environment",
  describe: "manage explicit per-track Conda environment boundaries",
  builder: (yargs) =>
    yargs.command(ResearchEnvironmentListCommand).command(ResearchEnvironmentIsolateCommand).demandCommand(),
  async handler() {},
})

const ResearchRunListCommand = cmd({
  command: "list [directory]",
  describe: "list formal run attempts and outcomes",
  builder: (yargs) =>
    yargs
      .positional("directory", { type: "string", default: process.cwd() })
      .option("iteration", { type: "string", describe: "limit results to one iteration ID" })
      .option("format", { choices: ["text", "json"] as const, default: "text" }),
  async handler(args) {
    const { git } = await current(args.directory as string)
    const runs = await ResearchRunService.list(git.root, args.iteration as string | undefined)
    output(args.format as Format, runs, () => {
      for (const run of runs) prompts.log.info(`${run.state} · ${run.environment.name} · ${run.id}`)
    })
  },
})

const ResearchRunDeclareCommand = cmd({
  command: "declare [directory]",
  describe: "capture Git and Conda provenance and sign a formal run intent",
  builder: (yargs) =>
    yargs
      .positional("directory", { type: "string", default: process.cwd() })
      .option("protocol", { type: "string", demandOption: true })
      .option("command", {
        type: "string",
        demandOption: true,
        describe: "program to run inside the project Conda env",
      })
      .option("arg", { type: "string", array: true, default: [], describe: "exact argv item; repeat for each item" })
      .option("parameters", { type: "string", default: "{}", describe: "JSON parameters recorded with the intent" })
      .option("seed", { type: "number" })
      .option("timeout-ms", { type: "number", default: 60 * 60 * 1000 })
      .option("env", { type: "string", array: true, default: [], describe: "non-secret environment key to pass" })
      .option("idempotency-key", { type: "string", describe: "reuse this key when retrying the same mutation" })
      .option("format", { choices: ["text", "json"] as const, default: "text" }),
  async handler(args) {
    const { git } = await current(args.directory as string)
    const signer = await identity()
    const member = await ProjectMembership.localMember(git.root, signer.keyId)
    if (!member) throw new Error("The local signing identity is not an active project member")
    const result = await ResearchRunService.declare({
      projectRoot: git.root,
      protocolId: args.protocol as string,
      parameters: JSON.parse(args.parameters as string),
      seed: args.seed as number | undefined,
      execution: {
        command: args.command as string,
        args: args.arg as string[],
        cwd: git.root,
        timeoutMs: args.timeoutMs as number,
        environmentKeys: args.env as string[],
      },
      actor: { kind: "human", id: member.id, displayName: member.displayName },
      role: member.role,
      signer,
      idempotencyKey: (args.idempotencyKey as string | undefined) ?? crypto.randomUUID(),
    })
    output(args.format as Format, result, () => {
      prompts.log.success(`${result.replayed ? "Reused" : "Declared"} formal run ${result.run.id}`)
      prompts.log.info(
        `Conda: ${result.run.environment.name} · workspace ${result.run.workspaceStateHash.slice(0, 12)}`,
      )
    })
  },
})

const ResearchNotebookDeclareCommand = cmd({
  command: "notebook [directory]",
  describe: "declare a saved notebook for clean-kernel formal execution",
  builder: (yargs) =>
    yargs
      .positional("directory", { type: "string", default: process.cwd() })
      .option("protocol", { type: "string", demandOption: true })
      .option("notebook", { type: "string", demandOption: true, describe: "project-local .ipynb path" })
      .option("parameters", { type: "string", default: "{}", describe: "JSON parameters recorded with the intent" })
      .option("seed", { type: "number" })
      .option("timeout-ms", { type: "number", default: 60 * 60 * 1000 })
      .option("allow-errors", {
        type: "boolean",
        default: false,
        describe: "preserve cell errors in the executed copy instead of stopping",
      })
      .option("env", { type: "string", array: true, default: [], describe: "non-secret environment key to pass" })
      .option("idempotency-key", { type: "string", describe: "reuse this key when retrying the same mutation" })
      .option("format", { choices: ["text", "json"] as const, default: "text" }),
  async handler(args) {
    const { git } = await current(args.directory as string)
    const signer = await identity()
    const member = await ProjectMembership.localMember(git.root, signer.keyId)
    if (!member) throw new Error("The local signing identity is not an active project member")
    const result = await ResearchRunService.declareNotebook({
      projectRoot: git.root,
      protocolId: args.protocol as string,
      notebookPath: args.notebook as string,
      parameters: JSON.parse(args.parameters as string),
      seed: args.seed as number | undefined,
      timeoutMs: args.timeoutMs as number,
      allowErrors: args.allowErrors as boolean,
      environmentKeys: args.env as string[],
      actor: { kind: "human", id: member.id, displayName: member.displayName },
      role: member.role,
      signer,
      idempotencyKey: (args.idempotencyKey as string | undefined) ?? crypto.randomUUID(),
    })
    output(args.format as Format, result, () => {
      prompts.log.success(`${result.replayed ? "Reused" : "Declared"} notebook run ${result.run.id}`)
      prompts.log.info(`Source: ${result.run.notebook?.sourcePath}`)
    })
  },
})

const ResearchRunExecuteCommand = cmd({
  command: "execute <run-id> [directory]",
  describe: "execute a declared formal run through the controlled Conda runner",
  builder: (yargs) =>
    yargs
      .positional("run-id", { type: "string", demandOption: true })
      .positional("directory", { type: "string", default: process.cwd() })
      .option("yes", { type: "boolean", default: false, describe: "confirm execution non-interactively" })
      .option("format", { choices: ["text", "json"] as const, default: "text" }),
  async handler(args) {
    const { git } = await current(args.directory as string)
    if (!args.yes) {
      const confirmed = await prompts.confirm({ message: `Execute formal run ${args.runId}?`, initialValue: false })
      if (prompts.isCancel(confirmed) || !confirmed) throw new Error("Formal run execution cancelled")
    }
    const signer = await identity()
    const member = await ProjectMembership.localMember(git.root, signer.keyId)
    if (!member) throw new Error("The local signing identity is not an active project member")
    const result = await ResearchRunService.execute({
      projectRoot: git.root,
      runId: args.runId as string,
      actor: { kind: "human", id: member.id, displayName: member.displayName },
      role: member.role,
      signer,
    })
    output(args.format as Format, result, () => {
      prompts.log.success(`${result.replayed ? "Reused" : "Recorded"} ${result.run.state} run ${result.run.id}`)
      if (result.run.result) prompts.log.info(`Duration: ${result.run.result.durationMs} ms`)
    })
  },
})

const ResearchRunCommand = cmd({
  command: "run",
  describe: "declare and execute formal computational evidence",
  builder: (yargs) =>
    yargs
      .command(ResearchRunListCommand)
      .command(ResearchRunDeclareCommand)
      .command(ResearchNotebookDeclareCommand)
      .command(ResearchRunExecuteCommand)
      .demandCommand(),
  async handler() {},
})

const ResearchArtifactRegisterCommand = cmd({
  command: "register [directory]",
  describe: "hash and register a project-local evidence artifact",
  builder: (yargs) =>
    yargs
      .positional("directory", { type: "string", default: process.cwd() })
      .option("iteration", { type: "string", demandOption: true })
      .option("file", { type: "string", demandOption: true })
      .option("role", {
        choices: ["input", "output", "dataset", "model", "figure", "table", "notebook", "log", "other"] as const,
        demandOption: true,
      })
      .option("media-type", { type: "string", demandOption: true })
      .option("run", { type: "string" })
      .option("format", { choices: ["text", "json"] as const, default: "text" }),
  async handler(args) {
    const { git } = await current(args.directory as string)
    const signer = await identity()
    const member = await ProjectMembership.localMember(git.root, signer.keyId)
    if (!member) throw new Error("The local signing identity is not an active project member")
    const result = await ResearchEvidenceService.registerArtifact({
      projectRoot: git.root,
      iterationId: args.iteration as string,
      file: args.file as string,
      artifactRole: args.role as
        | "input"
        | "output"
        | "dataset"
        | "model"
        | "figure"
        | "table"
        | "notebook"
        | "log"
        | "other",
      mediaType: args.mediaType as string,
      runId: args.run as string | undefined,
      actor: { kind: "human", id: member.id, displayName: member.displayName },
      role: member.role,
      signer,
    })
    output(args.format as Format, result, () => {
      prompts.log.success(`Registered ${result.artifact.path} (${result.artifact.id})`)
      prompts.log.info(`SHA-256 ${result.artifact.contentHash}`)
    })
  },
})

const ResearchArtifactListCommand = cmd({
  command: "list [directory]",
  describe: "list artifact manifests and integrity state",
  builder: (yargs) =>
    yargs
      .positional("directory", { type: "string", default: process.cwd() })
      .option("iteration", { type: "string" })
      .option("format", { choices: ["text", "json"] as const, default: "text" }),
  async handler(args) {
    const { git } = await current(args.directory as string)
    const values = await ResearchEvidenceService.listArtifacts(git.root, args.iteration as string | undefined)
    output(args.format as Format, values, () => {
      for (const value of values) prompts.log.info(`${value.role} · ${value.path} · ${value.id}`)
    })
  },
})

const ResearchArtifactVerifyCommand = cmd({
  command: "verify [directory]",
  describe: "verify every registered artifact against its signed manifest",
  builder: (yargs) =>
    yargs
      .positional("directory", { type: "string", default: process.cwd() })
      .option("format", { choices: ["text", "json"] as const, default: "text" }),
  async handler(args) {
    const { git } = await current(args.directory as string)
    const values = await ResearchEvidenceService.verifyArtifacts(git.root)
    output(args.format as Format, values, () => {
      for (const value of values)
        (value.valid ? prompts.log.success : prompts.log.error)(
          `${value.artifact.path} · ${value.valid ? "verified" : "missing or corrupted"}`,
        )
    })
    if (values.some((value) => !value.valid)) process.exitCode = 2
  },
})

const ResearchArtifactCommand = cmd({
  command: "artifact",
  describe: "capture and verify immutable evidence manifests",
  builder: (yargs) =>
    yargs
      .command(ResearchArtifactRegisterCommand)
      .command(ResearchArtifactListCommand)
      .command(ResearchArtifactVerifyCommand)
      .demandCommand(),
  async handler() {},
})

const ResearchAnalysisCreateCommand = cmd({
  command: "create [directory]",
  describe: "record methods, findings, limitations, runs, and artifacts",
  builder: (yargs) =>
    yargs
      .positional("directory", { type: "string", default: process.cwd() })
      .option("iteration", { type: "string", demandOption: true })
      .option("title", { type: "string", demandOption: true })
      .option("summary", { type: "string", demandOption: true })
      .option("methods", { type: "string", demandOption: true })
      .option("finding", { type: "string", array: true, demandOption: true })
      .option("limitation", { type: "string", array: true, demandOption: true })
      .option("run", { type: "string", array: true, default: [] })
      .option("artifact", { type: "string", array: true, default: [] })
      .option("finalize", { type: "boolean", default: false })
      .option("format", { choices: ["text", "json"] as const, default: "text" }),
  async handler(args) {
    const { git } = await current(args.directory as string)
    const signer = await identity()
    const member = await ProjectMembership.localMember(git.root, signer.keyId)
    if (!member) throw new Error("The local signing identity is not an active project member")
    const result = await ResearchEvidenceService.createAnalysis({
      projectRoot: git.root,
      iterationId: args.iteration as string,
      title: args.title as string,
      summary: args.summary as string,
      methods: args.methods as string,
      findings: args.finding as string[],
      limitations: args.limitation as string[],
      runIds: args.run as string[],
      artifactIds: args.artifact as string[],
      finalize: args.finalize as boolean,
      actor: { kind: "human", id: member.id, displayName: member.displayName },
      role: member.role,
      signer,
    })
    output(args.format as Format, result, () =>
      prompts.log.success(`${result.analysis.state} analysis ${result.analysis.id}`),
    )
  },
})

const ResearchAnalysisCommand = cmd({
  command: "analysis",
  describe: "record traceable scientific interpretations",
  builder: (yargs) => yargs.command(ResearchAnalysisCreateCommand).demandCommand(),
  async handler() {},
})

const ResearchClaimCreateCommand = cmd({
  command: "create [directory]",
  describe: "record an evidence-backed claim with scope and uncertainty",
  builder: (yargs) =>
    yargs
      .positional("directory", { type: "string", default: process.cwd() })
      .option("iteration", { type: "string", demandOption: true })
      .option("statement", { type: "string", demandOption: true })
      .option("scope", { type: "string", demandOption: true })
      .option("uncertainty", { type: "string", array: true, demandOption: true })
      .option("analysis", { type: "string", array: true, demandOption: true })
      .option("artifact", { type: "string", array: true, default: [] })
      .option("finalize", { type: "boolean", default: false })
      .option("yes", { type: "boolean", default: false })
      .option("format", { choices: ["text", "json"] as const, default: "text" }),
  async handler(args) {
    if (args.finalize && !args.yes) throw new Error("Finalizing a scientific claim requires --yes after human review")
    const { git } = await current(args.directory as string)
    const signer = await identity()
    const member = await ProjectMembership.localMember(git.root, signer.keyId)
    if (!member) throw new Error("The local signing identity is not an active project member")
    const result = await ResearchReviewService.createClaim({
      projectRoot: git.root,
      iterationId: args.iteration as string,
      statement: args.statement as string,
      scope: args.scope as string,
      uncertainties: args.uncertainty as string[],
      analysisIds: args.analysis as string[],
      artifactIds: args.artifact as string[],
      finalize: args.finalize as boolean,
      actor: { kind: "human", id: member.id, displayName: member.displayName },
      role: member.role,
      signer,
    })
    output(args.format as Format, result, () => prompts.log.success(`${result.claim.state} claim ${result.claim.id}`))
  },
})

const ResearchClaimCommand = cmd({
  command: "claim",
  describe: "record scoped evidence-backed claims",
  builder: (yargs) => yargs.command(ResearchClaimCreateCommand).demandCommand(),
  async handler() {},
})

const ResearchReviewTrackCommand = cmd({
  command: "track [directory]",
  describe: "record a signed human review decision for a track",
  builder: (yargs) =>
    yargs
      .positional("directory", { type: "string", default: process.cwd() })
      .option("track", { type: "string", demandOption: true })
      .option("claim", { type: "string", array: true, demandOption: true })
      .option("analysis", { type: "string", array: true, demandOption: true })
      .option("outcome", {
        choices: ["accepted", "not_selected", "inconclusive", "return_for_changes"] as const,
        demandOption: true,
      })
      .option("rationale", { type: "string", demandOption: true })
      .option("yes", { type: "boolean", default: false })
      .option("format", { choices: ["text", "json"] as const, default: "text" }),
  async handler(args) {
    if (!args.yes) throw new Error("Track review requires --yes after human review")
    const { git } = await current(args.directory as string)
    const signer = await identity()
    const member = await ProjectMembership.localMember(git.root, signer.keyId)
    if (!member) throw new Error("The local signing identity is not an active project member")
    const result = await ResearchReviewService.reviewTrack({
      projectRoot: git.root,
      trackId: args.track as string,
      claimIds: args.claim as string[],
      analysisIds: args.analysis as string[],
      outcome: args.outcome as "accepted" | "not_selected" | "inconclusive" | "return_for_changes",
      rationale: args.rationale as string,
      actor: { kind: "human", id: member.id, displayName: member.displayName },
      role: member.role,
      signer,
    })
    output(args.format as Format, result, () =>
      prompts.log.success(`${result.review.outcome} review ${result.review.id}`),
    )
  },
})

const ResearchReviewCommand = cmd({
  command: "review",
  describe: "make explicit human scientific decisions",
  builder: (yargs) => yargs.command(ResearchReviewTrackCommand).demandCommand(),
  async handler() {},
})

const ResearchIntegrateEvidenceCommand = cmd({
  command: "evidence [directory]",
  describe: "integrate reviewed evidence without changing implementation code",
  builder: (yargs) =>
    yargs
      .positional("directory", { type: "string", default: process.cwd() })
      .option("review", { type: "string", demandOption: true })
      .option("yes", { type: "boolean", default: false })
      .option("format", { choices: ["text", "json"] as const, default: "text" }),
  async handler(args) {
    if (!args.yes) throw new Error("Evidence integration requires --yes after human review")
    const { git } = await current(args.directory as string)
    const signer = await identity()
    const member = await ProjectMembership.localMember(git.root, signer.keyId)
    if (!member) throw new Error("The local signing identity is not an active project member")
    const result = await ResearchReviewService.integrateEvidenceOnly({
      projectRoot: git.root,
      reviewId: args.review as string,
      actor: { kind: "human", id: member.id, displayName: member.displayName },
      role: member.role,
      signer,
    })
    output(args.format as Format, result, () =>
      prompts.log.success(`Integrated evidence bundle ${result.integration.id}; source code unchanged`),
    )
  },
})

const ResearchIntegrateCommand = cmd({
  command: "integrate",
  describe: "separate evidence integration from code and foundation decisions",
  builder: (yargs) => yargs.command(ResearchIntegrateEvidenceCommand).demandCommand(),
  async handler() {},
})

export const ResearchCommand = cmd({
  command: "research",
  describe: "manage the local, reproducible scientific workflow",
  builder: (yargs) =>
    yargs
      .command(ResearchInitCommand)
      .command(ResearchVerifyCommand)
      .command(ResearchStatusCommand)
      .command(ResearchTrackCommand)
      .command(ResearchProtocolCommand)
      .command(ResearchEnvironmentCommand)
      .command(ResearchRunCommand)
      .command(ResearchArtifactCommand)
      .command(ResearchAnalysisCommand)
      .command(ResearchClaimCommand)
      .command(ResearchReviewCommand)
      .command(ResearchIntegrateCommand)
      .demandCommand(),
  async handler() {},
})
