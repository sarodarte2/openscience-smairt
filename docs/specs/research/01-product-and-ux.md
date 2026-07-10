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
