# ADR 0004 — Local ledger and Git are authoritative

**Status:** accepted

**Decision:** project-local events are the complete scientific record. Atlas is optional, off by default, and may receive explicitly approved exports only.

**Consequences:** scaffold, run, review, audit, replay and export work offline. Remote acknowledgement cannot rewrite local state.

**Rejected:** Atlas-first storage; automatic bidirectional synchronization.

**Revisit when:** a self-hosted/remote system can preserve identical offline guarantees.
