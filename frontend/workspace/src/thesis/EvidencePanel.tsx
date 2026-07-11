import { For, Show, createResource, createSignal, onCleanup, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { useSDK } from "@/context/sdk"
import { FONT_MONO, FONT_SANS } from "@/styles/tokens"

interface Iteration {
  id: string
  title: string
}
interface Artifact {
  id: string
  iterationId: string
  path: string
  role: string
  mediaType: string
  contentHash: string
  byteLength: number
}
interface Analysis {
  id: string
  iterationId: string
  title: string
  state: string
  findings: string[]
  limitations: string[]
}

async function response<T>(request: Promise<Response>): Promise<T> {
  const value = await request
  if (value.ok) return value.json()
  const body = await value.json().catch(() => ({}))
  throw new Error(body.message || body.error || `Request failed (${value.status})`)
}

export function EvidencePanel(props: { iterations: Iteration[]; disabled?: boolean }): JSX.Element {
  const sdk = useSDK()
  const endpoint = (path: string) =>
    `${sdk.url.replace(/\/$/, "")}/research${path}?directory=${encodeURIComponent(sdk.directory)}`
  const [artifacts, { refetch: refetchArtifacts }] = createResource(() =>
    response<Artifact[]>(fetch(endpoint("/artifacts"))),
  )
  const [analyses, { refetch: refetchAnalyses }] = createResource(() =>
    response<Analysis[]>(fetch(endpoint("/analyses"))),
  )
  const unsubscribe = sdk.event.on("research.evidence.updated", () => {
    void Promise.all([refetchArtifacts(), refetchAnalyses()])
  })
  onCleanup(unsubscribe)
  const [mode, setMode] = createSignal<"artifact" | "analysis" | "">("")
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal("")
  const [mutationKey, setMutationKey] = createSignal("")
  const [artifact, setArtifact] = createStore({
    iterationId: "",
    file: "",
    role: "output",
    mediaType: "application/octet-stream",
    runId: "",
  })
  const [analysis, setAnalysis] = createStore({
    iterationId: "",
    title: "",
    summary: "",
    methods: "",
    finding: "",
    limitation: "",
    artifactId: "",
    finalize: false,
  })
  const open = (value: "artifact" | "analysis") => {
    setMutationKey("")
    setError("")
    setMode(mode() === value ? "" : value)
  }

  const register = async (event: SubmitEvent) => {
    event.preventDefault()
    setBusy(true)
    setError("")
    const key = mutationKey() || crypto.randomUUID()
    setMutationKey(key)
    try {
      await response(
        fetch(endpoint("/artifacts"), {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": key },
          body: JSON.stringify({ ...artifact, runId: artifact.runId || undefined, humanConfirmed: true }),
        }),
      )
      setArtifact({
        iterationId: artifact.iterationId,
        file: "",
        role: "output",
        mediaType: "application/octet-stream",
        runId: "",
      })
      setMode("")
      setMutationKey("")
      await refetchArtifacts()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const createAnalysis = async (event: SubmitEvent) => {
    event.preventDefault()
    setBusy(true)
    setError("")
    const key = mutationKey() || crypto.randomUUID()
    setMutationKey(key)
    try {
      await response(
        fetch(endpoint("/analyses"), {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": key },
          body: JSON.stringify({
            iterationId: analysis.iterationId,
            title: analysis.title,
            summary: analysis.summary,
            methods: analysis.methods,
            findings: [analysis.finding],
            limitations: [analysis.limitation],
            runIds: [],
            artifactIds: analysis.artifactId ? [analysis.artifactId] : [],
            finalize: analysis.finalize,
            humanConfirmed: true,
          }),
        }),
      )
      setAnalysis({
        iterationId: analysis.iterationId,
        title: "",
        summary: "",
        methods: "",
        finding: "",
        limitation: "",
        artifactId: "",
        finalize: false,
      })
      setMode("")
      setMutationKey("")
      await refetchAnalyses()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section style={shell}>
      <div style={heading}>
        <div>
          <div style={title}>Evidence</div>
          <div style={subtitle}>Artifacts are hashed; interpretations name findings and limitations.</div>
        </div>
        <div style={{ display: "flex", gap: "6px" }}>
          <button type="button" disabled={props.disabled} style={button} onClick={() => open("artifact")}>
            Register artifact
          </button>
          <button type="button" disabled={props.disabled} style={button} onClick={() => open("analysis")}>
            Record analysis
          </button>
        </div>
      </div>
      <Show when={error()}>
        <div role="alert" style={errorBox}>
          {error()}
        </div>
      </Show>
      <Show when={mode() === "artifact"}>
        <form style={form} onSubmit={register}>
          <SelectIteration
            value={artifact.iterationId}
            iterations={props.iterations}
            onInput={(value) => setArtifact("iterationId", value)}
          />
          <label style={label}>
            Project-local file
            <input
              required
              style={input}
              value={artifact.file}
              onInput={(event) => setArtifact("file", event.currentTarget.value)}
              placeholder="results/metrics.csv"
            />
          </label>
          <label style={label}>
            Evidence role
            <select
              style={input}
              value={artifact.role}
              onInput={(event) => setArtifact("role", event.currentTarget.value)}
            >
              <For each={["input", "output", "dataset", "model", "figure", "table", "notebook", "log", "other"]}>
                {(value) => <option value={value}>{value}</option>}
              </For>
            </select>
          </label>
          <label style={label}>
            Media type
            <input
              required
              style={input}
              value={artifact.mediaType}
              onInput={(event) => setArtifact("mediaType", event.currentTarget.value)}
            />
          </label>
          <button style={primary} disabled={busy()}>
            Hash and register
          </button>
        </form>
      </Show>
      <Show when={mode() === "analysis"}>
        <form style={form} onSubmit={createAnalysis}>
          <SelectIteration
            value={analysis.iterationId}
            iterations={props.iterations}
            onInput={(value) => setAnalysis("iterationId", value)}
          />
          <label style={label}>
            Analysis title
            <input
              required
              style={input}
              value={analysis.title}
              onInput={(event) => setAnalysis("title", event.currentTarget.value)}
            />
          </label>
          <label style={label}>
            Summary
            <textarea
              required
              style={input}
              value={analysis.summary}
              onInput={(event) => setAnalysis("summary", event.currentTarget.value)}
            />
          </label>
          <label style={label}>
            Methods
            <textarea
              required
              style={input}
              value={analysis.methods}
              onInput={(event) => setAnalysis("methods", event.currentTarget.value)}
            />
          </label>
          <label style={label}>
            Finding
            <textarea
              required
              style={input}
              value={analysis.finding}
              onInput={(event) => setAnalysis("finding", event.currentTarget.value)}
            />
          </label>
          <label style={label}>
            Limitation
            <textarea
              required
              style={input}
              value={analysis.limitation}
              onInput={(event) => setAnalysis("limitation", event.currentTarget.value)}
            />
          </label>
          <label style={label}>
            Supporting artifact
            <select
              style={input}
              value={analysis.artifactId}
              onInput={(event) => setAnalysis("artifactId", event.currentTarget.value)}
            >
              <option value="">None</option>
              <For each={(artifacts() ?? []).filter((value) => value.iterationId === analysis.iterationId)}>
                {(value) => <option value={value.id}>{value.path}</option>}
              </For>
            </select>
          </label>
          <label style={{ ...label, display: "flex", "grid-template-columns": "auto 1fr" }}>
            <input
              type="checkbox"
              checked={analysis.finalize}
              onChange={(event) => setAnalysis("finalize", event.currentTarget.checked)}
            />
            Finalize this analysis
          </label>
          <button style={primary} disabled={busy()}>
            Record analysis
          </button>
        </form>
      </Show>
      <div style={{ display: "grid", gap: "6px" }}>
        <For each={artifacts() ?? []}>
          {(value) => (
            <article style={card}>
              <div style={title}>{value.path}</div>
              <div style={subtitle}>
                {value.role} · {(value.byteLength / 1024).toFixed(1)} KB · {value.contentHash.slice(0, 12)}
              </div>
            </article>
          )}
        </For>
        <For each={analyses() ?? []}>
          {(value) => (
            <article style={card}>
              <div style={title}>
                {value.title} <span style={pill}>{value.state}</span>
              </div>
              <div style={subtitle}>
                {value.findings.length} finding(s) · {value.limitations.length} limitation(s)
              </div>
            </article>
          )}
        </For>
      </div>
    </section>
  )
}

function SelectIteration(props: { value: string; iterations: Iteration[]; onInput: (value: string) => void }) {
  return (
    <label style={label}>
      Iteration
      <select required style={input} value={props.value} onInput={(event) => props.onInput(event.currentTarget.value)}>
        <option value="">Choose an iteration</option>
        <For each={props.iterations}>{(value) => <option value={value.id}>{value.title}</option>}</For>
      </select>
    </label>
  )
}

const shell: JSX.CSSProperties = { display: "grid", gap: "9px", "margin-top": "4px" }
const heading: JSX.CSSProperties = {
  display: "flex",
  "align-items": "center",
  "justify-content": "space-between",
  gap: "10px",
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
const form: JSX.CSSProperties = {
  display: "grid",
  gap: "9px",
  padding: "12px",
  border: "1px solid var(--color-border)",
  "border-radius": "8px",
}
const label: JSX.CSSProperties = {
  display: "grid",
  gap: "5px",
  "font-family": FONT_SANS,
  "font-size": "11px",
  color: "var(--color-text-muted)",
}
const input: JSX.CSSProperties = {
  width: "100%",
  "box-sizing": "border-box",
  padding: "7px 8px",
  border: "1px solid var(--color-border-strong)",
  "border-radius": "5px",
  background: "var(--color-surface-solid)",
  color: "var(--color-text)",
  "font-family": FONT_SANS,
  "font-size": "12px",
}
const button: JSX.CSSProperties = {
  border: "1px solid var(--color-border)",
  "border-radius": "5px",
  padding: "6px 8px",
  background: "var(--color-surface-solid)",
  color: "var(--color-text)",
  "font-family": FONT_MONO,
  "font-size": "10px",
}
const primary: JSX.CSSProperties = {
  ...button,
  border: 0,
  background: "var(--color-accent)",
  color: "var(--color-on-accent)",
  "font-family": FONT_SANS,
  "font-weight": 650,
}
const card: JSX.CSSProperties = {
  padding: "10px",
  border: "1px solid var(--color-border)",
  "border-radius": "7px",
  background: "var(--color-surface-solid)",
}
const pill: JSX.CSSProperties = {
  "font-family": FONT_MONO,
  "font-size": "9px",
  color: "var(--color-text-faint)",
  "margin-left": "5px",
}
const errorBox: JSX.CSSProperties = {
  padding: "9px",
  color: "var(--color-danger)",
  border: "1px solid var(--color-danger)",
  "border-radius": "6px",
  "font-family": FONT_SANS,
  "font-size": "11px",
}
