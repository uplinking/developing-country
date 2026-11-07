import type {
  DataViewResultRow,
  MapColor,
  MapColorBy,
  MapLayerStyle,
  MapLayerView,
  MapViewSpec,
} from '@developing-country/views'
import { mixColor, type FigureTokens } from './tokens'

/**
 * Pure translation from the Data View map contract to MapLibre style objects.
 * Nothing here touches the DOM or MapLibre itself, so the whole styling model is
 * unit-tested; `mapEngine.ts` only adds what these functions return.
 */

/** A MapLibre expression or literal. Kept structural so tests need no MapLibre types. */
export type Expr = string | number | boolean | null | Expr[] | { [key: string]: Expr }

/** Where a styled field's value lives: a GeoJSON property, or feature-state set from a tile join. */
export type ValueSource = 'property' | 'feature-state'

export const FEATURE_ID_PROPERTY = '__fid'
export const TILE_ID_PROPERTY = 'id'
const HIGHLIGHT_STATE = 'hl'
const PRESENT_STATE = 'present'

export function valueExpr(field: string, source: ValueSource): Expr {
  return source === 'property' ? ['get', field] : ['feature-state', field]
}

const TOKEN_KEYS: Record<string, keyof FigureTokens> = {
  'route-system': 'routeSystem',
  'route-sun': 'routeSun',
  'route-flag': 'routeFlag',
  'route-info': 'routeInfo',
  ink: 'ink',
  'ink-dim': 'inkDim',
}

/** Resolve a view colour (token name or #rrggbb) against the live theme. */
export function resolveMapColor(color: MapColor | undefined, tokens: FigureTokens, fallback: string): string {
  if (!color) return fallback
  if (color.startsWith('#')) return color
  const key = TOKEN_KEYS[color]
  const value = key ? tokens[key] : undefined
  return typeof value === 'string' ? value : fallback
}

/** Default series colours for layers that carry no style, in route order. */
export function defaultLayerColor(index: number, tokens: FigureTokens): string {
  const palette = [tokens.routeFlag, tokens.routeSystem, tokens.routeInfo, tokens.routeSun]
  return palette[index % palette.length] ?? tokens.routeFlag
}

/** Warm "heat" ramp from the route tokens: quiet → amber → vermillion → deep. */
export function sequentialRamp(tokens: FigureTokens): string[] {
  return [
    mixColor(tokens.paper, tokens.routeSun, 0.22),
    mixColor(tokens.paper, tokens.routeSun, 0.62),
    tokens.routeSun,
    tokens.routeFlag,
    mixColor(tokens.routeFlag, tokens.ink, tokens.dark ? 0.18 : 0.38),
  ]
}

/** Blue ↔ vermillion around a neutral paper midpoint. */
export function divergingRamp(tokens: FigureTokens): string[] {
  const neutral = mixColor(tokens.paper, tokens.inkDim, 0.18)
  return [
    tokens.routeInfo,
    mixColor(tokens.routeInfo, neutral, 0.55),
    neutral,
    mixColor(tokens.routeFlag, neutral, 0.55),
    tokens.routeFlag,
  ]
}

export function missingColor(tokens: FigureTokens): string {
  return mixColor(tokens.paper, tokens.inkDim, 0.22)
}

export interface FieldStats {
  min: number
  max: number
  count: number
}

export function fieldStats(rows: DataViewResultRow[], field: string): FieldStats | null {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  let count = 0
  for (const row of rows) {
    const value = numeric(row[field])
    if (value === null) continue
    min = Math.min(min, value)
    max = Math.max(max, value)
    count += 1
  }
  return count > 0 ? { min, max, count } : null
}

