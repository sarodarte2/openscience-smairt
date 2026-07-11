# Verification and rollout

## Test layers

- Domain property tests for schemas, transitions, capability evaluation, canonical hashes and signatures.
- Temporary-filesystem integration tests for ledger locking, branch concurrency, crash, corruption and migration.
- Real spawned-process tests for stdout/stderr/exit/signal/timeout/cancel/restart.
- Conda adapter fixture tests in normal CI plus scheduled real-Conda macOS/Linux jobs.
- Clean-kernel notebook and hidden-state tests.
- Hono route, CLI JSON, generated SDK and agent-tool parity.
- Solid component and Playwright golden journeys.
- First-run tests that distinguish folder opening, research initialization, and model generation, including missing-key,
  offline, timeout, cancellation, restart, and source-build launch cases.
- Provider setup tests for BYOK, local OpenAI-compatible endpoints, optional managed services, and connector discovery.
- Keyboard, screen-reader, reduced-motion and WCAG checks.
- Agent evals for track selection, tools, approvals, bounded retry, evidence citations and handoff.
- Security tests for path traversal, symlink escape, argv injection, forged approvals and secret leakage.
- Atlas-off/network-off local workflow tests.
- Git tests for branch rename/rebase, several bindings, evidence-only integration, code promotion, negative evidence and synthesis tracks.
- Clean-machine replay and RO-Crate validation.

## Delivery slices

0. Specification and ADR freeze.
1. Project/track/foundation schemas and ledger kernel.
2. GUI scaffold, Conda and hidden core track.
3. Track/worktree, iteration and role lifecycle.
4. Python runner and minimal audit.
5. Formal notebook execution.
6. Evidence integration and foundation promotion.
7. Review, collaboration, publication and retention.
8. Adoption, export, accessibility and public-v1 verification.

## Release gates

- First-time researcher completes project → environment → iteration → run → review without terminal.
- Two parallel tracks produce no ID/ledger conflict.
- Researchers distinguish run completion, evidence import, code merge and foundation promotion.
- Rejected code does not enter the foundation while evidence remains discoverable.
- No branch operation silently deletes/re-writes research.
- No AI output becomes a signed scientific decision.
- macOS/Linux clean-install golden paths pass.
- Atlas may be absent.
- A clean user can configure a model/provider/key or local endpoint from the GUI before generation; missing configuration
  produces no indefinite "Generating" state.
- Atlas-off/BYOK/local journeys show no credit-purchase prompt in their primary path.
- Source mode and packaged mode both launch the intended project and show correct executable-specific permission help.
- The researcher golden journey passes visual-regression, reduced-motion, reduced-transparency, keyboard, zoom, and
  contrast gates.
- No unresolved critical/high integrity, privacy, or execution finding remains.

## Traceability

`README.md` maintains requirement → implementation packet → test → release-slice mapping. Public claims are allowed only after the linked release tests pass.
