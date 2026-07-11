import { For, Show, createResource, createSignal, onCleanup, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { useSDK } from "@/context/sdk"
import { useDialog } from "@synsci/ui/context/dialog"
import { confirmDialog } from "@/thesis/dialogs"
import { FONT_MONO, FONT_SANS } from "@/styles/tokens"

interface Member {
  id: string
  displayName: string
  role: "owner" | "researcher" | "reviewer" | "viewer"
  signingKeyId: string
  active: boolean
}
interface Publication {
  id: string
  title: string
  supportState: "approved" | "unresolved"
  state: "draft" | "approved"
}
interface Claim {
  id: string
  statement: string
  state: string
}
interface Audit {
  valid: boolean
  diagnostics: { code: string; file: string; message: string }[]
}

async function response<T>(request: Promise<Response>): Promise<T> {
  const value = await request
  if (value.ok) return value.json()
  const body = await value.json().catch(() => ({}))
  throw new Error(body.message || body.error || `Request failed (${value.status})`)
}

export function TrustPanel(props: { disabled?: boolean; section?: "all" | "people" | "publications" }): JSX.Element {
  const sdk = useSDK()
  const dialog = useDialog()
  const endpoint = (path: string) =>
    `${sdk.url.replace(/\/$/, "")}/research${path}?directory=${encodeURIComponent(sdk.directory)}`
  const [members, { refetch: refetchMembers }] = createResource(() => response<Member[]>(fetch(endpoint("/members"))))
  const [publications, { refetch: refetchPublications }] = createResource(() =>
    response<Publication[]>(fetch(endpoint("/publications"))),
  )
  const [claims] = createResource(() => response<Claim[]>(fetch(endpoint("/claims"))))
  const [audit, { refetch: refetchAudit }] = createResource(() => response<Audit>(fetch(endpoint("/audits"))))
  const [mode, setMode] = createSignal<"member" | "join" | "publication" | "export" | "">("")
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal("")
  const [notice, setNotice] = createSignal("")
  const [member, setMember] = createStore({ bundle: "", memberRole: "researcher" })
  const [join, setJoin] = createStore({ displayName: "", email: "" })
  const [joinBundle, setJoinBundle] = createSignal("")
  const [verifiedJoin, setVerifiedJoin] = createSignal<{
    bundle: string
    displayName: string
    email?: string
    signingKeyId: string
    issuedAt: string
  }>()
  const [publication, setPublication] = createStore({
    title: "",
    abstract: "",
    claimId: "",
    aiUseStatement: "AI assistance and human review are disclosed from the signed project record.",
    contributionStatement: "Contributions are attributed from the signed project membership and research ledger.",
  })
  const [destination, setDestination] = createSignal("")
  const section = () => props.section ?? "all"
  const showPeople = () => section() === "all" || section() === "people"
  const showPublications = () => section() === "all" || section() === "publications"

  const refresh = () => Promise.all([refetchMembers(), refetchPublications(), refetchAudit()])
  const memberSubscription = sdk.event.on("research.member.updated", () => void refresh())
  const publicationSubscription = sdk.event.on("research.publication.updated", () => void refresh())
  onCleanup(() => {
    memberSubscription()
    publicationSubscription()
  })
  const mutate = async (path: string, method: string, body: object) => {
    setBusy(true)
    setError("")
    setNotice("")
    try {
      const result = await response<{ destination?: string }>(
        fetch(endpoint(path), {
          method,
          headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify({ ...body, humanConfirmed: true }),
        }),
      )
      setMode("")
      if (result.destination) setNotice(`Export created at ${result.destination}`)
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const createJoinRequest = async (event: SubmitEvent) => {
    event.preventDefault()
    setBusy(true)
    setError("")
    setNotice("")
    try {
      const result = await response<{ bundle: string }>(
        fetch(endpoint("/collaboration/join-request"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ displayName: join.displayName, email: join.email || undefined }),
        }),
      )
      setJoinBundle(result.bundle)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const previewJoinRequest = async () => {
    setBusy(true)
    setError("")
    try {
      const request = await response<Omit<NonNullable<ReturnType<typeof verifiedJoin>>, "bundle">>(
        fetch(endpoint("/collaboration/join-request/preview"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bundle: member.bundle }),
        }),
      )
      setVerifiedJoin({ bundle: member.bundle, ...request })
    } catch (cause) {
      setVerifiedJoin(undefined)
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const removeMember = async (value: Member) => {
    const confirmed = await confirmDialog(dialog, {
      title: `Remove ${value.displayName}?`,
      message: "Future project actions from this identity will be rejected. Historical attribution is preserved.",
      confirmLabel: "Remove",
      danger: true,
    })
    if (confirmed) await mutate(`/members/${value.id}`, "DELETE", {})
  }

  return (
    <section style={shell}>
      <div style={heading}>
        <div>
          <div style={title}>
            {section() === "people" ? "People & roles" : section() === "publications" ? "Publications" : "Trust record"}
          </div>
          <div style={subtitle}>
            {section() === "people"
              ? "Local authority, explicit roles, and signed collaboration."
              : section() === "publications"
                ? "Evidence-linked writing, contribution disclosure, and human approval."
                : "Verified local authority and honest export."}
          </div>
        </div>
        <span style={{ ...badge, color: audit()?.valid ? "var(--color-success)" : "var(--color-danger)" }}>
          {audit()?.valid ? "verified" : `${audit()?.diagnostics.length ?? 0} findings`}
        </span>
      </div>
      <div style={actions}>
        <Show when={showPeople()}>
          <button style={button} disabled={props.disabled} onClick={() => setMode(mode() === "member" ? "" : "member")}>
            Accept join request
          </button>
          <button style={button} onClick={() => setMode(mode() === "join" ? "" : "join")}>
            Create my join request
          </button>
        </Show>
        <Show when={showPublications()}>
          <button
            style={button}
            disabled={props.disabled}
            onClick={() => setMode(mode() === "publication" ? "" : "publication")}
          >
            Draft publication
          </button>
        </Show>
        <button style={button} onClick={() => setMode(mode() === "export" ? "" : "export")}>
          Export study
        </button>
      </div>
      <Show when={error()}>
        <div role="alert" style={errorStyle}>
          {error()}
        </div>
      </Show>
      <Show when={notice()}>
        <div role="status" style={note}>
          {notice()}
        </div>
      </Show>
      <Show when={mode() === "member"}>
        <form
          style={form}
          onSubmit={(event) => {
            event.preventDefault()
            void mutate("/members/import", "POST", member)
          }}
        >
          <Field
            label="Signed join request"
            value={member.bundle}
            onInput={(value) => {
              setMember("bundle", value)
              setVerifiedJoin(undefined)
            }}
            multiline
          />
          <button
            type="button"
            style={button}
            disabled={busy() || !member.bundle.trim()}
            onClick={() => void previewJoinRequest()}
          >
            Verify request
          </button>
          <Show when={verifiedJoin()}>
            {(request) => (
              <div style={note} role="status">
                Verified request from {request().displayName}
                {request().email ? ` · ${request().email}` : ""} · signed{" "}
                {new Date(request().issuedAt).toLocaleString()} · key {request().signingKeyId.slice(0, 20)}…
              </div>
            )}
          </Show>
          <label style={label}>
            Role
            <select
              style={input}
              value={member.memberRole}
              onInput={(event) => setMember("memberRole", event.currentTarget.value)}
            >
              <For each={["researcher", "reviewer", "viewer", "owner"]}>
                {(value) => <option value={value}>{value}</option>}
              </For>
            </select>
          </label>
          <button style={primary} disabled={busy() || verifiedJoin()?.bundle !== member.bundle}>
            Verify and add person
          </button>
        </form>
      </Show>
      <Show when={mode() === "join"}>
        <form style={form} onSubmit={(event) => void createJoinRequest(event)}>
          <Field label="Your name" value={join.displayName} onInput={(value) => setJoin("displayName", value)} />
          <Field
            label="Email — optional"
            value={join.email}
            onInput={(value) => setJoin("email", value)}
            required={false}
          />
          <button style={primary} disabled={busy()}>
            Create signed request
          </button>
          <Show when={joinBundle()}>
            <Field
              label="Send this request to a project owner"
              value={joinBundle()}
              onInput={setJoinBundle}
              multiline
            />
            <button
              type="button"
              style={button}
              onClick={() =>
                void navigator.clipboard.writeText(joinBundle()).then(() => setNotice("Join request copied."))
              }
            >
              Copy request
            </button>
          </Show>
        </form>
      </Show>
      <Show when={mode() === "publication"}>
        <form
          style={form}
          onSubmit={(event) => {
            event.preventDefault()
            void mutate("/publications", "POST", {
              title: publication.title,
              abstract: publication.abstract,
              claimIds: [publication.claimId],
              artifactIds: [],
              aiUseStatement: publication.aiUseStatement,
              contributionStatement: publication.contributionStatement,
            })
          }}
        >
          <Field label="Title" value={publication.title} onInput={(value) => setPublication("title", value)} />
          <Field
            label="Abstract"
            value={publication.abstract}
            onInput={(value) => setPublication("abstract", value)}
            multiline
          />
          <label style={label}>
            Finalized claim
            <select
              style={input}
              required
              value={publication.claimId}
              onInput={(event) => setPublication("claimId", event.currentTarget.value)}
            >
              <option value="">Choose…</option>
              <For each={(claims() ?? []).filter((value) => value.state === "finalized")}>
                {(value) => <option value={value.id}>{value.statement}</option>}
              </For>
            </select>
          </label>
          <Field
            label="AI-use statement"
            value={publication.aiUseStatement}
            onInput={(value) => setPublication("aiUseStatement", value)}
            multiline
          />
          <Field
            label="Contribution statement"
            value={publication.contributionStatement}
            onInput={(value) => setPublication("contributionStatement", value)}
            multiline
          />
          <button style={primary} disabled={busy()}>
            Create signed draft
          </button>
        </form>
      </Show>
      <Show when={mode() === "export"}>
        <form
          style={form}
          onSubmit={(event) => {
            event.preventDefault()
            void mutate("/exports", "POST", { destination: destination() })
          }}
        >
          <Field label="New export folder" value={destination()} onInput={setDestination} />
          <div style={note}>
            The bundle includes checksums and audit limitations. Integrity is not presented as scientific validity.
          </div>
          <button style={primary} disabled={busy()}>
            Create verified bundle
          </button>
        </form>
      </Show>
      <div style={grid}>
        <Show when={showPeople()}>
          <div>
            <div style={sectionTitle}>People</div>
            <For each={(members() ?? []).filter((value) => value.active)}>
              {(value) => (
                <div style={row}>
                  <span>{value.displayName}</span>
                  <div style={{ display: "flex", gap: "6px", "align-items": "center" }}>
                    <select
                      aria-label={`Role for ${value.displayName}`}
                      style={{ ...input, width: "auto", padding: "5px 7px", "font-size": "11px" }}
                      value={value.role}
                      disabled={busy() || props.disabled}
                      onChange={(event) =>
                        void mutate(`/members/${value.id}/role`, "PATCH", { newRole: event.currentTarget.value })
                      }
                    >
                      <For each={["owner", "researcher", "reviewer", "viewer"]}>
                        {(role) => <option value={role}>{role}</option>}
                      </For>
                    </select>
                    <button style={button} disabled={busy() || props.disabled} onClick={() => void removeMember(value)}>
                      Remove
                    </button>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
        <Show when={showPublications()}>
          <div>
            <div style={sectionTitle}>Publications</div>
            <For each={publications() ?? []} fallback={<div style={empty}>No publication drafts yet.</div>}>
              {(value) => (
                <div style={row}>
                  <span>{value.title}</span>
                  <Show
                    when={value.state === "draft" && value.supportState === "approved"}
                    fallback={
                      <span style={badge}>
                        {value.state} · {value.supportState}
                      </span>
                    }
                  >
                    <button
                      style={button}
                      disabled={busy() || props.disabled}
                      onClick={() => void mutate(`/publications/${value.id}/approve`, "POST", {})}
                    >
                      Approve
                    </button>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </section>
  )
}

function Field(props: {
  label: string
  value: string
  onInput: (value: string) => void
  multiline?: boolean
  required?: boolean
}) {
  return (
    <label style={label}>
      {props.label}
      <Show
        when={props.multiline}
        fallback={
          <input
            style={input}
            required={props.required !== false}
            value={props.value}
            onInput={(event) => props.onInput(event.currentTarget.value)}
          />
        }
      >
        <textarea
          style={input}
          required={props.required !== false}
          value={props.value}
          onInput={(event) => props.onInput(event.currentTarget.value)}
        />
      </Show>
    </label>
  )
}

const shell: JSX.CSSProperties = {
  display: "grid",
  gap: "10px",
  padding: "12px",
  border: "1px solid var(--color-border)",
  "border-radius": "14px",
  background: "color-mix(in srgb, var(--color-surface-solid) 74%, transparent)",
}
const heading: JSX.CSSProperties = {
  display: "flex",
  "justify-content": "space-between",
  gap: "10px",
  "align-items": "start",
}
const title: JSX.CSSProperties = {
  "font-family": FONT_SANS,
  "font-size": "12px",
  "font-weight": 650,
  color: "var(--color-text)",
}
const subtitle: JSX.CSSProperties = { "font-family": FONT_MONO, "font-size": "10px", color: "var(--color-text-faint)" }
const actions: JSX.CSSProperties = { display: "flex", gap: "6px", "flex-wrap": "wrap" }
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
const note: JSX.CSSProperties = {
  padding: "9px",
  "border-radius": "8px",
  background: "var(--color-accent-subtle)",
  color: "var(--color-text-muted)",
  "font-family": FONT_SANS,
  "font-size": "11px",
}
const errorStyle: JSX.CSSProperties = { ...note, color: "var(--color-danger)", border: "1px solid var(--color-danger)" }
const grid: JSX.CSSProperties = {
  display: "grid",
  "grid-template-columns": "repeat(auto-fit, minmax(220px, 1fr))",
  gap: "12px",
}
const sectionTitle: JSX.CSSProperties = {
  "font-family": FONT_MONO,
  "font-size": "9px",
  "text-transform": "uppercase",
  color: "var(--color-text-faint)",
  "margin-bottom": "5px",
}
const row: JSX.CSSProperties = {
  display: "flex",
  "justify-content": "space-between",
  gap: "8px",
  padding: "6px 0",
  "font-family": FONT_SANS,
  "font-size": "11px",
  color: "var(--color-text-muted)",
  "border-bottom": "1px solid var(--color-border)",
}
const badge: JSX.CSSProperties = {
  "font-family": FONT_MONO,
  "font-size": "9px",
  color: "var(--color-text-faint)",
  "white-space": "nowrap",
}
const empty: JSX.CSSProperties = {
  "font-family": FONT_SANS,
  "font-size": "11px",
  color: "var(--color-text-faint)",
  padding: "6px 0",
}
