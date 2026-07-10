import { For, Show, createSignal, type JSX } from "solid-js"
import { useSDK } from "@/context/sdk"
import { FONT_MONO, FONT_SANS } from "@/styles/tokens"

export interface ResearchProtocol {
  id: string
  iterationId: string
  revision: number
  mode: "exploratory" | "confirmatory" | "replication" | "benchmark"
  content: Record<string, unknown>
  frozenAt: string | null
}

function label(value: string) {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (character) => character.toUpperCase())
}

function display(value: unknown) {
  if (Array.isArray(value)) return value.map(String)
  if (value === null || value === undefined) return []
  return [String(value)]
}

async function response(request: Promise<Response>) {
  const value = await request
  if (value.ok) return value.json()
  const body = await value.json().catch(() => ({}))
  throw new Error(body.message || body.error || `Request failed (${value.status})`)
}

export function ProtocolReview(props: {
  protocol: ResearchProtocol
  disabled?: boolean
  onFrozen: () => void | Promise<void>
  onNewRun?: () => void
}): JSX.Element {
  const sdk = useSDK()
  const [reviewing, setReviewing] = createSignal(false)
  const [confirmed, setConfirmed] = createSignal(false)
  const [passphrase, setPassphrase] = createSignal("")
  const [needsPassphrase, setNeedsPassphrase] = createSignal(false)
  const [key, setKey] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal("")
  const fields = () => Object.entries(props.protocol.content).filter(([name]) => name !== "mode")

  const freeze = async () => {
    if (!confirmed()) return
    const idempotencyKey = key() || crypto.randomUUID()
    setKey(idempotencyKey)
    setBusy(true)
    setError("")
    try {
      const endpoint = `${sdk.url.replace(/\/$/, "")}/research/protocols/${encodeURIComponent(props.protocol.id)}/freeze?directory=${encodeURIComponent(sdk.directory)}`
      await response(
        fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
          body: JSON.stringify({
            passphrase: passphrase() || undefined,
            humanConfirmed: true,
          }),
        }),
      )
      setKey("")
      await props.onFrozen()
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      if (message.toLowerCase().includes("passphrase")) setNeedsPassphrase(true)
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={shell}>
      <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
        <span style={pill}>protocol r{props.protocol.revision}</span>
        <span style={status}>{props.protocol.frozenAt ? "frozen" : "draft"}</span>
        <Show when={!props.protocol.frozenAt}>
          <button
            type="button"
            disabled={props.disabled}
            onClick={() => setReviewing((value) => !value)}
            style={{ ...secondaryButton, "margin-left": "auto" }}
          >
            {reviewing() ? "Close review" : "Review protocol"}
          </button>
        </Show>
      </div>
      <Show when={props.protocol.frozenAt}>
        <div style={note}>Formal runs will bind this exact revision. Changes require a new revision.</div>
        <Show when={props.onNewRun}>
          <button type="button" disabled={props.disabled} onClick={props.onNewRun} style={secondaryButton}>
            Declare a formal run
          </button>
        </Show>
      </Show>
      <Show when={reviewing() && !props.protocol.frozenAt}>
        <div style={reviewBox}>
          <div style={warning}>
            Freezing is a scientific control, not a save action. Read every field below; this revision becomes immutable
            and formal runs must follow it.
          </div>
          <For each={fields()}>
            {([name, value]) => (
              <div style={field}>
                <div style={fieldLabel}>{label(name)}</div>
                <For each={display(value)}>{(line) => <div style={fieldValue}>{line}</div>}</For>
              </div>
            )}
          </For>
          <label style={confirmation}>
            <input
              type="checkbox"
              checked={confirmed()}
              onChange={(event) => setConfirmed(event.currentTarget.checked)}
            />
            I reviewed this protocol and intend to freeze it before viewing formal results.
          </label>
          <Show when={needsPassphrase()}>
            <label style={inputLabel}>
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
          <button type="button" disabled={!confirmed() || busy()} onClick={() => void freeze()} style={primaryButton}>
            {busy() ? "Signing and freezing…" : "Freeze reviewed protocol"}
          </button>
        </div>
      </Show>
    </div>
  )
}

const shell: JSX.CSSProperties = { display: "grid", gap: "8px", "margin-top": "10px" }
const pill: JSX.CSSProperties = {
  padding: "2px 5px",
  "border-radius": "4px",
  background: "var(--color-accent-subtle)",
  color: "var(--color-text-muted)",
  "font-family": FONT_MONO,
  "font-size": "9px",
}
const status: JSX.CSSProperties = { color: "var(--color-text-faint)", "font-family": FONT_MONO, "font-size": "9px" }
const note: JSX.CSSProperties = {
  color: "var(--color-text-faint)",
  "font-family": FONT_SANS,
  "font-size": "10px",
  "line-height": 1.45,
}
const reviewBox: JSX.CSSProperties = {
  display: "grid",
  gap: "10px",
  padding: "12px",
  border: "1px solid var(--color-border-strong)",
  "border-radius": "6px",
  background: "var(--color-surface-solid)",
}
const warning: JSX.CSSProperties = {
  color: "var(--color-text-muted)",
  "font-family": FONT_SANS,
  "font-size": "11px",
  "line-height": 1.5,
}
const field: JSX.CSSProperties = { display: "grid", gap: "3px" }
const fieldLabel: JSX.CSSProperties = {
  color: "var(--color-text-faint)",
  "font-family": FONT_MONO,
  "font-size": "9px",
  "text-transform": "uppercase",
}
const fieldValue: JSX.CSSProperties = {
  color: "var(--color-text)",
  "font-family": FONT_SANS,
  "font-size": "11px",
  "line-height": 1.45,
  "white-space": "pre-wrap",
}
const confirmation: JSX.CSSProperties = {
  display: "flex",
  gap: "8px",
  "align-items": "flex-start",
  color: "var(--color-text-muted)",
  "font-family": FONT_SANS,
  "font-size": "11px",
  "line-height": 1.45,
}
const inputLabel: JSX.CSSProperties = {
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
