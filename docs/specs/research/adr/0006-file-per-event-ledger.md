# ADR 0006 — File-per-event ledger

**Status:** accepted

**Decision:** canonical state is an immutable event DAG with one canonical JSON file per event and a rebuildable derived index.

**Consequences:** Git branches append without shared counters or JSONL conflicts. Corruption is isolated. Mutations require new events.

**Rejected:** one mutable manifest, global JSON graph, authoritative SQLite database.

**Revisit when:** scale measurements prove the derived index cannot satisfy performance targets.
