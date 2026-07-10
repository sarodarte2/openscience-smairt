# ADR 0012 — User-controlled Git commits

**Status:** accepted

**Decision:** OpenScience writes reviewable research records and prepares commits/handoffs but never commits, pushes, force-removes, resets, stashes, or deletes branches automatically.

**Consequences:** Git side effects require plain-language preview and user action. Worktree cleanup is conservative.

**Rejected:** automatic checkpoints; dedicated record branch.

**Revisit when:** users explicitly opt into a separately designed automation policy.