export function numeric(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/** Domain stops for an interpolated scale: explicit breaks when they match the ramp, else even steps. */
export function rampDomain(colorBy: MapColorBy, stats: FieldStats | null, stops: number): number[] {
  if (colorBy.breaks && colorBy.breaks.length === stops) return [...colorBy.breaks]
  if (!stats) return []
  if (colorBy.scale === 'diverging' && stops >= 3 && stops % 2 === 1) {
    const center = stats.min < 0 && stats.max > 0 ? 0 : (stats.min + stats.max) / 2
    const half = (stops - 1) / 2
    const low = Array.from({ length: half }, (_, i) => stats.min + ((center - stats.min) * i) / half)
    const high = Array.from({ length: half }, (_, i) => center + ((stats.max - center) * (i + 1)) / half)
    return dedupeAscending([...low, center, ...high])
  }
  if (stats.max === stats.min) return [stats.min]
  return Array.from({ length: stops }, (_, i) => stats.min + ((stats.max - stats.min) * i) / (stops - 1))
}

function dedupeAscending(values: number[]): number[] {
  return values.filter((value, index) => index === 0 || value > (values[index - 1] as number))
}

export function rampColors(colorBy: MapColorBy, tokens: FigureTokens, fallback: string): string[] {
  if (colorBy.colors && colorBy.colors.length >= 2) {
    return colorBy.colors.map((color) => resolveMapColor(color, tokens, fallback))
  }
  return colorBy.scale === 'diverging' ? divergingRamp(tokens) : sequentialRamp(tokens)
}

/** Sample `n` colours evenly from a ramp (used when the domain collapses or differs in length). */
export function sampleRamp(colors: string[], n: number): string[] {
  if (n <= 0) return []
  if (n === 1) return [colors[colors.length - 1] ?? '#000000']
  return Array.from({ length: n }, (_, i) => {
    const position = (i / (n - 1)) * (colors.length - 1)
    const lower = Math.floor(position)
    const upper = Math.min(colors.length - 1, lower + 1)
    return mixColor(colors[lower] ?? '#000000', colors[upper] ?? '#000000', position - lower)
  })
}

/** Data-driven colour for any scale; rows without a value get the neutral missing colour. */
export function colorExpression(
  colorBy: MapColorBy,
  source: ValueSource,
  tokens: FigureTokens,
  stats: FieldStats | null,
  fallback: string,
): Expr {
  const value = valueExpr(colorBy.field, source)
  const missing = missingColor(tokens)
  if (colorBy.scale === 'categorical') {
    const entries = Object.entries(colorBy.categories ?? {})
    if (entries.length === 0) return fallback
    const match: Expr[] = ['match', ['to-string', value]]
    for (const [category, color] of entries) match.push(category, resolveMapColor(color, tokens, fallback))
    match.push(fallback)
    return match
  }
  const isNumber: Expr = ['==', ['typeof', value], 'number']
  if (colorBy.scale === 'threshold') {
    const breaks = colorBy.breaks ?? []
    const colors = (colorBy.colors ?? []).map((color) => resolveMapColor(color, tokens, fallback))
    if (breaks.length === 0 || colors.length !== breaks.length + 1) return fallback
    const step: Expr[] = ['step', value, colors[0] as string]
    breaks.forEach((limit, index) => step.push(limit, colors[index + 1] as string))
    return ['case', isNumber, step, missing]
  }
  const ramp = rampColors(colorBy, tokens, fallback)
  const domain = rampDomain(colorBy, stats, ramp.length)
  if (domain.length === 0) return missing
  if (domain.length === 1) return ['case', isNumber, ramp[ramp.length - 1] as string, missing]
  const colors = domain.length === ramp.length ? ramp : sampleRamp(ramp, domain.length)
  const interpolate: Expr[] = ['interpolate', ['linear'], value]
  domain.forEach((stop, index) => interpolate.push(stop, colors[index] as string))
  return ['case', isNumber, interpolate, missing]
}

export function radiusExpression(style: MapLayerStyle, source: ValueSource, stats: FieldStats | null): Expr {
  const base = style.radius ?? 5
  if (!style.radiusBy) return base
  const [low, high] = style.radiusBy.range
  if (!stats) return low
  if (stats.max === stats.min) return high
  const value = valueExpr(style.radiusBy.field, source)
  return [
    'case',
    ['==', ['typeof', value], 'number'],
    ['interpolate', ['linear'], value, stats.min, low, stats.max, high],
    low,
  ]
}

/** Feature-state flags that drive highlight emphasis and tile-join presence. */
export function highlightOpacity(opacity: number, dimOthers: boolean, joined: boolean): Expr {
  const lit: Expr = dimOthers
    ? ['case', ['boolean', ['feature-state', HIGHLIGHT_STATE], false], opacity, round(opacity * 0.22)]
    : opacity
  if (!joined) return lit
  return ['case', ['boolean', ['feature-state', PRESENT_STATE], false], lit, 0]
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

export interface LayerPlan {
  id: string
  type: 'fill' | 'line' | 'circle' | 'symbol'
  role: 'main' | 'outline' | 'highlight' | 'label'
  paint: Record<string, Expr>
  layout: Record<string, Expr>
  filter?: Expr
}

export interface PlanInput {
  /** MapLibre layer id prefix for this view layer; unique per view. */
  prefix: string
  layer: MapLayerView
  index: number
  source: ValueSource
  tokens: FigureTokens
  stats: Record<string, FieldStats | null>
  dimOthers: boolean
  visible: boolean
  /** Explicit label expression for joined layers (row labels are not tile properties). */
  labelExpr?: Expr
  /** Paint transitions used for scrolly cross-fades; 0 disables them. */
  fadeMs?: number
}

const POLYGON_FILTER: Expr = ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false]
const LINE_FILTER: Expr = ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false]
const POINT_FILTER: Expr = ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false]
const NOT_POINT_FILTER: Expr = ['!', POINT_FILTER]

