import path from "node:path"
import { mkdir, open, readFile, readdir, rename } from "node:fs/promises"
import { LocalGit } from "../adapters/git/local"
import { FilesystemLedger } from "../adapters/ledger/filesystem"
import { Canonical, type JsonValue } from "../domain/canonical"
import { Governance, ResearchCapability, type ResearchRole } from "../domain/governance"
import { ResearchID } from "../domain/id"
import { CodeMergeProposal, EvidenceIntegration, ResearchProject, type Actor } from "../domain/schema"
import type { Signer } from "../domain/signature"
import { ResearchAudit } from "./audit"

type Authorization = { actor: Actor; role?: ResearchRole; delegatedCapabilities?: ResearchCapability[]; signer: Signer }

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

export namespace ResearchIntegrationService {
  export async function listCodeProposals(projectRoot: string) {
    const git = await LocalGit.inspect(projectRoot)
    const directory = path.join(git.root, ".openscience/research/integrations/code-proposals")
    const names = await readdir(directory).catch(() => [])
    return Promise.all(
      names
        .filter((name) => name.endsWith(".json"))
        .map(async (name) => CodeMergeProposal.parse(JSON.parse(await readFile(path.join(directory, name), "utf8")))),
    )
  }

  export async function proposeCodeMerge(
    input: Authorization & {
      projectRoot: string
      evidenceIntegrationId: string
      sourceCommit: string
      targetBranch: string
      targetCommit: string
      idempotencyKey?: string
    },
  ) {
    Governance.authorize(input, ResearchCapability.codeMergePropose)
    const git = await LocalGit.inspect(input.projectRoot)
    await ResearchAudit.assertWritable(git.root)
    const project = ResearchProject.parse(
      JSON.parse(await readFile(path.join(git.root, ".openscience/research/project.json"), "utf8")),
    )
    const integration = EvidenceIntegration.parse(
      JSON.parse(
        await readFile(
          path.join(git.root, `.openscience/research/integrations/${input.evidenceIntegrationId}.json`),
          "utf8",
        ),
      ),
    )
    if (integration.projectId !== project.id) throw new Error("Evidence integration belongs to another project")
    const diffHash = await LocalGit.diffHash(git.root, input.targetCommit, input.sourceCommit)
    const request: JsonValue = {
      actorId: input.actor.id,
      evidenceIntegrationId: input.evidenceIntegrationId,
      sourceCommit: input.sourceCommit,
      targetBranch: input.targetBranch,
      targetCommit: input.targetCommit,
      diffHash,
    }
    const now = new Date().toISOString()
    const proposal = CodeMergeProposal.parse({
      schemaVersion: 1,
      id: ResearchID.create("codeProposal"),
      projectId: project.id,
      evidenceIntegrationId: integration.id,
      sourceTrackId: integration.sourceTrackId,
      sourceBranch: integration.sourceBranch,
      sourceCommit: input.sourceCommit,
      targetBranch: input.targetBranch,
      targetCommit: input.targetCommit,
      diffHash,
      state: "proposed",
      instructions: `Review the exact diff ${input.targetCommit}..${input.sourceCommit} and merge with normal Git tooling. This proposal does not merge code or promote a foundation.`,
      createdAt: now,
      createdBy: input.actor,
    })
    const appended = input.idempotencyKey
      ? await FilesystemLedger.appendIdempotent({
          projectRoot: git.root,
          projectId: project.id,
          type: "code.merge_proposed",
          actor: input.actor,
          payload: { proposal },
          signer: input.signer,
          occurredAt: now,
          key: input.idempotencyKey,
          request,
        })
      : {
          event: await FilesystemLedger.append({
            projectRoot: git.root,
            projectId: project.id,
            type: "code.merge_proposed",
            actor: input.actor,
            payload: { proposal },
            signer: input.signer,
            occurredAt: now,
          }),
          replayed: false,
        }
    const value = appended.replayed
      ? CodeMergeProposal.parse((appended.event.payload as Record<string, unknown>).proposal)
      : proposal
    await atomic(
      path.join(git.root, `.openscience/research/integrations/code-proposals/${value.id}.json`),
      value as JsonValue,
    )
    return { proposal: value, eventId: appended.event.eventId, replayed: appended.replayed }
  }
}
