// Credentials — external-service secrets (encrypted-at-rest via
// /settings/credentials) + provider BYOK keys (auth.json via /auth). Every
// secret is write-only: values are never returned after saving.
import { type Component, type JSX, For, Show, createMemo, createSignal, onMount } from "solid-js"
import { Button } from "@synsci/ui/button"
import type { Provider } from "@synsci/sdk/v2/client"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { usePlatform } from "@/context/platform"
import { useDialog } from "@synsci/ui/context/dialog"
import { useProviders } from "@/hooks/use-providers"
import { FONT_CODE, FONT_SANS, sectionTitle } from "@/styles/tokens"
import { StatusDot } from "@/thesis/shared/StatusDot"
import { settingsApi } from "./api"
import { confirmDialog } from "@/thesis/dialogs"

type FieldSpec = {
  name: string
  label: string
  type: "password" | "text" | "textarea"
  optional: boolean
  placeholder?: string
}
type Service = {
  id: string
  label: string
  description: string
  custom: boolean
  fields: FieldSpec[]
  connected: boolean
  set_fields: string[]
  updated_at: string | null
}

// Where a connected provider's credential actually lives. Only "api" keys sit in
// the local auth store — the others reappear after a remove, so remove is gated.
const SOURCE_INFO: Record<Provider["source"], { label: string; removable: boolean; title: string }> = {
  api: { label: "local", removable: true, title: "API key stored in the local auth store on this machine" },
  env: {
    label: "env",
    removable: false,
    title: "API key from an environment variable or dashboard sync — unset it where it is defined to remove it",
  },
  config: {
    label: "config",
    removable: false,
    title: "API key set in openscience.json — edit the config file to remove it",
  },
  custom: {
    label: "custom",
    removable: false,
    title: "Custom provider defined in openscience.json — edit the config file to remove it",
  },
}