function withFade(paint: Record<string, Expr>, keys: string[], fadeMs: number | undefined): Record<string, Expr> {
  if (fadeMs === undefined) return paint
  for (const key of keys) paint[`${key}-transition`] = { duration: fadeMs, delay: 0 }
  return paint
}

function layerColor(input: PlanInput, style: MapLayerStyle | undefined): Expr {
  const fallback = resolveMapColor(style?.color, input.tokens, defaultLayerColor(input.index, input.tokens))
  if (!style?.colorBy) return fallback
  return colorExpression(style.colorBy, input.source, input.tokens, input.stats[style.colorBy.field] ?? null, fallback)
}

/**
 * MapLibre layers for one view layer. A styled layer becomes its declared
 * geometry (+ outline/highlight/label companions); an unstyled GeoJSON layer
 * draws fills, lines and points in one route colour, as saved results did before.
 */
export function planLayer(input: PlanInput): LayerPlan[] {
  const { layer, tokens, prefix, dimOthers, fadeMs } = input
  const style = layer.style
  const joined = input.source === 'feature-state'
  const layout = { visibility: input.visible ? 'visible' : 'none' } as Record<string, Expr>
  const color = layerColor(input, style)
  const plans: LayerPlan[] = []
  const geometry = style?.geometry

  if (!style || geometry === 'fill') {
    const opacity = style?.opacity ?? (style ? 0.78 : 0.24)
    plans.push({
      id: `${prefix}:fill`,
      type: 'fill',
      role: 'main',
      paint: withFade({ 'fill-color': color, 'fill-opacity': highlightOpacity(opacity, dimOthers, joined) }, ['fill-opacity'], fadeMs),
      layout: { ...layout },
      ...(joined ? {} : { filter: POLYGON_FILTER }),
    })
    plans.push({
      id: `${prefix}:outline`,
      type: 'line',
      role: 'outline',
      paint: withFade({
        'line-color': style ? tokens.lineSoft : color,
        'line-width': style ? (style.width ?? 0.4) : 1.6,
        'line-opacity': highlightOpacity(0.9, dimOthers, joined),
      }, ['line-opacity'], fadeMs),
      layout: { ...layout },
      ...(joined ? {} : { filter: POLYGON_FILTER }),
    })
  }
  if (!style || geometry === 'line') {
    const opacity = style?.opacity ?? 0.9
    plans.push({
      id: `${prefix}:line`,
      type: 'line',
      role: 'main',
      paint: withFade({
        'line-color': color,
        'line-width': style?.width ?? 2.5,
        'line-opacity': highlightOpacity(opacity, dimOthers, joined),
      }, ['line-opacity'], fadeMs),
      layout: { ...layout, 'line-cap': 'round', 'line-join': 'round' },
      // A styled line layer outlines polygons too (cluster boundaries, walksheds);
      // an unstyled layer already outlines its polygons with the fill outline.
      ...(joined ? {} : { filter: style ? NOT_POINT_FILTER : LINE_FILTER }),
    })
  }
  if (!style || geometry === 'circle') {
    const opacity = style?.opacity ?? 0.92
    const radiusField = style?.radiusBy?.field
    plans.push({
      id: `${prefix}:circle`,
      type: 'circle',
      role: 'main',
      paint: withFade({
        'circle-color': color,
        'circle-radius': style ? radiusExpression(style, input.source, radiusField ? input.stats[radiusField] ?? null : null) : 5,
        'circle-opacity': highlightOpacity(opacity, dimOthers, joined),
        'circle-stroke-color': tokens.paper,
        'circle-stroke-width': 1.2,
        'circle-stroke-opacity': highlightOpacity(1, dimOthers, joined),
      }, ['circle-opacity', 'circle-stroke-opacity'], fadeMs),
      layout: { ...layout },
      ...(joined ? {} : { filter: POINT_FILTER }),
    })
  }

  // Emphasis ring/edge in ink for highlighted features (scrolly `highlight`).
  const highlightOn: Expr = ['case', ['boolean', ['feature-state', HIGHLIGHT_STATE], false], 1, 0]
  if (!style || geometry === 'circle') {
    plans.push({
      id: `${prefix}:highlight-point`,
      type: 'circle',
      role: 'highlight',
      paint: {
        'circle-color': 'rgba(0,0,0,0)',
        'circle-radius': style ? radiusExpression(style, input.source, style.radiusBy ? input.stats[style.radiusBy.field] ?? null : null) : 5,
        'circle-stroke-color': tokens.ink,
        'circle-stroke-width': 2.5,
        'circle-stroke-opacity': highlightOn,
      },
      layout: { ...layout },
      ...(joined ? {} : { filter: POINT_FILTER }),
    })
  }
  if (!style || geometry === 'fill' || geometry === 'line') {
    plans.push({
      id: `${prefix}:highlight-edge`,
      type: 'line',
      role: 'highlight',
      paint: { 'line-color': tokens.ink, 'line-width': 2.5, 'line-opacity': highlightOn },
      layout: { ...layout, 'line-join': 'round' },
      ...(joined ? {} : { filter: geometry === 'fill' ? POLYGON_FILTER : NOT_POINT_FILTER }),
    })
  }

  const labelField = style?.labelField
  const textField = input.labelExpr ?? (labelField && !joined ? ['to-string', ['get', labelField]] : undefined)
  if (textField !== undefined) {
    plans.push({
      id: `${prefix}:label`,
      type: 'symbol',
      role: 'label',
      paint: withFade({
        'text-color': tokens.ink,
        'text-halo-color': tokens.paper,
        'text-halo-width': 1.4,
        'text-opacity': dimOthers ? ['case', ['boolean', ['feature-state', HIGHLIGHT_STATE], false], 1, 0.35] : 1,
      }, ['text-opacity'], fadeMs),
      layout: {
        ...layout,
        'text-field': textField,
        'text-font': ['Noto Sans Regular'],
        'text-size': 11,
        'text-offset': geometry === 'circle' ? [0, 1.1] : [0, 0],
        'text-anchor': geometry === 'circle' ? 'top' : 'center',
        'text-optional': true,
        'text-max-width': 9,
      },
    })
  }
  return plans
}

