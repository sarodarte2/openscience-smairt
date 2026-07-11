import { Show, createSignal, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { useSDK } from "@/context/sdk"
import { FONT_MONO, FONT_SANS } from "@/styles/tokens"

export interface ResearchRun {
  id: string
  iterationId: string
  protocolId: string
  kind: "command" | "notebook"
  notebook?: {
    sourcePath: string
    sourceHash: string
    originalPath: string
    executedPath: string
    executedHash: string | null
    allowErrors: boolean
  } | null
  state: "declared" | "queued" | "running" | "succeeded" | "failed" | "timed_out" | "cancelled" | "lost"
  workspaceStateHash: string
  environmentHash: string
  environment: { kind: "conda"; name: string; captureConfidence: "complete" | "credential_redacted" }
  execution: { command: string; args: string[]; timeoutMs: number }
  result?: { outcome: string; durationMs: number; exitCode: number | null; stdoutPath: string; stderrPath: string }
}

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

export function RunComposer(props: {
  protocolId: string
  onDeclared: () => void | Promise<void>
  onCancel: () => void
}): JSX.Element {
  const sdk = useSDK()
  const [form, setForm] = createStore({
    kind: "command" as "command" | "notebook",
    command: "python",
    args: "",
    parameters: "{}",
    seed: "",
    timeoutMinutes: "60",
    environmentKeys: "",
    outputs: "",
    notebookPath: "",
    allowErrors: false,
    passphrase: "",
  })
  const [key, setKey] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal("")
  const [needsPassphrase, setNeedsPassphrase] = createSignal(false)

  const submit = async (event: SubmitEvent) => {
    event.preventDefault()
    const idempotencyKey = key() || crypto.randomUUID()
    setKey(idempotencyKey)
    setBusy(true)
    setError("")
    try {
      const parameters = JSON.parse(form.parameters)
      const timeoutMinutes = Number(form.timeoutMinutes)
      if (!Number.isFinite(timeoutMinutes) || timeoutMinutes <= 0) throw new Error("Timeout must be positive")
      const endpoint = `${sdk.url.replace(/\/$/, "")}/research/${form.kind === "notebook" ? "runs/notebooks" : "runs"}?directory=${encodeURIComponent(sdk.directory)}`
      const common = {
        protocolId: props.protocolId,
        parameters,
        seed: form.seed ? Number(form.seed) : undefined,
        passphrase: form.passphrase || undefined,
        humanConfirmed: true,
      }
      await response(
        fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
          body: JSON.stringify(
            form.kind === "notebook"
              ? {
                  ...common,
                  notebookPath: form.notebookPath,
                  timeoutMs: Math.round(timeoutMinutes * 60_000),
                  allowErrors: form.allowErrors,
                  environmentKeys: lines(form.environmentKeys),
                }
              : {
                  ...common,
                  execution: {
                    command: form.command,
                    args: lines(form.args),
                    timeoutMs: Math.round(timeoutMinutes * 60_000),
                    environmentKeys: lines(form.environmentKeys),
                    outputs: lines(form.outputs).map((path) => ({
                      path,
                      role: "output",
                      mediaType: "application/octet-stream",
                    })),
                  },
                },
          ),
        }),
      )
      setKey("")
      await props.onDeclared()
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      if (message.toLowerCase().includes("passphrase")) setNeedsPassphrase(true)
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} style={box}>
      <div style={note}>
        Declaration captures the current Git workspace and resolved Conda environment before anything executes.
        Arguments are passed directly—never through a shell.
      </div>
      <label style={labelStyle}>
        Execution type
        <select
          value={form.kind}
          onChange={(event) => setForm("kind", event.currentTarget.value as "command" | "notebook")}
          style={input}
        >
          <option value="command">Python or command</option>
          <option value="notebook">Saved Jupyter notebook — clean kernel</option>
        </select>
      </label>
      <Show
        when={form.kind === "command"}
        fallback={
          <>
            <Field
              label="Notebook path"
              value={form.notebookPath}
              onInput={(value) => setForm("notebookPath", value)}
            />
            <label style={confirmation}>
              <input
                type="checkbox"
                checked={form.allowErrors}
                onChange={(event) => setForm("allowErrors", event.currentTarget.checked)}
              />
              Preserve cell errors in the executed copy instead of stopping at the first error.
            </label>
            <div style={note}>
              Formal notebooks always start a clean kernel. Interactive scratch state is not available.
            </div>
          </>
        }
      >
        <Field label="Program" value={form.command} onInput={(value) => setForm("command", value)} />
        <Field
          label="Arguments — one per line"
          value={form.args}
          onInput={(value) => setForm("args", value)}
          multiline
          required={false}
        />
      </Show>
      <Field
        label="Parameters — JSON"
        value={form.parameters}
        onInput={(value) => setForm("parameters", value)}
        multiline
      />
      <Field
        label="Random seed — optional"
        value={form.seed}
        onInput={(value) => setForm("seed", value)}
        type="number"
        required={false}
      />
      <Field
        label="Timeout — minutes"
        value={form.timeoutMinutes}
        onInput={(value) => setForm("timeoutMinutes", value)}
        type="number"
      />
      <Field
        label="Non-secret environment keys — one per line"
        value={form.environmentKeys}
        onInput={(value) => setForm("environmentKeys", value)}
        multiline
        required={false}
      />
      <Show when={form.kind === "command"}>
        <Field
          label="Expected output files — one project-local path per line"
          value={form.outputs}
          onInput={(value) => setForm("outputs", value)}
          multiline
          required={false}
        />
      </Show>
      <Show when={needsPassphrase()}>
        <Field
          label="Signing-key passphrase"
          value={form.passphrase}
          onInput={(value) => setForm("passphrase", value)}
          type="password"
        />
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
        <button type="submit" disabled={busy()} style={primaryButton}>
          {busy() ? "Capturing…" : "Declare formal run"}
        </button>
      </div>
    </form>
  )
}

