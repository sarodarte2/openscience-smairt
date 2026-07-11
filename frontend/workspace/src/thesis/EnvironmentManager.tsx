import { Show, createSignal } from "solid-js"
import { useSDK } from "@/context/sdk"

interface Plan {
  environmentName: string
  currentSpecHash: string
  proposedEnvironmentYml: string
  additions: string[]
  removals: string[]
  solve: { state: "not_requested" | "solvable" | "conda_unavailable" | "conflict"; error?: string }
  blockingRuns: { id: string; state: string }[]
  canApply: boolean
}

async function response<T>(request: Promise<Response>): Promise<T> {
  const value = await request
  if (value.ok) return value.json()
  const body = await value.json().catch(() => ({}))
  throw new Error(body.message || body.error || `Request failed (${value.status})`)
}

function entries(value: string) {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

export function EnvironmentManager(props: { trackId: string; disabled?: boolean; onApplied?: () => void }) {
  const sdk = useSDK()
  const endpoint = (suffix: string) =>
    `${sdk.url.replace(/\/$/, "")}/research/environments/${props.trackId}${suffix}?directory=${encodeURIComponent(sdk.directory)}`
  const [python, setPython] = createSignal("3.12")
  const [conda, setConda] = createSignal("")
  const [pip, setPip] = createSignal("")
  const [solve, setSolve] = createSignal(false)
  const [plan, setPlan] = createSignal<Plan>()
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal("")
  const [notice, setNotice] = createSignal("")
  const body = () => ({ python: python(), condaPackages: entries(conda()), pipPackages: entries(pip()) })

  const preview = async () => {
    setBusy(true)
    setError("")
    setNotice("")
    try {
      setPlan(
        await response<Plan>(
          fetch(endpoint("/plan"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...body(), solve: solve() }),
          }),
        ),
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const apply = async () => {
    const current = plan()
    if (!current) return
    setBusy(true)
    setError("")
    try {
      const result = await response<{ rollback: string }>(
        fetch(endpoint("/apply"), {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify({ ...body(), expectedSpecHash: current.currentSpecHash, humanConfirmed: true }),
        }),
      )
      setNotice(`Environment specification updated. ${result.rollback}`)
      setPlan(undefined)
      props.onApplied?.()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section class="os-environment-manager" aria-label="Environment manager">
      <div class="os-form-grid os-form-grid--three">
        <label class="os-field">
          <span>Python</span>
          <select value={python()} onInput={(event) => setPython(event.currentTarget.value)}>
            <option value="3.10">3.10</option>
            <option value="3.11">3.11</option>
            <option value="3.12">3.12</option>
            <option value="3.13">3.13</option>
          </select>
        </label>
        <label class="os-field">
          <span>Conda packages</span>
          <textarea
            value={conda()}
            onInput={(event) => setConda(event.currentTarget.value)}
            placeholder="numpy&#10;pandas"
          />
        </label>
        <label class="os-field">
          <span>Pip packages</span>
          <textarea value={pip()} onInput={(event) => setPip(event.currentTarget.value)} placeholder="transformers" />
        </label>
      </div>
      <label class="os-check-row">
        <input type="checkbox" checked={solve()} onChange={(event) => setSolve(event.currentTarget.checked)} />
        Ask Conda to dry-run the solve before applying
      </label>
      <div class="os-inline-actions">
        <button class="os-button" type="button" disabled={busy() || props.disabled} onClick={() => void preview()}>
          {busy() ? "Planning…" : "Preview exact change"}
        </button>
        <Show when={plan()}>
          {(value) => (
            <button
              class="os-button os-button--primary"
              type="button"
              disabled={busy() || props.disabled || !value().canApply}
              onClick={() => void apply()}
            >
              Apply signed update
            </button>
          )}
        </Show>
      </div>
      <Show when={error()}>
        <div class="os-callout os-callout--danger" role="alert">
          {error()}
        </div>
      </Show>
      <Show when={notice()}>
        <div class="os-callout" role="status">
          {notice()}
        </div>
      </Show>
      <Show when={plan()}>
        {(value) => (
          <div class="os-environment-plan">
            <div class="os-plan-summary">
              <span>{value().additions.length} additions</span>
              <span>{value().removals.length} removals</span>
              <span>Solve: {value().solve.state.replaceAll("_", " ")}</span>
            </div>
            <Show when={value().solve.error}>
              <div class="os-callout os-callout--danger">{value().solve.error}</div>
            </Show>
            <Show when={value().blockingRuns.length}>
              <div class="os-callout os-callout--danger">Formal runs currently block this change.</div>
            </Show>
            <pre>{value().proposedEnvironmentYml}</pre>
          </div>
        )}
      </Show>
    </section>
  )
}
