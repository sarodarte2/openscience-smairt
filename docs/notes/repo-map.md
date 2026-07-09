# OpenScience — agent repo map

Purpose: let an agent locate any subsystem in one read, without re-exploring. Paths are
relative to the repo root (`openscience-smairt/`). Pair this with [CLAUDE.md](../../CLAUDE.md)
(prompt-chain RCA) and [ARCHITECTURE.md](../../ARCHITECTURE.md) (system shape). When code
moves, update this file.

Product: OpenScience (`@synsci/openscience`, binary `openscience`) — an open-source,
model-agnostic AI research workbench. Bun + TypeScript, compiled to native binaries. Runs a
local server + browser workspace; agent runtime routes each request to any of 75+ providers.

## Top level

```
backend/cli          The CLI, server, agent runtime, tools, skills, science layer  ← most work happens here
frontend/workspace   Browser workspace UI (SolidJS), embedded into the binary
frontend/ui          Shared UI components, themes, fonts
frontend/docs        Astro docs + session-share site (openscience.sh/docs)
frontend/landing     Marketing site
tooling/sdk/js       TypeScript SDK, generated from tooling/sdk/openapi.json
tooling/plugin       Plugin runtime (@synsci/plugin) — hook surface lives here
tooling/launcher     `npx synsci` installer
tooling/repo         Release automation; generate.ts regenerates the SDK
tooling/{script,util,patches}   Build helper, @synsci/util, install-time dep patches
docs/plans           Sprint plan docs (one per workstream); 12-smairt-integration.md is the SMAIRT roadmap
docs/notes           Engineering notes: skills.md, verification.md, release-process.md, deferred.md, this file
.openscience/        This repo's own project config: agent/, command/, skill/, themes/, openscience.jsonc
```

Root config: `package.json` (scripts: `dev`, `typecheck`, `test`, `build`, `check`, `format`),
`turbo.json`, `bunfig.toml`, `tsconfig.json`, `AGENTS.md` (style guide — read before writing TS).

## backend/cli/src — subsystem index

| Dir | What it owns | Start file |
|---|---|---|
| `agent/` | Agent registry + behavior prompts | `agent.ts` (definitions), `prompt/*.txt` (behavior) |
| `session/` | The agent runtime: message loop, prompt routing, compaction, review gate | `index.ts`, `prompt.ts`, `system.ts` |
| `session/prompt/` | Provider-level system prompts (anthropic.txt, gemini.txt, …) + plan/utility | selected by `system.ts` |
| `session/rlm/` | Research-state artifacts + state persistence across compaction | `state.ts`, `artifacts.ts` |
| `session/rsi/` | Recursive self-improvement: distill learned skills from past runs | `distill.ts`, `critic.ts`, `lifecycle.ts`, `trajectory.ts` |
| `tool/` | Every agent-callable tool (bash, edit, read, write, glob, grep, task, provenance, science, …) | `registry.ts` (assembles the set), `tool.ts` (defn helper) |
| `tool/biology/` | Persistent-kernel notebook tool (long-lived Python process) | `notebook.ts` |
| `science/` | Scientific database connectors + provenance DAG + language kernels | `connectors/index.ts`, `provenance/store.ts` |
| `science/connectors/` | DB clients: literature, genomics, proteins, chemistry, omics, pathways | `http.ts`, `types.ts`, per-domain dirs |
| `science/provenance/` | Content-addressed provenance DAG + its blind-review pass | `store.ts`, `review.ts` |
| `science/kernel/` | Generalized persistent-kernel interface (python, R, …) | `types.ts` |
| `skill/` | Skill catalog assembly, install/validation, embedded system skills | `skill.ts`, `install/review.ts`, `system/` |
| `provider/` | Model routing; catalog from models.dev + bundled snapshot | `provider/`, `sdk/` |
| `config/` | Config schema (Zod) + markdown-frontmatter parser | `config.ts`, `markdown.ts` |
| `permission/` | Permission policy engine (`ask`/`allow`/`deny`) | `index.ts`, `next.ts`, `arity.ts` |
| `cli/cmd/` | Every `openscience <cmd>` subcommand | see command table below |
| `server/` | Hono server: serves UI, session/tool APIs, SSE | `server/`, `routes/` |
| `server/routes/` | HTTP routes incl. `project.ts`, `session.ts`, `settings/` | one file per resource |
| `plugin/` | In-process plugin loading (runtime contract in tooling/plugin) | `plugin/` |
| `mcp/` | MCP client integration | `mcp/` |
| `lsp/` | Language-server bridge | `lsp/` |
| `project/` | Project instance + on-disk state resolution | `instance.ts`, `state.ts` |
| `global/` | XDG path resolution, legacy `synsc` migration | `index.ts` |
| `openscience/` | Atlas client (optional managed platform) | `openscience/` |
| `flag/` | Feature/opt-out flags (e.g. `OPENSCIENCE_DISABLE_*`) | `flag.ts` |
| `command/` | User slash-command loading + templates | `command/`, `template/` |
| `format`, `id`, `bus`, `storage`, `util`, `env`, `snapshot`, `share`, `worktree`, `pty`, `shell`, `web`, `acp`, `scheduler`, `question`, `installation`, `auth`, `patch`, `settings`, `file`, `bun` | supporting infra | — |

