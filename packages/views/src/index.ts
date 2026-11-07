import type { CountryCode, EvidenceRef } from '@developing-country/domain'

export const DATA_VIEW_VERSION = 1 as const
export const DEFAULT_DATA_VIEW_ORIGIN = 'https://explore.developing-country.org' as const

const DATA_VIEW_ID_PATTERN = /^view_[a-z0-9]+$/
const DATA_VIEW_PATH_PATTERN = /^\/views\/view_[a-z0-9]+$/
const MAX_VIEW_LAYERS = 64

/** Build the one canonical public URL shared by the Worker, MCP Apps, and CMS. */
export function dataViewUrl(origin: string, id: string): string {
  if (!DATA_VIEW_ID_PATTERN.test(id)) throw new Error('invalid Data View id')
  const base = new URL(origin)
  if (base.username || base.password || base.pathname !== '/' || base.search || base.hash) {
    throw new Error('Data View origin must be an origin without a path, query, or credentials')
  }
  return `${base.origin}/views/${id}`
}

/** Fail closed when a CMS value is not a canonical view on the configured platform origin. */
export function isDataViewUrl(value: string, origin: string = DEFAULT_DATA_VIEW_ORIGIN): boolean {
  try {
    const candidate = new URL(value)
    const expected = new URL(origin)
    return candidate.origin === expected.origin
      && DATA_VIEW_PATH_PATTERN.test(candidate.pathname)
      && candidate.search === ''
      && candidate.hash === ''
  } catch {
    return false
  }
}

export type DataViewId = string
export type DataViewKind = 'map' | 'chart'

export interface DataReference {
  queryId: string
  resultChecksum: string
  rowCount: number
}

export interface DataViewBase {
  version: typeof DATA_VIEW_VERSION
  id: DataViewId
  kind: DataViewKind
  country: CountryCode
  title: string
  description?: string
  data: DataReference
  evidence: EvidenceRef
  theme: 'developing-country/v1'
  createdAt: string
}

export interface MapCamera {
  center: [longitude: number, latitude: number]
  zoom: number
  bearing?: number
  pitch?: number
}

/** Named colours resolve to packages/ui/tokens.css at render time, so views follow the theme. */
export type MapColorToken = 'route-system' | 'route-sun' | 'route-flag' | 'route-info' | 'ink' | 'ink-dim'
export type MapColor = MapColorToken | `#${string}`
export const MAP_COLOR_TOKENS: readonly MapColorToken[] = [
  'route-system', 'route-sun', 'route-flag', 'route-info', 'ink', 'ink-dim',
]

/**
 * Data-driven colour. `threshold` uses `breaks` (ascending, n) with `colors` (n + 1);
 * `sequential` and `diverging` interpolate the renderer's ramp over the row values;
 * `categorical` maps exact string values to `categories`, falling back to `color`.
 */
export interface MapColorBy {
  field: string
  scale: 'sequential' | 'diverging' | 'threshold' | 'categorical'
  breaks?: number[]
  colors?: MapColor[]
  categories?: Record<string, MapColor>
  /** Legend text per categorical value, e.g. { "true": "Within 10 minutes" }. */
  labels?: Record<string, string>
  /** Legend text per threshold class (breaks.length + 1), e.g. ["Under 1%", "1–25%", …]. */
  classLabels?: string[]
  label?: string
  unit?: string
}

export interface MapLayerStyle {
  geometry: 'fill' | 'line' | 'circle'
  color?: MapColor
  colorBy?: MapColorBy
  /** Circle radius in px, or a linear field-driven range. */
  radius?: number
  radiusBy?: { field: string; range: [min: number, max: number]; label?: string }
  width?: number
  opacity?: number
  labelField?: string
}

/**
 * Style a published vector tileset by joining result rows to its features, for
 * results that carry ids but no geometry (e.g. GND coverage rows → demographics.pmtiles).
 */
export interface MapTileJoin {
  tileset: 'demographics'
  sourceLayer: 'province' | 'district' | 'dsd' | 'gnd'
  /** Row field whose value equals the tile feature id. */
  rowKey: string
}

