import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { defineConfig } from "vite"
import desktopPlugin from "./vite"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const commit =
  process.env.VITE_OPENSCIENCE_BUILD_COMMIT ??
  (() => {
    try {
      return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], { cwd: root, encoding: "utf8" }).trim()
    } catch {
      return "unknown"
    }
  })()

export default defineConfig(({ command }) => {
  const mode = command === "serve" ? "source" : "packaged"
  const version = process.env.VITE_OPENSCIENCE_BUILD_VERSION ?? (mode === "source" ? "local" : "unknown")
  const channel = process.env.VITE_OPENSCIENCE_BUILD_CHANNEL ?? (mode === "source" ? "local" : "unknown")
  return {
    plugins: [desktopPlugin] as any,
    define: {
      __OPENSCIENCE_BUILD_COMMIT__: JSON.stringify(commit),
      __OPENSCIENCE_BUILD_MODE__: JSON.stringify(mode),
      __OPENSCIENCE_BUILD_VERSION__: JSON.stringify(version),
      __OPENSCIENCE_BUILD_CHANNEL__: JSON.stringify(channel),
    },
    server: {
      host: "0.0.0.0",
      allowedHosts: true,
      port: 3000,
    },
    build: {
      target: "esnext",
      // sourcemap: true,
      // Never inline audio (notification sounds) as base64 — sound.ts imports ~45
      // alert clips, and inlining the small ones baked ~58KB gzip of base64 into
      // the entry chunk for sounds that (a) are off by default and (b) only ever
      // play on an event, never at first paint. As separate assets they're fetched
      // on demand when a sound actually plays.
      assetsInlineLimit(filePath) {
        if (/\.(aac|mp3|wav|ogg|m4a)$/.test(filePath)) return false
        return undefined
      },
    },
  }
})
