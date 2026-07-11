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

export const WorkspaceSnapshot = z
  .object({
    kind: z.literal("git"),
    branch: z.string().min(1),
    commit: z
      .string()
      .regex(/^[0-9a-f]{40,64}$/)
      .nullable(),
    dirty: z.boolean(),
    statusHash: Hash,
    trackedFilesHash: Hash,
    untrackedFilesHash: Hash,
    captureConfidence: z.enum(["complete", "best_effort"]),
  })
  .strict()
export type WorkspaceSnapshot = z.infer<typeof WorkspaceSnapshot>

export const EnvironmentSnapshot = z
  .object({
    kind: z.literal("conda"),
    name: z.string().min(1),
    portableSpecPath: z.string().min(1),
    portableSpecHash: Hash,
    resolvedSpecPath: z.string().min(1),
    resolvedSpecHash: Hash,
    platform: z.string().min(1),
    captureConfidence: z.enum(["complete", "credential_redacted"]),
  })
  .strict()
export type EnvironmentSnapshot = z.infer<typeof EnvironmentSnapshot>

export const NotebookRun = z
  .object({
    sourcePath: z.string().min(1),
    sourceHash: Hash,
    originalPath: z.string().min(1),
    executedPath: z.string().min(1),
    executedHash: Hash.nullable(),
    allowErrors: z.boolean(),
  })
  .strict()
export type NotebookRun = z.infer<typeof NotebookRun>

export const ArtifactRole = z.enum([
  "input",
  "output",
  "dataset",
  "model",
  "figure",
  "table",
  "notebook",
  "log",
  "other",
])

