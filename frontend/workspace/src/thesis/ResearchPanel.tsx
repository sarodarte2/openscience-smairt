import { createResource, createSignal, For, Match, onCleanup, Show, Switch, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { ResearchNav, ResearchProgress, ResearchStatus, ResearchSurface } from "@synsci/ui/research"
import { useSDK } from "@/context/sdk"
import { useDialog } from "@synsci/ui/context/dialog"
import { openSetupDialog } from "@/thesis/SetupDialog"
import { DialogSettings } from "@/components/dialog-settings"
import { FONT_MONO, FONT_SANS } from "@/styles/tokens"
import { IconBookOpen, IconCheckCircle, IconRefresh } from "@/thesis/shared/Icon"
import { IterationComposer } from "@/thesis/IterationComposer"
import { ProtocolReview, type ResearchProtocol } from "@/thesis/ProtocolReview"
import { RunCard, RunComposer, type ResearchRun } from "@/thesis/FormalRunPanel"
import {
  EnvironmentIsolation,
  type EnvironmentIsolationResult,
  type TrackEnvironment,
} from "@/thesis/EnvironmentIsolation"
import { EvidencePanel } from "@/thesis/EvidencePanel"
import { DecisionPanel } from "@/thesis/DecisionPanel"
import { TrustPanel } from "@/thesis/TrustPanel"
import { EnvironmentManager } from "@/thesis/EnvironmentManager"
import { useProviders } from "@/hooks/use-providers"

interface ResearchProject {
  id: string
  name: string
  description: string
  defaultEnvironment: { kind: "conda"; name: string }
  coreTrackId: string
}

interface ResearchStatus {
  initialized: boolean
  root: string
  project?: ResearchProject
  eventCount?: number
  readOnly?: boolean
  diagnostics?: { code: string; file: string; message: string }[]
}

interface ResearchTrack {
  id: string
  alias: string
  title: string
  objective: string
  state: string
  hidden: boolean
}

interface ResearchIteration {
  id: string
  trackId: string
  title: string
  mode: "exploratory" | "confirmatory" | "replication" | "benchmark"
  question: string
  state: string
}

interface ResearchWorkflow {
  currentStage: "frame" | "hypothesize" | "plan" | "execute" | "interpret" | "review" | "decide"
  stages: {
    id: string
    label: string
    detail: string
    state: "complete" | "current" | "pending" | "blocked"
  }[]
  blockers: { code: string; message: string }[]
  nextActions: {
    id: string
    label: string
    section: "overview" | "tracks" | "evidence" | "publications" | "people"
    enabled: boolean
    reason?: string
  }[]
}

async function response<T>(request: Promise<Response>): Promise<T> {
  const value = await request
  if (value.ok) return value.json()
  const body = await value.json().catch(() => ({}))
  throw new Error(body.message || body.error || `Request failed (${value.status})`)
}

export function ResearchPanel(): JSX.Element {
  const sdk = useSDK()
  const dialog = useDialog()
  const providers = useProviders()
  const endpoint = (path = "") =>
    `${sdk.url.replace(/\/$/, "")}/research${path}?directory=${encodeURIComponent(sdk.directory)}`
  const [status, { refetch }] = createResource(() => response<ResearchStatus>(fetch(endpoint())))
  const [tracks, { refetch: refetchTracks }] = createResource(
    () => status()?.initialized,
    (initialized) => (initialized ? response<ResearchTrack[]>(fetch(endpoint("/tracks"))) : Promise.resolve([])),
  )
  const [iterations, { refetch: refetchIterations }] = createResource(
    () => status()?.initialized,
    (initialized) =>
      initialized ? response<ResearchIteration[]>(fetch(endpoint("/iterations"))) : Promise.resolve([]),
  )
  const [protocols, { refetch: refetchProtocols }] = createResource(
    () => status()?.initialized,
    (initialized) => (initialized ? response<ResearchProtocol[]>(fetch(endpoint("/protocols"))) : Promise.resolve([])),
  )
  const [runs, { refetch: refetchRuns }] = createResource(
    () => status()?.initialized,
    (initialized) => (initialized ? response<ResearchRun[]>(fetch(endpoint("/runs"))) : Promise.resolve([])),
  )
  const [environments, { refetch: refetchEnvironments }] = createResource(
    () => status()?.initialized,
    (initialized) =>
      initialized ? response<TrackEnvironment[]>(fetch(endpoint("/environments"))) : Promise.resolve([]),
  )
  const [workflow, { refetch: refetchWorkflow }] = createResource(
    () => (status()?.initialized ? endpoint("/workflow") : undefined),
    (url) => response<ResearchWorkflow>(fetch(url)),
  )
  const [setup, setSetup] = createStore({
    name: "",
    description: "",
    createCondaEnvironment: true,
    passphrase: "",
  })
  const [track, setTrack] = createStore({
    title: "",
    objective: "",
    workspaceKind: "none",
    branch: "",
    worktreePath: "",
  })
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal("")
  const [needsPassphrase, setNeedsPassphrase] = createSignal(false)
  const [showTrack, setShowTrack] = createSignal(false)
  const [showIteration, setShowIteration] = createSignal(false)
  const [trackMutationKey, setTrackMutationKey] = createSignal("")
  const [selectedProtocol, setSelectedProtocol] = createSignal("")
  const [isolatingTrack, setIsolatingTrack] = createSignal("")
  const [environmentNotice, setEnvironmentNotice] = createSignal("")
  const [showEnvironment, setShowEnvironment] = createSignal(false)
  const [liveOperation, setLiveOperation] = createSignal<{ kind: string; state: string }>()
  const [setupElapsed, setSetupElapsed] = createSignal(0)
  const [view, setView] = createSignal<"overview" | "tracks" | "evidence" | "publications" | "people">("overview")
  let setupAbort: AbortController | undefined
  let setupTimer: ReturnType<typeof setInterval> | undefined

  const subscriptions = [
    sdk.event.on("research.operation.updated", (event) => {
      setLiveOperation({ kind: event.properties.kind, state: event.properties.state })
    }),
    sdk.event.on("research.track.updated", () => {
      void Promise.all([refetch(), refetchTracks(), refetchEnvironments()])
    }),
    sdk.event.on("research.iteration.updated", () => {
      void Promise.all([refetch(), refetchIterations(), refetchProtocols()])
    }),
    sdk.event.on("research.run.updated", () => {
      void Promise.all([refetch(), refetchRuns()])
    }),
    sdk.event.on("research.audit.updated", () => {
      void Promise.all([refetch(), refetchWorkflow()])
    }),
  ]
  onCleanup(() => subscriptions.forEach((unsubscribe) => unsubscribe()))
  onCleanup(() => {
    if (setupTimer) clearInterval(setupTimer)
    setupAbort?.abort()
  })

  const initialize = async (event: SubmitEvent) => {
    event.preventDefault()
    setBusy(true)
    setError("")
    setSetupElapsed(0)
    setupAbort = new AbortController()
    setupTimer = setInterval(() => setSetupElapsed((value) => value + 1), 1000)
    try {
      await response(
        fetch(endpoint("/initialize"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: setup.name,
            description: setup.description || undefined,
            createCondaEnvironment: setup.createCondaEnvironment,
            passphrase: setup.passphrase || undefined,
            humanConfirmed: true,
          }),
          signal: setupAbort.signal,
        }),
      )
      setSetup("passphrase", "")
      await refetch()
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") {
        setError(
          "Stopped waiting for project setup. The server may still finish the current stage; refresh status before retrying.",
        )
        return
      }
      const message = cause instanceof Error ? cause.message : String(cause)
      if (message.toLowerCase().includes("passphrase")) setNeedsPassphrase(true)
      setError(message)
    } finally {
      if (setupTimer) clearInterval(setupTimer)
      setupTimer = undefined
      setupAbort = undefined
      setBusy(false)
    }
  }

  const createTrack = async (event: SubmitEvent) => {
    event.preventDefault()
    setBusy(true)
    setError("")
    const idempotencyKey = trackMutationKey() || crypto.randomUUID()
    setTrackMutationKey(idempotencyKey)
    try {
      await response(
        fetch(endpoint("/tracks"), {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
          body: JSON.stringify({
            title: track.title,
            objective: track.objective,
            workspace:
              track.workspaceKind === "new-worktree"
                ? { kind: "new-worktree", branch: track.branch, worktreePath: track.worktreePath }
                : { kind: track.workspaceKind },
            passphrase: setup.passphrase || undefined,
            humanConfirmed: true,
          }),
        }),
      )
      setTrack({ title: "", objective: "", workspaceKind: "none", branch: "", worktreePath: "" })
      setTrackMutationKey("")
      setShowTrack(false)
      await Promise.all([refetch(), refetchTracks()])
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      if (message.toLowerCase().includes("passphrase")) setNeedsPassphrase(true)
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section style={shell} aria-label="OpenScience Research">
      <header class="os-research-toolbar" style={header}>
        <div style={{ display: "flex", "align-items": "center", gap: "9px" }}>
          <IconBookOpen size={15} strokeWidth={1.5} />
          <div>
            <div style={title}>OpenScience Research</div>
            <div style={subtitle}>
              <Show when={liveOperation()} fallback="Powered by SMAIRT methodology">
                {(operation) => `${operation().kind} · ${operation().state}`}
              </Show>
            </div>
          </div>
        </div>
        <button
          type="button"
          title="refresh research status"
          onClick={() =>
            void Promise.all([
              refetch(),
              refetchTracks(),
              refetchIterations(),
              refetchProtocols(),
              refetchRuns(),
              refetchEnvironments(),
              refetchWorkflow(),
            ])
          }
          style={iconButton}
        >
          <IconRefresh size={13} strokeWidth={1.5} />
        </button>
        <button type="button" onClick={() => openSetupDialog(dialog)} style={setupButton}>
          Models & connectors
        </button>
      </header>

      <main style={body}>
        <Show when={error()}>
          <div role="alert" style={errorBox}>
            {error()}
          </div>
        </Show>
        <Switch>
          <Match when={status.loading}>
            <ResearchProgress
              stage="Opening study"
              detail="Verifying the local research record and its signed history."
            />
          </Match>
          <Match when={status.error}>
            <div role="alert" style={errorBox}>
              {status.error instanceof Error ? status.error.message : String(status.error)}
            </div>
          </Match>
          <Match when={!status()?.initialized}>
            <div style={hero}>
              <div style={{ "font-family": FONT_SANS, "font-size": "15px", "font-weight": 650 }}>
                Turn this repository into a reproducible study
              </div>
              <p style={copy}>
                Your Git repository stays authoritative. OpenScience adds a signed scientific record, a hidden core
                track, and a project-named Python environment—without committing or publishing anything for you.
              </p>
            </div>
            <form onSubmit={initialize} style={form}>
              <label style={label}>
                Project name
                <input
                  required
                  value={setup.name}
                  onInput={(event) => setSetup("name", event.currentTarget.value)}
                  placeholder="e.g. Protein foundation model study"
                  style={input}
                />
              </label>
              <label style={label}>
                Research objective
                <textarea
                  value={setup.description}
                  onInput={(event) => setSetup("description", event.currentTarget.value)}
                  placeholder="What are you trying to learn?"
                  rows={4}
                  style={input}
                />
              </label>
              <label style={checkLabel}>
                <input
                  type="checkbox"
                  checked={setup.createCondaEnvironment}
                  onChange={(event) => setSetup("createCondaEnvironment", event.currentTarget.checked)}
                />
                Create the project-named Conda environment now
              </label>
              <Show when={needsPassphrase()}>
                <label style={label}>
                  Signing-key passphrase
                  <input
                    required
                    minlength="12"
                    type="password"
                    autocomplete="new-password"
                    value={setup.passphrase}
                    onInput={(event) => setSetup("passphrase", event.currentTarget.value)}
                    style={input}
                  />
                  <span style={hint}>Used only when the operating-system keychain is unavailable.</span>
                </label>
              </Show>
              <button type="submit" disabled={busy()} style={primaryButton}>
                {busy()
                  ? setup.createCondaEnvironment
                    ? `Creating signed project and Conda environment · ${setupElapsed()}s`
                    : `Creating signed project · ${setupElapsed()}s`
                  : "Set up research project"}
              </button>
              <Show when={busy()}>
                <div style={progressRow} role="status" aria-live="polite">
                  <span>
                    {setup.createCondaEnvironment
                      ? "Conda may take several minutes on first use. The repository is validated before records are written."
                      : "Writing the signed project record and hidden core track."}
                  </span>
                  <button type="button" style={cancelButton} onClick={() => setupAbort?.abort()}>
                    Cancel
                  </button>
                </div>
              </Show>
              <button
                type="button"
                style={secondaryButton}
                onClick={() => dialog.show(() => <DialogSettings initialPanel="credentials" />)}
              >
                Configure models, keys, local endpoints, or connectors
              </button>
            </form>
          </Match>
          <Match when={status()?.initialized}>
            <ResearchNav
              value={view()}
              onChange={setView}
              items={[
                { id: "overview", label: "Overview" },
                { id: "tracks", label: "Tracks", count: (tracks() ?? []).filter((item) => !item.hidden).length },
                { id: "evidence", label: "Evidence", count: runs()?.length ?? 0 },
                { id: "publications", label: "Publications" },
                { id: "people", label: "People" },
              ]}
            />
            <Show when={view() === "overview"}>
              <ResearchSurface class="os-study-summary">
                <div style={projectCard}>
                  <div
                    style={{
                      display: "flex",
                      "align-items": "center",
                      gap: "7px",
                      color: status()?.readOnly ? "var(--color-danger)" : "var(--color-success)",
                    }}
                  >
                    <IconCheckCircle size={14} strokeWidth={1.6} />
                    <span style={{ "font-family": FONT_MONO, "font-size": "10px" }}>
                      {status()?.readOnly ? "integrity attention needed" : "signed record verified"}
                    </span>
                  </div>
                  <h2 style={{ margin: "10px 0 3px", "font-family": FONT_SANS, "font-size": "16px" }}>
                    {status()?.project?.name}
                  </h2>
                  <div style={subtitle}>
                    {status()?.eventCount} events · conda: {status()?.project?.defaultEnvironment.name}
                  </div>
                  <Show when={status()?.project?.description}>
                    <p style={copy}>{status()?.project?.description}</p>
                  </Show>
                  <Show when={status()?.readOnly}>
                    <p role="alert" style={{ ...copy, color: "var(--color-danger)" }}>
                      The project is read-only because {status()?.diagnostics?.length ?? 0} ledger integrity issue(s)
                      need review. No scientific records will be changed.
                    </p>
                  </Show>
                </div>
              </ResearchSurface>
              <SmairtCycle
                workflow={workflow()}
                disabled={status()?.readOnly}
                onAction={(action) => {
                  setView(action.section)
                  if (action.id === "iteration.create") setShowIteration(true)
                  if (action.id === "run.declare") {
                    const protocol = (protocols() ?? []).find((value) => !!value.frozenAt)
                    if (protocol) setSelectedProtocol(protocol.id)
                  }
                }}
              />
              <div class="os-overview-grid">
                <ResearchSurface class="os-overview-card">
                  <span class="os-eyebrow">Environment</span>
                  <strong>{status()?.project?.defaultEnvironment.name}</strong>
                  <span>Project-named Conda environment</span>
                  <button
                    class="os-button"
                    type="button"
                    disabled={status()?.readOnly}
                    onClick={() => setShowEnvironment((value) => !value)}
                  >
                    {showEnvironment() ? "Close environment manager" : "Manage packages"}
                  </button>
                </ResearchSurface>
                <ResearchSurface class="os-overview-card">
                  <span class="os-eyebrow">Research record</span>
                  <strong>{status()?.eventCount} signed events</strong>
                  <span>
                    {status()?.readOnly ? "Read-only until integrity findings are resolved" : "Writable and verified"}
                  </span>
                </ResearchSurface>
                <ResearchSurface class="os-overview-card">
                  <span class="os-eyebrow">Model readiness</span>
                  <strong>
                    {providers.connected().length
                      ? `${providers.connected().length} provider(s) ready`
                      : "Connection required"}
                  </strong>
                  <span>
                    {providers.connected().length
                      ? "Assistant generation is available"
                      : "Runs and records remain available offline"}
                  </span>
                  <Show when={!providers.connected().length}>
                    <button
                      class="os-button"
                      type="button"
                      onClick={() => dialog.show(() => <DialogSettings initialPanel="credentials" />)}
                    >
                      Connect a model
                    </button>
                  </Show>
                </ResearchSurface>
              </div>
              <Show when={showEnvironment() && status()?.project?.coreTrackId}>
                <ResearchSurface>
                  <EnvironmentManager
                    trackId={status()?.project?.coreTrackId ?? ""}
                    disabled={status()?.readOnly}
                    onApplied={() => void Promise.all([refetch(), refetchEnvironments(), refetchWorkflow()])}
                  />
                </ResearchSurface>
              </Show>
            </Show>

            <Show when={view() === "tracks"}>
              <div style={sectionHeader}>
                <div>
                  <div style={title}>Scientific tracks</div>
                  <div style={subtitle}>Parallel approaches share evidence without becoming branch names.</div>
                </div>
                <button
                  type="button"
                  disabled={status()?.readOnly}
                  onClick={() => setShowTrack((value) => !value)}
                  style={secondaryButton}
                >
                  {showTrack() ? "Cancel" : "New track"}
                </button>
              </div>
              <Show when={showTrack()}>
                <form onSubmit={createTrack} style={form}>
                  <label style={label}>
                    Track title
                    <input
                      required
                      value={track.title}
                      onInput={(event) => setTrack("title", event.currentTarget.value)}
                      placeholder="e.g. Sparse adaptation"
                      style={input}
                    />
                  </label>
                  <label style={label}>
                    What is distinct about this approach?
                    <textarea
                      required
                      value={track.objective}
                      onInput={(event) => setTrack("objective", event.currentTarget.value)}
                      rows={3}
                      style={input}
                    />
                  </label>
                  <label style={label}>
                    Workspace binding
                    <select
                      style={input}
                      value={track.workspaceKind}
                      onInput={(event) => setTrack("workspaceKind", event.currentTarget.value)}
                    >
                      <option value="none">Scientific track only</option>
                      <option value="current">Bind current Git workspace</option>
                      <option value="new-worktree">Create a branch and worktree</option>
                    </select>
                  </label>
                  <Show when={track.workspaceKind === "new-worktree"}>
                    <label style={label}>
                      Branch name
                      <input
                        required
                        style={input}
                        value={track.branch}
                        onInput={(event) => setTrack("branch", event.currentTarget.value)}
                        placeholder="experiment/sparse-adaptation"
                      />
                    </label>
                    <label style={label}>
                      Worktree folder
                      <input
                        required
                        style={input}
                        value={track.worktreePath}
                        onInput={(event) => setTrack("worktreePath", event.currentTarget.value)}
                        placeholder="/path/to/study-sparse"
                      />
                    </label>
                  </Show>
                  <button type="submit" disabled={busy()} style={primaryButton}>
                    Create track
                  </button>
                  <span style={hint}>No branch is created. You can bind a workspace when the approach needs one.</span>
                </form>
              </Show>
              <div style={{ display: "grid", gap: "8px" }}>
                <Show when={environmentNotice()}>
                  <div role="status" style={projectCard}>
                    {environmentNotice()}
                  </div>
                </Show>
                <For each={(tracks() ?? []).filter((item) => !item.hidden)}>
                  {(item) => {
                    const environment = () => (environments() ?? []).find((value) => value.trackId === item.id)
                    return (
                      <article style={trackCard}>
                        <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
                          <span style={statePill}>{item.state}</span>
                          <strong style={{ "font-family": FONT_SANS, "font-size": "13px" }}>{item.title}</strong>
                        </div>
                        <p style={{ ...copy, margin: "7px 0 0" }}>{item.objective}</p>
                        <Show when={environment()}>
                          {(binding) => (
                            <div style={{ display: "flex", "align-items": "center", gap: "7px", "margin-top": "9px" }}>
                              <span style={statePill}>conda · {binding().state}</span>
                              <span style={subtitle}>{binding().name}</span>
                              <Show when={binding().state === "inherited"}>
                                <button
                                  type="button"
                                  disabled={status()?.readOnly}
                                  onClick={() => setIsolatingTrack(item.id)}
                                  style={{ ...secondaryButton, "margin-left": "auto" }}
                                >
                                  Isolate environment
                                </button>
                              </Show>
                            </div>
                          )}
                        </Show>
                        <Show when={isolatingTrack() === item.id && environment()}>
                          {(binding) => (
                            <EnvironmentIsolation
                              trackId={item.id}
                              current={binding()}
                              onCancel={() => setIsolatingTrack("")}
                              onIsolated={async (result: EnvironmentIsolationResult) => {
                                setIsolatingTrack("")
                                setEnvironmentNotice(
                                  `Created ${result.environment.name}. Provision when ready: ${result.provision.command} ${result.provision.args.join(" ")}`,
                                )
                                await Promise.all([refetch(), refetchEnvironments()])
                              }}
                            />
                          )}
                        </Show>
                      </article>
                    )
                  }}
                </For>
                <Show when={(tracks() ?? []).filter((item) => !item.hidden).length === 0}>
                  <div style={quiet}>No parallel tracks yet. The core track is active in the background.</div>
                </Show>
              </div>

              <div style={sectionHeader}>
                <div>
                  <div style={title}>Iterations and protocols</div>
                  <div style={subtitle}>Declare intent before formal execution.</div>
                </div>
                <button
                  type="button"
                  disabled={status()?.readOnly || (tracks() ?? []).length === 0}
                  onClick={() => setShowIteration((value) => !value)}
                  style={secondaryButton}
                >
                  {showIteration() ? "Cancel" : "New iteration"}
                </button>
              </div>
              <Show when={showIteration()}>
                <IterationComposer
                  tracks={(tracks() ?? []).map((item) => ({
                    id: item.id,
                    title: item.hidden ? "Primary approach" : item.title,
                  }))}
                  onCancel={() => setShowIteration(false)}
                  onCreated={async () => {
                    setShowIteration(false)
                    await Promise.all([refetch(), refetchIterations(), refetchProtocols()])
                  }}
                />
              </Show>
              <div style={{ display: "grid", gap: "8px" }}>
                <For each={iterations() ?? []}>
                  {(item) => (
                    <article style={trackCard}>
                      <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
                        <span style={statePill}>{item.mode}</span>
                        <strong style={{ "font-family": FONT_SANS, "font-size": "13px" }}>{item.title}</strong>
                        <span style={{ ...subtitle, "margin-left": "auto" }}>{item.state}</span>
                      </div>
                      <p style={{ ...copy, margin: "7px 0 0" }}>{item.question}</p>
                      <For each={(protocols() ?? []).filter((protocol) => protocol.iterationId === item.id)}>
                        {(protocol) => (
                          <ProtocolReview
                            protocol={protocol}
                            disabled={status()?.readOnly}
                            onFrozen={async () => {
                              await Promise.all([refetch(), refetchIterations(), refetchProtocols()])
                            }}
                            onNewRun={() => setSelectedProtocol(protocol.id)}
                          />
                        )}
                      </For>
                      <Show
                        when={(protocols() ?? []).find(
                          (protocol) => protocol.id === selectedProtocol() && protocol.iterationId === item.id,
                        )}
                      >
                        {(protocol) => (
                          <RunComposer
                            protocolId={protocol().id}
                            onCancel={() => setSelectedProtocol("")}
                            onDeclared={async () => {
                              setSelectedProtocol("")
                              await Promise.all([refetch(), refetchRuns()])
                            }}
                          />
                        )}
                      </Show>
                      <For each={(runs() ?? []).filter((run) => run.iterationId === item.id)}>
                        {(run) => (
                          <RunCard
                            run={run}
                            disabled={status()?.readOnly}
                            onUpdated={async () => {
                              await Promise.all([refetch(), refetchRuns()])
                            }}
                          />
                        )}
                      </For>
                    </article>
                  )}
                </For>
                <Show when={(iterations() ?? []).length === 0}>
                  <div style={quiet}>No iterations yet. Start by declaring what this study should learn or decide.</div>
                </Show>
              </div>
            </Show>
            <Show when={view() === "evidence"}>
              <EvidencePanel
                iterations={(iterations() ?? []).map((item) => ({ id: item.id, title: item.title }))}
                disabled={status()?.readOnly}
              />
              <DecisionPanel
                iterations={(iterations() ?? []).map((item) => ({
                  id: item.id,
                  trackId: item.trackId,
                  title: item.title,
                }))}
                tracks={(tracks() ?? []).map((item) => ({ id: item.id, title: item.title, hidden: item.hidden }))}
                disabled={status()?.readOnly}
              />
            </Show>
            <Show when={view() === "publications"}>
              <TrustPanel disabled={status()?.readOnly} section="publications" />
            </Show>
            <Show when={view() === "people"}>
              <TrustPanel disabled={status()?.readOnly} section="people" />
            </Show>
          </Match>
        </Switch>
      </main>
    </section>
  )
}