export interface MapLayerView {
  id: string
  visible: boolean
  filter?: Record<string, string | number | boolean | null>
  label?: string
  style?: MapLayerStyle
  join?: MapTileJoin
  /** Default true when `style` is set. */
  legend?: boolean
}

export interface MapAnnotation {
  id: string
  coordinates: [longitude: number, latitude: number]
  text: string
  anchor?: 'top' | 'bottom' | 'left' | 'right'
}

export interface MapViewSpec extends DataViewBase {
  kind: 'map'
  camera: MapCamera
  layers: MapLayerView[]
  selectedFeatureId?: string
  annotations?: MapAnnotation[]
}

/** Map presentation layers carry intent only; the Worker fills `visible` and the data link. */
export type MapLayerPresentation = Omit<MapLayerView, 'visible'> & { visible?: boolean }

export type DataViewResultRow = Record<string, unknown>

/** One rows accessor for every renderer (explorer /views, site figures, bound stats). */
export function rowsFromViewResult(result: unknown): DataViewResultRow[] {
  if (!isRecord(result)) return []
  if (Array.isArray(result.features) && result.features.length > 0) {
    return result.features.filter(isRecord)
  }
  if (Array.isArray(result.rows)) return result.rows.filter(isRecord)
  if (isRecord(result.aggregates)) {
    const summary = typeof result.summary === 'string' && result.summary ? result.summary : 'Result'
    return [{ label: summary, ...result.aggregates }]
  }
  return []
}

export type ChartFamily =
  | 'trend'
  | 'comparison'
  | 'ranking'
  | 'distribution'
  | 'relationship'
  | 'composition'

export interface ChartEncoding {
  field: string
  label?: string
  unit?: string
}

export interface ChartViewSpec extends DataViewBase {
  kind: 'chart'
  intent: {
    family: ChartFamily
    dimension: ChartEncoding
    measure: ChartEncoding
    series?: ChartEncoding
  }
  presentation?: {
    orientation?: 'horizontal' | 'vertical'
    stacked?: boolean
    showLegend?: boolean
    /** Dimension values drawn in the accent colour; everything else recedes. */
    highlight?: string[]
  }
}

export type DataViewSpec = MapViewSpec | ChartViewSpec

export type DataViewVisibility = 'link' | 'public'

export type DataViewPresentation =
  | {
      kind: 'map'
      title: string
      description?: string
      visibility?: DataViewVisibility
      camera?: MapCamera
      layers?: MapLayerPresentation[]
      annotations?: MapAnnotation[]
    }
  | {
      kind: 'chart'
      title: string
      description?: string
      visibility?: DataViewVisibility
      family: ChartFamily
      dimension: ChartEncoding
      measure: ChartEncoding
      series?: ChartEncoding
      orientation?: 'horizontal' | 'vertical'
      stacked?: boolean
      show_legend?: boolean
      highlight?: string[]
    }

export type DataViewPresentationValidation =
  | { ok: true; value: DataViewPresentation }
  | { ok: false; issues: string[] }