/** Opacity paint properties per layer type, for fade-in/out of whole view layers. */
export const OPACITY_PROPERTIES: Record<LayerPlan['type'], string[]> = {
  fill: ['fill-opacity'],
  line: ['line-opacity'],
  circle: ['circle-opacity', 'circle-stroke-opacity'],
  symbol: ['text-opacity'],
}

function rowTag(row: DataViewResultRow): string | undefined {
  if (typeof row.layer === 'string') return row.layer
  return typeof row.entity === 'string' ? row.entity : undefined
}

/**
 * Rows that belong to a view layer. Spatial-op results tag rows with the
 * `entity` (or `layer`) that matches a view layer id, and those are split per
 * layer. Untagged rows (e.g. a table `select`, whose single layer is named by
 * dataset id) feed every layer; each layer draws what its geometry allows.
 */
export function rowsForLayer(rows: DataViewResultRow[], layerId: string, layerIds: readonly string[] = [layerId]): DataViewResultRow[] {
  const ids = new Set(layerIds)
  const tagged = rows.some((row) => {
    const tag = rowTag(row)
    return tag !== undefined && ids.has(tag)
  })
  if (!tagged) return rows
  return rows.filter((row) => rowTag(row) === layerId)
}

/** A layer `filter` is scalar equality on row properties; null matches a missing value. */
export function matchesLayerFilter(row: DataViewResultRow, filter: MapLayerView['filter']): boolean {
  if (!filter) return true
  const properties = typeof row.properties === 'object' && row.properties !== null ? row.properties as Record<string, unknown> : {}
  return Object.entries(filter).every(([key, expected]) => {
    const actual = row[key] !== undefined ? row[key] : properties[key]
    if (expected === null) return actual === null || actual === undefined
    if (typeof expected === 'number') return numeric(actual) === expected
    if (typeof expected === 'boolean') return actual === expected || String(actual) === String(expected)
    return actual !== null && actual !== undefined && String(actual) === expected
  })
}

