# API, events, and UI integration

## Domain boundary

Add `backend/cli/src/research/{domain,application,ports,adapters}`. Domain code imports no filesystem, HTTP, UI, Atlas, `Instance`, `Global`, or process implementation. Routes, CLI, tools, and frontend contain no scientific business rules.

## Public routes

```text
/research/project
/research/foundations
/research/tracks
/research/workspaces
/research/iterations
/research/protocols
/research/approvals
/research/runs
/research/integrations
/research/members
/research/publications
/research/audits
/research/exports
/research/adoption
```

Zod is the source for OpenAPI, generated SDK types, editor schema and CLI JSON. Mutations accept idempotency keys. Errors contain stable `code`, plain-language `message`, `remediation`, and structured `details`.

## Events

Reuse the global SSE bus with versioned payloads:

```text
research.operation.updated
research.track.updated
research.workspace.updated
research.iteration.updated
research.run.updated
research.approval.requested
research.integration.updated
research.foundation.updated
research.audit.updated
```

## CLI and agent parity

All transports invoke the application service. CLI commands live under `openscience research ...`, support `--format=json`, and share stable exit-code classes. The GUI never shells out to the CLI.

## UI state

Use Solid stores for project/track/run state. Operations are addressed by stable IDs and rehydrate after restart. Loading, empty, degraded and error are distinct states. Raw terminal/log content is virtualized and disclosed progressively.

## Requirements

- `API-001`: API, CLI, SDK and agent tool return equivalent domain results.
- `API-002`: retrying a mutation with one idempotency key cannot duplicate an event or run.
- `API-003`: SSE names and payload versions are public compatibility contracts.
- `UI-001`: frontend components cannot mutate canonical research files directly.