export function RunCard(props: {
  run: ResearchRun
  disabled?: boolean
  onUpdated: () => void | Promise<void>
}): JSX.Element {
  const sdk = useSDK()
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal("")
  const [passphrase, setPassphrase] = createSignal("")
  const [needsPassphrase, setNeedsPassphrase] = createSignal(false)

  const execute = async () => {
    setBusy(true)
    setError("")
    try {
      const endpoint = `${sdk.url.replace(/\/$/, "")}/research/runs/${encodeURIComponent(props.run.id)}/execute?directory=${encodeURIComponent(sdk.directory)}`
      await response(
        fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ passphrase: passphrase() || undefined, humanConfirmed: true }),
        }),
      )
      await props.onUpdated()
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      if (message.toLowerCase().includes("passphrase")) setNeedsPassphrase(true)
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={runCard}>
      <div style={{ display: "flex", "align-items": "center", gap: "7px" }}>
        <span style={pill}>{props.run.state}</span>
        <span style={mono}>{props.run.id.slice(-10)}</span>
        <span style={{ ...mono, "margin-left": "auto" }}>{props.run.environment.name}</span>
      </div>
      <div style={note}>
        workspace {props.run.workspaceStateHash.slice(0, 10)} · environment {props.run.environmentHash.slice(0, 10)} ·{" "}
        {props.run.environment.captureConfidence}
      </div>
      <Show when={props.run.notebook}>
        {(notebook) => (
          <div style={note}>
            clean notebook · {notebook().sourcePath} ·{" "}
            {notebook().executedHash ? "executed copy captured" : "awaiting execution"}
          </div>
        )}
      </Show>
      <Show when={props.run.result}>
        {(result) => (
          <div style={note}>
            {result().outcome} · {(result().durationMs / 1000).toFixed(2)}s · exit {result().exitCode ?? "none"}
          </div>
        )}
      </Show>
      <Show when={needsPassphrase() && props.run.state === "declared"}>
        <Field label="Signing-key passphrase" value={passphrase()} onInput={setPassphrase} type="password" />
      </Show>
      <Show when={error()}>
        <div role="alert" style={errorStyle}>
          {error()}
        </div>
      </Show>
      <Show when={props.run.state === "declared"}>
        <button type="button" disabled={props.disabled || busy()} onClick={() => void execute()} style={primaryButton}>
          {busy() ? "Running in Conda…" : "Execute formal run"}
        </button>
      </Show>
    </div>
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
            style={input}
          />
        }
      >
        <textarea
          required={props.required !== false}
          value={props.value}
          onInput={(event) => props.onInput(event.currentTarget.value)}
          rows={3}
          style={input}
        />
      </Show>
    </label>
  )
}

const box: JSX.CSSProperties = {
  display: "grid",
  gap: "10px",
  padding: "12px",
  border: "1px solid var(--color-border-strong)",
  "border-radius": "6px",
  background: "var(--color-surface-solid)",
  "margin-top": "8px",
}
const runCard: JSX.CSSProperties = {
  display: "grid",
  gap: "8px",
  padding: "10px",
  border: "1px solid var(--color-border)",
  "border-radius": "6px",
  background: "var(--color-surface-solid)",
  "margin-top": "8px",
}
const note: JSX.CSSProperties = {
  color: "var(--color-text-faint)",
  "font-family": FONT_SANS,
  "font-size": "10px",
  "line-height": 1.45,
}
const mono: JSX.CSSProperties = { color: "var(--color-text-faint)", "font-family": FONT_MONO, "font-size": "9px" }
const pill: JSX.CSSProperties = {
  padding: "2px 5px",
  "border-radius": "4px",
  background: "var(--color-accent-subtle)",
  color: "var(--color-text-muted)",
  "font-family": FONT_MONO,
  "font-size": "9px",
}
const labelStyle: JSX.CSSProperties = {
  display: "grid",
  gap: "6px",
  color: "var(--color-text-muted)",
  "font-family": FONT_SANS,
  "font-size": "11px",
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
  resize: "vertical",
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
