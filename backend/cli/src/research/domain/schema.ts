import z from "zod"
import { ResearchID } from "./id"

export const Json = z.json()
export const Timestamp = z.string().datetime({ offset: true })
export const Hash = z.string().regex(/^[0-9a-f]{64}$/)

export const Actor = z
  .object({
    kind: z.enum(["human", "agent", "system"]),
    id: z.string().min(1),
    displayName: z.string().min(1),
    delegationId: z.string().min(1).optional(),
  })
  .strict()
export type Actor = z.infer<typeof Actor>

const RecordBase = z
  .object({
    schemaVersion: z.literal(1),
    projectId: ResearchID.schema("project"),
    createdAt: Timestamp,
    createdBy: Actor,
  })
  .strict()

export const ResearchProject = RecordBase.extend({
  id: ResearchID.schema("project"),
  name: z.string().min(1).max(120),
  description: z.string().max(4000).default(""),
  defaultEnvironment: z.object({ kind: z.literal("conda"), name: z.string().min(1) }).strict(),
  coreTrackId: ResearchID.schema("track"),
  activeFoundationId: ResearchID.schema("foundation").nullable(),
}).strict()
export type ResearchProject = z.infer<typeof ResearchProject>

export const TrackState = z.enum([
  "draft",
  "active",
  "review_ready",
  "accepted",
  "not_selected",
  "inconclusive",
  "abandoned",
  "superseded",
  "synthesized",
])

export const ResearchTrack = RecordBase.extend({
  id: ResearchID.schema("track"),
  alias: z.string().min(1).max(80),
  title: z.string().min(1).max(200),
  objective: z.string().min(1).max(8000),
  state: TrackState,
  hidden: z.boolean().default(false),
  parentTrackIds: z.array(ResearchID.schema("track")),
  supersedesTrackId: ResearchID.schema("track").optional(),
}).strict()
export type ResearchTrack = z.infer<typeof ResearchTrack>

export const IterationMode = z.enum(["exploratory", "confirmatory", "replication", "benchmark"])

export const ProtocolContent = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("exploratory"),
      aim: z.string().min(1),
      intendedInputs: z.array(z.string().min(1)).min(1),
      intendedOutputs: z.array(z.string().min(1)).min(1),
      decisionGoal: z.string().min(1),
    })
    .strict(),
  z
    .object({
      mode: z.literal("confirmatory"),
      hypothesis: z.string().min(1),
      nullHypothesis: z.string().min(1),
      primaryOutcome: z.string().min(1),
      controls: z.array(z.string().min(1)).min(1),
      exclusions: z.array(z.string().min(1)),
      statisticalMethod: z.string().min(1),
      stoppingRule: z.string().min(1),
      decisionRule: z.string().min(1),
    })
    .strict(),
  z
    .object({
      mode: z.literal("replication"),
      sourceProtocol: z.string().min(1),
      faithfulElements: z.array(z.string().min(1)).min(1),
      deviations: z.array(z.string().min(1)),
      equivalenceRule: z.string().min(1),
    })
    .strict(),
  z
    .object({
      mode: z.literal("benchmark"),
      datasetsAndSplits: z.array(z.string().min(1)).min(1),
      baselines: z.array(z.string().min(1)).min(1),
      metrics: z.array(z.string().min(1)).min(1),
      leakageBoundary: z.string().min(1),
    })
    .strict(),
])
export type ProtocolContent = z.infer<typeof ProtocolContent>

export const ResearchIteration = RecordBase.extend({
  id: ResearchID.schema("iteration"),
  trackId: ResearchID.schema("track"),
  alias: z.string().min(1).max(80),
  title: z.string().min(1).max(200),
  mode: IterationMode,
  question: z.string().min(1).max(12000),
  decisionGoal: z.string().min(1).max(8000),
  state: z.enum(["draft", "protocol_ready", "approved", "running", "analysis", "complete", "cancelled"]),
}).strict()
export type ResearchIteration = z.infer<typeof ResearchIteration>

export const ProtocolRevision = RecordBase.extend({
  id: ResearchID.schema("protocol"),
  iterationId: ResearchID.schema("iteration"),
  revision: z.number().int().positive(),
  mode: IterationMode,
  content: ProtocolContent,
  frozenAt: Timestamp.nullable(),
  resultsViewedBeforeAmendment: z.boolean(),
  supersedesProtocolId: ResearchID.schema("protocol").optional(),
}).strict()
export type ProtocolRevision = z.infer<typeof ProtocolRevision>

export const RunAttempt = RecordBase.extend({
  id: ResearchID.schema("run"),
  iterationId: ResearchID.schema("iteration"),
  protocolId: ResearchID.schema("protocol"),
  intentEventId: ResearchID.schema("event"),
  workspaceStateHash: Hash,
  environmentHash: Hash,
  parameters: Json,
  seed: z.number().int().optional(),
  execution: z
    .object({
      command: z.string().min(1),
      args: z.array(z.string()),
      cwd: z.string().min(1),
      timeoutMs: z.number().int().positive(),
      environmentKeys: z.array(z.string()),
    })
    .strict(),
  state: z.enum(["declared", "queued", "running", "succeeded", "failed", "timed_out", "cancelled", "lost"]),
  result: z
    .object({
      outcome: z.enum(["succeeded", "failed", "timed_out", "cancelled", "lost"]),
      exitCode: z.number().int().nullable(),
      signal: z.string().nullable(),
      stdoutHash: Hash,
      stderrHash: Hash,
      stdoutPath: z.string().min(1),
      stderrPath: z.string().min(1),
      startedAt: Timestamp,
      finishedAt: Timestamp,
      durationMs: z.number().int().nonnegative(),
      error: z.string().optional(),
    })
    .strict()
    .optional(),
}).strict()
export type RunAttempt = z.infer<typeof RunAttempt>

export const WorkspaceBinding = RecordBase.extend({
  id: ResearchID.schema("workspace"),
  trackId: ResearchID.schema("track"),
  repositoryRoot: z.string().min(1),
  worktreePath: z.string().min(1),
  branch: z.string().min(1),
  boundAtCommit: z
    .string()
    .regex(/^[0-9a-f]{40,64}$/)
    .nullable(),
  active: z.boolean(),
}).strict()
export type WorkspaceBinding = z.infer<typeof WorkspaceBinding>

export const MemberRole = z.enum(["owner", "researcher", "reviewer", "viewer"])

export const ProjectMember = RecordBase.extend({
  id: ResearchID.schema("member"),
  displayName: z.string().min(1).max(200),
  email: z.string().email().optional(),
  gitName: z.string().min(1).optional(),
  gitEmail: z.string().email().optional(),
  role: MemberRole,
  signingKeyId: z.string().startsWith("sha256:"),
  active: z.boolean(),
}).strict()
export type ProjectMember = z.infer<typeof ProjectMember>

export const FoundationRevision = RecordBase.extend({
  id: ResearchID.schema("foundation"),
  parentFoundationId: ResearchID.schema("foundation").nullable(),
  gitCommit: z.string().regex(/^[0-9a-f]{40,64}$/),
  codeSnapshotHash: Hash,
  environmentHash: Hash,
  artifactIds: z.array(ResearchID.schema("artifact")),
  supportingEventIds: z.array(ResearchID.schema("event")),
  promotedByEventId: ResearchID.schema("event"),
}).strict()
export type FoundationRevision = z.infer<typeof FoundationRevision>