export function validateDataViewPresentation(input: unknown): DataViewPresentationValidation {
  const issues: string[] = []
  if (!isRecord(input)) return { ok: false, issues: ['presentation must be an object'] }
  if (input.kind !== 'map' && input.kind !== 'chart') issues.push('presentation.kind must be map or chart')
  requireString(input, 'title', issues, 'presentation')
  optionalString(input, 'description', issues, 'presentation')
  if (typeof input.title === 'string' && input.title.length > 160) {
    issues.push('presentation.title must be at most 160 characters')
  }
  if (typeof input.description === 'string' && input.description.length > 500) {
    issues.push('presentation.description must be at most 500 characters')
  }
  if (input.visibility !== undefined && input.visibility !== 'link' && input.visibility !== 'public') {
    issues.push('presentation.visibility must be link or public')
  }
  if (input.kind === 'map') {
    rejectUnknownKeys(input, ['kind', 'title', 'description', 'visibility', 'camera', 'layers', 'annotations'], 'presentation', issues)
    if (input.camera !== undefined) validateMapCamera(input.camera, 'presentation.camera', issues)
    if (input.layers !== undefined) {
      if (!Array.isArray(input.layers)) issues.push('presentation.layers must be an array')
      else {
        if (input.layers.length > MAX_VIEW_LAYERS) issues.push(`presentation.layers must contain at most ${MAX_VIEW_LAYERS} entries`)
        input.layers.forEach((layer, index) => validateMapLayer(layer, `presentation.layers[${index}]`, issues, false))
      }
    }
    if (input.annotations !== undefined) validateAnnotations(input.annotations, 'presentation.annotations', issues)
  }
  if (input.kind === 'chart') {
    rejectUnknownKeys(
      input,
      [
        'kind', 'title', 'description', 'visibility', 'family', 'dimension', 'measure', 'series',
        'orientation', 'stacked', 'show_legend', 'highlight',
      ],
      'presentation',
      issues,
    )
    validateHighlight(input.highlight, 'presentation.highlight', issues)
    const families: ChartFamily[] = ['trend', 'comparison', 'ranking', 'distribution', 'relationship', 'composition']
    if (!families.includes(input.family as ChartFamily)) issues.push('presentation.family is not supported')
    validateEncoding(input.dimension, 'presentation.dimension', issues)
    validateEncoding(input.measure, 'presentation.measure', issues)
    if (input.series !== undefined) validateEncoding(input.series, 'presentation.series', issues)
    if (input.orientation !== undefined && input.orientation !== 'horizontal' && input.orientation !== 'vertical') {
      issues.push('presentation.orientation must be horizontal or vertical')
    }
    for (const key of ['stacked', 'show_legend'] as const) {
      if (input[key] !== undefined && typeof input[key] !== 'boolean') {
        issues.push(`presentation.${key} must be a boolean`)
      }
    }
  }
  if (issues.length > 0) return { ok: false, issues }
  return { ok: true, value: input as unknown as DataViewPresentation }
}

export type DataViewValidation =
  | { ok: true; value: DataViewSpec }
  | { ok: false; issues: string[] }

export function validateDataViewSpec(input: unknown): DataViewValidation {
  const issues: string[] = []
  if (!isRecord(input)) return { ok: false, issues: ['view must be an object'] }
  if (input.version !== DATA_VIEW_VERSION) issues.push(`version must be ${DATA_VIEW_VERSION}`)
  if (input.kind !== 'map' && input.kind !== 'chart') issues.push('kind must be map or chart')
  requireString(input, 'id', issues)
  validateCountry(input.country, 'country', issues)
  requireString(input, 'title', issues)
  if (input.theme !== 'developing-country/v1') issues.push('theme must be developing-country/v1')
  validateTimestamp(input.createdAt, 'createdAt', issues)
  optionalString(input, 'description', issues)
  if (typeof input.title === 'string' && input.title.length > 160) {
    issues.push('title must be at most 160 characters')
  }
  if (typeof input.description === 'string' && input.description.length > 500) {
    issues.push('description must be at most 500 characters')
  }
  validateDataReference(input.data, issues)
  validateEvidence(input.evidence, issues)

  if (input.kind === 'map') {
    rejectUnknownKeys(
      input,
      [
        'version', 'id', 'kind', 'country', 'title', 'description', 'data', 'evidence', 'theme',
        'createdAt', 'camera', 'layers', 'selectedFeatureId', 'annotations',
      ],
      'view',
      issues,
    )
    validateMap(input, issues)
  }
  if (input.kind === 'chart') {
    rejectUnknownKeys(
      input,
      [
        'version', 'id', 'kind', 'country', 'title', 'description', 'data', 'evidence', 'theme',
        'createdAt', 'intent', 'presentation',
      ],
      'view',
      issues,
    )
    validateChart(input, issues)
  }
  if (issues.length > 0) return { ok: false, issues }

  // SAFETY: The strict validators reject unknown keys and validate every required and optional field.
  return { ok: true, value: input as unknown as DataViewSpec }
}

function validateDataReference(value: unknown, issues: string[]): void {
  if (!isRecord(value)) {
    issues.push('data must be an object')
    return
  }
  rejectUnknownKeys(value, ['queryId', 'resultChecksum', 'rowCount'], 'data', issues)
  requireString(value, 'queryId', issues, 'data')
  validateChecksum(value.resultChecksum, 'data.resultChecksum', issues)
  if (!Number.isInteger(value.rowCount) || Number(value.rowCount) < 0) {
    issues.push('data.rowCount must be a non-negative integer')
  }
}

