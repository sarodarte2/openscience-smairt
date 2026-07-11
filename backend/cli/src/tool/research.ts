import path from "node:path"
import { readFile } from "node:fs/promises"
import z from "zod"
import { Tool } from "./tool"
import { Instance } from "../project/instance"
import { ResearchAudit } from "../research/application/audit"
import { ProjectMembership } from "../research/application/membership"
import { ResearchTrackService } from "../research/application/track"
import { InvestigationService } from "../research/application/investigation"
import { ResearchRunService } from "../research/application/run"
import { ResearchEnvironmentService } from "../research/application/environment"
import { ResearchEvidenceService } from "../research/application/evidence"
import { ResearchReviewService } from "../research/application/review"
import { ResearchFoundationService } from "../research/application/foundation"
import { ResearchCapability } from "../research/domain/governance"
import { Json, ProtocolContent, ResearchProject } from "../research/domain/schema"
import { LocalIdentity } from "../research/adapters/identity/local"
import { Bus } from "../bus"
import { ResearchEvents } from "../research/events"

async function project() {
  return ResearchProject.parse(
    JSON.parse(await readFile(path.join(Instance.directory, ".openscience/research/project.json"), "utf8")),
  )
}

export const ResearchContextTool = Tool.define("research_context", {
  description: [
    "Read the authoritative OpenScience Research context for this repository.",
    "Use before scientific planning or mutation to bind work to stable project, track, and iteration IDs.",
    "This verifies ledger signatures and membership trust; it never changes project state.",
  ].join(" "),
  parameters: z.object({}),
  async execute() {
    const [
      currentProject,
      tracks,
      currentIterations,
      protocols,
      runs,
      environments,
      artifacts,
      analyses,
      claims,
      reviews,
      integrations,
      foundations,
      audit,
    ] = await Promise.all([
      project(),
      ResearchTrackService.list(Instance.directory),
      InvestigationService.listIterations(Instance.directory),
      InvestigationService.listProtocols(Instance.directory),
      ResearchRunService.list(Instance.directory),
      ResearchEnvironmentService.list(Instance.directory),
      ResearchEvidenceService.listArtifacts(Instance.directory),
      ResearchEvidenceService.listAnalyses(Instance.directory),
      ResearchReviewService.listClaims(Instance.directory),
      ResearchReviewService.listReviews(Instance.directory),
      ResearchReviewService.listIntegrations(Instance.directory),
      ResearchFoundationService.list(Instance.directory),
      ResearchAudit.inspect(Instance.directory),
    ])
    const visible = tracks.filter((track) => !track.hidden)
    return {
      title: `Research context: ${currentProject.name}`,
      output: JSON.stringify(
        {
          project: currentProject,
          tracks: visible,
          iterations: currentIterations,
          protocols,
          runs,
          environments,
          artifacts,
          analyses,
          claims,
          reviews,
          integrations,
          foundations,
          integrity: { readOnly: audit.readOnly, diagnostics: audit.diagnostics },
        },
        null,
        2,
      ),
      metadata: {
        projectId: currentProject.id,
        trackCount: visible.length,
        iterationCount: currentIterations.length,
        protocolCount: protocols.length,
        runCount: runs.length,
        environmentCount: environments.length,
        artifactCount: artifacts.length,
        analysisCount: analyses.length,
        claimCount: claims.length,
        foundationCount: foundations.length,
        readOnly: audit.readOnly,
      },
    }
  },
})

