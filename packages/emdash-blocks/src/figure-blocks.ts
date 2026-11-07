import type { DataViewResultRow } from '@developing-country/views'

/**
 * Interactive article blocks (ADR 0009). Every block points at immutable Data
 * Views by `view_url`; the CMS stores intent and prose only, never rows,
 * renderer config or screenshots (ADR 0003). Renderers fetch the view and its
 * result snapshot from the platform origin at read time.
 */

/** One figure, rendered inline (map or chart, whichever the view is). */
export interface FigureNode {
  _type: 'dcFigure'
  view_url: string
  title?: string
  caption?: string
  /** `inline` sits in the text column, `wide` breaks out of it, `full` spans the viewport. */
  size?: 'inline' | 'wide' | 'full'
  /**
   * Comma-separated canonical map view URLs drawn beneath this view in the same
   * map (e.g. a density choropleth under cluster outlines). Map views only.
   */
  underlay_urls?: string
}

/**
 * One scroll step. Optional overrides change presentation only: camera, which
 * of the view's layers are shown, and which features are emphasised.
 */
export interface ScrollyStep {
  text: string
  view_url: string
  center_lng?: number
  center_lat?: number
  zoom?: number
  /** Comma-separated layer ids from the view; empty means the view's own visibility. */
  show?: string
  /** Comma-separated feature ids (row ids) to emphasise. */
  highlight?: string
  /** Comma-separated canonical map view URLs drawn beneath this step's view. */
  underlay_urls?: string
}

/** A sticky figure that changes as the reader scrolls through the steps. */
export interface ScrollyNode {
  _type: 'dcScrolly'
  title?: string
  steps: ScrollyStep[]
}

export type BoundAggregate = 'first' | 'sum' | 'mean' | 'min' | 'max' | 'count'

/** A number read from a view's result rows, never typed by hand. */
export interface ValueBinding {
  view_url: string
  field: string
  /** Optional row filter: only rows where `where_field` equals `where_value`. */
  where_field?: string
  where_value?: string
  aggregate?: BoundAggregate
  /** Multiplier applied after aggregation, e.g. 100 to show a share as a percentage. */
  scale?: number
}

export type StatFormat = 'number' | 'compact' | 'percent'

export interface StatNode extends ValueBinding {
  _type: 'dcStat'
  label: string
  format?: StatFormat
  unit?: string
  note?: string
  /** When set, the stat also shows the reader's answer to the dcGuess with this id. */
  guess_id?: string
}

/** The reader commits to a guess before the story reveals the bound answer. */
export interface GuessNode extends ValueBinding {
  _type: 'dcGuess'
  guess_id: string
  question: string
  min: number
  max: number
  step?: number
  unit?: string
  format?: StatFormat
  /** Where the answer appears, e.g. "We'll check it after the map." */
  reveal_hint?: string
}

export interface ExplorerMetric {
  field: string
  label: string
  unit?: string
  format?: StatFormat
}

/** Searchable small multiples over a view's rows (one card per row). */
export interface ExplorerNode {
  _type: 'dcExplorer'
  view_url: string
  title?: string
  title_field: string
  subtitle_field?: string
  /** Comma-separated row fields matched by the search box; defaults to title_field. */
  search_fields?: string
  metrics: ExplorerMetric[]
  /**
   * Compact counts on one line under the metric bars, e.g. { field: 'schools_10min',
   * label: '🏫', unit: 'schools' } renders "🏫 12 schools". Also offered as sort keys.
   */
  badges?: ExplorerMetric[]
  sort_field?: string
  sort_dir?: 'asc' | 'desc'
}

export type InteractiveBlockNode = FigureNode | ScrollyNode | StatNode | GuessNode | ExplorerNode

export const INTERACTIVE_BLOCK_TYPES = ['dcFigure', 'dcScrolly', 'dcStat', 'dcGuess', 'dcExplorer'] as const

/** Split a comma-separated CMS field into trimmed, non-empty ids. */
export function parseIdList(value: string | undefined): string[] {
  return (value ?? '').split(',').map((part) => part.trim()).filter(Boolean)
}

/** The underlay view URLs of a dcFigure or scrolly step, in order, de-duplicated. */
export function parseUnderlayUrls(value: unknown): string[] {
  return [...new Set(parseIdList(typeof value === 'string' ? value : undefined))]
}

/**
 * Every Data View URL an article body references, in document order, including
 * scrolly steps and every underlay. The evidence gate requires each one in
 * evidence_bundle.dataViews.
 */
export function viewUrlsInContent(content: unknown): string[] {
  if (!Array.isArray(content)) return []
  const urls: string[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const node = block as Record<string, unknown>
    if (typeof node._type !== 'string' || !node._type.startsWith('dc')) continue
    for (const key of ['view_url', 'url', 'id'] as const) {
      // dcLiveView keeps its legacy aliases; the new blocks only use view_url.
      if (key !== 'view_url' && node._type !== 'dcLiveView') continue
      const value = node[key]
      if (typeof value === 'string' && value.trim()) {
        urls.push(value.trim())
        break
      }
    }
    if (node._type === 'dcFigure') urls.push(...parseUnderlayUrls(node.underlay_urls))
    if (node._type === 'dcScrolly' && Array.isArray(node.steps)) {
      for (const step of node.steps) {
        if (!step || typeof step !== 'object') continue
        const record = step as Record<string, unknown>
        const url = record.view_url
        if (typeof url === 'string' && url.trim()) urls.push(url.trim())
        urls.push(...parseUnderlayUrls(record.underlay_urls))
      }
    }
  }
  return urls
}

/** Resolve a ValueBinding against result rows; null when nothing numeric matches. */
export function resolveBoundValue(rows: DataViewResultRow[], binding: Omit<ValueBinding, 'view_url'>): number | null {
  const matching = binding.where_field
    ? rows.filter((row) => String(row[binding.where_field as string] ?? '') === (binding.where_value ?? ''))
    : rows
  const aggregate = binding.aggregate ?? 'first'
  if (aggregate === 'count') return applyScale(matching.length, binding.scale)
  const values = matching
    .map((row) => row[binding.field])
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  if (values.length === 0) return null
  let result: number
  switch (aggregate) {
    case 'sum': result = values.reduce((a, b) => a + b, 0); break
    case 'mean': result = values.reduce((a, b) => a + b, 0) / values.length; break
    case 'min': result = Math.min(...values); break
    case 'max': result = Math.max(...values); break
    default: result = values[0] as number
  }
  return applyScale(result, binding.scale)
}

function applyScale(value: number, scale: number | undefined): number {
  return typeof scale === 'number' && Number.isFinite(scale) ? value * scale : value
}

export function formatBoundValue(value: number, format: StatFormat = 'number', unit?: string): string {
  const text = format === 'percent'
    ? `${new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(value)}%`
    : format === 'compact'
      ? new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
      : new Intl.NumberFormat('en', { maximumFractionDigits: Math.abs(value) < 10 ? 1 : 0 }).format(value)
  // A percent format already carries its sign; don't print "40% %".
  if (!unit || (format === 'percent' && unit.trim() === '%')) return text
  return `${text} ${unit}`
}
