import { For, Show, Switch, Match, createSignal, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { useSDK } from "@/context/sdk"
import { FONT_MONO, FONT_SANS } from "@/styles/tokens"

export interface IterationTrackOption {
  id: string
  title: string
}

type Mode = "exploratory" | "confirmatory" | "replication" | "benchmark"

function lines(value: string) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
}

async function response(request: Promise<Response>) {
  const value = await request
  if (value.ok) return value.json()
  const body = await value.json().catch(() => ({}))
  throw new Error(body.message || body.error || `Request failed (${value.status})`)
}

export function IterationComposer(props: {
  tracks: IterationTrackOption[]
  onCreated: () => void | Promise<void>
  onCancel: () => void
}): JSX.Element {
  const sdk = useSDK()
  const endpoint = () =>
    `${sdk.url.replace(/\/$/, "")}/research/iterations?directory=${encodeURIComponent(sdk.directory)}`
  const [form, setForm] = createStore({
    trackId: props.tracks[0]?.id ?? "",
    title: "",
    question: "",
    decisionGoal: "",
    mode: "exploratory" as Mode,
    aim: "",
    intendedInputs: "",
    intendedOutputs: "",
    hypothesis: "",
    nullHypothesis: "",
    primaryOutcome: "",
    controls: "",
    exclusions: "",
    statisticalMethod: "",
    stoppingRule: "",
    decisionRule: "",
    sourceProtocol: "",
    faithfulElements: "",
    deviations: "",
    equivalenceRule: "",
    datasetsAndSplits: "",
    baselines: "",
    metrics: "",
    leakageBoundary: "",
    passphrase: "",
  })
  const [key, setKey] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal("")
  const [needsPassphrase, setNeedsPassphrase] = createSignal(false)

  const content = () => {
    if (form.mode === "exploratory") {
      return {
        mode: form.mode,
        aim: form.aim,
        intendedInputs: lines(form.intendedInputs),
        intendedOutputs: lines(form.intendedOutputs),
        decisionGoal: form.decisionGoal,
      }
    }
    if (form.mode === "confirmatory") {
      return {
        mode: form.mode,
        hypothesis: form.hypothesis,
        nullHypothesis: form.nullHypothesis,
        primaryOutcome: form.primaryOutcome,
        controls: lines(form.controls),
        exclusions: lines(form.exclusions),
        statisticalMethod: form.statisticalMethod,
        stoppingRule: form.stoppingRule,
        decisionRule: form.decisionRule,
      }
    }
    if (form.mode === "replication") {
      return {
        mode: form.mode,
        sourceProtocol: form.sourceProtocol,
        faithfulElements: lines(form.faithfulElements),
        deviations: lines(form.deviations),
        equivalenceRule: form.equivalenceRule,
      }
    }
    return {
      mode: form.mode,
      datasetsAndSplits: lines(form.datasetsAndSplits),
      baselines: lines(form.baselines),
      metrics: lines(form.metrics),
      leakageBoundary: form.leakageBoundary,
    }
  }

  const submit = async (event: SubmitEvent) => {
    event.preventDefault()
    const idempotencyKey = key() || crypto.randomUUID()
    setKey(idempotencyKey)
    setBusy(true)
    setError("")
    try {
      await response(
        fetch(endpoint(), {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
          body: JSON.stringify({
            trackId: form.trackId,
            title: form.title,
            question: form.question,
            decisionGoal: form.decisionGoal,
            content: content(),
            passphrase: form.passphrase || undefined,
            humanConfirmed: true,
          }),
        }),
      )
      setKey("")
      await props.onCreated()
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      if (message.toLowerCase().includes("passphrase")) setNeedsPassphrase(true)
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} style={formStyle}>
      <Show when={error()}>
        <div role="alert" style={errorStyle}>
          {error()}
        </div>
      </Show>
      <label style={labelStyle}>
        Scientific track
        <select
          value={form.trackId}
          onChange={(event) => setForm("trackId", event.currentTarget.value)}
          style={inputStyle}
        >
          <For each={props.tracks}>{(track) => <option value={track.id}>{track.title}</option>}</For>
        </select>
      </label>
      <label style={labelStyle}>
        Study mode
        <select
          value={form.mode}
          onChange={(event) => setForm("mode", event.currentTarget.value as Mode)}
          style={inputStyle}
        >
          <option value="exploratory">Exploratory — learn what to test next</option>
          <option value="confirmatory">Confirmatory — test a frozen hypothesis</option>
          <option value="replication">Replication — reproduce a source protocol</option>
          <option value="benchmark">Benchmark — compare against fixed baselines</option>
        </select>
      </label>
      <Field label="Iteration title" value={form.title} onInput={(value) => setForm("title", value)} />
      <Field
        label="Research question"
        value={form.question}
        onInput={(value) => setForm("question", value)}
        multiline
      />
      <Field
        label="Decision this should inform"
        value={form.decisionGoal}
        onInput={(value) => setForm("decisionGoal", value)}
        multiline
      />

      <Switch>
        <Match when={form.mode === "exploratory"}>
          <Field label="Exploratory aim" value={form.aim} onInput={(value) => setForm("aim", value)} multiline />
          <Field
            label="Intended inputs — one per line"
            value={form.intendedInputs}
            onInput={(value) => setForm("intendedInputs", value)}
            multiline
          />
          <Field
            label="Intended outputs — one per line"
            value={form.intendedOutputs}
            onInput={(value) => setForm("intendedOutputs", value)}
            multiline
          />
        </Match>
        <Match when={form.mode === "confirmatory"}>
          <Field
            label="Hypothesis"
            value={form.hypothesis}
            onInput={(value) => setForm("hypothesis", value)}
            multiline
          />
          <Field
            label="Null hypothesis"
            value={form.nullHypothesis}
            onInput={(value) => setForm("nullHypothesis", value)}
            multiline
          />
          <Field
            label="Primary outcome"
            value={form.primaryOutcome}
            onInput={(value) => setForm("primaryOutcome", value)}
          />
          <Field
            label="Controls — one per line"
            value={form.controls}
            onInput={(value) => setForm("controls", value)}
            multiline
          />
          <Field
            label="Exclusions — one per line"
            value={form.exclusions}
            onInput={(value) => setForm("exclusions", value)}
            multiline
            required={false}
          />
          <Field
            label="Statistical method"
            value={form.statisticalMethod}
            onInput={(value) => setForm("statisticalMethod", value)}
            multiline
          />
          <Field
            label="Stopping rule"
            value={form.stoppingRule}
            onInput={(value) => setForm("stoppingRule", value)}
            multiline
          />
          <Field
            label="Decision rule"
            value={form.decisionRule}
            onInput={(value) => setForm("decisionRule", value)}
            multiline
          />
        </Match>
        <Match when={form.mode === "replication"}>
          <Field
            label="Source protocol"
            value={form.sourceProtocol}
            onInput={(value) => setForm("sourceProtocol", value)}
            multiline
          />
          <Field
            label="Faithful elements — one per line"
            value={form.faithfulElements}
            onInput={(value) => setForm("faithfulElements", value)}
            multiline
          />
          <Field
            label="Deviations — one per line"
            value={form.deviations}
            onInput={(value) => setForm("deviations", value)}
            multiline
            required={false}
          />
          <Field
            label="Equivalence rule"
            value={form.equivalenceRule}
            onInput={(value) => setForm("equivalenceRule", value)}
            multiline
          />
        </Match>
        <Match when={form.mode === "benchmark"}>
          <Field
            label="Datasets and splits — one per line"
            value={form.datasetsAndSplits}
            onInput={(value) => setForm("datasetsAndSplits", value)}
            multiline
          />
          <Field
            label="Baselines — one per line"
            value={form.baselines}
            onInput={(value) => setForm("baselines", value)}
            multiline
          />
          <Field
            label="Metrics — one per line"
            value={form.metrics}
            onInput={(value) => setForm("metrics", value)}
            multiline
          />
          <Field
            label="Leakage boundary"
            value={form.leakageBoundary}
            onInput={(value) => setForm("leakageBoundary", value)}
            multiline
          />
        </Match>
      </Switch>
      <Show when={needsPassphrase()}>
        <Field
          label="Signing-key passphrase"
          value={form.passphrase}
          onInput={(value) => setForm("passphrase", value)}
          type="password"
        />
      </Show>
      <div style={{ display: "flex", gap: "8px", "justify-content": "flex-end" }}>
        <button type="button" onClick={props.onCancel} style={secondaryButton}>
          Cancel
        </button>
        <button type="submit" disabled={busy() || !form.trackId} style={primaryButton}>
          {busy() ? "Creating…" : "Create draft protocol"}
        </button>
      </div>
    </form>
  )
}

