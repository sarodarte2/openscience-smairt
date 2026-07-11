import { Dialog } from "@synsci/ui/dialog"
import { ResearchProgress } from "@synsci/ui/research"
import { For, Show, Switch, Match, createMemo, createSignal, onCleanup, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { useDialog } from "@synsci/ui/context/dialog"
import { useGlobalSDK } from "@/context/global-sdk"

type Preview = {
  slug: string
  destination: string
  environmentName: string
  environmentYml: string
  directories: string[]
}

type Operation = {
  id: string
  stage: string
  state: "queued" | "running" | "completed" | "paused" | "cancelled" | "failed"
  message: string
  error?: string
  request: { destination: string }
}

const STEPS = ["Study", "Repository", "Scientific start", "Environment", "Compute", "Safety", "Collaboration", "Review"]
const PRESETS = {
  data: ["numpy", "pandas", "scipy"],
  ml: ["scikit-learn"],
  deep: ["pytorch"],
  visualization: ["matplotlib", "seaborn"],
} as const

function values(input: string) {
  return input
    .split(/[\n,]/)
    .map((value) => value.trim())
    .filter(Boolean)
}

function slug(value: string) {
  return (
    value
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "openscience-study"
  )
}

async function response<T>(request: Promise<Response>): Promise<T> {
  const value = await request
  if (value.ok) return value.json()
  const body = await value.json().catch(() => ({}))
  throw new Error(body.message || body.error || `Request failed (${value.status})`)
}

export function ScaffoldWizard(props: { home: string; onCreated: (directory: string) => void }): JSX.Element {
  const dialog = useDialog()
  const sdk = useGlobalSDK()
  const [step, setStep] = createSignal(0)
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal("")
  const [preview, setPreview] = createSignal<Preview>()
  const [operation, setOperation] = createSignal<Operation>()
  const [elapsed, setElapsed] = createSignal(0)
  const [state, setState] = createStore({
    name: "",
    destinationBase: props.home,
    destinationEdited: false,
    description: "",
    question: "",
    domain: "machine_learning",
    license: "MIT",
    repositoryMode: "new",
    dataPhase: "synthetic",
    iterationMode: "exploratory",
    iterationTitle: "Initial feasibility",
    iterationQuestion: "",
    decisionGoal: "",
    aim: "",
    intendedInputs: "synthetic dataset",
    intendedOutputs: "metrics\ndiagnostic figures",
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
    datasets: "",
    baselines: "",
    metrics: "",
    leakageBoundary: "",
    python: "3.12",
    createEnvironment: true,
    presets: { data: true, ml: false, deep: false, visualization: true },
    condaPackages: "",
    pipPackages: "",
    hpc: false,
    scheduler: "slurm",
    clusterName: "",
    account: "",
    partition: "",
    modules: "",
    scratchPath: "",
    networkMode: "ask",
    egressPolicy: "public",
    expectedServices: "",
    publicConfirmed: false,
    authorName: "",
    authorEmail: "",
    passphrase: "",
  })

  const destination = createMemo(() => {
    if (state.repositoryMode === "existing" || state.destinationEdited) return state.destinationBase
    return `${state.destinationBase.replace(/\/$/, "")}/${slug(state.name)}`
  })
  const conda = createMemo(() => [
    ...Object.entries(state.presets).flatMap(([name, enabled]) =>
      enabled ? [...PRESETS[name as keyof typeof PRESETS]] : [],
    ),
    ...values(state.condaPackages),
  ])

  const content = () => {
    if (state.iterationMode === "confirmatory")
      return {
        mode: "confirmatory",
        hypothesis: state.hypothesis,
        nullHypothesis: state.nullHypothesis,
        primaryOutcome: state.primaryOutcome,
        controls: values(state.controls),
        exclusions: values(state.exclusions),
        statisticalMethod: state.statisticalMethod,
        stoppingRule: state.stoppingRule,
        decisionRule: state.decisionRule,
      }
    if (state.iterationMode === "replication")
      return {
        mode: "replication",
        sourceProtocol: state.sourceProtocol,
        faithfulElements: values(state.faithfulElements),
        deviations: values(state.deviations),
        equivalenceRule: state.equivalenceRule,
      }
    if (state.iterationMode === "benchmark")
      return {
        mode: "benchmark",
        datasetsAndSplits: values(state.datasets),
        baselines: values(state.baselines),
        metrics: values(state.metrics),
        leakageBoundary: state.leakageBoundary,
      }
    return {
      mode: "exploratory",
      aim: state.aim || state.iterationQuestion,
      intendedInputs: values(state.intendedInputs),
      intendedOutputs: values(state.intendedOutputs),
      decisionGoal: state.decisionGoal,
    }
  }

  const request = () => ({
    destination: destination(),
    repositoryMode: state.repositoryMode,
    name: state.name,
    description: state.description,
    author: { displayName: state.authorName, ...(state.authorEmail ? { email: state.authorEmail } : {}) },
    profile: {
      question: state.question,
      domain: state.domain,
      dataPhase: state.dataPhase,
      license: state.license,
      paperWorkspace: true,
      networkMode: state.networkMode,
      egressPolicy: state.egressPolicy,
      hpc: {
        enabled: state.hpc,
        ...(state.hpc ? { scheduler: state.scheduler } : {}),
        ...(state.clusterName ? { clusterName: state.clusterName } : {}),
        ...(state.account ? { account: state.account } : {}),
        ...(state.partition ? { partition: state.partition } : {}),
        modules: values(state.modules),
        ...(state.scratchPath ? { scratchPath: state.scratchPath } : {}),
        validated: false,
      },
    },
    initialIteration: {
      title: state.iterationTitle,
      mode: state.iterationMode,
      question: state.iterationQuestion,
      decisionGoal: state.decisionGoal,
      content: content(),
    },
    environment: {
      create: state.createEnvironment,
      python: state.python,
      condaPackages: conda(),
      pipPackages: values(state.pipPackages),
    },
  })

  const endpoint = (path: string) => `${sdk.url.replace(/\/$/, "")}/research/scaffolds${path}`
  const loadPreview = async () => {
    setBusy(true)
    setError("")
    try {
      setPreview(
        await response<Preview>(
          fetch(endpoint("/preview"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(request()),
          }),
        ),
      )
      setStep(7)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  let poll: ReturnType<typeof setInterval> | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  onCleanup(() => {
    if (poll) clearInterval(poll)
    if (timer) clearInterval(timer)
  })
  const check = async (id: string) => {
    const next = await response<Operation>(fetch(endpoint(`/${id}`)))
    setOperation(next)
    if (!["completed", "failed", "cancelled"].includes(next.state)) return
    if (poll) clearInterval(poll)
    if (timer) clearInterval(timer)
    poll = undefined
    timer = undefined
    if (next.state === "completed" && next.stage === "ready") {
      props.onCreated(next.request.destination)
      dialog.close()
    }
  }
  const create = async () => {
    setBusy(true)
    setError("")
    setElapsed(0)
    try {
      const started = await response<Operation>(
        fetch(endpoint("/"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...request(), ...(state.passphrase ? { passphrase: state.passphrase } : {}) }),
        }),
      )
      setOperation(started)
      setBusy(false)
      poll = setInterval(() => void check(started.id).catch((cause) => setError(String(cause))), 500)
      timer = setInterval(() => setElapsed((value) => value + 1), 1000)
      await check(started.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setBusy(false)
    }
  }
  const cancel = async () => {
    const current = operation()
    if (!current) return
    await response(fetch(endpoint(`/${current.id}/cancel`), { method: "POST" }))
    await check(current.id)
  }

  const next = () => {
    setError("")
    if (step() === 6) {
      void loadPreview()
      return
    }
    setStep((value) => Math.min(7, value + 1))
  }

  return (
    <Dialog size="x-large" transition class="os-scaffold-dialog">
      <div class="os-wizard">
        <aside class="os-wizard__rail">
          <span class="os-eyebrow">New study</span>
          <h1>OpenScience–SMAIRT</h1>
          <ol>
            <For each={STEPS}>
              {(label, index) => (
                <li classList={{ active: step() === index(), complete: step() > index() }}>
                  <span>{step() > index() ? "✓" : index() + 1}</span>
                  {label}
                </li>
              )}
            </For>
          </ol>
          <p>Paper-driven work is integrated into every study. The scientific lifecycle stays the same.</p>
        </aside>
        <main class="os-wizard__main">
          <div class="os-wizard__content">
            <Show when={error()}>
              <div class="os-form-error" role="alert">
                {error()}
              </div>
            </Show>
            <Show when={operation()}>
              {(current) => (
                <ResearchProgress
                  stage={current().stage.replaceAll("_", " ")}
                  detail={current().error ?? current().message}
                  elapsed={elapsed()}
                  onCancel={current().state === "running" ? () => void cancel() : undefined}
                />
              )}
            </Show>
            <Show when={!operation()}>
              <Switch>
                <Match when={step() === 0}>
                  <WizardTitle
                    title="Define the study"
                    description="Start with the scientific question, not the chat session."
                  />
                  <Field label="Study name" value={state.name} onInput={(value) => setState("name", value)} required />
                  <Field
                    label="Primary research question"
                    value={state.question}
                    onInput={(value) => setState("question", value)}
                    multiline
                    required
                  />
                  <Field
                    label="Description"
                    value={state.description}
                    onInput={(value) => setState("description", value)}
                    multiline
                  />
                  <div class="os-form-grid">
                    <SelectField
                      label="Domain"
                      value={state.domain}
                      onInput={(value) => setState("domain", value)}
                      options={[
                        "machine_learning",
                        "data_science",
                        "computational_biology",
                        "physics",
                        "chemistry",
                        "engineering",
                        "other",
                      ]}
                    />
                    <SelectField
                      label="License"
                      value={state.license}
                      onInput={(value) => setState("license", value)}
                      options={["MIT", "BSD-3-Clause", "Apache-2.0", "GPL-3.0", "proprietary"]}
                    />
                  </div>
                </Match>
                <Match when={step() === 1}>
                  <WizardTitle
                    title="Choose the repository"
                    description="Every ready study has one authoritative Git repository."
                  />
                  <Choice
                    label="Initialize a new repository"
                    detail="Recommended. Creates a new study folder and initializes Git."
                    selected={state.repositoryMode === "new"}
                    onClick={() => setState("repositoryMode", "new")}
                  />
                  <Choice
                    label="Use an existing repository"
                    detail="Adds the signed research record without moving existing files."
                    selected={state.repositoryMode === "existing"}
                    onClick={() => setState("repositoryMode", "existing")}
                  />
                  <Choice
                    label="Set up Git later"
                    detail="Saves an incomplete draft. Formal research actions remain disabled."
                    selected={state.repositoryMode === "later"}
                    onClick={() => setState("repositoryMode", "later")}
                  />
                  <Field
                    label={state.repositoryMode === "new" ? "Parent folder" : "Repository or draft folder"}
                    value={state.destinationBase}
                    onInput={(value) => {
                      setState("destinationBase", value)
                      setState("destinationEdited", state.repositoryMode !== "new")
                    }}
                    required
                  />
                  <div class="os-path-preview">Destination: {destination()}</div>
                </Match>
                <Match when={step() === 2}>
                  <WizardTitle
                    title="Declare the scientific start"
                    description="The first iteration records intent before any formal execution."
                  />
                  <SelectField
                    label="Starting data phase"
                    value={state.dataPhase}
                    onInput={(value) => setState("dataPhase", value)}
                    options={["synthetic", "downloaded", "real"]}
                  />
                  <SelectField
                    label="Iteration type"
                    value={state.iterationMode}
                    onInput={(value) => setState("iterationMode", value)}
                    options={["exploratory", "confirmatory", "replication", "benchmark"]}
                  />
                  <Field
                    label="Iteration title"
                    value={state.iterationTitle}
                    onInput={(value) => setState("iterationTitle", value)}
                    required
                  />
                  <Field
                    label="Question for this iteration"
                    value={state.iterationQuestion}
                    onInput={(value) => setState("iterationQuestion", value)}
                    multiline
                    required
                  />
                  <Field
                    label="Decision goal / success criterion"
                    value={state.decisionGoal}
                    onInput={(value) => setState("decisionGoal", value)}
                    multiline
                    required
                  />
                  <ModeFields state={state} setState={setState} />
                </Match>
                <Match when={step() === 3}>
                  <WizardTitle
                    title="Build the research environment"
                    description="OpenScience writes a portable specification before solving anything."
                  />
                  <div class="os-form-grid">
                    <SelectField
                      label="Python"
                      value={state.python}
                      onInput={(value) => setState("python", value)}
                      options={["3.10", "3.11", "3.12", "3.13"]}
                    />
                    <Toggle
                      label="Create Conda environment now"
                      checked={state.createEnvironment}
                      onChange={(value) => setState("createEnvironment", value)}
                    />
                  </div>
                  <div class="os-preset-grid">
                    <For each={Object.keys(PRESETS) as (keyof typeof PRESETS)[]}>
                      {(name) => (
                        <Toggle
                          label={`${name} · ${PRESETS[name].join(", ")}`}
                          checked={state.presets[name]}
                          onChange={(value) => setState("presets", name, value)}
                        />
                      )}
                    </For>
                  </div>
                  <Field
                    label="Additional Conda packages"
                    value={state.condaPackages}
                    onInput={(value) => setState("condaPackages", value)}
                    multiline
                    hint="One per line or comma-separated. Package names and version constraints only."
                  />
                  <Field
                    label="Additional Pip packages"
                    value={state.pipPackages}
                    onInput={(value) => setState("pipPackages", value)}
                    multiline
                  />
                </Match>
                <Match when={step() === 4}>
                  <WizardTitle
                    title="Choose compute readiness"
                    description="HPC fields create a profile; they do not claim the cluster is connected."
                  />
                  <Toggle
                    label="Prepare this study for HPC"
                    checked={state.hpc}
                    onChange={(value) => setState("hpc", value)}
                  />
                  <Show when={state.hpc}>
                    <div class="os-form-grid">
                      <SelectField
                        label="Scheduler"
                        value={state.scheduler}
                        onInput={(value) => setState("scheduler", value)}
                        options={["slurm", "pbs", "sge"]}
                      />
                      <Field
                        label="Cluster name"
                        value={state.clusterName}
                        onInput={(value) => setState("clusterName", value)}
                      />
                      <Field label="Account" value={state.account} onInput={(value) => setState("account", value)} />
                      <Field
                        label="Partition / queue"
                        value={state.partition}
                        onInput={(value) => setState("partition", value)}
                      />
                    </div>
                    <Field
                      label="Modules"
                      value={state.modules}
                      onInput={(value) => setState("modules", value)}
                      hint="One per line, for example cuda/12.4"
                    />
                    <Field
                      label="Scratch path"
                      value={state.scratchPath}
                      onInput={(value) => setState("scratchPath", value)}
                    />
                  </Show>
                </Match>
                <Match when={step() === 5}>
                  <WizardTitle
                    title="Set data and network boundaries"
                    description="These choices are visible in the study contract and applied before agent work begins."
                  />
                  <SelectField
                    label="Network use"
                    value={state.networkMode}
                    onInput={(value) => setState("networkMode", value)}
                    options={["offline", "ask", "allowed"]}
                  />
                  <SelectField
                    label="Data egress"
                    value={state.egressPolicy}
                    onInput={(value) => setState("egressPolicy", value)}
                    options={["public", "restricted", "air-gapped"]}
                  />
                  <Field
                    label="Expected external services"
                    value={state.expectedServices}
                    onInput={(value) => setState("expectedServices", value)}
                    multiline
                  />
                  <Toggle
                    label="I confirm this v1 study contains public or non-sensitive data"
                    checked={state.publicConfirmed}
                    onChange={(value) => setState("publicConfirmed", value)}
                  />
                </Match>
                <Match when={step() === 6}>
                  <WizardTitle
                    title="Create the local owner"
                    description="People and roles can evolve later from the project’s People workspace."
                  />
                  <Field
                    label="Your name"
                    value={state.authorName}
                    onInput={(value) => setState("authorName", value)}
                    required
                  />
                  <Field
                    label="Email"
                    value={state.authorEmail}
                    onInput={(value) => setState("authorEmail", value)}
                    type="email"
                  />
                  <Field
                    label="Signing-key passphrase, if required"
                    value={state.passphrase}
                    onInput={(value) => setState("passphrase", value)}
                    type="password"
                    hint="Leave blank when the operating-system keychain is available."
                  />
                  <div class="os-note">
                    Publication and contribution workspaces are always available. They consume approved evidence and
                    never bypass review.
                  </div>
                </Match>
                <Match when={step() === 7}>
                  <WizardTitle
                    title="Review exact changes"
                    description="Nothing is created until you confirm this preview."
                  />
                  <Show when={preview()}>
                    {(value) => (
                      <div class="os-review-grid">
                        <ReviewRow label="Destination" value={value().destination} />
                        <ReviewRow label="Git" value={state.repositoryMode} />
                        <ReviewRow label="Environment" value={`${value().environmentName} · Python ${state.python}`} />
                        <ReviewRow label="Data phase" value={state.dataPhase} />
                        <ReviewRow label="Network / egress" value={`${state.networkMode} · ${state.egressPolicy}`} />
                        <ReviewRow
                          label="HPC"
                          value={state.hpc ? `${state.scheduler} profile · not yet validated` : "local"}
                        />
                        <details>
                          <summary>environment.yml</summary>
                          <pre>{value().environmentYml}</pre>
                        </details>
                        <details>
                          <summary>{value().directories.length} scaffold directories</summary>
                          <pre>{value().directories.join("\n")}</pre>
                        </details>
                      </div>
                    )}
                  </Show>
                </Match>
              </Switch>
            </Show>
          </div>
          <footer class="os-wizard__footer">
            <button
              type="button"
              class="os-button"
              disabled={busy() || !!operation()}
              onClick={() => (step() === 0 ? dialog.close() : setStep((value) => value - 1))}
            >
              {step() === 0 ? "Cancel" : "Back"}
            </button>
            <span />
            <Show when={!operation()}>
              <button
                type="button"
                class="os-button os-button--primary"
                disabled={busy() || (step() === 5 && !state.publicConfirmed)}
                onClick={() => (step() === 7 ? void create() : next())}
              >
                {busy() ? "Preparing preview…" : step() === 7 ? "Create study" : "Continue"}
              </button>
            </Show>
          </footer>
        </main>
      </div>
    </Dialog>
  )
}

function WizardTitle(props: { title: string; description: string }) {
  return (
    <div class="os-wizard-title">
      <span class="os-eyebrow">Step</span>
      <h2>{props.title}</h2>
      <p>{props.description}</p>
    </div>
  )
}
function Field(props: {
  label: string
  value: string
  onInput: (value: string) => void
  multiline?: boolean
  required?: boolean
  hint?: string
  type?: string
}) {
  return (
    <label class="os-field">
      <span>{props.label}</span>
      <Show
        when={props.multiline}
        fallback={
          <input
            type={props.type ?? "text"}
            required={props.required}
            value={props.value}
            onInput={(event) => props.onInput(event.currentTarget.value)}
          />
        }
      >
        <textarea
          required={props.required}
          rows={4}
          value={props.value}
          onInput={(event) => props.onInput(event.currentTarget.value)}
        />
      </Show>
      <Show when={props.hint}>
        <small>{props.hint}</small>
      </Show>
    </label>
  )
}
function SelectField(props: { label: string; value: string; onInput: (value: string) => void; options: string[] }) {
  return (
    <label class="os-field">
      <span>{props.label}</span>
      <select value={props.value} onInput={(event) => props.onInput(event.currentTarget.value)}>
        <For each={props.options}>{(value) => <option value={value}>{value.replaceAll("_", " ")}</option>}</For>
      </select>
    </label>
  )
}
function Toggle(props: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label class="os-toggle">
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(event) => props.onChange(event.currentTarget.checked)}
      />
      <span>{props.label}</span>
    </label>
  )
}
function Choice(props: { label: string; detail: string; selected: boolean; onClick: () => void }) {
  return (
    <button type="button" class="os-choice" classList={{ selected: props.selected }} onClick={props.onClick}>
      <span class="os-choice__radio" />
      <strong>{props.label}</strong>
      <small>{props.detail}</small>
    </button>
  )
}
function ReviewRow(props: { label: string; value: string }) {
  return (
    <div class="os-review-row">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  )
}