/** The rows one layer draws: its share of tagged rows, narrowed by its filter. */
export function layerRows(rows: DataViewResultRow[], layer: MapLayerView, layerIds: readonly string[]): DataViewResultRow[] {
  return rowsForLayer(rows, layer.id, layerIds).filter((row) => matchesLayerFilter(row, layer.filter))
}

/**
 * Detailed geometry (`result.geometry`) for a layer, as Feature rows. Features
 * tagged with a layer id go to that layer; untagged ones belong to the first
 * layer so they are drawn once. Point rows whose id has a polygon are dropped
 * by the caller so a walkshed is not also drawn as its centroid.
 */
export function geometryRowsForLayer(result: Record<string, unknown>, layer: MapLayerView, layerIndex: number, layerIds: readonly string[]): DataViewResultRow[] {
  const geometry = result.geometry
  if (typeof geometry !== 'object' || geometry === null || !Array.isArray((geometry as { features?: unknown }).features)) return []
  const out: DataViewResultRow[] = []
  for (const feature of (geometry as { features: unknown[] }).features) {
    if (typeof feature !== 'object' || feature === null) continue
    const value = feature as Record<string, unknown>
    if (typeof value.geometry !== 'object' || value.geometry === null) continue
    const properties = typeof value.properties === 'object' && value.properties !== null ? value.properties as Record<string, unknown> : {}
    const row: DataViewResultRow = { ...properties, type: 'Feature', geometry: value.geometry, properties }
    const id = value.id ?? properties.id
    if (typeof id === 'string' || typeof id === 'number') row.id = id
    const tag = rowTag(row)
    const owned = tag !== undefined && layerIds.includes(tag) ? tag === layer.id : layerIndex === 0
    if (owned && matchesLayerFilter(row, layer.filter)) out.push(row)
  }
  return out
}

/** Stable id for a row: its `id` when present, otherwise its index. */
export function rowId(row: DataViewResultRow, index: number): string {
  const id = row.id
  return typeof id === 'string' || typeof id === 'number' ? String(id) : `#${index}`
}

export interface GeoFeature {
  type: 'Feature'
  geometry: { type: string; coordinates?: unknown; geometries?: unknown }
  properties: Record<string, unknown>
}

function isGeometry(value: unknown): value is GeoFeature['geometry'] {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string'
}

function scalarProperties(source: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(source)) {
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) out[key] = value
  }
  return out
}

/** GeoJSON features for one layer: rows that are features, rows with lat/lng, and tagged result geometry. */
export function featuresFromRows(rows: DataViewResultRow[]): GeoFeature[] {
  const features: GeoFeature[] = []
  rows.forEach((row, index) => {
    const fid = rowId(row, index)
    if (row.type === 'Feature' && isGeometry(row.geometry)) {
      const properties = typeof row.properties === 'object' && row.properties !== null
        ? row.properties as Record<string, unknown>
        : {}
      features.push({
        type: 'Feature',
        geometry: row.geometry,
        properties: { ...scalarProperties(properties), ...scalarProperties(row), [FEATURE_ID_PROPERTY]: fid },
      })
      return
    }
    const lat = numeric(row.lat ?? row.latitude)
    const lng = numeric(row.lng ?? row.lon ?? row.longitude)
    if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lng, lat] },
      properties: { ...scalarProperties(row), [FEATURE_ID_PROPERTY]: fid },
    })
  })
  return features
}

/** Fields whose values a joined layer needs in feature-state. */
export function joinStateFields(style: MapLayerStyle | undefined): string[] {
  const fields = new Set<string>()
  if (style?.colorBy) fields.add(style.colorBy.field)
  if (style?.radiusBy) fields.add(style.radiusBy.field)
  return [...fields]
}