export const ResearchCreateTrackTool = Tool.define("research_create_track", {
  description: [
    "Request creation of a first-class scientific track for a sustained alternative approach.",
    "Do not use for parameter changes, seeds, retries, or a single experiment; those are iterations or runs.",
    "Requires user permission and creates no Git branch or worktree. Reuse idempotency_key when retrying.",
  ].join(" "),
  parameters: z.object({
    title: z.string().min(1).max(200),
    objective: z.string().min(1).max(8000),
    alias: z.string().max(80).optional(),
    parent_track_ids: z.array(z.string()).optional(),
    idempotency_key: z.string().min(8).max(200),
  }),
  async execute(params, ctx) {
    const [currentProject, signer] = await Promise.all([project(), LocalIdentity.loadOrCreate()])
    const member = await ProjectMembership.localMember(Instance.directory, signer.keyId)
    if (!member) throw new Error("The local signing identity is not an active project member")
    await ctx.ask({
      permission: "research_track_create",
      patterns: [currentProject.id],
      always: [currentProject.id],
      metadata: { title: params.title, objective: params.objective },
    })
    const actor = {
      kind: "agent" as const,
      id: `agent:${ctx.agent}`,
      displayName: ctx.agent,
      delegationId: `tool:${ctx.callID ?? params.idempotency_key}`,
    }
    const result = await ResearchTrackService.create({
      projectRoot: Instance.directory,
      title: params.title,
      objective: params.objective,
      alias: params.alias,
      parentTrackIds: params.parent_track_ids,
      workspace: { kind: "none" },
      actor,
      role: member.role,
      delegatedCapabilities: [ResearchCapability.trackCreate],
      signer,
      idempotencyKey: params.idempotency_key,
    })
    await Bus.publish(ResearchEvents.TrackUpdated, {
      version: 1,
      projectId: currentProject.id,
      trackId: result.track.id,
      eventId: result.eventId,
      action: "created",
      replayed: result.replayed,
    })
    return {
      title: `${result.replayed ? "Reused" : "Created"} track: ${result.track.title}`,
      output: JSON.stringify(result, null, 2),
      metadata: { trackId: result.track.id, eventId: result.eventId, replayed: result.replayed },
    }
  },
})

export const ResearchCreateIterationTool = Tool.define("research_create_iteration", {
  description: [
    "Draft a scientific iteration and its mode-specific protocol inside an existing track.",
    "Use exploratory mode to learn what to test; use confirmatory, replication, or benchmark only when their required controls are known.",
    "This tool cannot freeze or approve the protocol. Reuse idempotency_key when retrying.",
  ].join(" "),
  parameters: z.object({
    track_id: z.string().min(1),
    title: z.string().min(1).max(200),
    question: z.string().min(1).max(12000),
    decision_goal: z.string().min(1).max(8000),
    alias: z.string().max(80).optional(),
    content: ProtocolContent,
    idempotency_key: z.string().min(8).max(200),
  }),
  async execute(params, ctx) {
    const [currentProject, signer] = await Promise.all([project(), LocalIdentity.loadOrCreate()])
    const member = await ProjectMembership.localMember(Instance.directory, signer.keyId)
    if (!member) throw new Error("The local signing identity is not an active project member")
    await ctx.ask({
      permission: "research_iteration_create",
      patterns: [currentProject.id, params.track_id],
      always: [currentProject.id, params.track_id],
      metadata: { title: params.title, mode: params.content.mode, question: params.question },
    })
    const actor = {
      kind: "agent" as const,
      id: `agent:${ctx.agent}`,
      displayName: ctx.agent,
      delegationId: `tool:${ctx.callID ?? params.idempotency_key}`,
    }
    const result = await InvestigationService.createIteration({
      projectRoot: Instance.directory,
      trackId: params.track_id,
      title: params.title,
      question: params.question,
      decisionGoal: params.decision_goal,
      alias: params.alias,
      content: params.content,
      actor,
      role: member.role,
      delegatedCapabilities: [ResearchCapability.iterationCreate, ResearchCapability.protocolEdit],
      signer,
      idempotencyKey: params.idempotency_key,
    })
    await Bus.publish(ResearchEvents.IterationUpdated, {
      version: 1,
      projectId: currentProject.id,
      iterationId: result.iteration.id,
      eventId: result.eventId,
      action: "created",
      replayed: result.replayed,
    })
    return {
      title: `${result.replayed ? "Reused" : "Created"} iteration: ${result.iteration.title}`,
      output: JSON.stringify(result, null, 2),
      metadata: {
        iterationId: result.iteration.id,
        protocolId: result.protocol.id,
        eventId: result.eventId,
        replayed: result.replayed,
      },
    }
  },
})

