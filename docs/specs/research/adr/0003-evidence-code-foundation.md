# ADR 0003 — Evidence, code, and foundation integration are separate

**Status:** accepted

**Decision:** completed tracks integrate signed evidence independently from implementation code. Code follows ordinary Git review. A foundation revision is created only through explicit signed promotion.

**Consequences:** negative/inconclusive evidence can enter main without rejected code. A clean Git merge may still require scientific conflict resolution.

**Rejected:** merging every track wholesale; leaving rejected evidence only on disposable branches.

**Revisit when:** never unless the integrity promise changes.
