# ADR 0009 — Python/Conda and formal notebooks in v1

**Status:** accepted

**Decision:** the v1 scientific runtime is Python in project-named Conda environments plus saved notebooks executed in clean kernels. Persistent cells are scratch work.

**Consequences:** R/Julia and Windows are adapter work. Formal evidence never depends on hidden kernel state.

**Rejected:** unbounded multi-language v1; treating interactive output as reproducible evidence.

**Revisit when:** the Python/notebook vertical slice meets release gates.