export const ResearchDeclareRunTool = Tool.define("research_declare_run", {
  description: [
    "Declare one formal computational run under an already frozen protocol.",
    "Captures the Git workspace and resolved project Conda environment, records exact argv, and signs intent without executing it.",
    "Use a new idempotency_key for a new seed, parameter set, retry, or execution attempt.",
  ].join(" "),
  parameters: z.object({
    protocol_id: z.string().min(1),
    command: z.string().min(1).max(4000),
    args: z.array(z.string().max(12000)).max(1000).default([]),
    parameters: z.unknown().default({}),
    seed: z.number().int().optional(),
    timeout_ms: z
      .number()
      .int()
      .min(100)
      .max(7 * 24 * 60 * 60 * 1000)
      .default(60 * 60 * 1000),
    environment_keys: z
      .array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/))
      .max(64)
      .default([]),
    idempotency_key: z.string().min(8).max(200),
  }),
  async execute(params, ctx) {
    const [currentProject, signer] = await Promise.all([project(), LocalIdentity.loadOrCreate()])
    const member = await ProjectMembership.localMember(Instance.directory, signer.keyId)
    if (!member) throw new Error("The local signing identity is not an active project member")
    await ctx.ask({
      permission: "research_run_declare",
      patterns: [currentProject.id, params.protocol_id],
      always: [currentProject.id, params.protocol_id],
      metadata: { command: params.command, args: params.args, seed: params.seed },
    })
    const result = await ResearchRunService.declare({
      projectRoot: Instance.directory,
      protocolId: params.protocol_id,
      parameters: Json.parse(params.parameters),
      seed: params.seed,
      execution: {
        command: params.command,
        args: params.args,
        cwd: Instance.directory,
        timeoutMs: params.timeout_ms,
        environmentKeys: params.environment_keys,
      },
      actor: {
        kind: "agent",
        id: `agent:${ctx.agent}`,
        displayName: ctx.agent,
        delegationId: `tool:${ctx.callID ?? params.idempotency_key}`,
      },
      role: member.role,
      delegatedCapabilities: [ResearchCapability.runExecute],
      signer,
      idempotencyKey: params.idempotency_key,
    })
    await Bus.publish(ResearchEvents.RunUpdated, {
      version: 1,
      projectId: currentProject.id,
      runId: result.run.id,
      eventId: result.eventId,
      state: result.run.state,
      replayed: result.replayed,
    })
    return {
      title: `${result.replayed ? "Reused" : "Declared"} formal run ${result.run.id}`,
      output: JSON.stringify(result, null, 2),
      metadata: { runId: result.run.id, eventId: result.eventId, replayed: result.replayed },
    }
  },
})

export const ResearchExecuteRunTool = Tool.define("research_execute_run", {
  description: [
    "Execute one previously declared formal run through the controlled Conda runner.",
    "Requires explicit user permission, never invokes a shell, and will not automatically re-execute an uncertain or completed attempt.",
  ].join(" "),
  parameters: z.object({ run_id: z.string().min(1) }),
  async execute(params, ctx) {
    const [currentProject, signer] = await Promise.all([project(), LocalIdentity.loadOrCreate()])
    const member = await ProjectMembership.localMember(Instance.directory, signer.keyId)
    if (!member) throw new Error("The local signing identity is not an active project member")
    await ctx.ask({
      permission: "research_run_execute",
      patterns: [currentProject.id, params.run_id],
      always: [currentProject.id, params.run_id],
      metadata: { runId: params.run_id },
    })
    const result = await ResearchRunService.execute({
      projectRoot: Instance.directory,
      runId: params.run_id,
      actor: {
        kind: "agent",
        id: `agent:${ctx.agent}`,
        displayName: ctx.agent,
        delegationId: `tool:${ctx.callID ?? params.run_id}`,
      },
      role: member.role,
      delegatedCapabilities: [ResearchCapability.runExecute],
      signer,
      signal: ctx.abort,
    })
    await Bus.publish(ResearchEvents.RunUpdated, {
      version: 1,
      projectId: currentProject.id,
      runId: result.run.id,
      eventId: result.eventId,
      state: result.run.state,
      replayed: result.replayed,
    })
    return {
      title: `${result.replayed ? "Reused" : "Recorded"} ${result.run.state} run ${result.run.id}`,
      output: JSON.stringify(result, null, 2),
      metadata: { runId: result.run.id, eventId: result.eventId, state: result.run.state, replayed: result.replayed },
    }
  },
})

