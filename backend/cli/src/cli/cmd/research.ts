import path from "node:path"
import * as prompts from "@clack/prompts"
import { cmd } from "./cmd"
import { LocalGit } from "../../research/adapters/git/local"
import { ResearchAudit } from "../../research/application/audit"
import { IdentityPassphraseRequiredError, LocalIdentity } from "../../research/adapters/identity/local"
import { ResearchProjectService } from "../../research/application/project"

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
      .option("conda", { type: "boolean", default: true, describe: "create the project-named Conda environment" }),
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
    prompts.log.success(`OpenScience Research initialized at ${result.root}`)
    prompts.log.info(`Conda environment: ${result.environment.name}`)
    prompts.log.info("The core scientific track is ready; review and commit the scaffold when you choose.")
  },
})

const ResearchVerifyCommand = cmd({
  command: "verify [directory]",
  describe: "verify signatures, hashes, and lineage in the local research ledger",
  builder: (yargs) => yargs.positional("directory", { type: "string", default: process.cwd() }),
  async handler(args) {
    const root = (await LocalGit.inspect(path.resolve(args.directory as string))).root
    const ledger = await ResearchAudit.inspect(root)
    if (!ledger.readOnly) {
      prompts.log.success(`Verified ${ledger.events.length} signed research events`)
      return
    }
    for (const diagnostic of ledger.diagnostics) prompts.log.error(`${diagnostic.code}: ${diagnostic.file}`)
    process.exitCode = 2
  },
})

export const ResearchCommand = cmd({
  command: "research",
  describe: "manage the local, reproducible scientific workflow",
  builder: (yargs) => yargs.command(ResearchInitCommand).command(ResearchVerifyCommand).demandCommand(),
  async handler() {},
})
