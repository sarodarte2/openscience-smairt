# ADR 0013 — Receipt-only AI retention

**Status:** accepted

**Decision:** default persistence retains AI metadata and canonical hashes without message text. Full transcripts are encrypted, local, optional, and excluded from ordinary sync/export.

**Consequences:** current plaintext session persistence must change for governed research sessions. Execution evidence remains separately retained.

**Rejected:** plaintext-by-default transcripts; remote transcript mirroring.

**Revisit when:** institutional policy mandates a different local retention profile.