export const RunAttempt = RecordBase.extend({
  id: ResearchID.schema("run"),
  iterationId: ResearchID.schema("iteration"),
  protocolId: ResearchID.schema("protocol"),
  intentEventId: ResearchID.schema("event"),
  workspaceStateHash: Hash,
  environmentHash: Hash,
  workspace: WorkspaceSnapshot,
  environment: EnvironmentSnapshot,
  kind: z.enum(["command", "notebook"]).default("command"),
  notebook: NotebookRun.nullable().default(null),
  parameters: Json,
  seed: z.number().int().optional(),
  execution: z
    .object({
      command: z.string().min(1),
      args: z.array(z.string()),
      cwd: z.string().min(1),
      timeoutMs: z.number().int().positive(),
      environmentKeys: z.array(z.string()),
      outputs: z
        .array(
          z
            .object({
              path: z.string().min(1),
              role: ArtifactRole,
              mediaType: z.string().min(1),
            })
            .strict(),
        )
        .default([]),
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

export const ArtifactManifest = RecordBase.extend({
  id: ResearchID.schema("artifact"),
  iterationId: ResearchID.schema("iteration"),
  runId: ResearchID.schema("run").nullable(),
  path: z.string().min(1),
  role: ArtifactRole,
  mediaType: z.string().min(1),
  byteLength: z.number().int().nonnegative(),
  contentHash: Hash,
  captureConfidence: z.enum(["complete", "best_effort"]),
}).strict()
export type ArtifactManifest = z.infer<typeof ArtifactManifest>

export const ScientificAnalysis = RecordBase.extend({
  id: ResearchID.schema("analysis"),
  iterationId: ResearchID.schema("iteration"),
  title: z.string().min(1).max(300),
  summary: z.string().min(1).max(24000),
  methods: z.string().min(1).max(24000),
  findings: z.array(z.string().min(1).max(8000)).min(1),
  limitations: z.array(z.string().min(1).max(8000)).min(1),
  runIds: z.array(ResearchID.schema("run")),
  artifactIds: z.array(ResearchID.schema("artifact")),
  state: z.enum(["draft", "finalized"]),
  finalizedAt: Timestamp.nullable(),
}).strict()
export type ScientificAnalysis = z.infer<typeof ScientificAnalysis>

export const ScientificClaim = RecordBase.extend({
  id: ResearchID.schema("claim"),
  iterationId: ResearchID.schema("iteration"),
  statement: z.string().min(1).max(12000),
  scope: z.string().min(1).max(8000),
  uncertainties: z.array(z.string().min(1).max(8000)).min(1),
  analysisIds: z.array(ResearchID.schema("analysis")).min(1),
  artifactIds: z.array(ResearchID.schema("artifact")),
  state: z.enum(["draft", "finalized", "superseded"]),
  finalizedAt: Timestamp.nullable(),
}).strict()
export type ScientificClaim = z.infer<typeof ScientificClaim>

export const TrackReview = RecordBase.extend({
  id: ResearchID.schema("review"),
  trackId: ResearchID.schema("track"),
  claimIds: z.array(ResearchID.schema("claim")).min(1),
  analysisIds: z.array(ResearchID.schema("analysis")).min(1),
  outcome: z.enum(["accepted", "not_selected", "inconclusive", "return_for_changes"]),
  rationale: z.string().min(1).max(24000),
  reviewedAt: Timestamp,
}).strict()
export type TrackReview = z.infer<typeof TrackReview>

export const EvidenceIntegration = RecordBase.extend({
  id: ResearchID.schema("integration"),
  sourceTrackId: ResearchID.schema("track"),
  reviewId: ResearchID.schema("review"),
  mode: z.literal("evidence_only"),
  sourceBranch: z.string().min(1),
  sourceCommit: z
    .string()
    .regex(/^[0-9a-f]{40,64}$/)
    .nullable(),
  baseFoundationId: ResearchID.schema("foundation").nullable(),
  claimIds: z.array(ResearchID.schema("claim")),
  analysisIds: z.array(ResearchID.schema("analysis")),
  artifactIds: z.array(ResearchID.schema("artifact")),
  supportingEventIds: z.array(ResearchID.schema("event")),
  bundleHash: Hash,
}).strict()
export type EvidenceIntegration = z.infer<typeof EvidenceIntegration>

export const CodeMergeProposal = RecordBase.extend({
  id: ResearchID.schema("codeProposal"),
  evidenceIntegrationId: ResearchID.schema("integration"),
  sourceTrackId: ResearchID.schema("track"),
  sourceBranch: z.string().min(1),
  sourceCommit: z.string().regex(/^[0-9a-f]{40,64}$/),
  targetBranch: z.string().min(1),
  targetCommit: z.string().regex(/^[0-9a-f]{40,64}$/),
  diffHash: Hash,
  state: z.literal("proposed"),
  instructions: z.string().min(1).max(8000),
}).strict()
export type CodeMergeProposal = z.infer<typeof CodeMergeProposal>

export const ResearchPublication = RecordBase.extend({
  id: ResearchID.schema("publication"),
  title: z.string().min(1).max(500),
  abstract: z.string().min(1).max(24000),
  claimIds: z.array(ResearchID.schema("claim")).min(1),
  artifactIds: z.array(ResearchID.schema("artifact")),
  supportState: z.enum(["approved", "unresolved"]),
  state: z.enum(["draft", "approved"]),
  aiUseStatement: z.string().min(1).max(12000),
  contributionStatement: z.string().min(1).max(12000),
  approvedAt: Timestamp.nullable(),
}).strict()
export type ResearchPublication = z.infer<typeof ResearchPublication>

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

export const TrackEnvironment = RecordBase.extend({
  trackId: ResearchID.schema("track"),
  kind: z.literal("conda"),
  name: z.string().min(1),
  portableSpecPath: z.string().min(1),
  portableSpecHash: Hash,
  state: z.enum(["base", "inherited", "diverged"]),
  inheritedFromTrackId: ResearchID.schema("track").nullable(),
}).strict()
export type TrackEnvironment = z.infer<typeof TrackEnvironment>

export const MemberRole = z.enum(["owner", "researcher", "reviewer", "viewer"])

export const ProjectMember = RecordBase.extend({
  id: ResearchID.schema("member"),
  actorId: z.string().min(1).optional(),
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
  environmentSpecPath: z.string().min(1),
  artifactIds: z.array(ResearchID.schema("artifact")),
  integrationIds: z.array(ResearchID.schema("integration")).min(1),
  supportingEventIds: z.array(ResearchID.schema("event")),
  promotedByEventId: ResearchID.schema("event"),
}).strict()
export type FoundationRevision = z.infer<typeof FoundationRevision>
