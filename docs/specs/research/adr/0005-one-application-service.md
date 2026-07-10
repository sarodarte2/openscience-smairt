# ADR 0005 — One application service for every surface

**Status:** accepted

**Decision:** GUI, CLI, agent tools and future workers invoke the same research application use cases through declared ports.

**Consequences:** transports contain no scientific rules. The GUI does not shell out to the CLI. Parity is testable.

**Rejected:** prompt-only bookkeeping; separate GUI/CLI implementations.

**Revisit when:** none.
