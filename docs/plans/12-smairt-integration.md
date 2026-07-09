# 12 — SMAIRT × OpenScience integration roadmap

**Kind**: feature roadmap (multi-phase) · **Status**: 📝 plan drafted · **Depends on**: none to start; touches 10 (sandboxing) and 11 (reviewer agent) where noted.

**Goal**: bring SMAIRT's project-level scientific rigor — the audit trail, logging and coding conventions, accumulated project memory, human-contribution tracking, and data-progression discipline — into OpenScience, without degrading what OpenScience already does well, and without passing integration debt to researchers as token bloat, unreliable conventions, or opaque behavior.

**North star**: a researcher must be able to trust that the platform *does what it is told*. Every piece of rigor we add is either (a) enforced in code and therefore deterministic, or (b) clearly disclosed as advisory. Nothing in between.

**Companion maps** (read these to navigate the code without re-exploring): `docs/notes/repo-map.md` (OpenScience subsystem index + integration surfaces) and `smairt-template/REPO_MAP.md` (SMAIRT asset → port-target index).

---

## Revision 2 — adversarial review (findings + what changed)

This roadmap was rewritten after a second, hostile pass focused on what actually reaches the researcher: reliability, agent success rate, and the messy realities of real labs. The findings below drove the changes; each is tagged where it lands. Priority order reflects the project's goal — safe, reliable, consistent science for the widest set of researchers.