export const Credentials: Component = () => {
  const sdk = useGlobalSDK()
  const sync = useGlobalSync()
  const platform = usePlatform()
  const dialog = useDialog()
  const providers = useProviders()

  const base = () => sdk.url
  const fetchFn = () => platform.fetch ?? fetch

  const [services, setServices] = createSignal<Service[]>([])
  const [error, setError] = createSignal<string>()
  const [query, setQuery] = createSignal("")
  const [editing, setEditing] = createSignal<string>()
  const [values, setValues] = createSignal<Record<string, string>>({})
  const [saving, setSaving] = createSignal(false)

  const load = async () => {
    setError(undefined)
    try {
      const res = await settingsApi<{ services: Service[] }>(base(), fetchFn(), "/settings/credentials")
      setServices(res.services)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }
  onMount(() => void load())

  const openForm = (svc: Service) => {
    setValues({})
    setEditing(editing() === svc.id ? undefined : svc.id)
  }

  const save = async (id: string, extra?: { label?: string }) => {
    if (saving()) return
    setSaving(true)
    setError(undefined)
    try {
      const res = await settingsApi<{ services: Service[] }>(
        base(),
        fetchFn(),
        `/settings/credentials/${encodeURIComponent(id)}`,
        {
          method: "PUT",
          body: JSON.stringify({ fields: values(), ...(extra ?? {}) }),
        },
      )
      setServices(res.services)
      setEditing(undefined)
      setValues({})
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const disconnect = async (id: string) => {
    const confirmed = await confirmDialog(dialog, {
      title: "Remove stored credentials?",
      message: `This deletes the encrypted secrets for ${id} from this machine.`,
      confirmLabel: "Remove",
      danger: true,
    })
    if (!confirmed) return
    setError(undefined)
    try {
      const res = await settingsApi<{ services: Service[] }>(
        base(),
        fetchFn(),
        `/settings/credentials/${encodeURIComponent(id)}`,
        {
          method: "DELETE",
        },
      )
      setServices(res.services)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const filtered = createMemo(() => {
    const q = query().trim().toLowerCase()
    if (!q) return services()
    return services().filter((s) => s.label.toLowerCase().includes(q) || s.id.toLowerCase().includes(q))
  })
  const connectedCount = createMemo(() => services().filter((s) => s.connected).length)

  // ── Custom service ──
  const [customOpen, setCustomOpen] = createSignal(false)
  const [customName, setCustomName] = createSignal("")
  const [customValue, setCustomValue] = createSignal("")
  const [customField, setCustomField] = createSignal("api_key")
  const saveCustom = async () => {
    const name = customName().trim()
    const value = customValue().trim()
    const field = customField().trim() || "api_key"
    if (!name || !value) return
    const id = `custom:${name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")}`
    setValues({ [field]: value })
    await save(id, { label: name })
    setCustomOpen(false)
    setCustomName("")
    setCustomValue("")
    setCustomField("api_key")
    setValues({})
  }

  // ── BYOK provider keys ──
  const [keyProvider, setKeyProvider] = createSignal("")
  const [keyValue, setKeyValue] = createSignal("")
  const [savingKey, setSavingKey] = createSignal(false)
  const connectedProviders = createMemo(() => providers.connected().filter((p) => p.id !== "synsci"))
  const providerOptions = createMemo(() =>
    providers
      .all()
      .filter((provider) => provider.id !== "synsci")
      .sort((a, b) => a.name.localeCompare(b.name)),
  )
  const selectedProvider = () => keyProvider() || providerOptions()[0]?.id || ""
  const authMethods = () => sync.data.provider_auth?.[selectedProvider()] ?? []
  const [oauth, setOauth] = createSignal<{
    providerID: string
    method: number
    mode: "auto" | "code"
    instructions: string
  }>()
  const [oauthCode, setOauthCode] = createSignal("")
  // The list endpoint's generated type omits `source`, but the payload carries it
  // for every connected provider (see Provider in @synsci/sdk/v2/client).
  const sourceInfo = (p: { id: string }) => SOURCE_INFO[(p as { source?: Provider["source"] }).source ?? "api"]
  const saveKey = async () => {
    if (savingKey()) return
    const key = keyValue().trim()
    if (!key) return
    setSavingKey(true)
    setError(undefined)
    try {
      await sdk.client.auth.set({ providerID: selectedProvider(), auth: { type: "api", key } })
      setKeyValue("")
      await sdk.client.global.sync()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingKey(false)
    }
  }
  const removeKey = async (providerID: string) => {
    const provider = providerOptions().find((value) => value.id === providerID)
    const confirmed = await confirmDialog(dialog, {
      title: `Disconnect ${provider?.name ?? providerID}?`,
      message:
        "This removes locally stored provider credentials from this machine. Environment and config credentials must be removed at their source.",
      confirmLabel: "disconnect",
      danger: true,
    })
    if (!confirmed) return
    setError(undefined)
    try {
      await sdk.client.auth.remove({ providerID })
      await sdk.client.global.sync()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }
  const authorize = async (method: number) => {
    const providerID = selectedProvider()
    setSavingKey(true)
    setError(undefined)
    try {
      const result = await settingsApi<{ url: string; method: "auto" | "code"; instructions: string }>(
        base(),
        fetchFn(),
        `/provider/${encodeURIComponent(providerID)}/oauth/authorize`,
        { method: "POST", body: JSON.stringify({ method }) },
      )
      const destination = new URL(result.url)
      const local = ["localhost", "127.0.0.1", "::1"].includes(destination.hostname)
      if (destination.protocol !== "https:" && !(destination.protocol === "http:" && local)) {
        throw new Error("Provider authorization must use HTTPS or a loopback HTTP callback")
      }
      setOauth({ providerID, method, mode: result.method, instructions: result.instructions })
      platform.openLink(destination.href)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingKey(false)
    }
  }
  const completeOauth = async () => {
    const current = oauth()
    if (!current) return
    setSavingKey(true)
    setError(undefined)
    try {
      await settingsApi(base(), fetchFn(), `/provider/${encodeURIComponent(current.providerID)}/oauth/callback`, {
        method: "POST",
        body: JSON.stringify({ method: current.method, ...(current.mode === "code" ? { code: oauthCode() } : {}) }),
      })
      setOauth(undefined)
      setOauthCode("")
      await sdk.client.global.sync()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingKey(false)
    }
  }

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-raised-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-1 px-4 py-8 sm:p-8 max-w-[760px]">
          <h2 class="text-16-medium text-text-strong">Credentials</h2>
          <p class="text-13-regular text-text-weak">
            External-service secrets are encrypted and write-only. Provider keys and OAuth tokens use the local,
            owner-readable auth store; environment/config credentials remain at their source.
          </p>
        </div>
      </div>

      <div class="flex flex-col gap-8 px-4 pb-10 sm:px-8 max-w-[760px]">
        <Show when={error()}>
          <div
            style={{
              "font-family": FONT_SANS,
              "font-size": "12px",
              "line-height": 1.5,
              color: "var(--color-error)",
              border: "1px solid var(--color-error-muted)",
              "border-radius": "4px",
              padding: "10px 12px",
              "white-space": "pre-wrap",
            }}
          >
            {error()}
          </div>
        </Show>

        {/* Services */}
        <div class="flex flex-col gap-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex flex-col gap-1">
              <h3 class="text-13-medium text-text-weak tracking-wide">Services</h3>
              <p class="text-12-regular text-text-weak">
                Keys for the tools and clouds your research uses. {connectedCount()} of {services().length} connected.
              </p>
            </div>
            <input
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
              placeholder="Search services…"
              style={{ ...fieldStyle(), width: "180px" }}
            />
          </div>

          <div style={{ border: "1px solid var(--color-border)", "border-radius": "4px", overflow: "hidden" }}>
            <For each={filtered()}>
              {(svc) => (
                <div class="border-b border-border-weak-base last:border-none">
                  <div class="flex items-center justify-between gap-3 px-4 py-3.5">
                    <div class="flex items-center gap-2.5 min-w-0">
                      <StatusDot status={svc.connected ? "active" : "muted"} />
                      <div class="flex flex-col min-w-0">
                        <span class="text-13-medium text-text-strong truncate">{svc.label}</span>
                        <span class="text-12-regular text-text-weak truncate">
                          <Show when={svc.connected} fallback={svc.description}>
                            Connected · {svc.set_fields.join(", ")}
                          </Show>
                        </span>
                      </div>
                    </div>
                    <div class="flex gap-2 flex-shrink-0">
                      <Show when={svc.connected}>
                        <Button size="small" variant="secondary" onClick={() => void disconnect(svc.id)}>
                          remove
                        </Button>
                      </Show>
                      <Button
                        size="small"
                        variant={svc.connected ? "secondary" : "primary"}
                        onClick={() => openForm(svc)}
                      >
                        {editing() === svc.id ? "cancel" : svc.connected ? "update" : "connect"}
                      </Button>
                    </div>
                  </div>

                  <Show when={editing() === svc.id}>
                    <form
                      class="flex flex-col gap-2.5 px-4 pb-4"
                      onSubmit={(e) => {
                        e.preventDefault()
                        void save(svc.id)
                      }}
                    >
                      <For each={svc.fields}>
                        {(f) => (
                          <label class="flex flex-col gap-1">
                            <span style={eyebrow()}>
                              {f.label}
                              {f.optional ? " (optional)" : ""}
                              <Show when={svc.set_fields.includes(f.name)}> · saved</Show>
                            </span>
                            <Show
                              when={f.type === "textarea"}
                              fallback={
                                <input
                                  type={f.type === "password" ? "password" : "text"}
                                  autocomplete="off"
                                  spellcheck={false}
                                  placeholder={
                                    f.placeholder ??
                                    (svc.set_fields.includes(f.name) ? "•••••• (leave blank to keep)" : "")
                                  }
                                  value={values()[f.name] ?? ""}
                                  onInput={(e) => setValues({ ...values(), [f.name]: e.currentTarget.value })}
                                  style={fieldStyle()}
                                />
                              }
                            >
                              <textarea
                                spellcheck={false}
                                placeholder={f.placeholder}
                                value={values()[f.name] ?? ""}
                                onInput={(e) => setValues({ ...values(), [f.name]: e.currentTarget.value })}
                                style={{ ...fieldStyle(), height: "88px", padding: "8px 12px", resize: "vertical" }}
                              />
                            </Show>
                          </label>
                        )}
                      </For>
                      <div class="flex gap-2">
                        <Button
                          type="button"
                          size="small"
                          variant="primary"
                          disabled={saving()}
                          onClick={() => void save(svc.id)}
                        >
                          {saving() ? "saving…" : "save"}
                        </Button>
                        <Button
                          type="button"
                          size="small"
                          variant="secondary"
                          disabled={saving()}
                          onClick={() => setEditing(undefined)}
                        >
                          cancel
                        </Button>
                      </div>
                    </form>
                  </Show>
                </div>
              )}
            </For>
          </div>

          {/* Custom add-your-own-key */}
          <Show
            when={customOpen()}
            fallback={
              <button type="button" onClick={() => setCustomOpen(true)} style={addRowStyle()}>
                + add custom key
              </button>
            }
          >
            <form
              class="flex flex-col gap-2.5"
              style={{ border: "1px solid var(--color-border)", "border-radius": "4px", padding: "16px 18px" }}
              onSubmit={(e) => {
                e.preventDefault()
                void saveCustom()
              }}
            >
              <span class="text-13-medium text-text-strong">Custom credential</span>
              <div class="flex flex-col sm:flex-row gap-2">
                <label class="flex flex-col gap-1 flex-1">
                  <span style={eyebrow()}>Name</span>
                  <input
                    value={customName()}
                    onInput={(e) => setCustomName(e.currentTarget.value)}
                    placeholder="My service"
                    style={fieldStyle()}
                  />
                </label>
                <label class="flex flex-col gap-1 sm:w-[160px]">
                  <span style={eyebrow()}>Field</span>
                  <input
                    value={customField()}
                    onInput={(e) => setCustomField(e.currentTarget.value)}
                    placeholder="api_key"
                    style={fieldStyle()}
                  />
                </label>
              </div>
              <label class="flex flex-col gap-1">
                <span style={eyebrow()}>Value</span>
                <input
                  type="password"
                  autocomplete="off"
                  spellcheck={false}
                  value={customValue()}
                  onInput={(e) => setCustomValue(e.currentTarget.value)}
                  placeholder="secret value"
                  style={fieldStyle()}
                />
              </label>
              <div class="flex gap-2">
                <Button
                  type="button"
                  size="small"
                  variant="primary"
                  disabled={saving() || !customName().trim() || !customValue().trim()}
                  onClick={() => void saveCustom()}
                >
                  save
                </Button>
                <Button type="button" size="small" variant="secondary" onClick={() => setCustomOpen(false)}>
                  cancel
                </Button>
              </div>
            </form>
          </Show>
        </div>

        {/* Model providers — full server-advertised catalogue */}
        <div class="flex flex-col gap-3">
          <div class="flex flex-col gap-1">
            <h3 class="text-13-medium text-text-weak tracking-wide">Model providers</h3>
            <p class="text-12-regular text-text-weak">
              Connect any provider advertised by the local server using its available API-key or OAuth methods. Managed
              services remain in their optional settings section.
            </p>
          </div>

          <form
            class="flex flex-col sm:flex-row gap-2 sm:items-end"
            style={{ border: "1px solid var(--color-border)", "border-radius": "4px", padding: "16px 18px" }}
            onSubmit={(e) => {
              e.preventDefault()
              void saveKey()
            }}
          >
            <label class="flex flex-col gap-1 sm:w-[180px]">
              <span style={eyebrow()}>Provider</span>
              <select
                value={selectedProvider()}
                onChange={(e) => setKeyProvider(e.currentTarget.value)}
                style={fieldStyle()}
              >
                <For each={providerOptions()}>{(provider) => <option value={provider.id}>{provider.name}</option>}</For>
              </select>
            </label>
            <label class="flex flex-col gap-1 flex-1 min-w-0">
              <span style={eyebrow()}>API key</span>
              <input
                type="password"
                autocomplete="off"
                spellcheck={false}
                value={keyValue()}
                onInput={(e) => setKeyValue(e.currentTarget.value)}
                placeholder="sk-…"
                style={fieldStyle()}
              />
            </label>
            <Button
              type="button"
              size="small"
              variant="primary"
              disabled={savingKey() || !keyValue().trim()}
              onClick={() => void saveKey()}
            >
              {savingKey() ? "saving…" : "save key"}
            </Button>
          </form>

          <Show when={authMethods().some((method) => method.type === "oauth")}>
            <div class="os-provider-methods">
              <div>
                <strong>Sign-in methods</strong>
                <span>OAuth credentials stay in the local OpenScience credential store.</span>
              </div>
              <For each={authMethods()}>
                {(method, index) => (
                  <Show when={method.type === "oauth"}>
                    <Button
                      size="normal"
                      variant="secondary"
                      disabled={savingKey()}
                      onClick={() => void authorize(index())}
                    >
                      {method.label}
                    </Button>
                  </Show>
                )}
              </For>
            </div>
          </Show>

          <Show when={oauth()}>
            {(current) => (
              <div class="os-oauth-card" role="status">
                <strong>Complete sign-in in the opened browser tab</strong>
                <p>{current().instructions}</p>
                <Show when={current().mode === "code"}>
                  <input
                    value={oauthCode()}
                    onInput={(event) => setOauthCode(event.currentTarget.value)}
                    placeholder="Authorization code"
                    style={fieldStyle()}
                  />
                </Show>
                <div class="flex gap-2">
                  <Button
                    size="normal"
                    variant="primary"
                    disabled={savingKey() || (current().mode === "code" && !oauthCode().trim())}
                    onClick={() => void completeOauth()}
                  >
                    I completed authorization
                  </Button>
                  <Button size="normal" variant="ghost" onClick={() => setOauth(undefined)}>
                    cancel
                  </Button>
                </div>
              </div>
            )}
          </Show>

          <Show when={connectedProviders().length > 0}>
            <div style={{ border: "1px solid var(--color-border)", "border-radius": "4px", overflow: "hidden" }}>
              <For each={connectedProviders()}>
                {(p) => (
                  <div class="flex items-center justify-between gap-3 px-4 py-3.5 border-b border-border-weak-base last:border-none">
                    <div class="flex items-center gap-2.5 min-w-0">
                      <StatusDot status="active" />
                      <span class="text-13-regular text-text-strong truncate">{p.name}</span>
                      <span
                        class="flex-shrink-0 px-2 py-0.5 rounded-full text-11-regular border"
                        style={{
                          color: "var(--color-text-faint)",
                          "border-color": "var(--color-border)",
                          background: "transparent",
                        }}
                        title={sourceInfo(p).title}
                      >
                        {sourceInfo(p).label}
                      </span>
                    </div>
                    <Show
                      when={sourceInfo(p).removable}
                      fallback={
                        <span title={sourceInfo(p).title}>
                          <Button size="small" variant="secondary" disabled>
                            remove
                          </Button>
                        </span>
                      }
                    >
                      <Button size="small" variant="secondary" onClick={() => void removeKey(p.id)}>
                        remove
                      </Button>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      </div>
    </div>
  )
}

export default Credentials

function eyebrow(): JSX.CSSProperties {
  return sectionTitle
}

function fieldStyle(): JSX.CSSProperties {
  return {
    all: "unset",
    "box-sizing": "border-box",
    width: "100%",
    height: "36px",
    padding: "0 12px",
    "border-radius": "4px",
    border: "1px solid var(--color-border)",
    background: "var(--color-surface-solid, var(--color-bg))",
    "font-family": FONT_CODE,
    "font-size": "13px",
    "line-height": 1.5,
    color: "var(--color-text)",
    cursor: "text",
  }
}

function addRowStyle(): JSX.CSSProperties {
  return {
    all: "unset",
    "box-sizing": "border-box",
    cursor: "pointer",
    display: "flex",
    "align-items": "center",
    "justify-content": "center",
    height: "40px",
    "border-radius": "4px",
    border: "1px dashed var(--color-border-strong)",
    "font-family": FONT_SANS,
    "font-size": "12px",
    color: "var(--color-text-weak)",
  }
}
