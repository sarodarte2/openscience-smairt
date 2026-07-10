import { createResource, createSignal, For, Match, Show, Switch, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { useSDK } from "@/context/sdk"
import { FONT_MONO, FONT_SANS } from "@/styles/tokens"
import { IconBookOpen, IconCheckCircle, IconRefresh } from "@/thesis/shared/Icon"

interface ResearchProject {
  id: string
  name: string
  description: string
  defaultEnvironment: { kind: "conda"; name: string }
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

async function response<T>(request: Promise<Response>): Promise<T> {
  const value = await request
  if (value.ok) return value.json()
  const body = await value.json().catch(() => ({}))
  throw new Error(body.message || body.error || `Request failed (${value.status})`)
}

export function ResearchPanel(): JSX.Element {
  const sdk = useSDK()
  const endpoint = (path = "") =>
    `${sdk.url.replace(/\/$/, "")}/research${path}?directory=${encodeURIComponent(sdk.directory)}`
  const [status, { refetch }] = createResource(() => response<ResearchStatus>(fetch(endpoint())))
  const [tracks, { refetch: refetchTracks }] = createResource(
    () => status()?.initialized,
    (initialized) => (initialized ? response<ResearchTrack[]>(fetch(endpoint("/tracks"))) : Promise.resolve([])),
  )
  const [setup, setSetup] = createStore({
    name: "",
    description: "",
    createCondaEnvironment: true,
    passphrase: "",
  })
  const [track, setTrack] = createStore({ title: "", objective: "" })
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal("")
  const [needsPassphrase, setNeedsPassphrase] = createSignal(false)
  const [showTrack, setShowTrack] = createSignal(false)

  const initialize = async (event: SubmitEvent) => {
    event.preventDefault()
    setBusy(true)
    setError("")
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
        }),
      )
      setSetup("passphrase", "")
      await refetch()
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      if (message.toLowerCase().includes("passphrase")) setNeedsPassphrase(true)
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  const createTrack = async (event: SubmitEvent) => {
    event.preventDefault()
    setBusy(true)
    setError("")
    try {
      await response(
        fetch(endpoint("/tracks"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: track.title,
            objective: track.objective,
            workspace: { kind: "none" },
            passphrase: setup.passphrase || undefined,
            humanConfirmed: true,
          }),
        }),
      )
      setTrack({ title: "", objective: "" })
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
      <header style={header}>
        <div style={{ display: "flex", "align-items": "center", gap: "9px" }}>
          <IconBookOpen size={15} strokeWidth={1.5} />
          <div>
            <div style={title}>OpenScience Research</div>
            <div style={subtitle}>Powered by SMAIRT methodology</div>
          </div>
        </div>
        <button type="button" title="refresh research status" onClick={() => void refetch()} style={iconButton}>
          <IconRefresh size={13} strokeWidth={1.5} />
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
            <div style={quiet}>Opening the local research record…</div>
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
                {busy() ? "Preparing project…" : "Set up research project"}
              </button>
            </form>
          </Match>
          <Match when={status()?.initialized}>
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
                  The project is read-only because {status()?.diagnostics?.length ?? 0} ledger integrity issue(s) need
                  review. No scientific records will be changed.
                </p>
              </Show>
            </div>

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
                <button type="submit" disabled={busy()} style={primaryButton}>
                  Create track
                </button>
                <span style={hint}>No branch is created. You can bind a workspace when the approach needs one.</span>
              </form>
            </Show>
            <div style={{ display: "grid", gap: "8px" }}>
              <For each={(tracks() ?? []).filter((item) => !item.hidden)}>
                {(item) => (
                  <article style={trackCard}>
                    <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
                      <span style={statePill}>{item.state}</span>
                      <strong style={{ "font-family": FONT_SANS, "font-size": "13px" }}>{item.title}</strong>
                    </div>
                    <p style={{ ...copy, margin: "7px 0 0" }}>{item.objective}</p>
                  </article>
                )}
              </For>
              <Show when={(tracks() ?? []).filter((item) => !item.hidden).length === 0}>
                <div style={quiet}>No parallel tracks yet. The core track is active in the background.</div>
              </Show>
            </div>
          </Match>
        </Switch>
      </main>
    </section>
  )
}

const shell: JSX.CSSProperties = { flex: 1, "min-height": 0, display: "flex", "flex-direction": "column" }
const header: JSX.CSSProperties = {
  display: "flex",
  "align-items": "center",
  "justify-content": "space-between",
  padding: "12px 14px",
  "border-bottom": "1px solid var(--color-border)",
  background: "var(--color-bg)",
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
