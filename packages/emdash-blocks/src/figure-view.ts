import { DEFAULT_DATA_VIEW_ORIGIN, isDataViewUrl } from '@developing-country/views'
import { parseUnderlayUrls } from './figure-blocks'

/**
 * Server-side gate shared by every interactive article block: a view URL is
 * rendered only when it is a canonical Data View on the configured platform
 * origin and not on the site's own origin (same rule as LiveView.astro).
 */
export function safeFigureViewUrl(raw: unknown, siteOrigin: string, configuredOrigin?: string): string | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  if (!value) return null
  const origin = configuredOrigin || DEFAULT_DATA_VIEW_ORIGIN
  try {
    if (new URL(value).origin === siteOrigin) return null
    // SAFETY: isDataViewUrl accepts any origin string at runtime; its parameter type is the default literal.
    return isDataViewUrl(value, origin as typeof DEFAULT_DATA_VIEW_ORIGIN) ? value : null
  } catch {
    return null
  }
}

/**
 * Every underlay URL must pass the same canonical rule; one bad URL returns
 * null so the whole block renders its unavailable notice (fail closed).
 */
export function safeUnderlayUrls(raw: unknown, siteOrigin: string, configuredOrigin?: string): string[] | null {
  const urls = parseUnderlayUrls(raw)
  const safe: string[] = []
  for (const url of urls) {
    const checked = safeFigureViewUrl(url, siteOrigin, configuredOrigin)
    if (!checked) return null
    safe.push(checked)
  }
  return safe
}

export interface FigureIslandConfig {
  origin: string
  tileBase?: string
  apiBase?: string
}

/** Serializable figure settings passed to every island. */
export function figureIslandConfig(options: { configuredOrigin?: string; tileBase?: string; devApiBase?: string }): FigureIslandConfig {
  return {
    origin: options.configuredOrigin || DEFAULT_DATA_VIEW_ORIGIN,
    ...(options.tileBase ? { tileBase: options.tileBase } : {}),
    ...(options.devApiBase ? { apiBase: options.devApiBase } : {}),
  }
}

export interface SafeScrollyStep {
  text: string
  view_url: string
  center_lng?: number | string
  center_lat?: number | string
  zoom?: number | string
  show?: string
  highlight?: string
  underlay_urls?: string
}

/** Every step must carry a safe view URL; one bad step fails the whole block closed. */
export function safeScrollySteps(steps: unknown, siteOrigin: string, configuredOrigin?: string): SafeScrollyStep[] | null {
  if (!Array.isArray(steps) || steps.length === 0) return null
  const out: SafeScrollyStep[] = []
  for (const step of steps) {
    if (!step || typeof step !== 'object') return null
    const record = step as Record<string, unknown>
    const viewUrl = safeFigureViewUrl(record.view_url, siteOrigin, configuredOrigin)
    if (!viewUrl) return null
    const underlays = safeUnderlayUrls(record.underlay_urls, siteOrigin, configuredOrigin)
    if (!underlays) return null
    const scalar = (value: unknown) => (typeof value === 'number' || typeof value === 'string' ? value : undefined)
    out.push({
      text: typeof record.text === 'string' ? record.text : '',
      view_url: viewUrl,
      ...(scalar(record.center_lng) !== undefined ? { center_lng: scalar(record.center_lng) } : {}),
      ...(scalar(record.center_lat) !== undefined ? { center_lat: scalar(record.center_lat) } : {}),
      ...(scalar(record.zoom) !== undefined ? { zoom: scalar(record.zoom) } : {}),
      ...(typeof record.show === 'string' ? { show: record.show } : {}),
      ...(typeof record.highlight === 'string' ? { highlight: record.highlight } : {}),
      ...(underlays.length > 0 ? { underlay_urls: underlays.join(',') } : {}),
    })
  }
  return out
}

/** A trimmed non-empty string field, or undefined. */
export function textField(node: Record<string, unknown>, key: string): string | undefined {
  const value = node[key]
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

/** A finite number field (CMS numbers may arrive as strings); '' and missing are undefined, never 0. */
export function numberField(node: Record<string, unknown>, key: string): number | undefined {
  const value = node[key]
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}