function ModeFields(props: { state: Record<string, unknown>; setState: (...args: unknown[]) => void }): JSX.Element {
  const state = props.state as Record<string, string>
  const set = (name: string) => (value: string) => props.setState(name, value)
  return (
    <Switch>
      <Match when={state.iterationMode === "exploratory"}>
        <Field label="Exploratory aim" value={state.aim} onInput={set("aim")} multiline />
        <Field label="Intended inputs" value={state.intendedInputs} onInput={set("intendedInputs")} multiline />
        <Field label="Intended outputs" value={state.intendedOutputs} onInput={set("intendedOutputs")} multiline />
      </Match>
      <Match when={state.iterationMode === "confirmatory"}>
        <Field label="Hypothesis" value={state.hypothesis} onInput={set("hypothesis")} multiline required />
        <Field
          label="Null hypothesis"
          value={state.nullHypothesis}
          onInput={set("nullHypothesis")}
          multiline
          required
        />
        <Field label="Primary outcome" value={state.primaryOutcome} onInput={set("primaryOutcome")} required />
        <Field label="Controls" value={state.controls} onInput={set("controls")} multiline required />
        <Field label="Exclusions" value={state.exclusions} onInput={set("exclusions")} multiline />
        <Field label="Statistical method" value={state.statisticalMethod} onInput={set("statisticalMethod")} required />
        <Field label="Stopping rule" value={state.stoppingRule} onInput={set("stoppingRule")} required />
        <Field label="Decision rule" value={state.decisionRule} onInput={set("decisionRule")} required />
      </Match>
      <Match when={state.iterationMode === "replication"}>
        <Field label="Source protocol" value={state.sourceProtocol} onInput={set("sourceProtocol")} required />
        <Field
          label="Faithful elements"
          value={state.faithfulElements}
          onInput={set("faithfulElements")}
          multiline
          required
        />
        <Field label="Deviations" value={state.deviations} onInput={set("deviations")} multiline />
        <Field
          label="Equivalence rule"
          value={state.equivalenceRule}
          onInput={set("equivalenceRule")}
          multiline
          required
        />
      </Match>
      <Match when={state.iterationMode === "benchmark"}>
        <Field label="Datasets and splits" value={state.datasets} onInput={set("datasets")} multiline required />
        <Field label="Baselines" value={state.baselines} onInput={set("baselines")} multiline required />
        <Field label="Metrics" value={state.metrics} onInput={set("metrics")} multiline required />
        <Field
          label="Leakage boundary"
          value={state.leakageBoundary}
          onInput={set("leakageBoundary")}
          multiline
          required
        />
      </Match>
    </Switch>
  )
}
