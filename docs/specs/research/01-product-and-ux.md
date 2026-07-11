# Product and UX

## Information architecture

The study record, not chat, is primary:

- **Overview**: question, foundation, active tracks, next action, environment, trust state.
- **Tracks**: lineage, owners, workspace bindings, iterations, runs, outcomes.
- **Evidence**: artifacts, claims, reviews, audit, replay, integrations.
- **Publications**: optional evidence-linked writing.
- **People**: members, roles, delegations, handoffs.
- **Assistant**: contextual to the selected track and iteration.
- **Terminal**: advanced disclosure, never required for the golden path.

The core track is hidden until a second track exists. A session always displays its selected track; changing tracks replaces agent context before another action can run.

## Interaction rules

- One visually dominant next action per primary screen.
- Plain language first; IDs, hashes, raw commands and JSON under **Details**.
- Contextual feedback for routine status; interrupt only for consequential decisions.
- Operations over one second show progress. Operations over ten seconds show stage and cancellation.
- Every error states what happened, what was preserved, what is uncertain, and what the researcher can do next.
- Drafts and long-running operation state survive restart.
- No failure is represented as an empty result.
- All formal actions provide preview, consequence and recovery behavior.
- Folder opening, research-project initialization, and model generation are distinct actions with distinct progress
  language. A generic "Generating" state is forbidden for scaffold or configuration work.
- Model, provider, API-key, local-model, and connector status is visible from the research workspace and configurable
  without opening a terminal. Missing configuration is diagnosed before a request begins.
- Managed commercial services are optional adapters. Credit purchase, wallet balance, and vendor upgrade prompts do not
  occupy the research golden path and never obscure bring-your-own-key or local operation.

## Visual and motion system

The researcher workspace should feel calm, spatial, and direct rather than like a collection of administrative forms.
Use a restrained Liquid Glass-inspired system: layered translucent surfaces where they clarify hierarchy, continuous
corner geometry, consistent depth, responsive controls, and short physical transitions. Glass is progressive
enhancement, not decoration; contrast, reduced motion, GPU cost, and legibility take precedence.

- Prefer one adaptive workspace with contextual sheets over dense stacks of cards and unrelated buttons.
- Preserve spatial continuity when moving between overview, protocol, run, evidence, and review.
- Every pressed control responds immediately; asynchronous work then transitions into named stages.
- Avoid ornamental blur, excessive borders, nested panels, and motion without informational purpose.
- Provide an opaque/high-contrast fallback and honor `prefers-reduced-motion` and reduced-transparency settings.

## Observed usability finding: 2026-07 source trial

A first source-build trial exposed a release-blocking mismatch between the inherited OpenScience shell and the intended
research experience:

- "new project" opened a folder but did not initialize an OpenScience Research project;
- a subsequent request remained at "Generating" with no named stage, timeout, cancellation, or actionable model error;
- the research scaffold, model selection, provider keys, and connectors were not discoverable as one coherent setup;
- managed Synthetic Sciences credit and service links were more prominent than local/BYOK research configuration;
- the interface felt form-heavy and visually fragmented rather than fluid and researcher-directed;
- source-mode launch and Full Disk Access guidance described installed-binary behavior and caused avoidable confusion.

This is product evidence, not a documentation-only defect. Public-v1 verification must exercise the actual source and
packaged first-run shells, not only isolated Research components.

## Golden journeys

1. Create project → create project-named Conda environment → validate → define iteration → run → review.
2. Create or attach track → execute alternative approach → finalize evidence → integrate evidence only.
3. Accept track code → merge through Git → explicitly promote a foundation revision.
4. Enable Publications → select approved claims/evidence → draft → human approve/export.
5. Adopt existing SMAIRT repository → preview mappings → import with confidence labels.

## Accessibility and performance

- WCAG 2.2 AA for every critical journey.
- Complete keyboard operation and logical focus restoration.
- No state communicated by color alone.
- Reduced motion, 200% zoom, narrow-window support, semantic live status.
- UI input feedback under 100 ms; routine transitions under 300 ms.
- A conclusion's protocol, run, code, inputs, environment, evidence, and review are reachable within three interactions.

## Requirements

- `UX-001`: first local run is possible without terminal use.
- `UX-002`: branch, track, iteration, and run are never presented as synonyms.
- `UX-003`: track integration visibly separates evidence, code, and foundation decisions.
- `UX-004`: cancel/retry never overwrites prior runs or loses completed evidence.
- `UX-005`: at least 90% of usability participants complete the prepared-fixture golden journey within 15 minutes.
- `UX-006`: project creation cannot enter model generation, and every operation over ten seconds exposes its named
  stage, elapsed time, cancellation, and recovery action.
- `UX-007`: model/provider/key/local-model/connector setup is reachable from Research Overview within one interaction;
  invalid or missing configuration blocks before generation with an actionable explanation.
- `UX-008`: the Atlas-off/BYOK/local path contains no purchase call-to-action in the primary research journey.
- `UX-009`: source and packaged launchers open the correct project and provide runtime-specific permission guidance.
- `UX-010`: the critical journey passes reduced-motion, reduced-transparency, keyboard, 200% zoom, and contrast checks
  while maintaining the visual hierarchy and spatial continuity of the design system.