function SmairtCycle(props: {
  workflow?: ResearchWorkflow
  disabled?: boolean
  onAction: (action: ResearchWorkflow["nextActions"][number]) => void
}): JSX.Element {
  const action = () => props.workflow?.nextActions[0]

  return (
    <ResearchSurface class="os-cycle">
      <div class="os-cycle__heading">
        <div>
          <span class="os-eyebrow">SMAIRT cycle</span>
          <h2>One clear next scientific action</h2>
        </div>
        <button
          type="button"
          class="os-button os-button--primary"
          disabled={props.disabled || !action()?.enabled}
          onClick={() => action() && props.onAction(action()!)}
        >
          {action()?.label ?? "Loading next action…"}
        </button>
      </div>
      <div class="os-cycle__steps">
        <For each={props.workflow?.stages ?? []}>
          {(stage, index) => (
            <div
              class="os-cycle__step"
              classList={{
                "os-cycle__step--complete": stage.state === "complete",
                "os-cycle__step--current": stage.state === "current" || stage.state === "blocked",
              }}
            >
              <span class="os-cycle__marker">{stage.state === "complete" ? "✓" : index() + 1}</span>
              <div>
                <strong>{stage.label}</strong>
                <span>{stage.detail}</span>
              </div>
            </div>
          )}
        </For>
      </div>
      <ResearchStatus
        tone={props.disabled ? "danger" : "success"}
        label={props.disabled ? "Formal actions paused" : "Signed study record active"}
        detail={
          props.disabled
            ? "Resolve integrity findings before continuing."
            : "Stages advance from recorded evidence, not clicks."
        }
      />
    </ResearchSurface>
  )
}

