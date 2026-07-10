# ADR 0010 — Coordinator plus on-demand specialists

**Status:** accepted

**Decision:** one user-facing coordinator operates deterministic tools and may invoke read-only evidence/reviewer specialists. Always-multi-agent and user composition are deferred behind equivalent interfaces/evals.

**Consequences:** one coherent user experience and simpler evaluation. Specialists cannot mutate authoritative state directly.

**Rejected:** always-on multi-agent orchestration; user-facing agent graph in v1.

**Revisit when:** evals show a stable specialist configuration materially improves outcomes.
