# Project, track, and iteration model

## Entity graph

```text
ResearchProject
 ├─ FoundationRevision*
 ├─ ResearchTrack*
 │   ├─ WorkspaceBinding*
 │   ├─ Iteration*
 │   │   ├─ ProtocolRevision*
 │   │   ├─ Approval*
 │   │   ├─ RunAttempt*
 │   │   ├─ Analysis*
 │   │   └─ Claim*
 │   ├─ TrackReview*
 │   └─ TrackDecision*
 ├─ Member*
 ├─ Publication*
 └─ LedgerEvent*
```

Every durable object has `schemaVersion`, typed ULID, `projectId`, timestamps, actor, canonical hash, and event lineage.

## Boundaries

- New repository: independent primary objective, ownership/governance, or release lifecycle.
- New track: sustained alternative architecture, data strategy, objective, or research plan sharing the project foundation.
- New iteration: a new hypothesis or decision point within the same approach.
- New run: seed, parameter, retry, machine, or execution attempt under the same protocol.

## Tracks

A new project creates a `core` track bound to the primary branch. Tracks transition:

```text
draft → active → review_ready → accepted | not_selected | inconclusive | abandoned | superseded | synthesized
```

Track identity survives branch rename, rebase, worktree removal, merge, and archival. A branch binds to at most one active track; a track may have multiple bindings over time or across collaborators.

## Iterations

Each iteration declares:

- `exploratory`: aim, intended inputs/outputs and decision goal;
- `confirmatory`: hypothesis/null, outcome, controls, exclusions, statistics, stopping and decision rules;
- `replication`: source protocol, faithful elements, deviations and equivalence rules;
- `benchmark`: datasets/splits, baselines, metrics and leakage boundary.

Protocols are immutable after freeze. Amendments create revisions and record whether results had been viewed. Runs bind an exact revision.

## Foundations

A foundation revision binds:

- parent foundation;
- Git commit and code snapshot hash;
- selected model/data artifacts;
- environment snapshot;
- supporting decisions and evidence.

Git merge is not foundation promotion. Promotion is an explicit, signed human decision after reconciling code, evidence, environment, and artifacts.

## Requirements

- `MODEL-001`: stable IDs, never branch names or counters, are authoritative.
- `MODEL-002`: approved decisions are superseded rather than edited.
- `MODEL-003`: synthesis tracks support multiple parent tracks without rewriting lineage.
- `MODEL-004`: a run cannot move to `running` without an intent event.
- `MODEL-005`: a formal run cannot omit protocol revision, environment snapshot, or workspace state.
