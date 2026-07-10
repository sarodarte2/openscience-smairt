import { Show, createSignal, type JSX } from "solid-js"
import { useSDK } from "@/context/sdk"
import { FONT_MONO, FONT_SANS } from "@/styles/tokens"

export interface TrackEnvironment {
  trackId: string
  name: string
  portableSpecPath: string
  state: "base" | "inherited" | "diverged"
  inheritedFromTrackId: string | null
}

export interface EnvironmentIsolationResult {
  environment: TrackEnvironment
  eventId: string
  replayed: boolean
  provision: { command: "conda"; args: string[] }
}

async function response<T>(request: Promise<Response>): Promise<T> {
  const value = await request
  if (value.ok) return value.json()
  const body = await value.json().catch(() => ({}))
  throw new Error(body.message || body.error || `Request failed (${value.status})`)
}

export function EnvironmentIsolation(props: {
  trackId: string
  current: TrackEnvironment
  onIsolated: (result: EnvironmentIsolationResult) => void | Promise<void>
  onCancel: () => void
}): JSX.Element {
  const sdk = useSDK()
  const [confirmed, setConfirmed] = createSignal(false)
  const [passphrase, setPassphrase] = createSignal("")
  const [needsPassphrase, setNeedsPassphrase] = createSignal(false)
  const [key, setKey] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal("")

  const isolate = async () => {
    if (!confirmed()) return
    const idempotencyKey = key() || crypto.randomUUID()
    setKey(idempotencyKey)
    setBusy(true)
    setError("")
    try {
      const endpoint = `${sdk.url.replace(/\/$/, "")}/research/environments/${encodeURIComponent(props.trackId)}/isolate?directory=${encodeURIComponent(sdk.directory)}`
      const result = await response<EnvironmentIsolationResult>(
        fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
          body: JSON.stringify({ passphrase: passphrase() || undefined, humanConfirmed: true }),
        }),
      )
      setKey("")
      await props.onIsolated(result)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      if (message.toLowerCase().includes("passphrase")) setNeedsPassphrase(true)
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={box}>
      <div style={title}>Isolate this track’s environment?</div>
      <div style={copy}>
        OpenScience will copy <span style={mono}>{props.current.name}</span> into a track-specific Conda specification.
        The parent and sibling tracks will not change. No packages are installed automatically.
      </div>
      <label style={confirmation}>
        <input type="checkbox" checked={confirmed()} onChange={(event) => setConfirmed(event.currentTarget.checked)} />I
        want this track to manage dependencies independently.
      </label>
      <Show when={needsPassphrase()}>
        <label style={label}>
          Signing-key passphrase
          <input
            required
            minlength="12"
            type="password"
            autocomplete="current-password"
            value={passphrase()}
            onInput={(event) => setPassphrase(event.currentTarget.value)}
            style={input}
          />
        </label>
      </Show>
      <Show when={error()}>
        <div role="alert" style={errorStyle}>
          {error()}
        </div>
      </Show>
      <div style={actions}>
        <button type="button" onClick={props.onCancel} style={secondaryButton}>
          Cancel
        </button>
        <button type="button" disabled={!confirmed() || busy()} onClick={() => void isolate()} style={primaryButton}>
          {busy() ? "Creating boundary…" : "Create isolated specification"}
        </button>
      </div>
    </div>
  )
}

const box: JSX.CSSProperties = {
  display: "grid",
  gap: "10px",
  padding: "12px",
  border: "1px solid var(--color-border-strong)",
  "border-radius": "6px",
  background: "var(--color-surface-solid)",
  "margin-top": "9px",
}
const title: JSX.CSSProperties = {
  color: "var(--color-text)",
  "font-family": FONT_SANS,
  "font-size": "12px",
  "font-weight": 650,
}
const copy: JSX.CSSProperties = {
  color: "var(--color-text-muted)",
  "font-family": FONT_SANS,
  "font-size": "11px",
  "line-height": 1.5,
}
const mono: JSX.CSSProperties = { "font-family": FONT_MONO, "font-size": "10px" }
const confirmation: JSX.CSSProperties = {
  display: "flex",
  gap: "8px",
  "align-items": "flex-start",
  color: "var(--color-text-muted)",
  "font-family": FONT_SANS,
  "font-size": "11px",
  "line-height": 1.45,
}
const label: JSX.CSSProperties = {
  display: "grid",
  gap: "6px",
  color: "var(--color-text-muted)",
  "font-family": FONT_SANS,
  "font-size": "11px",
}
const input: JSX.CSSProperties = {
  width: "100%",
  "box-sizing": "border-box",
  padding: "8px 9px",
  border: "1px solid var(--color-border-strong)",
  "border-radius": "5px",
  background: "var(--color-bg)",
  color: "var(--color-text)",
  "font-family": FONT_SANS,
  "font-size": "12px",
}
const actions: JSX.CSSProperties = { display: "flex", gap: "8px", "justify-content": "flex-end" }
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
  padding: "8px 11px",
  background: "var(--color-bg)",
  color: "var(--color-text)",
  "font-family": FONT_MONO,
  "font-size": "10px",
  cursor: "pointer",
}
const errorStyle: JSX.CSSProperties = {
  padding: "9px",
  border: "1px solid var(--color-danger)",
  "border-radius": "5px",
  color: "var(--color-danger)",
  "font-family": FONT_SANS,
  "font-size": "10px",
}
