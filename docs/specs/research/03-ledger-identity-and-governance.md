# Ledger, identity, and governance

## Ledger

The authoritative journal is project-local:

```text
.openscience/research/
  project.json
  ledger/events/<event-ulid>.json
  projections/
  tracks/
  handoffs/
  receipts/
  cache/       # ignored, rebuildable
  private/     # ignored, encrypted
```

Events use RFC 8785 canonical JSON, SHA-256, typed ULIDs, parent hashes, schema version, actor and Ed25519 signature. Writers use an exclusive project lock, same-directory temporary file, flush, and atomic rename. Parse/hash/signature failure never resets or overwrites history; the project opens read-only with diagnostics.

Concurrent branches create separate event files. Reconciliation records a multi-parent merge event. A derived index may improve reads but is never authoritative.

## Identity

- Prefill a local OpenScience profile from Git `user.name` and `user.email`.
- Never rewrite global Git configuration without explicit consent.
- Generate an Ed25519 key stored in macOS Keychain or Linux Secret Service, with encrypted passphrase fallback.
- Record a signed binding between profile, Git identity, and public-key fingerprint.
- Git commit signing remains optional and separate.

## Roles and capabilities

Presets: `owner`, `researcher`, `reviewer`, `viewer`.

Capabilities cover project configuration, membership, track creation, protocol editing/freezing/approval, run execution/cancellation, analysis, claim finalization, foundation promotion, export, overrides, and transcript decryption.

AI agents are delegated actors, never members. They cannot approve protocols, manage members, override gates, promote foundations, finalize claims, or decrypt transcripts.

## Git collaboration

The application writes portable records but never commits automatically. It exposes **Prepare Commit**, **Prepare Handoff**, and integration previews. Git/OS permissions remain the actual access-control boundary; signatures provide attribution and tamper evidence.

## Requirements

- `LEDGER-001`: two branches can append events without filename or counter collision.
- `LEDGER-002`: corruption identifies exact events and cannot silently discard valid history.
- `LEDGER-003`: every approval, rejection, amendment, override, integration, and promotion is signed.
- `GOV-001`: role removal applies prospectively and never rewrites historical attribution.
- `GOV-002`: the final owner cannot be removed without transferring ownership.
- `GOV-003`: AI self-approval fails through every transport.