## Agents (`agent/agent.ts` + `agent/prompt/`)

Default user-facing agent: **`research`**. Specialists: `biology`, `physics`, `ml`. Read-only
mode: `plan`. Hidden subagents: `task`, `explore`, `literature-review`, `critique`, `reviewer`,
`physics-critique`, `write`. System: `compaction`, `title`.

Behavior prompt per agent is `agent/prompt/<name>.txt`. `research.txt` (~7.2k tokens) is the big
one — it defines the 8-stage workflow (SCOPE → LITERATURE → REASON → METHODOLOGY → COMPUTE →
ANALYZE → SYNTHESIZE → WRITE), the mandatory pre/post-COMPUTE critique gates, `research-state.md`,
and `experiments.tsv` tracking.

## Prompt chain (how an agent gets its instructions)

Two layers, both in `session/`:
1. **System role** — `system.ts` → `SystemPrompt.provider(model)` picks `session/prompt/<provider>.txt`.
2. **User-role injection** — `prompt.ts` → `insertReminders()` pushes the agent's `agent/prompt/<name>.txt`
   as a synthetic message part **on every turn** (search `input.agent.name === "research"`).

Debug a misbehaving agent in this order: `agent/agent.ts` (which agent/model) → `session/prompt.ts`
(which prompt injected) → `session/system.ts` (which system prompt). Full RCA table in CLAUDE.md.

## Where behavior can be shaped (integration surfaces)

Ranked by determinism — this is the decision axis for the SMAIRT roadmap (docs/plans/12).

| Surface | File(s) | Determinism | Token cost |
|---|---|---|---|
| Agent prompt | `agent/prompt/*.txt`, injected in `session/prompt.ts` | model-dependent, always present | per-turn, everyone |
| System prompt | `session/prompt/*.txt`, `session/system.ts` | model-dependent, always present | per-turn, everyone |
| Instruction files | `session/instruction.ts` (loads `AGENTS.md`/`CLAUDE.md` up the tree) | model-dependent, per-project | per-session, opt-in |
| Skills | `skill/skill.ts`; catalog line always, body on load | doubly model-dependent (load + comply) | ~30 tok until loaded |
| Slash commands | `command/`, `.openscience/command/*.md` | present when invoked | zero until invoked |
| CLI commands | `cli/cmd/*.ts` | **exact** | zero |
| Hooks | `tooling/plugin/src/index.ts` → `Hooks` (see below) | **exact** | zero |
| Agent tools | `tool/*.ts` (e.g. `provenance.ts`) | model-invoked | tool I/O |
| Code gates | `session/review.ts` (reviewer gate, loop-exit, config-gated) | **exact** | output only |

### Hook surface (`tooling/plugin/src/index.ts`, `interface Hooks`)