| # | Finding (user-affecting) | Severity | Resolution | Lands in |
|---|---|---|---|---|
| F1 | **The agent usually cannot reach the cluster.** OpenScience's `bash` tool runs in a *local* shell (confirmed: no SSH/remote concept in `tool/bash.ts`). For the dominant HPC topology — workbench on a laptop, cluster over SSH+MFA — the agent can generate `sbatch` scripts but cannot submit, poll, or read cluster-side logs. The v1 plan's "agent submits + monitors a SLURM job" was false for most users. | **critical** | WS-F redesigned around the SSH boundary: OpenScience is an *artifact generator + reconciler*, not a scheduler. Two explicit topologies. | §5 WS-F |
| F2 | **No universal SLURM.** Partition/account/QOS names, module systems (Lmod/tcl/Spack/none), scheduler flavor (SLURM/PBS/SGE/LSF), and env managers (conda/venv/Apptainer/bare) differ per cluster and are all human-supplied. Auto-detection is a trap. | **critical** | Cluster *profile* (`.openscience/clusters/<name>.jsonc`) captured once by the human, reused deterministically. No auto-detection in v1. | §5 WS-F |
| F3 | **Compute nodes (and often login nodes) have no outbound internet.** OpenScience routes every model request to a provider — that egress may be blocked or *prohibited* (national-lab/clinical/air-gapped; SMAIRT's home is PNNL). Local/open-weight models become a requirement, not a nicety. | **critical** | WS-F names the egress/compliance constraint explicitly and ties the HPC path to local-model operation + a data-egress policy in the manifest. | §5 WS-F, §7 |
| F4 | **HPC jobs are async and outlive the session.** Queue waits of hours–days; the session ends first. Auto-provenance on `tool.execute.after`(bash) fires at *submission*, before any log exists. | high | Explicit submit → detach → *reconcile* lifecycle; provenance is reconciled after the fact, not captured live. | §5 WS-F, WS-C |
| F5 | **Existing/greenfield asymmetry.** v1 was scaffold-first; most researchers have an existing, messy repo. No adoption path = tiny audience. | high | WS-A gains `--adopt` (formalize an existing tree) and `--from-smairt` (migrate a cookiecutter project), plus *progressive formalization*. | §5 WS-A |
| F6 | **Naming grammar as raw regex in the manifest is a footgun.** User-editable regex can fail to compile (breaking the hook), and script/log patterns can silently desync. | high | Manifest stores *named conventions with parameters* (pad width, track charset, separator), compiled by code — not raw regex. | §4.1 |
| F7 | **`AGENTS.md` summary duplicates the skill** — violates the roadmap's own "one normative home" rule and doubles per-session tokens. Also, scaffolding `AGENTS.md` can *clobber* a repo's existing one (instruction loader takes the first match up-tree). | high | Research contract moves to a dedicated `.openscience/` instruction file wired via config `instructions`; `AGENTS.md` is never clobbered. Methodology lives only in the skill. | §4.5, §5 WS-A |
| F8 | **Python-only contract punishes real science.** TeeLogger is Python; the validation hook would nag on every R/Julia/shell/notebook experiment. Stats (R), some physics (Julia/Fortran), and much of bioinformatics (R) are first-class. | high | Manifest declares `language`; the logging/naming contract is language-scoped; non-Python experiments are validated on what's checkable (naming, log presence) only. | §4.1, §5 WS-C |
| F9 | **Notebooks don't fit "script → log."** A large share of research is Jupyter; OpenScience even ships a kernel tool. Silent incompatibility = perpetual nagging. | high | Notebook execution contract (parameterized run → executed `.ipynb`/HTML as the log artifact) or explicit, declared exclusion. Never silent. | §5 WS-C |
| F10 | **"Reproducible bundle" overclaims.** Checksums prove *integrity* (files unchanged), not *reproducibility* (re-run → same result). Overclaiming reproducibility is itself an integrity failure. | high | Bundle is "integrity-verifiable"; reproducibility requires captured env (lockfile) + seeds + data pointers, which the bundle now includes and labels honestly. | §5 WS-F |
| F11 | **Collaborative counter collisions.** SMAIRT supports multi-researcher/branch work; two `iteration new` on two branches both allocate `07` → merge collision. "Atomic" holds only within one working copy. | high | Track/author-prefixed numbering is the collaborative default; the manifest records per-track counters; single-counter mode is opt-in for solo work. | §4.1, §5 WS-C, §7 |
| F12 | **`audit --fix` is dangerous.** Auto-renaming import-referenced files or rewriting content can corrupt a project. | med | `--fix` restricted to *additive, reversible* actions (backfill missing provenance nodes from existing files); never rewrites user content. | §5 WS-D |
| F13 | **Cost approval is dollar-shaped; HPC is allocation-hours (SUs).** The research prompt's `$`-gate doesn't map to quota-limited, free-at-point-of-use cluster time. | med | Approval generalized to *resource* approval (dollars **or** SU/node-hours) read from the active compute backend. | §5 WS-F |
| F14 | **Phase-consistency "in the critique gate" implies an extra LLM subagent** (latency + cost) when it's a deterministic check. | med | Phase gate is a *code* check (reads `currentPhase` + provenance) that feeds the existing gate — no new model call. | §5 WS-F |
| F15 | **Two writable state files can diverge.** `research.jsonc` (counters/config) and `research-state.md` (narrative) both look authoritative. | med | Write-ownership rule: `research.jsonc` is the *only* writable source for counters/config; `research-state.md` is narrative/derived and never holds a second counter. | §4.1, §4.4 |
| F16 | **Blocking gates with no escape = a footgun the other way.** A user who sets `block` can be hard-stopped mid-work with no recourse, eroding trust. | med | Every block carries a logged, per-invocation override (`--force-gate`, recorded in provenance) so it never dead-ends real work. | §4.3 |
| F17 | **`project scaffold` overloads the Atlas-flavored `project` command** (`project init` = Atlas graph). Conflates local scaffolding with remote graph semantics. | low | Naming raised as an open decision: prefer a distinct `openscience research init`. | §7 |
| F18 | **Session-note injection cadence unspecified** — "one-line note when manifest detected" could fire per-turn (uncounted tokens, repetitive). | low | Note fires *once per session* (first turn); counted in the budget. | §4.5, §5 WS-B |
| F19 | **The integrity guarantee was implicit.** Users need it stated: even if the methodology skill *never loads*, the record is still valid. | med | Stated as an invariant: Tier-1 code produces a complete audit trail with zero model cooperation; skills only raise *quality of science*, never *integrity of record*. | §2.4, §4.2 |
| F20 | **Agent success-rate practices weren't first-class**, though the user named them the priority. | high | New §2.4 — the agent-reliability design principles every workstream must satisfy. | §2.4 |

**Net effect on the plan**: HPC (WS-F) is now the most detailed and most honest workstream; a new agent-success-rate principles section (§2.4) governs the rest; the manifest schema (§4.1) is safer and multi-language/multi-author; and every enforcement point gained an escape hatch and an integrity floor. Nothing in the token budget (§4.5) grew — the AGENTS.md duplication was removed, which *lowered* per-session cost.

---

## 0. Source material

| | OpenScience (`this repo`) | SMAIRT (`biodataganache/smairt-cookiecutter`) |
|---|---|---|
| What it is | AI research workbench: CLI + browser workspace, agent runtime, 290+ skills, ~30 science DB connectors, model-agnostic | Cookiecutter template + 2 MCP skills encoding PNNL's AI-assisted research method |
| Rigor lives in | Session-level: staged workflow in `src/agent/prompt/research.txt`, critique gates, `research-state.md`, provenance DAG (`src/science/provenance/`), blind reviewer gate (`src/session/review.ts`) | Project-level: filesystem contract (hypothesis → script → log → analysis), `TeeLogger`, `KNOWN_PATTERNS.md`, `intellectual_contribution.md`, phase progression |
| Enforcement | Mostly prompt text; provenance tools exist but model-invoked; reviewer gate is code but off by default | None — pure convention; relies on the AI honoring the template |

The two are complementary: OpenScience governs *a session*; SMAIRT governs *a project across sessions, tools, and months*. The synthesis this roadmap builds is: **SMAIRT's contract, enforced by OpenScience's code.**

---

## 1. Integration surfaces available today

Before deciding *where* each SMAIRT piece goes, this section inventories every mechanism OpenScience has for shaping agent behavior, with its cost and reliability profile. This is the factual basis for every placement decision below.

### 1.1 Agent prompts (always-on, per-turn)

`src/agent/prompt/research.txt` (28.8 KB ≈ **7,200 tokens**) is injected as a synthetic part on **every user message** in a research-agent session (`src/session/prompt.ts` → `insertReminders`, the `input.agent.name === "research"` branches). Same pattern for `biology`, `physics`, `ml`.

- **Reliability**: probabilistic (model must comply), but *always present* — cannot be "not loaded".
- **Cost**: every line added is paid by every research session, every turn, whether or not the project uses SMAIRT. Long prompts also measurably dilute instruction-following: the more rules, the lower per-rule compliance. `research.txt` is already at the size where new sections compete with existing ones.
- **Blast radius**: global. A regression here affects all users.

### 1.2 Instruction files (always-on, per-session)

`src/session/instruction.ts` auto-loads `AGENTS.md` / `CLAUDE.md` found in the project tree (plus global config paths) into the system context. This is the designed home for *project-scoped* conventions — exactly what SMAIRT's `prompts/AI_CONTEXT.md` was hand-rolling.

- **Reliability**: probabilistic, always present *for that project only*.
- **Cost**: paid once per session, and only by projects that opt in (the file exists or it doesn't). Zero cost to everyone else.
- **Blast radius**: single project.

### 1.3 Skills (on-demand)

`src/skill/skill.ts` assembles a catalog keyed by name from: project `.claude/skills/` → Atlas catalog → bundled `skills/` tree → embedded system skills → learned skills → user skills (earlier sources shadow later ones — see `docs/notes/skills.md`). The catalog costs ~1 line (name + description) per skill; the body enters context **only when the agent loads it**. SMAIRT's own skills measure: `smairt-research` 5.7 KB ≈ 1,400 tokens, `smairt-paper-driven` 8.1 KB ≈ 2,000 tokens.

- **Reliability**: doubly probabilistic — the agent must *decide to load it*, then *comply with it*. Details can also fall out of context after compaction.
- **Cost**: near-zero until loaded; bounded when loaded.
- **Blast radius**: none unless loaded. User-overridable (a project skill shadows a bundled one) — which is a transparency feature and a drift risk at once.

### 1.4 Commands (user-triggered)

`.openscience/command/*.md` defines slash commands (this repo uses them: `/commit`, `/learn`, …). Deterministically injected when the user invokes them.

- **Reliability**: content is guaranteed present when invoked; compliance still probabilistic.
- **Cost**: zero until invoked.

### 1.5 CLI commands + scaffolds (deterministic, zero-token)

Anything `openscience <cmd>` does in TypeScript — file generation, numbering, validation — is exact, testable, and costs no context. Precedent: `openscience project init`, `openscience skill new`.

### 1.6 Hooks (deterministic, zero-token)

The plugin runtime (`tooling/plugin/src/index.ts`, `Hooks`) exposes `tool.execute.before` / `tool.execute.after` (inspect/modify any tool call and its result), `chat.message`, `chat.params`, `permission.ask`, `experimental.chat.system.transform`, and `experimental.session.compacting`. Hooks run whether or not the model cooperates.

### 1.7 Tools + code-level gates (deterministic)

Agent-facing tools (`src/tool/provenance.ts`: `provenance_record`, audit) plus session-loop machinery like the reviewer gate (`src/session/review.ts` — runs at loop exit *independent of whether the agent remembered to self-review*, config-gated via `config.experimental.reviewGate`, annotate-only at level 0). The reviewer gate is the house precedent this roadmap follows everywhere: **rigor as code, config-gated, non-blocking first**.

### Summary table

| Surface | Determinism | Token cost | Who pays | Right for |
|---|---|---|---|---|
| Agent prompt (`research.txt`) | model-dependent, always present | ~7.2k/turn already; every added line recurs per turn | **everyone** | only the minimal SMAIRT *pointer* |
| Instruction files (`AGENTS.md`) | model-dependent, always present per project | once/session, opt-in per project | that project | project conventions, memory files |
| Skills | model-dependent, conditionally present | ~30 tokens (catalog) until loaded | loader | methodology teaching, domain guidance |
| Commands | present when invoked | zero until invoked | invoker | session-start priming, finalize rituals |
| CLI scaffold/commands | **exact** | zero | nobody | layout, numbering, manifests, exports |
| Hooks | **exact** | zero | nobody | validation, auto-provenance, gates |
| Code gates (reviewer-gate pattern) | **exact** | zero (output only) | nobody | audit-trail integrity checks |

---

## 2. The core decision: skills vs. modifying the harness

The question is not either/or. It is a placement rule per feature, derived from one test:

> **What is the cost of the model silently ignoring this?**
> If a missed detail *corrupts the audit trail or misleads the researcher* → it must be **code** (hook, gate, CLI).
> If a missed detail merely *reduces quality or completeness* → it may be **prompt/skill** text.

### 2.1 Skills-only integration — benefits and demerits

**Benefits**

- Zero cost to non-SMAIRT users; near-zero until loaded. No release-cycle coupling for content-only fixes (catalog skills update out-of-band).
- Transparent and overridable: a lab can fork `smairt-research` in `.claude/skills/` and shadow ours — their conventions win, visibly.
- Model-agnostic by construction; ships in days (SMAIRT already publishes skill-format bundles).
- Matches OpenScience's existing "290 skills" mental model — no new concepts for users.

**Demerits — and these are exactly the failure modes the roadmap must not accept**

- **Non-loading**: the agent simply never loads the skill for a project that needs it. The convention silently doesn't exist that session.
- **Partial compliance**: the skill says "use `TeeLogger`, name logs after scripts" and the model does it 90% of the time. A 10% miss rate on *logging* means 10% of experiments have no raw evidence — the audit trail has holes precisely where nobody noticed. For a rigor framework, probabilistic conventions are worse than none, because they *look* like rigor.
- **Compaction amnesia**: skill bodies are context, and context gets compacted. Iteration 14 of a long session may no longer contain the naming rules loaded at iteration 1.
- **Drift**: skill prose describing behavior that code doesn't enforce will diverge from reality over releases; nobody notices because nothing fails.

### 2.2 Harness-modification-only — benefits and demerits

**Benefits**: deterministic; testable (`bun test`, no mocks per house style); zero marginal tokens; survives compaction and model swaps; the platform can *prove* it did what it was told.

**Demerits**: engineering and maintenance cost in `backend/cli`; coupled to the release cycle; risks hard-coding one research methodology into a general tool (OpenScience serves people who don't want SMAIRT); *invisible enforcement can itself break trust* if the agent's files get rewritten or rejected without the user seeing why.

### 2.3 The placement rule this roadmap uses

**Skills teach. Prompts point. Code enforces. Files remember.**

1. **Code** (CLI + hooks + gates) owns every *invariant*: directory layout, iteration numbering, script/log naming, the logging contract, provenance recording, audit-chain verification, the finalize gate. These are cheap to check mechanically and catastrophic to miss silently.
2. **Skills** own the *methodology*: why hypotheses precede code, how to interpret results through a hypothesis, phase-progression judgment, paper-driven mode, HPC guidance. Missing these degrades quality, not integrity.
3. **The agent prompt** gets **one pointer, ≤ 10 lines** (see §5, WS-B): "if the project manifest exists, this is a structured research project — load `smairt-research`, honor the manifest, use the iteration commands." That is the entire permanent tax on `research.txt`.
4. **Instruction files + project files** own project state and conventions (`.openscience/research-contract.md`, `KNOWN_PATTERNS.md`, the manifest), loaded per-project at session start.

Corollary — **never state a convention in two places**. Every convention lives in exactly one normative home (usually the machine-readable manifest, §4.1); prose in skills/docs *refers* to it. Duplicated statements are the primary drift engine.

### 2.4 Agent-reliability design principles (the priority constraint)

Success rate and efficiency for the agent are not a workstream — they are constraints every workstream must satisfy. The goal "safe, reliable, consistent science" is, mechanically, an agent-reliability goal: the platform is trustworthy only to the degree the agent reliably does the right thing and the code catches it when it doesn't. Eight principles, each with the failure it prevents:

1. **One blessed path per action.** For anything with an invariant (creating an iteration, naming a script, writing a log), there is exactly one supported way, and tools *return the exact artifact* rather than asking the agent to construct it. `iteration new` returns the precise paths to write; the agent copies, never guesses. *Prevents*: name-format misses, rename churn, broken imports (F6).
2. **Integrity floor independent of cooperation.** The complete audit trail must be producible with *zero* model compliance — pure Tier-1 code. Skills and prompts only raise the *quality of the science*; they can never be load-bearing for the *integrity of the record* (F19). *Prevents*: the "looks like rigor, has holes" failure of probabilistic conventions.
3. **Fail forward, never silently.** Every mechanical check emits an actionable message the agent can act on in one shot ("rename to `script_07_...`; run `openscience iteration new` to avoid this"), surfaced in the transcript. No silent rejection, no silent acceptance. *Prevents*: the agent looping on an opaque failure; the user distrusting invisible interference (F16).
4. **Minimal always-on context.** Instruction-following degrades as prompt length grows; every always-on token competes with every rule already there. The permanent tax is a ≤10-line pointer, nothing more (§4.5). Everything else is on-demand or code. *Prevents*: diluting `research.txt`'s existing gates.
5. **State is read, not re-derived.** After compaction or a crash, the agent recovers by reading durable state (`research.jsonc`, `research-state.md`, provenance), never by reconstructing it from conversation. Counters and config have a single writable owner (F15). *Prevents*: divergence, double-allocation, lost place.
6. **Reconcilable, not just live.** Where capture can't happen in the moment (async HPC jobs, F4), the design provides an explicit after-the-fact reconcile step rather than a live hook that fires at the wrong time. *Prevents*: provenance gaps exactly where the real compute happened.
7. **Progressive formalization.** Real research starts messy; full ceremony on day one drives users (and agents) to fight or bypass the system. Structure is adoptable incrementally — a project can be half-formalized and the tooling degrades gracefully (F5). *Prevents*: the framework serving only greenfield toy projects.
8. **Escape hatches are first-class.** Any block a user can configure must have a logged, per-invocation override. A gate that can dead-end legitimate work is a reliability bug, not a safety feature (F16). *Prevents*: rigor becoming an obstacle researchers route around entirely.

Where a workstream trades against one of these, it says so explicitly.

---

## 3. What happens to each SMAIRT asset

Every file in the SMAIRT template, mapped to its destination. "Drop" means deliberately not ported — porting it would be pure debt.

| SMAIRT asset | Destination in OpenScience | Mechanism | Why |
|---|---|---|---|
| Directory layout (`hypotheses/`, `experiments/<phase>/`, `analysis/`, `results/logs/`, `plans/`, `data/`, `background/`) | `openscience research init` (§7/F17) | CLI (deterministic) | Layout is an invariant; the model should never be asked to remember it |
| `cookiecutter.json` + Jinja conditionals (`starting_phase`, `project_mode`) + `hooks/pre_gen_project.py` / `post_gen_project.py` | Scaffold command flags + TS templates; validation logic reimplemented in TS | CLI | Removes the Python/cookiecutter dependency entirely — one less install step for researchers |
| `prompts/AI_CONTEXT.md` | Scaffolded `.openscience/research-contract.md` (pointers only, ≤30 lines) wired via config `instructions` (F7) | Instruction file (loaded by `src/session/instruction.ts`) | This is what the instruction system was built for; a dedicated file avoids clobbering a repo's own `AGENTS.md` |
| `prompts/CODE_CONVENTIONS.md` | **Split**: normative rules (naming regexes, log path pattern, required docstring fields) → the project manifest (§4.1); explanation → the `smairt-research` skill | Manifest + skill | Machine-checkable parts must be machine-readable; prose teaches |
| `prompts/KNOWN_PATTERNS.md` | Stays a project file, referenced from `research-contract.md` so it loads at session start; agent updates it (skill instructs); finalize command reminds | File + instruction | Accumulating memory must live in the repo, not in any prompt |
| `prompts/SESSION_START.md` priming prompts | `.openscience/command/` scaffolded slash commands (`/iteration-start`, `/context-refresh`, `/interpret`) | Commands | Deterministic injection when the researcher wants it; zero cost otherwise |
| `prompts/intellectual_contribution.md` + Active Innovation Detection | Project file + ledger + detection (Phase 3, WS-E) | File + skill line + UI panel | The ethical differentiator; see WS-E |
| `prompts/session_log.md`, `iteration_review_prompt.md`, `figure_generation_prompt.md` | Fold into commands/skill | Commands | Same as SESSION_START |
| `scripts/shared/logging.py` (`TeeLogger`, `setup_logging`, 90 lines) | Scaffolded verbatim into projects + **validated by hook** (WS-C) | CLI + hook | The logging contract is the audit trail's foundation — enforce, don't hope |
| `scripts/new_script.py`, `new_iteration.py`, `finalize_iteration.py`, `generate_manifest.py` | `openscience iteration new / finalize`, `openscience project export` | CLI | Numbering and bookkeeping must be allocated by code, not remembered by the model |
| `scripts/compile_for_ai.py` | **Drop** | — | Solved a browser-paste problem OpenScience doesn't have; session share + export bundle supersede it |
| Browser-paste mode, per-IDE configs (Roo/Cursor/Windsurf) | **Drop** | — | OpenScience *is* the runtime |
| `skills/smairt-research`, `skills/smairt-paper-driven` | Bundled skills (adapted: strip cookiecutter/compile_for_ai references; point at manifest + iteration commands) | Skills | Already in the right format; teaching material |
| Data progression (synthetic → downloaded → real) | Manifest field + skill guidance + critique-gate check (WS-F) | Manifest + skill + gate | Phase choice is judgment (skill); "real-data claims resting only on synthetic evidence" is checkable (gate) |
| `hpc/` SLURM templates, `monitor_template.py`, `TUTORIAL_HPC.md` | New `slurm-hpc` skill + scaffold `--hpc` flag (WS-F) | Skill + CLI | Biggest accessibility unlock; see WS-F |
| `docs/12_STEPS.md`, `SMAIRT_PHILOSOPHY.md`, tutorials, `BEST_PRACTICE_*.md` | Docs site (`frontend/docs`) "rigorous AI-assisted research" track + scaffolded `docs/` stubs | Docs | Pedagogy is part of accessibility |
| Multi-track naming (A/B/C, X-interpretation) | Manifest naming grammar + `iteration new --track B` | Manifest + CLI | Numbering is allocation, allocation is code |

---

## 4. Cross-cutting design decisions

### 4.1 The project manifest — single source of truth

One machine-readable file makes the whole design coherent: `.openscience/research.jsonc` (extending the existing `.openscience/` project-config convention), written by the scaffold, versioned with the project.

```jsonc
{
  "$schema": "https://openscience.sh/research-project.json",
  "version": 1,
  "mode": "standard",              // standard | paper-driven
  "language": "python",            // python | r | julia | shell | mixed — scopes the logging/import contract (F8)
  "phases": ["synthetic", "downloaded", "real"],
  "currentPhase": "synthetic",
  // Named conventions with PARAMETERS — never raw regex (F6). Code compiles these
  // into matchers; a user can't hand it an uncompilable pattern, and script/log
  // conventions cannot silently desync because they derive from one spec.
  "naming": {
    "convention": "smairt",        // named preset; "smairt" = SMAIRT's grammar
    "pad": 2,                       // zero-pad width for iteration numbers
    "trackChars": "A-Z",           // allowed track letters ("" disables tracks)
    "separator": "_",
    "scriptExt": [".py"]            // extensions the naming/import contract applies to
  },
  // Per-track counters. Solo projects may set "mode":"single"; collaborative
  // projects default to track/author prefixing so two branches never collide (F11).
  "iterations": { "allocation": "per-track", "tracks": { "A": 2, "B": 1 } },
  "gates": { "finalize": "warn", "audit": "annotate" },   // annotate | warn | block; every block is overridable (F16)
  "compute": {
    "requireApproval": true,
    "activeBackend": "slurm-hpc",   // which backend below is current
    "backends": {
      "slurm-hpc": { "kind": "slurm", "profile": "clusters/perlmutter.jsonc", "unit": "node-hours" },
      "modal":     { "kind": "cloud", "unit": "usd" }   // approval unit follows the backend (F13)
    }
  },
  "dataEgress": "restricted"        // open | restricted | air-gapped — gates what may leave the machine (F3)
}
```

**Write-ownership (F15)**: `research.jsonc` is the *only* writable source for counters, phase, and config. `research-state.md` is narrative/derived — it may *render* the counter but never *owns* it. `iteration new`/`finalize` are the only writers of the `iterations` block. This single-writer rule is what makes state safe to *read* after compaction (principle §2.4-5).

Everything reads this one file: the scaffold writes it, `iteration new` allocates from it, the validation hook compiles the named convention into a matcher, the audit command walks it, the skill tells the agent to consult it, and the research-prompt pointer conditions on its existence. **No convention exists anywhere else in normative form.** Changing a convention = changing the manifest = every layer follows, atomically. This is the single most important tech-debt decision in the roadmap.

### 4.2 Reliability tiers — what the researcher is promised

Every SMAIRT-derived behavior is explicitly labeled one of:

- **Tier 1 — guaranteed** (code): scaffold layout, iteration numbering, name/logging validation, provenance auto-recording, audit verification, finalize gate, export bundle. If these fail, it's a bug with a test.
- **Tier 2 — checked** (model does it, code verifies): hypothesis-before-script ordering, analysis-references-log, KNOWN_PATTERNS updates on finalize. The model performs; the gate catches misses and says so.
- **Tier 3 — advisory** (model-only, disclosed as such): interpretation quality, phase-progression judgment, innovation detection sensitivity.

This tiering is user-facing (docs + UI), because trust requires knowing which promises are mechanical and which are best-effort. The current failure mode of *both* projects — SMAIRT's conventions and OpenScience's prompt mandates are all silently Tier 3 — is what this roadmap fixes.

**The integrity-floor invariant (F19)**: Tier 1 alone produces a complete, verifiable audit trail with *zero* model cooperation. If the `smairt-research` skill never loads and the agent ignores every prompt, `iteration new`/`finalize`/`audit` + the hooks still yield a hypothesis→script→log→analysis chain that `openscience audit` can verify. Tiers 2 and 3 raise the *quality of the science*; they are never load-bearing for the *integrity of the record*. This is the concrete meaning of "the platform does what it is told" — the telling that matters is the researcher's `scaffold`/`iteration`/`audit` commands, not the model's cooperation.

### 4.3 Enforcement transparency

Deterministic enforcement must never be silent (silent interference destroys trust from the other direction):

- Every hook rejection/warning surfaces in the session transcript as a visible system note ("`script_7_test.py` doesn't match the project naming contract (`script_NN_description.py`); renamed suggestion: `script_07_test.py`").
- Gates follow the reviewer-gate maturity ladder: **annotate → warn → block**, per-project via `gates` in the manifest. Ship everything at `annotate`, promote with evidence.
- **Every block is overridable (F16).** A `block`-level gate never dead-ends legitimate work: the researcher can pass `--force-gate` (or confirm an interactive prompt), and the override is *recorded as a provenance node* with the reason. A deviation that's logged and attributable is compatible with rigor; a hard stop with no recourse is not — it just teaches users to disable the gate wholesale. The transcript states the override happened.
- A workspace "Session context" panel (Phase 3 stretch, coordinate with plans 05/11) lists exactly what was injected this session: which agent prompt, which instruction files, which skills, which hooks are armed. "What was the agent told?" must be answerable by inspection, not source-diving.

### 4.4 Compaction survivability

Long research sessions get compacted; conventions must not evaporate:

- Tier 1 behaviors are immune by construction (hooks/CLI don't live in context).
- The `experimental.session.compacting` hook appends manifest essentials + current iteration state to the compaction context, so the summarized session retains "this is a SMAIRT project, iteration 7, phase: downloaded".
- `research-state.md` (already the compaction-survival mechanism) gains an iteration-state section, written by `iteration new`/`finalize` — not by the model (write-ownership, §4.1/F15). It *renders* the counter; `research.jsonc` *owns* it.

### 4.5 Token budget — the hard cap

Permanent additions to always-on context, total across the whole roadmap:

| Addition | Where | Cost | Recurrence |
|---|---|---|---|
| SMAIRT pointer | `research.txt` | ≤ 10 lines ≈ 120 tokens | per turn, research sessions only |
| 3 skill catalog entries (`smairt-research`, `smairt-paper-driven`, `slurm-hpc`) | catalog | ~90 tokens | per session |
| Manifest-detected session note | `chat.message` hook, **once per session** (F18) | ~20 tokens | first turn only, SMAIRT projects |
| Scaffolded contract instruction file | instruction load | ≤ 30 lines ≈ 350 tokens | per session, **SMAIRT projects only** |

**AGENTS.md duplication removed (F7).** The v1 plan put a ≤60-line contract summary in a scaffolded `AGENTS.md` — which (a) duplicated the skill, violating §2.3's one-normative-home rule, and (b) risked clobbering a repo's existing `AGENTS.md`. Replaced by a dedicated `.openscience/research-contract.md` wired through config `instructions`, holding only *pointers* (manifest location, "read `KNOWN_PATTERNS.md` before writing code", "use `openscience iteration` commands") — no methodology, which lives solely in the on-demand skill. This *halved* the per-session instruction cost (700→350) and eliminated the collision risk.

Everything else is on-demand (skill bodies ~1.4–2k tokens when loaded; commands when invoked) or zero (code). Non-SMAIRT users pay ~210 tokens total (pointer + catalog lines). For comparison, `research.txt` alone is ~7,200 tokens per turn today — this roadmap adds ~1.7% to it, and any future proposal that wants more always-on text must displace something or become a skill/gate. **This budget is an acceptance criterion, not an aspiration.**

---

## 5. Workstreams

House format per workstream: current state · what's missing · proposed change · risks · acceptance criteria.

### Phase 1 — foundation (no harness behavior changes)

#### WS-A: `openscience research init` — the research-project scaffold (command name per §7/F17)

- **Current state**: OpenScience opens in any directory with no structure. SMAIRT's scaffold requires Python + cookiecutter and knows nothing of OpenScience. `openscience project init` exists but only creates the Atlas graph link.
- **Missing**: a native, interactive scaffold producing the SMAIRT layout + manifest + shared logging lib + `.openscience/research-contract.md` + session commands — plus a way to adopt existing/messy or already-SMAIRT projects.
- **Proposed change**: new command in `backend/cli/src/cli/cmd/` (pattern: `agent.ts` creation CLI). Command name is an open decision (§7/F17) — `openscience research init` is preferred over overloading Atlas-flavored `project`. Three entry modes:
  - **Greenfield** (`init`): flags/prompts for `--mode standard|paper-driven`, `--phase synthetic|downloaded|real`, `--language python|r|julia|mixed`, `--hpc`, `--domain`. Writes: directory tree; `.openscience/research.jsonc` (§4.1); `scripts/shared/` (TeeLogger port, verbatim-compatible with SMAIRT's 90-line `logging.py` so existing users migrate seamlessly — for `--language` other than python, a small equivalent logger in that language); `.openscience/research-contract.md` (≤30 lines, *pointers only* — not a methodology copy, §4.5/F7) wired via config `instructions`; `KNOWN_PATTERNS.md`, `intellectual_contribution.md`, `research-state.md` seeds; `.openscience/command/{iteration-start,interpret,context-refresh}.md`.
  - **Adopt** (`init --adopt`, F5): run against an *existing, messy* repo. Scans for the SMAIRT-ish shape (experiments/scripts/logs/analysis in any layout), *infers* a manifest that matches what's already there (relaxed naming, discovered phases), and reports what it found rather than imposing structure. **Progressive formalization** (§2.4-7): a project can adopt with `gates: annotate` and tighten later; nothing is renamed or moved without explicit `--migrate`.
  - **From SMAIRT** (`init --from-smairt`, F5): read an existing cookiecutter-generated project — translate `prompts/AI_CONTEXT.md`→contract file, `cookiecutter.json`→manifest fields, existing numbering→counters — capturing the current SMAIRT userbase directly.
  - **Never clobbers instruction files (F7)**: if the repo has an `AGENTS.md`/`CLAUDE.md`, the scaffold leaves it untouched and registers the research contract via config `instructions` instead. Reimplements cookiecutter's pre/post-gen validation in TS. Idempotent: re-running only reports drift, never overwrites.
- **Risks**: scaffold divergence from what skills describe (mitigated: skills describe the manifest, not the layout); template-maintenance burden (mitigated: golden-file tests); `--adopt` mis-inferring a manifest on a genuinely unstructured repo (mitigated: adopt *reports* the inferred manifest and requires confirmation before writing; defaults to the most permissive contract that still validates).
- **Acceptance**: greenfield → `openscience audit` (WS-C) passes clean; golden-file test per mode×phase×language; `--adopt` on a hand-built fixture produces a manifest that `audit` passes *without moving any file*; `--from-smairt` on a real cookiecutter output yields a working manifest + preserved history; existing `AGENTS.md` is byte-identical after scaffold; works offline; zero Python required to scaffold (Python only needed to *run* Python experiments).

#### WS-B: bundle the SMAIRT skills + the 10-line prompt pointer

- **Current state**: `smairt-research` and `smairt-paper-driven` exist in skill format in the SMAIRT repo (fully compatible frontmatter). Nothing in OpenScience knows SMAIRT exists.
- **Missing**: the skills in the bundled `skills/research/` tree; a way for the agent to discover a SMAIRT project without being told.
- **Proposed change**:
  1. Adapt both skills: strip cookiecutter/`compile_for_ai`/IDE-mode references; replace "run `new_iteration.py`" with `openscience iteration new`; replace convention prose with "consult `.openscience/research.jsonc`". Add to `skills/research/`.
  2. Add the **pointer** to `research.txt` (the only permanent prompt change in the whole roadmap): *"If `.openscience/research.jsonc` exists, this project follows a structured research contract. Load the `smairt-research` skill (or `smairt-paper-driven` if `mode` is paper-driven), honor the manifest, and use `openscience iteration` commands for all experiment bookkeeping."*
  3. `chat.message` hook adds a one-line system note **once per session** (first turn only, F18) when the manifest is detected, so discovery doesn't depend on the model reading the prompt carefully — and doesn't repeat per-turn.
- **Risks**: skill text drifting from CLI behavior (mitigated: a test asserts every CLI command named in the skill exists — same pattern as the `SYSTEM_SKILLS` sync test in `skill.ts`); pointer ignored by weaker models (mitigated: the hook note + Tier-1 enforcement doesn't depend on it).
- **Acceptance**: skills resolve via `Skill.get` in from-source and binary builds; pointer diff to `research.txt` ≤ 10 lines; non-SMAIRT sessions show zero behavior change (snapshot test on injected context); skill-CLI consistency test green.

### Phase 2 — enforcement (the trust core)

#### WS-C: iteration lifecycle + validation hooks + auto-provenance

- **Current state**: provenance DAG + `provenance_record` tool exist but are model-invoked (Tier 3 in practice). Nothing validates the files the agent writes. SMAIRT numbering/logging is pure convention.
- **Missing**: deterministic iteration bookkeeping; mechanical validation of the naming/logging contract; provenance that records itself.
- **Proposed change**:
  1. **`openscience iteration new [--track X]` is the single blessed path (§2.4-1).** It allocates the next number (single-counter for solo, per-track/author for collaborative — F11), stamps `HYPOTHESIS_NN.md` from template with a success-criteria section, updates `research-state.md`, and **returns the exact paths the agent must write to** — the agent copies them rather than constructing names, which is what actually prevents naming misses (the validation hook is the backstop, not the primary mechanism). **`openscience iteration finalize NN`**: verifies the four-artifact chain (hypothesis exists and predates script; script matches the compiled naming convention and, *for the manifest's declared language*, imports the logging lib; ≥1 log exists matching the log pattern; `ANALYSIS_NN.md` exists and references the log), prompts for `KNOWN_PATTERNS.md` / contribution-ledger updates, records the chain as linked provenance nodes (`claim → run → artifact`), reports at the manifest's `finalize` gate level (overridable, §4.3/F16).
  2. **Validation hook** (`tool.execute.after` on write/edit tools, armed only when the manifest exists): files landing in the contract directories are checked against the *compiled named convention* (F6) — naming, required docstring fields, and the logging-lib import **only for files matching `naming.scriptExt`** (F8: an R or Julia experiment isn't nagged for lacking a Python import; the check is language-scoped or, for `mixed`, per-extension). Violations surface as visible, actionable transcript notes that point back to `iteration new` (§4.3, §2.4-3), never silent rejection at `annotate`/`warn`.
  3. **Notebook contract (F9)**: `.ipynb` experiments don't fit "script → stdout log." When `scriptExt` includes `.ipynb`, the contract is: parameterized execution (papermill-style, or OpenScience's kernel tool) produces an *executed notebook* (+ optional HTML) that serves as the log artifact; the hook checks for the executed output, not a `.log`. If a project doesn't want notebooks under the contract, that's declared in the manifest — the incompatibility is never silent.
  4. **Auto-provenance, with honest limits (F4)**: on `tool.execute.after`(bash), when a *local, foreground* command runs a script under the contract dir, record run + log-artifact nodes automatically (Tier 1 for the local loop). **This cannot fire for async/remote jobs** — `sbatch` returns at submission, before any log exists, and cluster logs live across the SSH boundary. Those are handled by the explicit reconcile step (WS-F): `iteration finalize`/`audit --fix` backfill provenance from logs once they're pulled back. The design never pretends to have captured what it couldn't observe.
- **Risks**: hook false-positives annoying users (mitigated: `annotate` default, manifest-tunable, scoped strictly to contract paths and declared extensions); performance on `tool.execute.after` (mitigated: one compiled matcher over ≤3 directories, benchmark in CI); over-enforcement making exploratory hacking feel policed (mitigated: only contract directories are watched — scratch work anywhere else is untouched; progressive formalization lets a project stay at `annotate`).
- **Acceptance**: end-to-end integration test (real files, no mocks, per house style): scaffold → `iteration new` → writes to the returned paths → run → `finalize` → provenance chain queryable and content-hashes verify; a misnamed script produces a visible annotation naming the fix; an R experiment under `language: r` is *not* nagged for a Python import; a `.ipynb` under the notebook contract validates on executed output; `finalize` at `block` refuses on a missing log, says exactly what's missing, and `--force-gate` records an override node; hook overhead < 5 ms per write.

#### WS-D: project memory + `openscience audit`

- **Current state**: `KNOWN_PATTERNS.md` concept doesn't exist; nothing verifies an audit trail after the fact; instruction files load but nothing curates research memory.
- **Missing**: memory that survives sessions *and* a way to prove the trail is intact — the "traceable" pillar made verifiable.
- **Proposed change**:
  1. The scaffolded `.openscience/research-contract.md` (§4.5/F7) references `KNOWN_PATTERNS.md` so both load at session start (§1.2). `iteration finalize` diffs the session for resolved-error patterns and *proposes* additions (Tier 2: model writes, command reminds).
  2. **`openscience audit [--fix] [--format=json]`**: walks manifest + provenance DAG; verifies every analysis references an existing log, every log maps to a script, every script to a hypothesis; recomputes content hashes against DAG nodes; flags orphans (logs without analyses = unexamined evidence; hypotheses without scripts = untested claims). Exit non-zero on broken chain → **CI-runnable**: a lab can require a green audit on every PR to a research repo. This one command is the platform's trust anchor — "the tool can prove the record is intact" is what neither prompt text nor skill prose can offer. **`--fix` is strictly additive and reversible (F12)**: it may *backfill* missing provenance nodes from files that already exist on disk (including logs pulled back from a cluster, WS-F reconcile) and write a report; it **never renames, moves, or edits user content** — those are surfaced as findings for a human, because auto-renaming an import-referenced script can silently break a project. Anything destructive is out of scope for `--fix` by design.
  3. Compaction hook (§4.4) preserving manifest + iteration state.
- **Risks**: hash-verification cost on large artifact dirs (mitigated: size cutoff, hash only DAG-recorded artifacts); audit rigidity vs. messy real projects (mitigated: `annotate` reporting + explicit `audit.ignore` manifest list + progressive formalization from `--adopt`).
- **Acceptance**: audit green on a freshly scaffolded + WS-C-exercised project; deliberately corrupting a log flips it red naming the exact artifact; `--fix` backfills a provenance node for an orphan log **and touches no other file** (asserted); runs in CI on a fixture project; post-compaction session still knows its iteration number (integration test).

### Phase 3 — differentiators

#### WS-E: intellectual contribution + AI disclosure

- **Current state**: nothing in OpenScience distinguishes human from AI contribution. SMAIRT's `intellectual_contribution.md` + Active Innovation Detection is the strongest ethical idea in either repo — and it's a bare markdown convention.
- **Missing**: the ledger, the detection behavior, and the payoff: journal-ready AI-use disclosure. Nature, Science, and PLOS all now require AI-use statements; no research tool generates them from actual records.
- **Proposed change**:
  1. Ledger file (scaffolded, WS-A) + Active Innovation Detection as a section in the `smairt-research` skill (Tier 3, explicitly): when the human supplies a framing/pivot/interpretation beyond the AI's analysis, the agent asks to log it — mirroring SMAIRT's "do not flag routine decisions" rule.
  2. `iteration finalize` includes a contribution prompt (Tier 2 nudge — the ritual, not the judgment, is enforced).
  3. **`openscience project disclosure`**: generates an AI-use statement from ledger + session metadata (models used, stages AI-performed vs. human-decided, per-iteration provenance) with per-venue templates via the existing `venue-templates` skill.
  4. Workspace contribution panel (coordinate with plan 05 UX polish) — stretch.
- **Risks**: over-flagging becomes noise → users disable it (mitigated: skill wording carries SMAIRT's tested threshold; detection stays Tier-3 advisory); a generated disclosure being wrong is worse than none (mitigated: statement is drafted-for-review, watermarked "generated — verify before submission", every claim cites its ledger/provenance source).
- **Acceptance**: fixture project with seeded ledger → disclosure statement citing only ledger/provenance-backed claims; detection demonstrated in an eval transcript without flagging routine parameter choices; ledger survives compaction (it's a file — Tier 1 by construction).

#### WS-F: HPC/SLURM — the accessibility unlock, designed for how clusters actually work

This is the most detailed workstream because it is both the biggest audience-widener (university + national-lab researchers with free allocations and no cloud budget) and the one where a naïve design fails most users. The v1 draft treated SLURM as "port templates + a config file." The adversarial pass (F1–F4, F13) showed that's wrong in ways that reach the researcher directly.

- **Current state**: `research.txt` hard-mandates *"ALL compute-intensive work runs on cloud GPUs. Never suggest local GPU compute."* This excludes the exact population SMAIRT serves. SMAIRT ships `hpc/config.yaml`, `hpc/templates/slurm_basic.sh`, `scripts/monitor_template.py`, and a 448-line `TUTORIAL_HPC.md` — and the tutorial's dominant message is that *partitions, accounts, QOS, module names, and env paths are all cluster-specific and human-supplied*. Plan 06 (compute integrations) is adjacent; Atlas managed compute is cloud-only.

- **The realities the design must respect** (each drove a decision):
  1. **The agent's shell is local (F1).** `tool/bash.ts` runs in a persistent shell in the working directory — there is no SSH/remote execution primitive. In the common topology (workbench on laptop/workstation, cluster reachable only over SSH, often with MFA), the agent **cannot** run `sbatch`, `squeue`, or read cluster-side logs. It can *generate* correct artifacts; the human runs them. Any design where "the agent submits the job" silently assumes a topology most users don't have.
  2. **No universal scheduler (F2).** SLURM vs PBS/Torque vs SGE vs LSF; Lmod vs tcl-modules vs Spack vs none; conda vs venv vs Apptainer/Singularity vs bare. All human-supplied, none reliably auto-detectable.
  3. **Egress is often blocked or prohibited (F3).** Compute nodes — and frequently login nodes — have no outbound internet. OpenScience's core assumption (each request goes straight to a model provider) can *fail* or be *policy-prohibited* (national-lab/clinical/air-gapped). So the HPC path is coupled to **local/open-weight model operation** and a declared **data-egress policy**.
  4. **Jobs are async and outlive the session (F4).** Hours-to-days of queue; the session ends first. Live provenance capture at submission time records nothing (no log exists yet).

- **Proposed change** — OpenScience is an **artifact generator + reconciler, not a scheduler**:
  1. **Cluster profile (F2)**: `openscience cluster add <name>` captures, *once, from the human*, a profile at `.openscience/clusters/<name>.jsonc` — scheduler kind, submit/poll/cancel commands, partition/account/QOS, module lines, env-activation lines, scratch/project paths, and the SSH/`rsync` transfer recipe (or "same host" if OpenScience runs on the login node). No auto-detection; the tutorial-driven, human-filled approach is what already works at PNNL. Profiles are reusable across projects.
  2. **Two explicit topologies**, chosen in the profile:
     - **Detached (default, F1)**: agent + `slurm-hpc` skill generate a cluster-adapted batch script (from the profile, honoring the manifest's naming so the eventual log matches the contract) and a copy-paste **submission recipe**. The human runs `sbatch`/transfer over their own SSH+MFA session. OpenScience does not pretend to reach the cluster.
     - **On-cluster**: when OpenScience genuinely runs on a login node with a local scheduler, `cluster add --local` marks submit/poll as local bash — then the agent *can* submit and poll. This topology usually implies **no egress** → pair with a local model (see 5).
  3. **Async lifecycle + reconcile (F4, F19-integrity)**: `openscience job submit|status|reconcile`. `submit` (detached) emits the recipe and records a *pending run* provenance node with the job's expected log path — the record exists before the evidence, marked pending. `reconcile` (run after the human reports the job done, or polled on-cluster) ingests the pulled-back log, hashes it, and completes the run→artifact provenance edge. This is the concrete instance of §2.4-6: capture what you can observe, reconcile the rest — never fabricate a completion.
  4. **Resource approval, not just dollars (F13)**: the cost gate generalizes to read the active backend's `unit` from the manifest. Cloud → USD estimate (unchanged). SLURM → node-hours/SU against a declared allocation, with a quota warning. The approval ritual stays; only the unit and the estimate source change.
  5. **Egress policy + local models (F3)**: the manifest's `dataEgress` (`open|restricted|air-gapped`) is enforced at the tool boundary — under `air-gapped`, tools that would send data or prompts off-host are blocked with an explanation, and the agent is steered to a local/open-weight model. This makes OpenScience usable *inside* the compliance envelope national labs and clinical sites require, rather than assuming it away.
  6. **Prompt change**: replace the absolute "cloud GPUs only" rule with a manifest-conditioned line — *"use the compute backend declared in the manifest; for `slurm`, follow the `slurm-hpc` skill and the cluster profile."* Net prompt-length change ≈ 0.
- **Risks**: profile capture is friction (mitigated: one-time, reusable, tutorial-guided — and it's friction the researcher already lives with today via raw SLURM); detached mode means the agent can't close the loop unattended (accepted: correctness beats a false autonomy claim — the recipe + reconcile is honest and still saves the researcher the scripting); local-model quality under `air-gapped` (mitigated: this is the researcher's existing constraint, not one we introduce; OpenScience is already model-agnostic).
- **Acceptance**: `cluster add` round-trips a profile; **detached** mode generates a batch script whose eventual log name satisfies the manifest contract, plus a submission recipe, and records a *pending* provenance node — asserted *without any network/SSH in the test*; `job reconcile` on a supplied log completes the provenance edge and `audit` goes green; **on-cluster** mode submits + polls against a SLURM emulator container in CI; under `dataEgress: air-gapped` a would-be off-host tool call is blocked with a clear message; resource approval shows node-hours for a SLURM backend and USD for a cloud backend.

#### WS-F2: data-progression gate (deterministic) + reproducibility bundle

- **Current state**: `research.txt`'s "real data only" is anti-fabrication, not staged validation; nothing enforces synthetic→benchmark→real discipline; no shareable proof-of-work artifact.
- **Missing**: a *cheap* phase-consistency check and an honest export.
- **Proposed change**:
  1. **Data-progression gate as a code check (F14)**: a deterministic function reads `currentPhase` + provenance and flags real-data *conclusions* whose evidence chain traces only to synthetic runs. It **feeds** the existing pre-COMPUTE gate's report — it is *not* a new critique subagent (no extra LLM call, no added latency/cost). Tier 2, `annotate` first. `starting_phase: real` makes it vacuous by construction — the manifest decides, not the tool.
  2. **`openscience project export` — an *integrity-verifiable* bundle, honestly labeled (F10)**: full audit trail (hypotheses, scripts, logs, analyses, figures) + provenance DAG export + disclosure statement (WS-E) + `MANIFEST.sha256`. Checksums prove **integrity** (files unchanged), which is all a checksum can prove. For **reproducibility** the bundle additionally captures what reproduction actually needs — an environment lockfile (pip/conda/renv), recorded seeds, and data pointers/hashes — and the bundle README states plainly which guarantee is which. Overclaiming "reproducible" when you've only proven "unchanged" is itself an integrity failure, so the artifact never does. `export` runs `audit` first; a bundle that doesn't verify doesn't export.
- **Risks**: phase-gate false positives (mitigated: `annotate` + manifest opt-out); env capture is language-specific (mitigated: capture per declared `language`; absence is reported, not silently omitted).
- **Acceptance**: the phase gate flags a seeded synthetic-only→real-claim fixture, stays quiet on `starting_phase: real`, and adds **zero** model calls (asserted); an exported bundle verifies integrity via `sha256 -c` on a clean machine with no OpenScience installed; the bundle README distinguishes integrity from reproducibility and lists captured env + seeds.

#### WS-G (docs, parallel to any phase): pedagogy port

Port `12_STEPS.md`, `SMAIRT_PHILOSOPHY.md`, tutorials (including `TUTORIAL_HPC.md` — rewritten around the cluster-profile + detached/on-cluster model of WS-F), and both best-practice guides into a "Rigorous AI-assisted research" track on `frontend/docs`, rewritten against OpenScience mechanics (commands instead of Python scripts). Acceptance: a researcher who has never seen SMAIRT can go from install → scaffolded (or `--adopt`ed) project → one verified iteration using only the docs track; a researcher on a terminal-only cluster can go from `cluster add` → generated batch script → `job reconcile` → green `audit` using only the HPC page.

---

## 6. Sequencing and dependencies

```
WS-A (scaffold/adopt + manifest) ──► WS-B (skills + pointer) ──► WS-C (lifecycle + hooks + provenance)
                                                                     │
                                                   WS-D (memory + audit) ◄─┘
                                                                     │
                    ┌────────────────────────────────────────────────┼───────────────────────────┐
              WS-E (contribution/disclosure)     WS-F (HPC: profile+detached+reconcile)     WS-F2 (phase gate + export)
                                                                     │
                                                   WS-G (docs) — parallel throughout
```

- The **manifest (WS-A) blocks everything** — it is the single source of truth every later piece reads. Its schema (§4.1) must be right before WS-C builds on it.
- Phase 1 ships alone as a useful product (scaffold/adopt + skills = "SMAIRT, natively") with zero harness risk.
- Phase 2 is the trust core; do not market "traceable" until WS-C/WS-D land — before that, the audit trail is still Tier 3.
- **WS-F (HPC) can start as soon as the manifest lands** — its cluster-profile + detached-generation parts need only WS-A/WS-B, and it's the biggest audience-widener; only the *reconcile→provenance* edge depends on WS-C. Consider pulling its detached-generation slice forward.
- WS-F's compute alignment is with plan 06; workspace panels (WS-E/§4.3) with plan 05; gate maturity with plan 11's reviewer-gate ladder; permission + egress tightening for scaffolded projects with plan 10 (open questions 3, 6).

## 7. Open questions (owner decisions)

1. **Manifest location**: `.openscience/research.jsonc` (proposed — sits with existing project config) vs. repo-root `research.jsonc` (more visible to humans browsing the repo). Recommend `.openscience/` for consistency; the scaffolded `research-contract.md` makes it discoverable.
2. **Command naming (F17)**: overload `openscience project` (currently Atlas-graph-flavored: `project init` = create graph) with `project scaffold`, or add a distinct top-level `openscience research init` / `openscience iteration` / `openscience audit`? Recommend the distinct namespace — it keeps local-scaffold semantics separate from Atlas-graph semantics and reads more clearly.
3. **Skill distribution**: bundled tree only, or also the Atlas catalog? Catalog enables out-of-band content fixes (good for prose) but means from-source and binary installs can diverge (bad for the CLI-consistency test). Recommend: bundled as source of truth, catalog mirrors it.
4. **Permission + egress defaults for scaffolded projects**: plan 10 flags the global `"*": "allow"` default. Should the scaffold write a tighter per-project policy (ask on network/spend), and should `dataEgress: restricted|air-gapped` (§4.1/F3) *enforce* at the tool boundary? Recommend yes to both — a *research-rigor* scaffold that leaves everything on `allow` undercuts the trust story, and egress enforcement is what makes OpenScience usable inside a national-lab/clinical compliance envelope — but coordinate with plan 10.
5. **Collaborative counter default (F11)**: make track/author-prefixed numbering the default whenever a git remote / multiple committers are detected, or require explicit `--track`? Recommend auto-detect and default to per-track allocation for shared repos; single-counter only for clearly-solo projects.
6. **Language scope for v1 (F8)**: ship the enforced logging contract for Python first (matches the plurality of the research population), with R/Julia/notebook contracts declared in the manifest but validated only on naming + log-presence until their loggers land? Recommend yes — never *nag* a language whose contract isn't implemented; validate only what's checkable.
7. **Naming/branding**: does the mode carry the SMAIRT name (credit to PNNL, discoverability for existing SMAIRT users) or a neutral "research project" label with SMAIRT credited in docs + NOTICE? Licensing is compatible (MIT source → Apache-2.0 project).

## 8. What we explicitly will not do

- **No always-on prompt expansion** beyond the ≤ 10-line pointer (§4.5 budget is binding).
- **No second convention store** — if a rule isn't in the manifest, it isn't a rule (§4.1).
- **No silent enforcement** — every mechanical intervention is visible in the transcript (§4.3).
- **No porting of** `compile_for_ai.py`, browser-paste mode, or per-IDE configs (§3 — obsolete in this runtime; porting them is debt with no user).
- **No blocking gates at launch** — everything ships `annotate`, promotes on evidence (reviewer-gate precedent); every block, once promoted, stays overridable (§4.3/F16).
- **No pretending to reach the cluster (F1)** — in detached mode the agent generates artifacts and a submission recipe; it does not claim to `sbatch`, poll, or read cluster logs it cannot see. Honesty about the boundary beats a false autonomy claim.
- **No overclaiming reproducibility (F10)** — the export bundle proves integrity (checksums) and *supports* reproduction (env + seeds), and says exactly which is which. It never labels "unchanged" as "reproducible."
- **No auto-detecting cluster config (F2)** — profiles are human-captured once and reused. Guessing partitions/modules/accounts fails silently and dangerously.
- **No clobbering a repo's `AGENTS.md`/`CLAUDE.md` (F7)** — the research contract registers via config `instructions`, never by overwriting an existing instruction file.
- **No destructive `audit --fix` (F12)** — fixes are additive/reversible (backfill provenance); renames/moves/content edits are human-confirmed findings only.
- **No SMAIRT lock-in**: a project that deletes the manifest gets stock OpenScience back, completely.
