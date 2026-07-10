# ADR 0008 — Git-linked signing identity

**Status:** accepted

**Decision:** OpenScience prefills a human profile from Git identity, generates an Ed25519 key protected by OS secret storage, and records a signed binding. Scientific decisions use the key; Git authorship remains familiar.

**Consequences:** app-level attribution is tamper-evident without requiring Git commit signing. Key recovery/rotation must preserve historical keys.

**Rejected:** free-form actor strings; mandatory Git signing; profiles without signatures.

**Revisit when:** an institutional identity provider can supply equivalent offline signatures.
