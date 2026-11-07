/**
 * Theme tokens as figures consume them. Every colour a figure paints comes from
 * packages/ui/tokens.css, read from the live CSS custom properties so a figure
 * follows `<html data-theme>` exactly like the chrome around it. The fallback
 * values below mirror the light tokens and are only used where no stylesheet is
 * present (server render, unit tests).
 */
export interface FigureTokens {
  routeSystem: string
  routeSun: string
  routeFlag: string
  routeInfo: string
  routeFlagInk: string
  ink: string
  inkDim: string
  paper: string
  line: string
  lineSoft: string
  dark: boolean
}

export const FALLBACK_TOKENS: FigureTokens = {
  routeSystem: '#00a191',
  routeSun: '#e8930c',
  routeFlag: '#d14321',
  routeInfo: '#2456c4',
  routeFlagInk: '#b23a1d',
  ink: '#050505',
  inkDim: '#5f5d56',
  paper: '#f7f6f4',
  line: '#050505',
  lineSoft: 'rgba(22, 24, 29, 0.28)',
  dark: false,
}

const TOKEN_PROPERTIES: Record<Exclude<keyof FigureTokens, 'dark'>, string> = {
  routeSystem: '--route-system',
  routeSun: '--route-sun',
  routeFlag: '--route-flag',
  routeInfo: '--route-info',
  routeFlagInk: '--route-flag-ink',
  ink: '--ink',
  inkDim: '--ink-dim',
  paper: '--paper',
  line: '--panel-line',
  lineSoft: '--panel-line-soft',
}

/** Read the resolved token values that apply to `element`. */
export function readTokens(element: Element): FigureTokens {
  const styles = getComputedStyle(element)
  const tokens = { ...FALLBACK_TOKENS }
  for (const [key, property] of Object.entries(TOKEN_PROPERTIES) as Array<[Exclude<keyof FigureTokens, 'dark'>, string]>) {
    const value = styles.getPropertyValue(property).trim()
    if (value) tokens[key] = value
  }
  tokens.dark = luminance(tokens.paper) < 0.4
  return tokens
}

export interface Rgba { r: number; g: number; b: number; a: number }

/** Parse #rgb, #rrggbb, rgb() and rgba(); null for anything else. */
export function parseColor(value: string): Rgba | null {
  const text = value.trim().toLowerCase()
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(text)
  if (hex) {
    const digits = hex[1] ?? ''
    const full = digits.length === 3 ? [...digits].map((d) => d + d).join('') : digits
    return {
      r: Number.parseInt(full.slice(0, 2), 16),
      g: Number.parseInt(full.slice(2, 4), 16),
      b: Number.parseInt(full.slice(4, 6), 16),
      a: 1,
    }
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(text)
  if (rgb) {
    const alphaText = rgb[4]
    const alpha = alphaText === undefined ? 1 : alphaText.endsWith('%') ? Number.parseFloat(alphaText) / 100 : Number(alphaText)
    return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]), a: alpha }
  }
  return null
}

function toHex(value: number): string {
  return Math.round(Math.max(0, Math.min(255, value))).toString(16).padStart(2, '0')
}

/** Mix two token colours in sRGB; `t` is the share of `b` (0 → a, 1 → b). Opaque output. */
export function mixColor(a: string, b: string, t: number): string {
  const ca = parseColor(a)
  const cb = parseColor(b)
  if (!ca || !cb) return t < 0.5 ? a : b
  const k = Math.max(0, Math.min(1, t))
  return `#${toHex(ca.r + (cb.r - ca.r) * k)}${toHex(ca.g + (cb.g - ca.g) * k)}${toHex(ca.b + (cb.b - ca.b) * k)}`
}

/** Relative luminance (0 black → 1 white); unknown colours count as light. */
export function luminance(value: string): number {
  const c = parseColor(value)
  if (!c) return 1
  const channel = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b)
}
