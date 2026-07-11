import type { JSX } from "solid-js"

export const FONT_SANS =
  "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Inter, Helvetica, Arial, sans-serif"
export const FONT_SERIF = "'Computer Modern', 'Latin Modern Roman', Georgia, 'Times New Roman', serif"
/** Code font — resolves through the theme/Settings-owned mono variable so the
 *  user's mono-font choice applies everywhere code renders. */
export const FONT_CODE = "var(--font-family-mono, ui-monospace, monospace)"
/** Legacy alias retained for existing code-shaped metadata call sites. */
export const FONT_MONO = FONT_CODE
/** Alias kept for call sites that explicitly reference the native UI face. */
export const FONT_UI_SANS = FONT_SANS

/** Control radius in px — keep in lockstep with --radius in thesis.css. */
export const RADIUS = 10

export const Z = {
  header: 20,
  sticky: 50,
  fab: 100,
  overlay: 200,
  modal: 300,
  toast: 400,
} as const

export const ICON_SIZE = {
  xs: 11,
  sm: 12,
  md: 13,
  lg: 14,
  xl: 16,
} as const

/** The one uppercase "eyebrow" label spec — mirror of .thesis-section-label. */
export const sectionTitle: JSX.CSSProperties = {
  "font-family": FONT_SANS,
  "font-size": "10px",
  "font-weight": 400,
  "letter-spacing": "0.08em",
  "text-transform": "uppercase",
  color: "var(--color-text-faint)",
}

export const cardStyle: JSX.CSSProperties = {
  background: "var(--color-surface-solid)",
  border: "1px solid var(--color-border)",
  "border-radius": `${RADIUS}px`,
  padding: "12px 16px",
}

export const monoText = (size: number, color: string = "var(--color-text)"): JSX.CSSProperties => ({
  "font-family": FONT_MONO,
  "font-size": `${size}px`,
  color,
})

export const sansText = (size: number, color: string = "var(--color-text)"): JSX.CSSProperties => ({
  "font-family": FONT_SANS,
  "font-size": `${size}px`,
  color,
})