function Field(props: {
  label: string
  value: string
  onInput: (value: string) => void
  multiline?: boolean
  required?: boolean
  type?: string
}) {
  return (
    <label style={labelStyle}>
      {props.label}
      <Show
        when={props.multiline}
        fallback={
          <input
            required={props.required !== false}
            type={props.type ?? "text"}
            value={props.value}
            onInput={(event) => props.onInput(event.currentTarget.value)}
            style={inputStyle}
          />
        }
      >
        <textarea
          required={props.required !== false}
          value={props.value}
          onInput={(event) => props.onInput(event.currentTarget.value)}
          rows={3}
          style={inputStyle}
        />
      </Show>
    </label>
  )
}

const formStyle: JSX.CSSProperties = {
  display: "grid",
  gap: "11px",
  padding: "14px",
  border: "1px solid var(--color-border)",
  "border-radius": "8px",
  background: "var(--color-bg)",
}
const labelStyle: JSX.CSSProperties = {
  display: "grid",
  gap: "6px",
  "font-family": FONT_SANS,
  "font-size": "11px",
  color: "var(--color-text-muted)",
}
const inputStyle: JSX.CSSProperties = {
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
  padding: "8px 11px",
  background: "var(--color-surface-solid)",
  color: "var(--color-text)",
  "font-family": FONT_MONO,
  "font-size": "10px",
  cursor: "pointer",
}
const errorStyle: JSX.CSSProperties = {
  padding: "10px",
  border: "1px solid var(--color-danger)",
  "border-radius": "6px",
  color: "var(--color-danger)",
  "font-family": FONT_SANS,
  "font-size": "11px",
}