const shell: JSX.CSSProperties = {
  flex: 1,
  "min-height": 0,
  display: "flex",
  "flex-direction": "column",
  background:
    "radial-gradient(circle at 12% 0%, color-mix(in srgb, var(--color-accent) 8%, transparent), transparent 32%), var(--color-bg)",
}
const header: JSX.CSSProperties = {
  display: "flex",
  "align-items": "center",
  "justify-content": "space-between",
  padding: "12px 14px",
  "border-bottom": "1px solid var(--color-border)",
  background: "color-mix(in srgb, var(--color-bg) 82%, transparent)",
  "backdrop-filter": "blur(20px) saturate(1.15)",
}
const body: JSX.CSSProperties = {
  flex: 1,
  overflow: "auto",
  padding: "14px",
  display: "grid",
  gap: "12px",
  "align-content": "start",
}
const title: JSX.CSSProperties = {
  "font-family": FONT_SANS,
  "font-size": "12px",
  "font-weight": 650,
  color: "var(--color-text)",
}
const subtitle: JSX.CSSProperties = {
  "font-family": FONT_MONO,
  "font-size": "10px",
  color: "var(--color-text-faint)",
  "line-height": 1.5,
}
const hero: JSX.CSSProperties = {
  padding: "16px",
  background: "var(--color-surface-solid)",
  border: "1px solid var(--color-border)",
  "border-radius": "8px",
}
const copy: JSX.CSSProperties = {
  "font-family": FONT_SANS,
  "font-size": "12px",
  color: "var(--color-text-muted)",
  "line-height": 1.55,
}
const form: JSX.CSSProperties = {
  display: "grid",
  gap: "11px",
  padding: "14px",
  border: "1px solid var(--color-border)",
  "border-radius": "8px",
  background: "var(--color-bg)",
}
const label: JSX.CSSProperties = {
  display: "grid",
  gap: "6px",
  "font-family": FONT_SANS,
  "font-size": "11px",
  color: "var(--color-text-muted)",
}
const checkLabel: JSX.CSSProperties = {
  display: "flex",
  gap: "8px",
  "align-items": "center",
  "font-family": FONT_SANS,
  "font-size": "11px",
  color: "var(--color-text-muted)",
}
const input: JSX.CSSProperties = {
  width: "100%",
  "box-sizing": "border-box",
  padding: "8px 9px",
  border: "1px solid var(--color-border-strong)",
  "border-radius": "5px",
  background: "var(--color-surface-solid)",
  color: "var(--color-text)",
  "font-family": FONT_SANS,
  "font-size": "12px",
  resize: "vertical",
}
const primaryButton: JSX.CSSProperties = {
  border: 0,
  "border-radius": "5px",
  padding: "9px 12px",
  background: "var(--color-accent)",
  color: "var(--color-on-accent)",
  "font-family": FONT_SANS,
  "font-size": "12px",
  "font-weight": 650,
  cursor: "pointer",
}
const secondaryButton: JSX.CSSProperties = {
  border: "1px solid var(--color-border)",
  "border-radius": "5px",
  padding: "6px 9px",
  background: "var(--color-surface-solid)",
  color: "var(--color-text)",
  "font-family": FONT_MONO,
  "font-size": "10px",
  cursor: "pointer",
}
const iconButton: JSX.CSSProperties = {
  border: 0,
  background: "transparent",
  color: "var(--color-text-muted)",
  cursor: "pointer",
  padding: "6px",
}
const setupButton: JSX.CSSProperties = {
  border: "1px solid color-mix(in srgb, var(--color-accent) 25%, var(--color-border))",
  "border-radius": "999px",
  padding: "6px 10px",
  background: "color-mix(in srgb, var(--color-surface-solid) 78%, transparent)",
  color: "var(--color-text)",
  "font-family": FONT_MONO,
  "font-size": "10px",
  cursor: "pointer",
}
const progressRow: JSX.CSSProperties = {
  display: "flex",
  gap: "10px",
  "align-items": "center",
  "justify-content": "space-between",
  padding: "9px 10px",
  "border-radius": "7px",
  background: "var(--color-accent-subtle)",
  color: "var(--color-text-muted)",
  "font-family": FONT_SANS,
  "font-size": "11px",
  "line-height": 1.45,
}
const cancelButton: JSX.CSSProperties = {
  border: "1px solid var(--color-border)",
  "border-radius": "999px",
  padding: "5px 9px",
  background: "var(--color-surface-solid)",
  color: "var(--color-text)",
  cursor: "pointer",
  "font-family": FONT_MONO,
  "font-size": "10px",
  "flex-shrink": 0,
}
const projectCard: JSX.CSSProperties = {
  padding: "14px",
  border: "1px solid var(--color-border)",
  "border-radius": "8px",
  background: "var(--color-surface-solid)",
}
const sectionHeader: JSX.CSSProperties = {
  display: "flex",
  "align-items": "center",
  "justify-content": "space-between",
  gap: "12px",
  padding: "4px 1px",
}
const trackCard: JSX.CSSProperties = {
  padding: "12px",
  border: "1px solid var(--color-border)",
  "border-radius": "7px",
  background: "var(--color-bg)",
}
const statePill: JSX.CSSProperties = {
  padding: "2px 5px",
  "border-radius": "4px",
  background: "var(--color-accent-subtle)",
  color: "var(--color-text-muted)",
  "font-family": FONT_MONO,
  "font-size": "9px",
}
const hint: JSX.CSSProperties = {
  "font-family": FONT_SANS,
  "font-size": "10px",
  color: "var(--color-text-faint)",
  "line-height": 1.4,
}
const quiet: JSX.CSSProperties = {
  padding: "18px",
  "text-align": "center",
  "font-family": FONT_SANS,
  "font-size": "11px",
  color: "var(--color-text-faint)",
}
const errorBox: JSX.CSSProperties = {
  padding: "10px",
  border: "1px solid var(--color-danger)",
  "border-radius": "6px",
  color: "var(--color-danger)",
  "font-family": FONT_SANS,
  "font-size": "11px",
  "line-height": 1.45,
}
