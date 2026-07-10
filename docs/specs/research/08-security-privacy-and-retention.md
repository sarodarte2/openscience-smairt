# Security, privacy, and retention

## V1 boundary

V1 supports public/non-sensitive data only. A private OpenAI-compatible endpoint does not by itself authorize sensitive use. No HIPAA, ITAR, classified, export-control, FDA, or equivalent compliance claim is made.

## Defaults

- Local ledger and Git are authoritative.
- Atlas is off and export-only when explicitly enabled.
- No provider fallback in a governed run.
- Model/provider, instruction, skill and tool-schema hashes are recorded.
- Network, destructive, external mutation and spend actions require scoped approval.
- Secrets are brokered to approved transports and excluded from child-process environments and logs.
- Remote instructions, plugins, MCP, updates, downloads and connectors are independently governed.

## AI retention

Default `receipt-only` stores session/provider/model/version, timing, canonical input/output/tool-sequence hashes, affected entity IDs, and token/cost metadata without message text.

Optional `encrypted-full` canonicalizes/compresses at session completion and encrypts with a per-project key protected by OS key storage. It is ignored by Git, Atlas and normal export. Execution stdout/stderr remains scientific evidence under artifact retention rules.

## Requirements

- `SEC-001`: lower-trust project/user/model content cannot weaken an administrator policy.
- `SEC-002`: inference credentials never enter bash, notebooks, MCP, logs, receipts, exports, or Atlas payloads.
- `SEC-003`: startup and each run expose the effective provider, endpoint policy, network classes and enabled extensions.
- `PRIV-001`: receipt-only finalization leaves no persistent plaintext AI messages.
- `PRIV-002`: encryption happens asynchronously at session boundary and cannot silently fall back to plaintext.