function validateEvidence(value: unknown, issues: string[]): void {
  if (!isRecord(value)) {
    issues.push('evidence must be an object')
    return
  }
  rejectUnknownKeys(value, ['datasetVersions', 'sourceIds', 'queryId', 'generatedAt'], 'evidence', issues)
  validateTimestamp(value.generatedAt, 'evidence.generatedAt', issues)
  optionalString(value, 'queryId', issues, 'evidence')
  if (!Array.isArray(value.sourceIds) || value.sourceIds.length === 0 || !value.sourceIds.every(isNonEmptyString)) {
    issues.push('evidence.sourceIds must be a non-empty string array')
  }
  if (!Array.isArray(value.datasetVersions) || value.datasetVersions.length === 0) {
    issues.push('evidence.datasetVersions must be a non-empty array')
  } else {
    value.datasetVersions.forEach((version, index) => validateDatasetVersion(version, index, issues))
  }
}

function validateDatasetVersion(value: unknown, index: number, issues: string[]): void {
  const path = `evidence.datasetVersions[${index}]`
  if (!isRecord(value)) {
    issues.push(`${path} must be an object`)
    return
  }
  rejectUnknownKeys(
    value,
    ['datasetId', 'versionId', 'country', 'sourceIds', 'vintage', 'refreshedAt', 'checksum', 'completeness'],
    path,
    issues,
  )
  for (const key of ['datasetId', 'versionId', 'vintage'] as const) requireString(value, key, issues, path)
  validateCountry(value.country, `${path}.country`, issues)
  validateTimestamp(value.refreshedAt, `${path}.refreshedAt`, issues)
  validateChecksum(value.checksum, `${path}.checksum`, issues)
  if (!Array.isArray(value.sourceIds) || value.sourceIds.length === 0 || !value.sourceIds.every(isNonEmptyString)) {
    issues.push(`${path}.sourceIds must be a non-empty string array`)
  }
  validateCompleteness(value.completeness, `${path}.completeness`, issues)
}

function validateCompleteness(value: unknown, path: string, issues: string[]): void {
  if (!isRecord(value)) {
    issues.push(`${path} must be an object`)
    return
  }
  rejectUnknownKeys(value, ['status', 'coverage', 'coverageNote', 'knownGaps', 'comparator'], path, issues)
  const statuses = ['complete', 'partial', 'osm_only', 'derived', 'known_absent', 'unverified']
  if (!statuses.includes(String(value.status))) issues.push(`${path}.status is not supported`)
  if (value.coverage !== null && (typeof value.coverage !== 'number' || value.coverage < 0 || value.coverage > 1)) {
    issues.push(`${path}.coverage must be null or a number from 0 to 1`)
  }
  requireString(value, 'coverageNote', issues, path)
  if (!Array.isArray(value.knownGaps) || !value.knownGaps.every(isNonEmptyString)) {
    issues.push(`${path}.knownGaps must be a string array`)
  }
  optionalString(value, 'comparator', issues, path)
}

function validateMap(value: Record<string, unknown>, issues: string[]): void {
  validateMapCamera(value.camera, 'camera', issues)
  if (!Array.isArray(value.layers)) {
    issues.push('layers must be an array')
  } else {
    if (value.layers.length > MAX_VIEW_LAYERS) issues.push(`layers must contain at most ${MAX_VIEW_LAYERS} entries`)
    value.layers.forEach((layer, index) => validateMapLayer(layer, `layers[${index}]`, issues, true))
  }
  optionalString(value, 'selectedFeatureId', issues)
  if (value.annotations !== undefined) validateAnnotations(value.annotations, 'annotations', issues)
}

const MAX_ANNOTATIONS = 32
const MAX_HIGHLIGHTS = 64
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

