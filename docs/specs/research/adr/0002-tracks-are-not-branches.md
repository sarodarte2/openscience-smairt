# ADR 0002 — Tracks are not Git branches

**Status:** accepted

**Decision:** a Research Track is a stable scientific entity. Git branches/worktrees are attachable workspace bindings. A track survives rename, rebase, merge, archival and collaborator-specific branches.

**Consequences:** sessions bind `trackId`; branch detection is a convenience, never authority. Parameters and retries remain runs.

**Rejected:** deriving track IDs from branch names; assigning one branch permanently to one scientific hypothesis.

**Revisit when:** none; this separation is foundational.
