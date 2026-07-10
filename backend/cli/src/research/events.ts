import z from "zod"
import { BusEvent } from "../bus/bus-event"
import { ResearchID } from "./domain/id"

const Version = z.literal(1)

export const ResearchEvents = {
  OperationUpdated: BusEvent.define(
    "research.operation.updated",
    z.object({
      version: Version,
      operationId: z.string().min(1),
      projectId: ResearchID.schema("project"),
      state: z.enum(["started", "succeeded", "failed"]),
      kind: z.string().min(1),
      message: z.string().optional(),
    }),
  ),
  TrackUpdated: BusEvent.define(
    "research.track.updated",
    z.object({
      version: Version,
      projectId: ResearchID.schema("project"),
      trackId: ResearchID.schema("track"),
      eventId: ResearchID.schema("event"),
      action: z.enum(["created", "updated", "state_changed", "workspace_bound", "environment_diverged"]),
      replayed: z.boolean(),
    }),
  ),
  IterationUpdated: BusEvent.define(
    "research.iteration.updated",
    z.object({
      version: Version,
      projectId: ResearchID.schema("project"),
      iterationId: ResearchID.schema("iteration"),
      eventId: ResearchID.schema("event"),
      action: z.enum(["created", "protocol_frozen", "state_changed"]),
      replayed: z.boolean(),
    }),
  ),
  RunUpdated: BusEvent.define(
    "research.run.updated",
    z.object({
      version: Version,
      projectId: ResearchID.schema("project"),
      runId: ResearchID.schema("run"),
      eventId: ResearchID.schema("event"),
      state: z.enum(["declared", "queued", "running", "succeeded", "failed", "timed_out", "cancelled", "lost"]),
      replayed: z.boolean(),
    }),
  ),
  ApprovalRequested: BusEvent.define(
    "research.approval.requested",
    z.object({
      version: Version,
      projectId: ResearchID.schema("project"),
      subjectType: z.enum(["protocol", "run", "integration", "foundation", "export"]),
      subjectId: z.string().min(1),
      reason: z.string().min(1),
    }),
  ),
  AuditUpdated: BusEvent.define(
    "research.audit.updated",
    z.object({
      version: Version,
      projectId: ResearchID.schema("project"),
      readOnly: z.boolean(),
      diagnosticCount: z.number().int().nonnegative(),
    }),
  ),
}