function validateAnnotations(value: unknown, path: string, issues: string[]): void {
  if (!Array.isArray(value)) {
    issues.push(`${path} must be an array`)
    return
  }
  if (value.length > MAX_ANNOTATIONS) issues.push(`${path} must contain at most ${MAX_ANNOTATIONS} entries`)
  value.forEach((annotation, index) => {
    const at = `${path}[${index}]`
    if (!isRecord(annotation)) {
      issues.push(`${at} must be an object`)
      return
    }
    rejectUnknownKeys(annotation, ['id', 'coordinates', 'text', 'anchor'], at, issues)
    requireString(annotation, 'id', issues, at)
    requireString(annotation, 'text', issues, at)
    if (typeof annotation.text === 'string' && annotation.text.length > 140) issues.push(`${at}.text must be at most 140 characters`)
    const c = annotation.coordinates
    if (!Array.isArray(c) || c.length !== 2 || !c.every((n) => typeof n === 'number' && Number.isFinite(n))
      || Math.abs(c[0] as number) > 180 || Math.abs(c[1] as number) > 90) {
      issues.push(`${at}.coordinates must contain valid longitude and latitude`)
    }
    if (annotation.anchor !== undefined && !['top', 'bottom', 'left', 'right'].includes(String(annotation.anchor))) {
      issues.push(`${at}.anchor must be top, bottom, left or right`)
    }
  })
}

function validateHighlight(value: unknown, path: string, issues: string[]): void {
  if (value === undefined) return
  if (!Array.isArray(value) || value.length > MAX_HIGHLIGHTS || !value.every(isNonEmptyString)) {
    issues.push(`${path} must be an array of at most ${MAX_HIGHLIGHTS} non-empty strings`)
  }
}

function isMapColor(value: unknown): boolean {
  return typeof value === 'string' && ((MAP_COLOR_TOKENS as readonly string[]).includes(value) || HEX_COLOR.test(value))
}

function validateLayerStyle(value: unknown, path: string, issues: string[]): void {
  if (!isRecord(value)) {
    issues.push(`${path} must be an object`)
    return
  }
  rejectUnknownKeys(value, ['geometry', 'color', 'colorBy', 'radius', 'radiusBy', 'width', 'opacity', 'labelField'], path, issues)
  if (!['fill', 'line', 'circle'].includes(String(value.geometry))) issues.push(`${path}.geometry must be fill, line or circle`)
  if (value.color !== undefined && !isMapColor(value.color)) issues.push(`${path}.color must be a colour token or #rrggbb`)
  optionalBoundedNumber(value, 'radius', 0, 64, path, issues)
  optionalBoundedNumber(value, 'width', 0, 32, path, issues)
  optionalBoundedNumber(value, 'opacity', 0, 1, path, issues)
  optionalString(value, 'labelField', issues, path)
  if (value.radiusBy !== undefined) {
    const r = value.radiusBy
    if (!isRecord(r) || !isNonEmptyString(r.field) || !Array.isArray(r.range) || r.range.length !== 2
      || !r.range.every((n) => typeof n === 'number' && n >= 0 && n <= 64)
      || (r.label !== undefined && !isNonEmptyString(r.label))
      || Object.keys(r).some((key) => !['field', 'range', 'label'].includes(key))) {
      issues.push(`${path}.radiusBy must be { field, range: [min, max], label? } with radii from 0 to 64`)
    }
  }
  if (value.colorBy !== undefined) validateColorBy(value.colorBy, `${path}.colorBy`, issues)
}

