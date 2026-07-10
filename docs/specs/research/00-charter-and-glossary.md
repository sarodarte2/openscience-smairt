# Charter and glossary

## Goal

OpenScience Research gives computational researchers a frictionless, human-controlled way to define questions, execute instrumented work, preserve evidence, compare parallel approaches, and make attributed decisions without requiring terminal expertise.

## V1 audience and scope

- Individual and Git-collaborating computational researchers.
- Python projects managed with Conda.
- Saved Jupyter notebooks executed formally in clean kernels.
- macOS and Linux workstations.
- Public and non-sensitive data.

## Vocabulary

- **Research Project**: one Git repository with one primary research objective and governance boundary.
- **Foundation Revision**: an approved baseline binding a Git commit, selected artifacts, environment snapshot, and evidence-backed decision.
- **Track**: a sustained line of scientific inquiry sharing the project's foundation.
- **Workspace Binding**: a Git branch/worktree associated with a track.
- **Iteration**: one typed hypothesis/question and its immutable protocol revision.
- **Run Attempt**: one execution under a protocol; parameters, seeds, retries, and machines create distinct attempts.
- **Evidence**: immutable logs, artifacts, metrics, snapshots, and source records linked to a run.
- **Decision**: an attributed human interpretation or governance action.
- **Publication**: an optional evidence-linked narrative; never an alternative scientific lifecycle.
- **Session**: an AI conversation, never a synonym for project, track, iteration, or run.

## Reliability language

The product reports these dimensions independently:

- schema-valid;
- record-complete;
- integrity-verified;
- protocol-compliant;
- replay-ready;
- replay-attempted;
- reproduced within declared tolerances;
- AI-reviewed;
- human-approved.

## Non-claims

V1 does not determine scientific truth or novelty, observe work outside its runner, make hashes prove scientific validity, guarantee inaccessible external systems, or support regulated/sensitive data.

## Requirements

- `CHAR-001`: every formal action binds a project, track, iteration, actor, and stable ID.
- `CHAR-002`: no UI or export collapses integrity, review, and scientific interpretation into one status.
- `CHAR-003`: deleting or disabling OpenScience must leave a portable Git project with inspectable records.
- `CHAR-004`: Atlas absence cannot block scaffold, execution, audit, review, or export.
