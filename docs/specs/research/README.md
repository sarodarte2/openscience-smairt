# OpenScience Research specifications

Status: normative design package for **OpenScience Research — Powered by SMAIRT methodology**.

The historical roadmap in `docs/plans/12-smairt-integration.md` remains useful source material. This directory supersedes it for implementation decisions. A requirement is not implementation-ready until it has a stable ID, an owning specification, and an acceptance test in `10-verification-and-rollout.md`.

## Product contract

- One Git repository is one Research Project.
- A hidden core track exists from scaffold; sustained parallel approaches become first-class tracks.
- Git branches and worktrees are workspace bindings, not scientific identity.
- Iterations declare `exploratory`, `confirmatory`, `replication`, or `benchmark` intent.
- Seeds, parameters, retries, and machines create run attempts, not branches.
- The project-local ledger and Git are authoritative. Atlas is optional and off by default.
- Evidence integration, code integration, and foundation promotion are separate signed decisions.
- Python/Conda and clean-kernel notebooks are v1 execution contracts.
- V1 is release-blocked on macOS and Linux and supports public/non-sensitive work only.

## Specifications

| File                                          | Contract                                           |
| --------------------------------------------- | -------------------------------------------------- |
| `00-charter-and-glossary.md`                  | Product promise, vocabulary, non-claims            |
| `01-product-and-ux.md`                        | Researcher journeys and interaction quality        |
| `02-project-track-iteration-model.md`         | Scientific domain model and transitions            |
| `03-ledger-identity-and-governance.md`        | Ledger, signatures, roles, Git reconciliation      |
| `04-scaffold-git-and-environments.md`         | Scaffold, worktrees, Conda, environment drift      |
| `05-runner-notebooks-and-provenance.md`       | Controlled execution and evidence capture          |
| `06-agent-contract-and-evals.md`              | Coordinator, specialists, tools, evals             |
| `07-api-events-and-ui-integration.md`         | Public APIs, SDK, SSE, CLI and frontend boundaries |
| `08-security-privacy-and-retention.md`        | Risk gates, providers, secrets and retention       |
| `09-audit-export-adoption-and-publication.md` | Audit, track integration, import and publication   |
| `10-verification-and-rollout.md`              | Traceability, tests and release gates              |
| `11-deferred-adapters-and-sensitive-data.md`  | Explicit post-v1 work                              |

## Delivery order

1. Contract and ledger kernel.
2. Project scaffold and hidden core track.
3. Track/worktree and iteration lifecycle.
4. Python and notebook runner.
5. Evidence integration and foundation promotion.
6. Review, publication, collaboration and retention.
7. Adoption, export and public-v1 verification.

`work/graph.yaml` is the machine-readable dependency graph. Each work packet must cite requirement IDs and accepted ADRs, own disjoint paths, and end in a runnable state.

## Implementation status

The first implementation slice is intentionally not a public-v1 claim. `partial` means executable code exists but the packet's complete acceptance suite or all declared outputs have not landed.

| Contract                                                       | Implementation                                                          | Verification                                              |
| -------------------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------- |
| Stable project, track, iteration, protocol and run identities  | `backend/cli/src/research/domain`                                       | domain and project tests                                  |
| Canonical hashes, Ed25519 signatures and file-per-event ledger | `domain/{canonical,event,signature}.ts`, `adapters/ledger`              | canonical, event and ledger tests; Node crypto smoke test |
| Human/agent capability boundary                                | `domain/governance.ts`                                                  | governance tests; AI approval denial                      |
| Existing-repository adoption, core track and Conda manifest    | `application/project.ts`, environment and identity adapters             | temporary-Git project test                                |
| Track identity, workspace binding and environment inheritance  | `application/track.ts`, Git and Conda adapters                          | project test; explicit parent/environment assertions      |
| Signed track environment isolation                             | `application/environment.ts`, CLI, API and researcher UI                | parent-preservation and idempotent divergence test        |
| Mode-specific protocols and signed run intent                  | `application/investigation.ts`                                          | end-to-end domain flow in project test                    |
| Captured Git/Conda formal run and argv-only execution          | `application/run.ts`, Git, Conda and process adapters                   | drift, redaction, replay and real-process tests           |
| Clean-kernel formal notebook execution                         | run/process adapters and `FormalRunPanel.tsx`                           | original/executed copy and hash smoke test                |
| Durable mutation replay and projection repair                  | ledger, track and investigation services                                | conflict, replay and interrupted-projection tests         |
| Versioned research events and generated API client             | `research/events.ts`, research routes, `tooling/sdk`                    | OpenAPI generation and SDK typecheck                      |
| Human-reviewed protocol freeze                                 | investigation service, CLI, API and `ProtocolReview.tsx`                | freeze/replay flow and human-only governance tests        |
| Bounded agent research tools                                   | `tool/research.ts`, common governance                                   | context/track/iteration schemas; AI approval denial       |
| CLI/API/researcher surface                                     | `cli/cmd/research.ts`, `server/routes/research.ts`, `ResearchPanel.tsx` | formatting/parser pass; route E2E pending                 |

Still release-blocking: complete input/output artifact manifests and resource capture, real Conda/Jupyter macOS/Linux notebook journeys, evidence/code integration, foundation promotion, audit/export/adoption, publication, full collaboration lifecycle, security review, accessibility/performance tests, and clean macOS/Linux golden journeys.