function validateColorBy(value: unknown, path: string, issues: string[]): void {
  if (!isRecord(value)) {
    issues.push(`${path} must be an object`)
    return
  }
  rejectUnknownKeys(value, ['field', 'scale', 'breaks', 'colors', 'categories', 'labels', 'classLabels', 'label', 'unit'], path, issues)
  requireString(value, 'field', issues, path)
  optionalString(value, 'label', issues, path)
  optionalString(value, 'unit', issues, path)
  const scale = String(value.scale)
  if (!['sequential', 'diverging', 'threshold', 'categorical'].includes(scale)) {
    issues.push(`${path}.scale must be sequential, diverging, threshold or categorical`)
  }
  const breaks = value.breaks
  if (breaks !== undefined && (!Array.isArray(breaks) || breaks.length > 12
    || !breaks.every((n, i) => typeof n === 'number' && Number.isFinite(n) && (i === 0 || n > (breaks[i - 1] as number))))) {
    issues.push(`${path}.breaks must be at most 12 ascending numbers`)
  }
  const colors = value.colors
  if (colors !== undefined && (!Array.isArray(colors) || colors.length > 13 || !colors.every(isMapColor))) {
    issues.push(`${path}.colors must be at most 13 colour tokens or #rrggbb values`)
  }
  if (scale === 'threshold' && (!Array.isArray(breaks) || !Array.isArray(colors) || colors.length !== breaks.length + 1)) {
    issues.push(`${path} threshold scales need breaks and exactly one more colour than breaks`)
  }
  if (value.labels !== undefined) {
    const entries = isRecord(value.labels) ? Object.entries(value.labels) : null
    if (!entries || entries.length > 24 || !entries.every(([, text]) => isNonEmptyString(text) && text.length <= 60)) {
      issues.push(`${path}.labels must map at most 24 values to labels of at most 60 characters`)
    }
  }
  if (value.classLabels !== undefined) {
    const labels = value.classLabels
    if (!Array.isArray(labels) || !labels.every((text) => isNonEmptyString(text) && text.length <= 40)
      || !Array.isArray(colors) || labels.length !== colors.length) {
      issues.push(`${path}.classLabels must give one label of at most 40 characters per colour`)
    }
  }
  if (value.categories !== undefined) {
    const entries = isRecord(value.categories) ? Object.entries(value.categories) : null
    if (!entries || entries.length > 24 || !entries.every(([, color]) => isMapColor(color))) {
      issues.push(`${path}.categories must map at most 24 values to colours`)
    }
  }
}

function validateTileJoin(value: unknown, path: string, issues: string[]): void {
  if (!isRecord(value)) {
    issues.push(`${path} must be an object`)
    return
  }
  rejectUnknownKeys(value, ['tileset', 'sourceLayer', 'rowKey'], path, issues)
  if (value.tileset !== 'demographics') issues.push(`${path}.tileset must be demographics`)
  if (!['province', 'district', 'dsd', 'gnd'].includes(String(value.sourceLayer))) {
    issues.push(`${path}.sourceLayer must be province, district, dsd or gnd`)
  }
  requireString(value, 'rowKey', issues, path)
}

function validateMapCamera(value: unknown, path: string, issues: string[]): void {
  if (!isRecord(value)) {
    issues.push(`${path} must be an object`)
    return
  }
  const center = value.center
  rejectUnknownKeys(value, ['center', 'zoom', 'bearing', 'pitch'], path, issues)
  if (
    !Array.isArray(center) ||
    center.length !== 2 ||
    typeof center[0] !== 'number' ||
    typeof center[1] !== 'number' ||
    !Number.isFinite(center[0]) ||
    !Number.isFinite(center[1]) ||
    center[0] < -180 ||
    center[0] > 180 ||
    center[1] < -90 ||
    center[1] > 90
  ) {
    issues.push(`${path}.center must contain valid longitude and latitude`)
  }
  if (typeof value.zoom !== 'number' || !Number.isFinite(value.zoom) || value.zoom < 0 || value.zoom > 24) {
    issues.push(`${path}.zoom must be between 0 and 24`)
  }
  optionalFiniteNumber(value, 'bearing', path, issues)
  optionalBoundedNumber(value, 'pitch', 0, 85, path, issues)
}

function validateMapLayer(value: unknown, path: string, issues: string[], requireVisible: boolean): void {
  if (!isRecord(value)) {
    issues.push(`${path} must be an object`)
    return
  }
  rejectUnknownKeys(value, ['id', 'visible', 'filter', 'label', 'style', 'join', 'legend'], path, issues)
  requireString(value, 'id', issues, path)
  optionalString(value, 'label', issues, path)
  if (requireVisible ? typeof value.visible !== 'boolean' : value.visible !== undefined && typeof value.visible !== 'boolean') {
    issues.push(`${path}.visible must be a boolean`)
  }
  if (value.legend !== undefined && typeof value.legend !== 'boolean') issues.push(`${path}.legend must be a boolean`)
  if (value.style !== undefined) validateLayerStyle(value.style, `${path}.style`, issues)
  if (value.join !== undefined) validateTileJoin(value.join, `${path}.join`, issues)
  if (value.filter !== undefined) {
    if (!isRecord(value.filter) || !Object.values(value.filter).every(isFilterValue)) {
      issues.push(`${path}.filter must contain only scalar values`)
    }
  }
}