export const ResearchDeclareNotebookTool = Tool.define("research_declare_notebook", {
  description: [
    "Declare a saved project notebook for formal clean-kernel execution under a frozen protocol.",
    "The original notebook is hashed now; execution later preserves original and executed copies and cannot reuse interactive kernel state.",
  ].join(" "),
  parameters: z.object({
    protocol_id: z.string().min(1),
    notebook_path: z.string().min(1).max(8000),
    parameters: z.unknown().default({}),
    seed: z.number().int().optional(),
    timeout_ms: z
      .number()
      .int()
      .min(1000)
      .max(7 * 24 * 60 * 60 * 1000)
      .default(60 * 60 * 1000),
    allow_errors: z.boolean().default(false),
    environment_keys: z
      .array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/))
      .max(64)
      .default([]),
    idempotency_key: z.string().min(8).max(200),
  }),
  async execute(params, ctx) {
    const [currentProject, signer] = await Promise.all([project(), LocalIdentity.loadOrCreate()])
    const member = await ProjectMembership.localMember(Instance.directory, signer.keyId)
    if (!member) throw new Error("The local signing identity is not an active project member")
    await ctx.ask({
      permission: "research_run_declare",
      patterns: [currentProject.id, params.protocol_id, params.notebook_path],
      always: [currentProject.id, params.protocol_id],
      metadata: { notebookPath: params.notebook_path, seed: params.seed, allowErrors: params.allow_errors },
    })
    const result = await ResearchRunService.declareNotebook({
      projectRoot: Instance.directory,
      protocolId: params.protocol_id,
      notebookPath: params.notebook_path,
      parameters: Json.parse(params.parameters),
      seed: params.seed,
      timeoutMs: params.timeout_ms,
      allowErrors: params.allow_errors,
      environmentKeys: params.environment_keys,
      actor: {
        kind: "agent",
        id: `agent:${ctx.agent}`,
        displayName: ctx.agent,
        delegationId: `tool:${ctx.callID ?? params.idempotency_key}`,
      },
      role: member.role,
      delegatedCapabilities: [ResearchCapability.runExecute],
      signer,
      idempotencyKey: params.idempotency_key,
    })
    await Bus.publish(ResearchEvents.RunUpdated, {
      version: 1,
      projectId: currentProject.id,
      runId: result.run.id,
      eventId: result.eventId,
      state: result.run.state,
      replayed: result.replayed,
    })
    return {
      title: `${result.replayed ? "Reused" : "Declared"} notebook run ${result.run.id}`,
      output: JSON.stringify(result, null, 2),
      metadata: { runId: result.run.id, eventId: result.eventId, replayed: result.replayed },
    }
  },
})

export const ResearchTools = [
  ResearchContextTool,
  ResearchCreateTrackTool,
  ResearchCreateIterationTool,
  ResearchDeclareRunTool,
  ResearchDeclareNotebookTool,
  ResearchExecuteRunTool,
]
export const RESEARCH_TOOL_IDS = new Set(ResearchTools.map((tool) => tool.id))
