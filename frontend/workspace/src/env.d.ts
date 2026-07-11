interface ImportMetaEnv {
  readonly VITE_OPENSCIENCE_SERVER_HOST: string
  readonly VITE_OPENSCIENCE_SERVER_PORT: string
  readonly VITE_OPENSCIENCE_SERVER?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare const __OPENSCIENCE_BUILD_COMMIT__: string
declare const __OPENSCIENCE_BUILD_MODE__: "source" | "packaged"
declare const __OPENSCIENCE_BUILD_VERSION__: string
declare const __OPENSCIENCE_BUILD_CHANNEL__: string

interface Window {
  __OPENSCIENCE_BASE_URL__?: string
}