`event`, `config`, `tool` (add tools), `auth`, `chat.message`, `chat.params`, `chat.headers`,
`permission.ask`, `command.execute.before`, `tool.execute.before`, `tool.execute.after`,
`experimental.chat.messages.transform`, `experimental.chat.system.transform`,
`experimental.session.compacting`. All run regardless of model cooperation — the deterministic
layer for the SMAIRT roadmap (naming/logging validation → `tool.execute.after`; auto-provenance
→ `tool.execute.after` on bash; compaction survival → `experimental.session.compacting`).

## Skills (`skill/skill.ts`, `docs/notes/skills.md`)

Catalog assembled by name from, in precedence order: project `.claude/skills/` → Atlas catalog
(`/api/cli/skills`, released builds) → bundled `backend/cli/skills/` tree (from source) →
embedded system skills (`skill/system/`) → learned skills (RSI) → user skills. Earlier shadows
later. `SYSTEM_SKILLS` in `skill.ts` embeds skills the product invokes directly; a test keeps
them synced with the bundled tree.

Bundled catalog (`backend/cli/skills/<category>/`): biology 43, chemistry 23, cloud-compute 10,
coding 20, data-engineering 10, databases 32, document-parsing 1, llm-tools 31, ml-inference 9,
ml-training 52, physics 23, quantum 4, research 9, scholar-evaluation 3, visualization 8,
writing 10, other 6. **SMAIRT skills would land in `skills/research/`.**

## Provenance DAG (SMAIRT's audit trail already has a home here)

- `science/provenance/store.ts` — content-addressed nodes (`artifact`|`run`|`source`|`claim`)
  + edges (`derived-from`, …). Recording identical content returns the same id.
- `tool/provenance.ts` — agent-facing `provenance_record` + audit tools (model-invoked today).
- `science/provenance/review.ts` — blind review over the DAG.
- `session/review.ts` — WS11 reviewer gate: runs a blind reviewer at loop exit **independent of
  whether the agent self-reviewed**. Config-gated (`config.experimental.reviewGate`),
  annotate-only at level 0. **This is the precedent pattern for all SMAIRT gates: code-enforced,
  config-gated, non-blocking first.**

## Config (`config/config.ts`, Zod schema)

Keys relevant to integration: `agent` (custom agents), `skills`/`skills.paths` (extra skill
folders), `instructions` (extra instruction file patterns), `permission` (policy;
`PermissionAction = ask|allow|deny`), `mcp`, `provider`, `plugin`, `command`, `experimental`.
Global config: `~/.config/openscience/openscience.json`. Project config: `openscience.json` or
`.openscience/` at repo root. **Proposed SMAIRT manifest home: `.openscience/research.jsonc`.**

Permission note: the shipped default policy is effectively `allow` (no isolation) — see
`docs/plans/10-agent-sandboxing.md`. Relevant to whether a scaffolded research project should
write a tighter per-project policy.

## CLI commands (`cli/cmd/*.ts`)

`web` (default — opens workspace), `serve` (headless server), `run` (one-shot message/command),
`session`, `agent` (create/manage agents), `skill` (new/validate/list), `project` (**Atlas graph
only today: `init` = find-or-create research graph, writes `.openscience/project.json`**),
`export` (session JSON), `models`, `auth`, `connect`, `billing`, `mcp`, `import`, `generate`,
`github`, `pr`, `stats`, `local`, `upgrade`, `uninstall`, `acp`, `cmd`, `debug/`. **New SMAIRT
commands (`project scaffold`, `iteration new/finalize`, `audit`, `project disclosure/export`)
would be added here.**

## Build / test / CI

Dev: `bun run dev`. Typecheck: `bun run typecheck`. Test: `cd backend/cli && bun test` (no mocks —
test real implementations, per AGENTS.md). Build binaries: `cd backend/cli && bun run build`
(`script/build.ts`). CI in `.github/workflows/`: `ci.yml`, `e2e.yml`, `catalog.yml` (nightly
model-catalog check), `codeql.yml`, `gitleaks.yml`, `publish.yml`, `scorecard.yml`.

## Style (AGENTS.md — enforced expectations for TS here)

`const` over `let`; avoid `else` (early return / iife); avoid `try`/`catch`; no `any`; prefer
single-word names; keep code in one function unless reusable; avoid unnecessary destructuring;
use Bun APIs (`Bun.file()`); rely on type inference; parallel tool calls when independent.
