import path from "node:path"
import { readFile, readdir } from "node:fs/promises"
import z from "zod"
import {
  EvidenceIntegration,
  ProtocolRevision,
  ResearchIteration,
  ResearchProject,
  RunAttempt,
  ScientificAnalysis,
  TrackReview,
} from "../domain/schema"
import { ResearchAudit } from "./audit"

export const ResearchWorkflow = z
  .object({
    projectId: z.string(),
    selectedTrackId: z.string(),
    selectedIterationId: z.string().nullable(),
    currentStage: z.enum(["frame", "hypothesize", "plan", "execute", "interpret", "review", "decide"]),
    stages: z.array(
      z
        .object({
          id: z.enum(["frame", "hypothesize", "plan", "execute", "interpret", "review", "decide"]),
          label: z.string(),
          detail: z.string(),
          state: z.enum(["complete", "current", "pending", "blocked"]),
        })
        .strict(),
    ),
    blockers: z.array(z.object({ code: z.string(), message: z.string() }).strict()),
    nextActions: z.array(
      z
        .object({
          id: z.string(),
          label: z.string(),
          section: z.enum(["overview", "tracks", "evidence", "publications", "people"]),
          enabled: z.boolean(),
          reason: z.string().optional(),
        })
        .strict(),
    ),
  })
  .strict()
export type ResearchWorkflow = z.infer<typeof ResearchWorkflow>

async function records<T>(root: string, relative: string, parse: (value: unknown) => T) {
  const directory = path.join(root, relative)
  const names = await readdir(directory).catch(() => [])
  return Promise.all(
    names
      .filter((name) => name.endsWith(".json"))
      .map(async (name) => parse(JSON.parse(await readFile(path.join(directory, name), "utf8")))),
  )
}

export namespace ResearchWorkflowService {
  export async function derive(projectRoot: string): Promise<ResearchWorkflow> {
    const project = ResearchProject.parse(
      JSON.parse(await readFile(path.join(projectRoot, ".openscience/research/project.json"), "utf8")),
    )
    const [audit, scientific, iterations, protocols, runs, analyses, reviews, integrations] = await Promise.all([
      ResearchAudit.inspect(projectRoot),
      ResearchAudit.inspectScientific(projectRoot),
      records(projectRoot, ".openscience/research/iterations", ResearchIteration.parse),
      records(projectRoot, ".openscience/research/projections/protocols", ProtocolRevision.parse),
      records(projectRoot, ".openscience/research/projections/runs", RunAttempt.parse),
      records(projectRoot, ".openscience/research/analyses", ScientificAnalysis.parse),
      records(projectRoot, ".openscience/research/reviews", TrackReview.parse),
      records(projectRoot, ".openscience/research/integrations", EvidenceIntegration.parse),
    ])
    const iteration = [...iterations].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
    const relatedProtocols = protocols.filter((value) => value.iterationId === iteration?.id)
    const frozen = relatedProtocols.some((value) => !!value.frozenAt)
    const relatedRuns = runs.filter((value) => value.iterationId === iteration?.id)
    const executed = relatedRuns.some((value) =>
      ["succeeded", "failed", "timed_out", "cancelled"].includes(value.state),
    )
    const interpreted = analyses.some((value) => value.iterationId === iteration?.id && value.state === "finalized")
    const reviewed = reviews.some((value) => value.trackId === iteration?.trackId)
    const decided = integrations.some((value) => value.sourceTrackId === iteration?.trackId)
    const complete = [true, !!iteration, frozen, executed, interpreted, reviewed, decided]
    const ids = ["frame", "hypothesize", "plan", "execute", "interpret", "review", "decide"] as const
    const labels = ["Frame", "Hypothesize", "Plan", "Execute", "Interpret", "Review", "Decide"]
    const details = [
      "Question and context",
      "Typed iteration",
      "Frozen protocol",
      "Formal run",
      "Analysis and claims",
      "Independent assessment",
      "Integrate, continue, or publish",
    ]
    const current = Math.max(
      0,
      complete.findIndex((value) => !value),
    )
    const blocked = audit.readOnly || !scientific.valid
    const actions = [
      { id: "iteration.create", label: "Define first iteration", section: "tracks" as const },
      { id: "protocol.freeze", label: "Review and freeze protocol", section: "tracks" as const },
      { id: "run.declare", label: "Declare formal run", section: "tracks" as const },
      { id: "analysis.create", label: "Record interpretation", section: "evidence" as const },
      { id: "review.create", label: "Request evidence review", section: "evidence" as const },
      { id: "decision.create", label: "Record scientific decision", section: "evidence" as const },
      { id: "iteration.continue", label: "Begin the next iteration", section: "tracks" as const },
    ]
    const action = actions[Math.min(current - 1 < 0 ? 0 : current - 1, actions.length - 1)]
    return ResearchWorkflow.parse({
      projectId: project.id,
      selectedTrackId: iteration?.trackId ?? project.coreTrackId,
      selectedIterationId: iteration?.id ?? null,
      currentStage: ids[Math.min(current, ids.length - 1)],
      stages: ids.map((id, index) => ({
        id,
        label: labels[index],
        detail: details[index],
        state:
          blocked && index === current
            ? "blocked"
            : complete[index]
              ? "complete"
              : index === current
                ? "current"
                : "pending",
      })),
      blockers: blocked
        ? [...audit.diagnostics, ...scientific.diagnostics].map((value) => ({
            code: value.code,
            message: value.message,
          }))
        : [],
      nextActions: [
        {
          ...action,
          enabled: !blocked,
          ...(blocked ? { reason: "Resolve signed-ledger integrity findings before continuing." } : {}),
        },
      ],
    })
  }
}