function validateChart(value: Record<string, unknown>, issues: string[]): void {
  if (!isRecord(value.intent)) {
    issues.push('intent must be an object')
    return
  }
  rejectUnknownKeys(value.intent, ['family', 'dimension', 'measure', 'series'], 'intent', issues)
  const families: ChartFamily[] = [
    'trend',
    'comparison',
    'ranking',
    'distribution',
    'relationship',
    'composition',
  ]
  if (!families.includes(value.intent.family as ChartFamily)) {
    issues.push('intent.family is not supported')
  }
  validateEncoding(value.intent.dimension, 'intent.dimension', issues)
  validateEncoding(value.intent.measure, 'intent.measure', issues)
  if (value.intent.series !== undefined) validateEncoding(value.intent.series, 'intent.series', issues)
  if (value.presentation !== undefined) validatePresentation(value.presentation, issues)
}

function validateEncoding(value: unknown, path: string, issues: string[]): void {
  if (!isRecord(value)) {
    issues.push(`${path} must be an object`)
    return
  }
  rejectUnknownKeys(value, ['field', 'label', 'unit'], path, issues)
  requireString(value, 'field', issues, path)
  optionalString(value, 'label', issues, path)
  optionalString(value, 'unit', issues, path)
}

function validatePresentation(value: unknown, issues: string[]): void {
  if (!isRecord(value)) {
    issues.push('presentation must be an object')
    return
  }
  rejectUnknownKeys(value, ['orientation', 'stacked', 'showLegend', 'highlight'], 'presentation', issues)
  validateHighlight(value.highlight, 'presentation.highlight', issues)
  if (value.orientation !== undefined && value.orientation !== 'horizontal' && value.orientation !== 'vertical') {
    issues.push('presentation.orientation must be horizontal or vertical')
  }
  for (const key of ['stacked', 'showLegend'] as const) {
    if (value[key] !== undefined && typeof value[key] !== 'boolean') {
      issues.push(`presentation.${key} must be a boolean`)
    }
  }
}

function requireString(
  value: Record<string, unknown>,
  key: string,
  issues: string[],
  prefix?: string,
): void {
  if (!isNonEmptyString(value[key])) issues.push(`${prefix ? `${prefix}.` : ''}${key} is required`)
}

function optionalString(
  value: Record<string, unknown>,
  key: string,
  issues: string[],
  prefix?: string,
): void {
  if (value[key] !== undefined && !isNonEmptyString(value[key])) {
    issues.push(`${prefix ? `${prefix}.` : ''}${key} must be a non-empty string when provided`)
  }
}

function validateTimestamp(value: unknown, path: string, issues: string[]): void {
  if (!isNonEmptyString(value) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || Number.isNaN(Date.parse(value))) {
    issues.push(`${path} must be an ISO 8601 UTC timestamp`)
  }
}

function validateChecksum(value: unknown, path: string, issues: string[]): void {
  if (!isNonEmptyString(value) || !/^sha256:[0-9a-f]{64}$/.test(value)) {
    issues.push(`${path} must be a lowercase sha256 checksum`)
  }
}

function validateCountry(value: unknown, path: string, issues: string[]): void {
  if (!isNonEmptyString(value) || !/^[A-Z]{2}$/.test(value)) issues.push(`${path} must be an ISO alpha-2 code`)
}

function optionalFiniteNumber(
  value: Record<string, unknown>,
  key: string,
  prefix: string,
  issues: string[],
): void {
  if (value[key] !== undefined && (typeof value[key] !== 'number' || !Number.isFinite(value[key]))) {
    issues.push(`${prefix}.${key} must be a finite number`)
  }
}

function optionalBoundedNumber(
  value: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
  prefix: string,
  issues: string[],
): void {
  if (value[key] !== undefined && (typeof value[key] !== 'number' || value[key] < min || value[key] > max)) {
    issues.push(`${prefix}.${key} must be between ${min} and ${max}`)
  }
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: string[],
  path: string,
  issues: string[],
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key))
  if (unknown.length > 0) issues.push(`${path} contains unknown fields: ${unknown.join(', ')}`)
}

function isFilterValue(value: unknown): value is string | number | boolean | null {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}
