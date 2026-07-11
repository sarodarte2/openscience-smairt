import { For, Show, type JSX, type ParentProps } from "solid-js"

export function ResearchSurface(props: ParentProps<{ class?: string }>): JSX.Element {
  return <section class={`os-surface ${props.class ?? ""}`}>{props.children}</section>
}

export function ResearchHeader(
  props: ParentProps<{ eyebrow?: string; title: string; description?: string; actions?: JSX.Element }>,
): JSX.Element {
  return (
    <header class="os-page-header">
      <div class="os-page-header__copy">
        <Show when={props.eyebrow}>
          <span class="os-eyebrow">{props.eyebrow}</span>
        </Show>
        <h1 class="os-page-title">{props.title}</h1>
        <Show when={props.description}>
          <p class="os-page-description">{props.description}</p>
        </Show>
      </div>
      <Show when={props.actions}>
        <div class="os-page-header__actions">{props.actions}</div>
      </Show>
      {props.children}
    </header>
  )
}

export interface ResearchNavItem<T extends string> {
  id: T
  label: string
  count?: number
}

export function ResearchNav<T extends string>(props: {
  items: ResearchNavItem<T>[]
  value: T
  onChange: (value: T) => void
}): JSX.Element {
  return (
    <nav class="os-segmented-nav" aria-label="Study sections">
      <For each={props.items}>
        {(item) => (
          <button
            type="button"
            class="os-segmented-nav__item"
            classList={{ "os-segmented-nav__item--active": props.value === item.id }}
            aria-current={props.value === item.id ? "page" : undefined}
            onClick={() => props.onChange(item.id)}
          >
            <span>{item.label}</span>
            <Show when={item.count !== undefined}>
              <span class="os-segmented-nav__count">{item.count}</span>
            </Show>
          </button>
        )}
      </For>
    </nav>
  )
}

export function ResearchSection(
  props: ParentProps<{ title: string; description?: string; action?: JSX.Element }>,
): JSX.Element {
  return (
    <section class="os-section">
      <div class="os-section__heading">
        <div>
          <h2 class="os-section__title">{props.title}</h2>
          <Show when={props.description}>
            <p class="os-section__description">{props.description}</p>
          </Show>
        </div>
        <Show when={props.action}>
          <div class="os-section__action">{props.action}</div>
        </Show>
      </div>
      {props.children}
    </section>
  )
}

export function ResearchStatus(props: {
  tone?: "neutral" | "success" | "warning" | "danger"
  label: string
  detail?: string
}): JSX.Element {
  return (
    <div class="os-status" data-tone={props.tone ?? "neutral"} role="status">
      <span class="os-status__dot" aria-hidden="true" />
      <span class="os-status__label">{props.label}</span>
      <Show when={props.detail}>
        <span class="os-status__detail">{props.detail}</span>
      </Show>
    </div>
  )
}

export function ResearchEmpty(props: { title: string; description: string; action?: JSX.Element }): JSX.Element {
  return (
    <div class="os-empty">
      <strong>{props.title}</strong>
      <p>{props.description}</p>
      <Show when={props.action}>{props.action}</Show>
    </div>
  )
}

export function ResearchProgress(props: {
  stage: string
  detail: string
  elapsed?: number
  onCancel?: () => void
}): JSX.Element {
  return (
    <div class="os-progress" role="status" aria-live="polite">
      <span class="os-progress__spinner" aria-hidden="true" />
      <div class="os-progress__copy">
        <strong>{props.stage}</strong>
        <span>{props.detail}</span>
      </div>
      <Show when={props.elapsed !== undefined}>
        <span class="os-progress__elapsed">{props.elapsed}s</span>
      </Show>
      <Show when={props.onCancel}>
        <button type="button" class="os-button os-button--compact" onClick={props.onCancel}>
          Cancel
        </button>
      </Show>
    </div>
  )
}
