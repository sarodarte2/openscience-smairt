# Agent contract and evals

## Architecture

V1 has one user-facing research coordinator with deterministic tools and on-demand read-only evidence/reviewer specialists. Always-multi-agent and user-composed orchestration must implement the same application interfaces and pass equivalent evals before release.

## Coordinator contract

- Bind every session to an explicit track; formal actions also bind an iteration.
- Load a compact materialized summary, contract hashes, unresolved gates, and selected evidence rather than the entire ledger.
- Use application tools rather than writing canonical state directly.
- Ask humans at scientific/risk boundaries and after bounded retries.
- Never approve protocols, integrate tracks, merge code, promote foundations, finalize claims, or certify novelty/validity.
- Deterministic checks precede model-based review.
- Compaction persists project/track/iteration IDs, pending approvals, selected evidence, and exact contract hashes.

## Tools

Provide narrow schemas for reading research context, drafting iterations/protocols, requesting approvals, executing through the runner, linking evidence, requesting review, and preparing track handoffs. Reject overlapping or ambiguous tool responsibilities.

RSI auto-distillation, automatic skill promotion, and remote learned-skill upload are disabled by default. A future learned workflow requires explicit evaluation and signed promotion.

## Evals

- Correct project/track/iteration selection.
- No cross-track context leakage.
- Correct tool and approval selection.
- Bounded retry and useful human handoff.
- Preservation of negative/inconclusive evidence.
- Reviewer read-only behavior and immutable evidence inputs.
- Refusal to overclaim novelty, validity, or reproduction.

## Requirements

- `AGENT-001`: an ambiguous/unbound branch triggers track selection rather than inference.
- `AGENT-002`: no prompt cooperation is required for ledger/run integrity.
- `AGENT-003`: coordinator and specialists report exact evidence IDs for material claims.
- `AGENT-004`: context size is budgeted and measured; always-on additions must displace existing text or become on-demand.
