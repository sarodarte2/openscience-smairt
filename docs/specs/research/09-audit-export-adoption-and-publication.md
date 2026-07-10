# Audit, export, adoption, and publication

## Track integration

Finalizing a track produces a signed evidence bundle containing source branch/commit, base foundation, protocols/amendments, run envelopes, selected evidence, analyses, claims, reviews, environment snapshots, artifact manifests, contributions, code-diff hash, and track outcome.

Main-branch integration offers:

1. evidence only;
2. evidence plus a normal Git code-merge proposal;
3. synthesis track;
4. return for changes.

Evidence import writes reviewable project files but never commits. Code merge never implies foundation promotion. Negative/inconclusive evidence is retained even if code is rejected and the source branch is later archived.

## Audit

Audit reports schema validity, completeness, integrity, capture confidence, protocol compliance, replay readiness, replay result, review state, overrides, missing sources, and Git/scientific/environment/artifact conflicts separately.

`audit --fix` may add verified indexes/backfill imported confidence metadata but never rename, move, edit, or fabricate historical execution.

## Adoption

Adoption is scan-first and read-only until confirmation. It reports recognized, uncertain, ignored and conflicting material. Existing records receive `captured`, `attested`, or `imported-unverified`; historical certainty is never upgraded by inference.

## Publication

Publications are optional, link approved claims/evidence from this project, and never mutate protocols or decisions. Draft AI-use and contribution statements cite ledger evidence and require human approval. Cross-project aggregation is post-v1 through verified exports or a publication repository.

## Export

Export remains available with incomplete/red audits and embeds the report. A stricter publish action may require policy thresholds. Export maps provenance to W3C PROV-O and RO-Crate, includes environment intent/resolution, seeds, data pointers, artifact hashes and honest integrity/replay labels.

## Requirements

- `INTEGRATE-001`: evidence-only integration changes no implementation code.
- `INTEGRATE-002`: foundation promotion names exact merge commit, artifacts, environment and supporting decisions.
- `AUDIT-001`: one-byte artifact corruption identifies the exact artifact.
- `ADOPT-001`: dry-run adoption changes no project file.
- `PUB-001`: unsupported claims remain visibly unresolved and cannot be exported as approved.