/** Feature-state payloads keyed by tile feature id for a tile-joined layer. */
export function joinStates(rows: DataViewResultRow[], rowKey: string, style: MapLayerStyle | undefined): Map<string, Record<string, string | number | boolean>> {
  const fields = joinStateFields(style)
  const states = new Map<string, Record<string, string | number | boolean>>()
  for (const row of rows) {
    const key = row[rowKey]
    if (typeof key !== 'string' && typeof key !== 'number') continue
    const state: Record<string, string | number | boolean> = { [PRESENT_STATE]: true }
    for (const field of fields) {
      const value = row[field]
      if (typeof value === 'number' && Number.isFinite(value)) state[field] = value
      else if (typeof value === 'string' || typeof value === 'boolean') {
        const asNumber = style?.colorBy?.scale !== 'categorical' ? numeric(value) : null
        state[field] = asNumber ?? value
      }
    }
    states.set(String(key), state)
  }
  return states
}

/** Label expression for a joined layer: tile id → row label (bounded to keep the style small). */
export function joinLabelExpr(rows: DataViewResultRow[], rowKey: string, labelField: string | undefined, limit = 600): Expr | undefined {
  if (!labelField) return undefined
  const match: Expr[] = ['match', ['to-string', ['get', TILE_ID_PROPERTY]]]
  const seen = new Set<string>()
  for (const row of rows) {
    if (seen.size >= limit) break
    const key = row[rowKey]
    const label = row[labelField]
    if ((typeof key !== 'string' && typeof key !== 'number') || label === null || label === undefined || label === '') continue
    const id = String(key)
    if (seen.has(id)) continue
    seen.add(id)
    match.push(id, String(label))
  }
  if (seen.size === 0) return undefined
  match.push('')
  return match
}

export function humanize(field: string): string {
  const spaced = field.replaceAll(/[_-]+/g, ' ').trim()
  return spaced ? `${spaced[0]?.toUpperCase() ?? ''}${spaced.slice(1)}` : field
}

export function formatNumber(value: number, unit?: string): string {
  const abs = Math.abs(value)
  const text = abs >= 100_000
    ? new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
    : new Intl.NumberFormat('en', { maximumFractionDigits: abs < 10 ? 2 : abs < 100 ? 1 : 0 }).format(value)
  if (!unit) return text
  return unit === '%' ? `${text}%` : `${text} ${unit}`
}

export type LegendEntry =
  | { kind: 'swatch'; layerId: string; title: string; geometry: MapLayerStyle['geometry']; color: string }
  | { kind: 'classes'; layerId: string; title: string; geometry: MapLayerStyle['geometry']; items: Array<{ color: string; label: string }> }
  | { kind: 'ramp'; layerId: string; title: string; geometry: MapLayerStyle['geometry']; colors: string[]; minLabel: string; maxLabel: string; midLabel?: string }
  | { kind: 'size'; layerId: string; title: string; color: string; minRadius: number; maxRadius: number; minLabel: string; maxLabel: string }

function legendTitle(layer: MapLayerView, colorBy?: MapColorBy): string {
  if (colorBy?.label) return colorBy.unit && colorBy.unit !== '%' ? `${colorBy.label} (${colorBy.unit})` : colorBy.label
  return layer.label ?? humanize(layer.id)
}

