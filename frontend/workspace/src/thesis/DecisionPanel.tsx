import { For, Show, createResource, createSignal, onCleanup, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { useSDK } from "@/context/sdk"
import { FONT_MONO, FONT_SANS } from "@/styles/tokens"

interface Iteration {
  id: string
  trackId: string
  title: string
}
interface Track {
  id: string
  title: string
  hidden?: boolean
}
interface Analysis {
  id: string
  iterationId: string
  title: string
  state: string
}
interface Claim {
  id: string
  iterationId: string
  statement: string
  state: string
  analysisIds: string[]
}
interface Review {
  id: string
  trackId: string
  outcome: string
  rationale: string
}
interface Integration {
  id: string
  sourceTrackId: string
  reviewId: string
  artifactIds: string[]
  bundleHash: string
}
interface Foundation {
  id: string
  gitCommit: string
  environmentHash: string
  artifactIds: string[]
}
interface CodeProposal {
  id: string
  evidenceIntegrationId: string
  sourceCommit: string
  targetCommit: string
  state: string
}
interface FoundationPreview {
  git: { commit: string | null; branch: string; dirty: boolean; codeSnapshotHash: string }
  environments: { trackId: string; name: string; portableSpecHash: string }[]
  integrations: Integration[]
  artifacts: { id: string; path: string; integrityValid: boolean }[]
  ready: boolean
}

async function response<T>(request: Promise<Response>): Promise<T> {
  const value = await request
  if (value.ok) return value.json()
  const body = await value.json().catch(() => ({}))
  throw new Error(body.message || body.error || `Request failed (${value.status})`)
}

export function DecisionPanel(props: { iterations: Iteration[]; tracks: Track[]; disabled?: boolean }): JSX.Element {
  const sdk = useSDK()
  const endpoint = (path: string) =>
    `${sdk.url.replace(/\/$/, "")}/research${path}?directory=${encodeURIComponent(sdk.directory)}`
  const [analyses, { refetch: refetchAnalyses }] = createResource(() =>
    response<Analysis[]>(fetch(endpoint("/analyses"))),
  )
  const [claims, { refetch: refetchClaims }] = createResource(() => response<Claim[]>(fetch(endpoint("/claims"))))
  const [reviews, { refetch: refetchReviews }] = createResource(() => response<Review[]>(fetch(endpoint("/reviews"))))
  const [integrations, { refetch: refetchIntegrations }] = createResource(() =>
    response<Integration[]>(fetch(endpoint("/integrations"))),
  )
  const [foundations, { refetch: refetchFoundations }] = createResource(() =>
    response<Foundation[]>(fetch(endpoint("/foundations"))),
  )
  const [proposals, { refetch: refetchProposals }] = createResource(() =>
    response<CodeProposal[]>(fetch(endpoint("/integrations/code-proposals"))),
  )
  const [preview, { refetch: refetchPreview }] = createResource(() =>
    response<FoundationPreview>(fetch(endpoint("/foundations/preview"))),
  )
  const [mode, setMode] = createSignal<"claim" | "review" | "integration" | "code" | "foundation" | "">("")
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal("")
  const [key, setKey] = createSignal("")
  const [claim, setClaim] = createStore({
    iterationId: "",
    statement: "",
    scope: "",
    uncertainty: "",
    analysisId: "",
    finalize: true,
    confirmed: false,
  })
  const [review, setReview] = createStore({
    trackId: "",
    claimId: "",
    analysisId: "",
    outcome: "inconclusive",
    rationale: "",
    confirmed: false,
  })
  const [integration, setIntegration] = createStore({ reviewId: "", confirmed: false })
  const [code, setCode] = createStore({
    evidenceIntegrationId: "",
    sourceCommit: "",
    targetBranch: "main",
    targetCommit: "",
    confirmed: false,
  })
  const [foundation, setFoundation] = createStore({ environmentTrackId: "", integrationId: "", confirmed: false })

  const refresh = () =>
    Promise.all([
      refetchAnalyses(),
      refetchClaims(),
      refetchReviews(),
      refetchIntegrations(),
      refetchFoundations(),
      refetchProposals(),
      refetchPreview(),
    ])
  const unsubscribe = sdk.event.on("research.foundation.updated", () => void refresh())
  const unsubscribeIntegration = sdk.event.on("research.integration.updated", () => void refresh())
  onCleanup(() => {
    unsubscribe()
    unsubscribeIntegration()
  })
  const begin = () => {
    const value = key() || crypto.randomUUID()
    setKey(value)
    setBusy(true)
    setError("")
    return value
  }
  const done = async () => {
    setKey("")
    setMode("")
    await refresh()
    setBusy(false)
  }
  const failed = (cause: unknown) => {
    setError(cause instanceof Error ? cause.message : String(cause))
    setBusy(false)
  }

  const submitClaim = async (event: SubmitEvent) => {
    event.preventDefault()
    if (claim.finalize && !claim.confirmed) return
    const mutation = begin()
    try {
      await response(
        fetch(endpoint("/claims"), {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": mutation },
          body: JSON.stringify({
            iterationId: claim.iterationId,
            statement: claim.statement,
            scope: claim.scope,
            uncertainties: [claim.uncertainty],
            analysisIds: [claim.analysisId],
            artifactIds: [],
            finalize: claim.finalize,
            humanConfirmed: true,
          }),
        }),
      )
      await done()
    } catch (cause) {
      failed(cause)
    }
  }
  const submitReview = async (event: SubmitEvent) => {
    event.preventDefault()
    if (!review.confirmed) return
    const mutation = begin()
    try {
      await response(
        fetch(endpoint("/reviews"), {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": mutation },
          body: JSON.stringify({
            trackId: review.trackId,
            claimIds: [review.claimId],
            analysisIds: [review.analysisId],
            outcome: review.outcome,
            rationale: review.rationale,
            humanConfirmed: true,
          }),
        }),
      )
      await done()
    } catch (cause) {
      failed(cause)
    }
  }
  const submitIntegration = async (event: SubmitEvent) => {
    event.preventDefault()
    if (!integration.confirmed) return
    const mutation = begin()
    try {
      await response(
        fetch(endpoint("/integrations/evidence"), {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": mutation },
          body: JSON.stringify({ reviewId: integration.reviewId, humanConfirmed: true }),
        }),
      )
      await done()
    } catch (cause) {
      failed(cause)
    }
  }
  const submitFoundation = async (event: SubmitEvent) => {
    event.preventDefault()
    if (!foundation.confirmed || !preview()?.git.commit) return
    const mutation = begin()
    const selected = preview()?.integrations.find((value) => value.id === foundation.integrationId)
    try {
      await response(
        fetch(endpoint("/foundations/promote"), {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": mutation },
          body: JSON.stringify({
            expectedGitCommit: preview()!.git.commit,
            environmentTrackId: foundation.environmentTrackId,
            integrationIds: [foundation.integrationId],
            artifactIds: selected?.artifactIds ?? [],
            supportingEventIds: [],
            humanConfirmed: true,
          }),
        }),
      )
      await done()
    } catch (cause) {
      failed(cause)
    }
  }

  const submitCode = async (event: SubmitEvent) => {
    event.preventDefault()
    if (!code.confirmed) return
    const mutation = begin()
    try {
      await response(
        fetch(endpoint("/integrations/code-proposals"), {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": mutation },
          body: JSON.stringify({ ...code, humanConfirmed: true }),
        }),
      )
      await done()
    } catch (cause) {
      failed(cause)
    }
  }

  const open = (value: typeof mode extends () => infer T ? T : never) => {
    setKey("")
    setError("")
    setMode(mode() === value ? "" : value)
    if (value === "code" && preview()?.git.commit) {
      if (!code.sourceCommit) setCode("sourceCommit", preview()!.git.commit!)
      if (!code.targetCommit) setCode("targetCommit", preview()!.git.commit!)
    }
  }
  return (
    <section style={shell}>
      <div style={heading}>
        <div>
          <div style={title}>Claims, review & foundation</div>
          <div style={subtitle}>
            Interpretation, acceptance, evidence integration, and baseline promotion remain separate signed decisions.
          </div>
        </div>
      </div>
      <div style={actions}>
        <button style={button} disabled={props.disabled} onClick={() => open("claim")}>
          Draft claim
        </button>
        <button style={button} disabled={props.disabled} onClick={() => open("review")}>
          Review track
        </button>
        <button style={button} disabled={props.disabled} onClick={() => open("integration")}>
          Integrate evidence
        </button>
        <button style={button} disabled={props.disabled} onClick={() => open("code")}>
          Propose code
        </button>
        <button style={button} disabled={props.disabled || !preview()?.ready} onClick={() => open("foundation")}>
          Promote foundation
        </button>
      </div>
      <Show when={error()}>
        <div role="alert" style={errorBox}>
          {error()}
        </div>
      </Show>
      <Show when={mode() === "claim"}>
        <form style={form} onSubmit={submitClaim}>
          <Select
            label="Iteration"
            value={claim.iterationId}
            onInput={(value) => setClaim("iterationId", value)}
            options={props.iterations.map((value) => ({ value: value.id, label: value.title }))}
          />
          <label style={label}>
            Claim statement
            <textarea
              required
              style={input}
              value={claim.statement}
              onInput={(event) => setClaim("statement", event.currentTarget.value)}
            />
          </label>
          <label style={label}>
            Scope
            <textarea
              required
              style={input}
              value={claim.scope}
              onInput={(event) => setClaim("scope", event.currentTarget.value)}
            />
          </label>
          <label style={label}>
            Uncertainty or alternative explanation
            <textarea
              required
              style={input}
              value={claim.uncertainty}
              onInput={(event) => setClaim("uncertainty", event.currentTarget.value)}
            />
          </label>
          <Select
            label="Finalized supporting analysis"
            value={claim.analysisId}
            onInput={(value) => setClaim("analysisId", value)}
            options={(analyses() ?? [])
              .filter((value) => value.iterationId === claim.iterationId && value.state === "finalized")
              .map((value) => ({ value: value.id, label: value.title }))}
          />
          <Confirm
            checked={claim.confirmed}
            onChange={(value) => setClaim("confirmed", value)}
            text="I reviewed the statement, scope, uncertainty, and supporting analysis."
          />
          <button style={primary} disabled={busy() || !claim.confirmed}>
            Finalize evidence-backed claim
          </button>
        </form>
      </Show>
      <Show when={mode() === "review"}>
        <form style={form} onSubmit={submitReview}>
          <Select
            label="Track"
            value={review.trackId}
            onInput={(value) => setReview("trackId", value)}
            options={props.tracks.map((value) => ({
              value: value.id,
              label: value.hidden ? "Primary approach" : value.title,
            }))}
          />
          <Select
            label="Finalized claim"
            value={review.claimId}
            onInput={(value) => {
              setReview("claimId", value)
              const found = (claims() ?? []).find((claim) => claim.id === value)
              if (found?.analysisIds[0]) setReview("analysisId", found.analysisIds[0])
            }}
            options={(claims() ?? [])
              .filter(
                (value) =>
                  value.state === "finalized" &&
                  props.iterations.some(
                    (iteration) => iteration.id === value.iterationId && iteration.trackId === review.trackId,
                  ),
              )
              .map((value) => ({ value: value.id, label: value.statement }))}
          />
          <Select
            label="Outcome"
            value={review.outcome}
            onInput={(value) => setReview("outcome", value)}
            options={["accepted", "not_selected", "inconclusive", "return_for_changes"].map((value) => ({
              value,
              label: value.replaceAll("_", " "),
            }))}
          />
          <label style={label}>
            Rationale
            <textarea
              required
              style={input}
              value={review.rationale}
              onInput={(event) => setReview("rationale", event.currentTarget.value)}
            />
          </label>
          <Confirm
            checked={review.confirmed}
            onChange={(value) => setReview("confirmed", value)}
            text="I am making this review decision as a human project member."
          />
          <button style={primary} disabled={busy() || !review.confirmed || !review.analysisId}>
            Sign track review
          </button>
        </form>
      </Show>
      <Show when={mode() === "integration"}>
        <form style={form} onSubmit={submitIntegration}>
          <Select
            label="Reviewed outcome"
            value={integration.reviewId}
            onInput={(value) => setIntegration("reviewId", value)}
            options={(reviews() ?? [])
              .filter((value) => value.outcome !== "return_for_changes")
              .map((value) => ({
                value: value.id,
                label: `${value.outcome.replaceAll("_", " ")} · ${value.rationale}`,
              }))}
          />
          <div style={notice}>
            Evidence-only integration preserves accepted, rejected, and inconclusive results. It changes no
            implementation code and promotes no foundation.
          </div>
          <Confirm
            checked={integration.confirmed}
            onChange={(value) => setIntegration("confirmed", value)}
            text="Integrate this reviewed evidence without merging code."
          />
          <button style={primary} disabled={busy() || !integration.confirmed}>
            Sign evidence integration
          </button>
        </form>
      </Show>
      <Show when={mode() === "foundation" && preview()}>
        {(value) => (
          <form style={form} onSubmit={submitFoundation}>
            <div style={notice}>
              <strong>Exact commit</strong> {value().git.commit?.slice(0, 12)} on {value().git.branch} ·{" "}
              {value().git.dirty ? "dirty — blocked" : "clean"}
            </div>
            <Select
              label="Environment"
              value={foundation.environmentTrackId}
              onInput={(v) => setFoundation("environmentTrackId", v)}
              options={value().environments.map((item) => ({
                value: item.trackId,
                label: `${item.name} · ${item.portableSpecHash.slice(0, 10)}`,
              }))}
            />
            <Select
              label="Evidence integration"
              value={foundation.integrationId}
              onInput={(v) => setFoundation("integrationId", v)}
              options={value().integrations.map((item) => ({
                value: item.id,
                label: `${item.sourceTrackId} · ${item.bundleHash.slice(0, 10)}`,
              }))}
            />
            <Confirm
              checked={foundation.confirmed}
              onChange={(v) => setFoundation("confirmed", v)}
              text="I reviewed the exact clean commit, environment, artifacts, and supporting evidence. Git merge alone is not promotion."
            />
            <button style={primary} disabled={busy() || !foundation.confirmed || !value().ready}>
              Promote signed foundation
            </button>
          </form>
        )}
      </Show>
      <Show when={mode() === "code"}>
        <form style={form} onSubmit={submitCode}>
          <Select
            label="Evidence integration"
            value={code.evidenceIntegrationId}
            onInput={(value) => setCode("evidenceIntegrationId", value)}
            options={(integrations() ?? []).map((value) => ({
              value: value.id,
              label: `${value.sourceTrackId} · ${value.bundleHash.slice(0, 10)}`,
            }))}
          />
          <label style={label}>
            Exact source commit
            <input
              required
              pattern="[0-9a-f]{40,64}"
              style={input}
              value={code.sourceCommit}
              onInput={(event) => setCode("sourceCommit", event.currentTarget.value)}
            />
          </label>
          <label style={label}>
            Target branch
            <input
              required
              style={input}
              value={code.targetBranch}
              onInput={(event) => setCode("targetBranch", event.currentTarget.value)}
            />
          </label>
          <label style={label}>
            Exact target commit
            <input
              required
              pattern="[0-9a-f]{40,64}"
              style={input}
              value={code.targetCommit}
              onInput={(event) => setCode("targetCommit", event.currentTarget.value)}
            />
          </label>
          <div style={notice}>
            This records a reviewable Git diff proposal only. OpenScience will not run merge, rebase, commit, or
            foundation promotion commands.
          </div>
          <Confirm
            checked={code.confirmed}
            onChange={(value) => setCode("confirmed", value)}
            text="I reviewed the exact source and target commits and want to record this proposal."
          />
          <button style={primary} disabled={busy() || !code.confirmed}>
            Sign code proposal
          </button>
        </form>
      </Show>
      <div style={summary}>
        <span>{(claims() ?? []).length} claims</span>
        <span>{(reviews() ?? []).length} reviews</span>
        <span>{(integrations() ?? []).length} integrations</span>
        <span>{(proposals() ?? []).length} code proposals</span>
        <span>{(foundations() ?? []).length} foundations</span>
      </div>
    </section>
  )
}

function Select(props: {
  label: string
  value: string
  options: { value: string; label: string }[]
  onInput: (value: string) => void
}) {
  return (
    <label style={label}>
      {props.label}
      <select required style={input} value={props.value} onInput={(event) => props.onInput(event.currentTarget.value)}>
        <option value="">Choose…</option>
        <For each={props.options}>{(value) => <option value={value.value}>{value.label}</option>}</For>
      </select>
    </label>
  )
}
function Confirm(props: { checked: boolean; text: string; onChange: (value: boolean) => void }) {
  return (
    <label style={confirm}>
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(event) => props.onChange(event.currentTarget.checked)}
      />
      <span>{props.text}</span>
    </label>
  )
}
const shell: JSX.CSSProperties = {
  display: "grid",
  gap: "9px",
  padding: "12px",
  border: "1px solid var(--color-border)",
  "border-radius": "14px",
  background: "color-mix(in srgb, var(--color-surface-solid) 74%, transparent)",
}
const heading: JSX.CSSProperties = { display: "flex", "justify-content": "space-between", gap: "10px" }
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
const actions: JSX.CSSProperties = { display: "flex", gap: "6px", "flex-wrap": "wrap" }
const form: JSX.CSSProperties = {
  display: "grid",
  gap: "9px",
  padding: "11px",
  border: "1px solid var(--color-border)",
  "border-radius": "11px",
  background: "color-mix(in srgb, var(--color-bg) 78%, transparent)",
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
  padding: "8px",
  border: "1px solid var(--color-border-strong)",
  "border-radius": "8px",
  background: "var(--color-surface-solid)",
  color: "var(--color-text)",
  "font-family": FONT_SANS,
  "font-size": "12px",
}
const button: JSX.CSSProperties = {
  border: "1px solid var(--color-border)",
  "border-radius": "999px",
  padding: "6px 9px",
  background: "var(--color-surface-solid)",
  color: "var(--color-text)",
  "font-family": FONT_MONO,
  "font-size": "10px",
  cursor: "pointer",
}
const primary: JSX.CSSProperties = {
  ...button,
  border: 0,
  "border-radius": "8px",
  background: "var(--color-accent)",
  color: "var(--color-on-accent)",
  "font-family": FONT_SANS,
  "font-weight": 650,
}
const confirm: JSX.CSSProperties = {
  display: "flex",
  gap: "8px",
  "align-items": "flex-start",
  "font-family": FONT_SANS,
  "font-size": "11px",
  color: "var(--color-text-muted)",
  "line-height": 1.45,
}
const notice: JSX.CSSProperties = {
  padding: "9px",
  "border-radius": "8px",
  background: "var(--color-accent-subtle)",
  color: "var(--color-text-muted)",
  "font-family": FONT_SANS,
  "font-size": "11px",
  "line-height": 1.5,
}
const errorBox: JSX.CSSProperties = { ...notice, color: "var(--color-danger)", border: "1px solid var(--color-danger)" }
const summary: JSX.CSSProperties = {
  display: "flex",
  gap: "10px",
  "flex-wrap": "wrap",
  "font-family": FONT_MONO,
  "font-size": "9px",
  color: "var(--color-text-faint)",
}
