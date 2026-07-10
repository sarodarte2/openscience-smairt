# Scaffold, Git, and environments

## Project scaffold

The GUI-first transaction collects:

1. name, location, question and description;
2. initial typed iteration;
3. public/non-sensitive confirmation and intended network use;
4. project-named Conda environment;
5. Git-linked identity and signing-key setup;
6. optional Publications workspace;
7. exact file/command preview.

Creation is resumable and atomic at the contract level. Partial directories never claim to be ready. Conda absence never triggers silent installation; the project remains in `environment_required` with remediation.

## Track workspace creation

`New Track` chooses title, objective, lead, base foundation/current commit, and **Create branch/worktree** or **Attach existing branch**.

Default managed branch: `research/<track-slug>-<short-id>`.

Managed creation requires a clean base. Dirty work offers: commit, create from last commit while leaving changes, attach with captured patch hash and reduced confidence, or cancel. Never stash/reset/delete automatically.

Track removal refuses by default when work is uncommitted, commits are unpushed, runs are unfinished, evidence is unintegrated, or no remote/tag preserves the branch.

## Conda

- Baseline environment name: project slug.
- Formal execution uses `conda run`, never activation-dependent shell state.
- Store portable `environment.yml` plus platform-specific resolved snapshot without credentials.
- Tracks inherit the base fingerprint until dependencies diverge.
- Divergent tracks receive `<project>--<track-short-id>` and a track-specific portable spec.
- Package changes never silently mutate an environment used by another active run/track.

## Requirements

- `SCAFFOLD-001`: GUI and CLI produce the same golden tree and ledger bootstrap event.
- `SCAFFOLD-002`: collision, cancellation, solve failure, and restart preserve a resumable project.
- `GIT-001`: create and attach paths produce equivalent workspace bindings.
- `GIT-002`: branch rename/rebase changes binding metadata, not track identity.
- `ENV-001`: each formal run records the resolved environment fingerprint.
- `ENV-002`: environment divergence is visible before foundation promotion.