/** Legend entries for every visible, styled layer that does not opt out. */
export function buildLegend(
  view: MapViewSpec,
  tokens: FigureTokens,
  statsByLayer: Record<string, Record<string, FieldStats | null>>,
  visible: (layer: MapLayerView) => boolean,
): LegendEntry[] {
  const entries: LegendEntry[] = []
  view.layers.forEach((layer, index) => {
    const style = layer.style
    if (!style || layer.legend === false || !visible(layer)) return
    const fallback = resolveMapColor(style.color, tokens, defaultLayerColor(index, tokens))
    const stats = statsByLayer[layer.id] ?? {}
    const colorBy = style.colorBy
    const geometry = style.geometry
    if (!colorBy) {
      entries.push({ kind: 'swatch', layerId: layer.id, title: layer.label ?? humanize(layer.id), geometry, color: fallback })
    } else if (colorBy.scale === 'threshold' && colorBy.breaks && colorBy.colors?.length === colorBy.breaks.length + 1) {
      const breaks = colorBy.breaks
      const colors = colorBy.colors.map((color) => resolveMapColor(color, tokens, fallback))
      const fmt = (n: number) => formatNumber(n, colorBy.unit === '%' ? '%' : undefined)
      const items = colors.map((color, i) => ({
        color,
        label: colorBy.classLabels?.[i] ?? (i === 0
          ? `< ${fmt(breaks[0] as number)}`
          : i === breaks.length
            ? `≥ ${fmt(breaks[i - 1] as number)}`
            : `${fmt(breaks[i - 1] as number)}–${fmt(breaks[i] as number)}`),
      }))
      entries.push({ kind: 'classes', layerId: layer.id, title: legendTitle(layer, colorBy), geometry, items })
    } else if (colorBy.scale === 'categorical') {
      const items = Object.entries(colorBy.categories ?? {}).map(([value, color]) => ({
        label: colorBy.labels?.[value] ?? value,
        color: resolveMapColor(color, tokens, fallback),
      }))
      entries.push({ kind: 'classes', layerId: layer.id, title: legendTitle(layer, colorBy), geometry, items })
    } else {
      const fieldStatsValue = stats[colorBy.field] ?? null
      const ramp = rampColors(colorBy, tokens, fallback)
      const domain = rampDomain(colorBy, fieldStatsValue, ramp.length)
      if (domain.length > 0) {
        const unit = colorBy.unit === '%' ? '%' : undefined
        const low = domain[0] as number
        const high = domain[domain.length - 1] as number
        const center = colorBy.scale === 'diverging' && domain.length >= 3 ? domain[Math.floor(domain.length / 2)] : undefined
        entries.push({
          kind: 'ramp',
          layerId: layer.id,
          title: legendTitle(layer, colorBy),
          geometry,
          colors: domain.length === ramp.length ? ramp : sampleRamp(ramp, Math.max(2, domain.length)),
          minLabel: formatNumber(low, unit),
          maxLabel: formatNumber(high, unit),
          ...(center === undefined ? {} : { midLabel: formatNumber(center, unit) }),
        })
      }
    }
    if (style.radiusBy) {
      const sizeStats = stats[style.radiusBy.field] ?? null
      if (sizeStats) {
        entries.push({
          kind: 'size',
          layerId: layer.id,
          title: style.radiusBy.label ?? humanize(style.radiusBy.field),
          color: fallback,
          minRadius: style.radiusBy.range[0],
          maxRadius: style.radiusBy.range[1],
          minLabel: formatNumber(sizeStats.min),
          maxLabel: formatNumber(sizeStats.max),
        })
      }
    }
  })
  return entries
}

const HIDDEN_FIELDS = new Set([
  'id', 'lat', 'lng', 'lon', 'latitude', 'longitude', 'type', 'geometry', 'properties',
  'entity', 'layer', 'source', 'vintage', FEATURE_ID_PROPERTY,
])
const TITLE_FIELDS = ['name', 'title', 'label']

export interface TooltipModel {
  title: string
  rows: Array<{ label: string; value: string }>
}

function displayValue(value: unknown, unit?: string): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return formatNumber(value, unit)
  if (typeof value === 'string' && value.trim()) return unit ? `${value} ${unit}` : value
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return null
}

/** Hover/tap card for one row: the styled (labelled) fields first, then a few other scalars. */
export function tooltipFor(row: DataViewResultRow, layer: MapLayerView | undefined, max = 6): TooltipModel {
  const style = layer?.style
  const titleField = style?.labelField && row[style.labelField] !== undefined ? style.labelField : TITLE_FIELDS.find((field) => typeof row[field] === 'string')
  const title = (titleField && displayValue(row[titleField])) || (typeof row.id === 'string' || typeof row.id === 'number' ? String(row.id) : 'Feature')
  const rows: TooltipModel['rows'] = []
  const used = new Set<string>(titleField ? [titleField] : [])
  const push = (field: string, label: string, unit?: string) => {
    if (used.has(field) || rows.length >= max) return
    const value = displayValue(row[field], unit)
    used.add(field)
    if (value !== null) rows.push({ label, value })
  }
  if (style?.colorBy) push(style.colorBy.field, style.colorBy.label ?? humanize(style.colorBy.field), style.colorBy.unit)
  if (style?.radiusBy) push(style.radiusBy.field, humanize(style.radiusBy.field))
  for (const [field, value] of Object.entries(row)) {
    if (rows.length >= max) break
    if (HIDDEN_FIELDS.has(field) || field.startsWith('_') || TITLE_FIELDS.includes(field)) continue
    if (value === null || typeof value === 'object') continue
    push(field, humanize(field))
  }
  return { title, rows }
}
