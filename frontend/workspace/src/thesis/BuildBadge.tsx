import { Show, type JSX } from "solid-js"
import { useServer } from "@/context/server"

export function BuildBadge(): JSX.Element {
  const server = useServer()
  const disconnected = () => server.healthy() === false
  const mismatch = () => {
    const build = server.build
    if (!build) return false
    if (build.mode !== __OPENSCIENCE_BUILD_MODE__) return true
    if (
      __OPENSCIENCE_BUILD_VERSION__ !== "unknown" &&
      __OPENSCIENCE_BUILD_VERSION__ !== "local" &&
      build.version !== __OPENSCIENCE_BUILD_VERSION__
    )
      return true
    if (__OPENSCIENCE_BUILD_CHANNEL__ !== "unknown" && build.channel !== __OPENSCIENCE_BUILD_CHANNEL__) return true
    if (build.commit === "unknown" || __OPENSCIENCE_BUILD_COMMIT__ === "unknown") return false
    return build.commit !== __OPENSCIENCE_BUILD_COMMIT__
  }

  return (
    <div class="os-build-badge" classList={{ "os-build-badge--warning": mismatch() || disconnected() }}>
      <span class="os-build-badge__dot" aria-hidden="true" />
      <Show when={!disconnected()} fallback={`Backend disconnected · ${server.url.replace(/^https?:\/\//, "")}`}>
        <Show
          when={mismatch()}
          fallback={`${__OPENSCIENCE_BUILD_MODE__ === "source" ? "Local source" : "Packaged"} · ${__OPENSCIENCE_BUILD_COMMIT__}`}
        >
          Frontend/backend build mismatch · reload the matching build
        </Show>
      </Show>
    </div>
  )
}
