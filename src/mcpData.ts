// Pure helpers for the MCP App's data surfaces: the dataset browser
// (get_layer_catalog index/search/card) and Indicator Table results
// (query_data op=select). The Worker owns every decision about what to
// suggest; these helpers only read its envelopes and build a transient chart
// spec so an unsaved preview renders with the same engine as a saved view.

import type { ChartViewSpec, DataViewSpec } from '@developing-country/views'
import { validateDataViewSpec } from '@developing-country/views'
import type { JsonObject, JsonValue } from './shared/json'
import { isJsonObject, isJsonString, jsonObjectFromSerializable, parseJsonObject } from './shared/json'

export interface NextStep {
  why: string
  tool: string
  arguments: JsonObject
}

export type DataPanelKind = 'index' | 'search' | 'dataset' | 'table'

export interface TableField {
  id: string
  role?: string
  type?: string
  label: string
  unit?: string
}

/** The whole structured body of a tool result, or the parsed text block. */
export function rawFromResult(result: {
  structuredContent?: object
  content?: Array<{ type: string; text?: string }>
}): JsonObject | null {
  const structured = result.structuredContent ? jsonObjectFromSerializable(result.structuredContent) : null
  if (structured) return structured
  const block = result.content?.find((c) => c.type === 'text' && c.text !== undefined)
  return block?.text ? parseJsonObject(block.text) : null
}

/** Which data surface a body belongs to; null means the map handles it. */
export function dataPanelKind(raw: JsonObject | null): DataPanelKind | null {
  if (!raw) return null
  if (raw.view === 'index' || raw.view === 'search' || raw.view === 'dataset') return raw.view
  if (raw.result_kind === 'table' || raw.op === 'select') return 'table'
  // get_layer_catalog {full:true}: the browser starts from the slim index.
  if (Array.isArray(raw.layers) && raw.product) return 'index'
  return null
}

export function nextSteps(raw: JsonObject | null): NextStep[] {
  if (!raw || !Array.isArray(raw.next)) return []
  return raw.next.flatMap((step) => {
    if (!isJsonObject(step) || !isJsonString(step.why) || !isJsonString(step.tool) || !isJsonObject(step.arguments)) return []
    return [{ why: step.why, tool: step.tool, arguments: step.arguments }]
  })
}

export function tableRows(raw: JsonObject): JsonObject[] {
  const rows = Array.isArray(raw.rows) ? raw.rows : Array.isArray(raw.features) ? raw.features : []
  return rows.filter(isJsonObject)
}

export function tableFields(raw: JsonObject): TableField[] {
  const schema = Array.isArray(raw.field_schema) ? raw.field_schema : []
  const fields = schema.flatMap((f) => {
    if (!isJsonObject(f) || !isJsonString(f.id)) return []
    const field: TableField = { id: f.id, label: isJsonString(f.label) ? f.label : f.id }
    if (isJsonString(f.role)) field.role = f.role
    if (isJsonString(f.type)) field.type = f.type
    if (isJsonString(f.unit)) field.unit = f.unit
    return [field]
  })
  if (fields.length) return fields
  const first = tableRows(raw)[0]
  return first ? Object.keys(first).map((id) => ({ id, label: id })) : []
}

function encoding(value: JsonValue | undefined): ChartViewSpec['intent']['dimension'] | null {
  if (!isJsonObject(value) || !isJsonString(value.field)) return null
  const out: ChartViewSpec['intent']['dimension'] = { field: value.field }
  if (isJsonString(value.label)) out.label = value.label
  if (isJsonString(value.unit)) out.unit = value.unit
  return out
}

const FAMILIES = new Set(['trend', 'comparison', 'ranking', 'distribution', 'relationship', 'composition'])

/**
 * A chart for this table result: the persisted view when the result was
 * saved, otherwise a transient spec from the Worker's suggested presentation
 * (the `next` step that would save it). Never invents an encoding itself.
 */
export function chartForTable(raw: JsonObject): { spec: ChartViewSpec; saved: boolean; presentation?: JsonObject } | null {
  const saved = raw.view === undefined ? null : validateDataViewSpec(raw.view)
  if (saved?.ok && saved.value.kind === 'chart') return { spec: saved.value, saved: true }

  const suggestion = nextSteps(raw).find((s) => isJsonObject(s.arguments.presentation) && s.arguments.presentation.kind === 'chart')
  const p = suggestion?.arguments.presentation
  if (!isJsonObject(p)) return null
  const dimension = encoding(p.dimension)
  const measure = encoding(p.measure)
  // SAFETY: FAMILIES holds exactly the ChartFamily members, and membership is checked first.
  const family = isJsonString(p.family) && FAMILIES.has(p.family) ? p.family as ChartViewSpec['intent']['family'] : null
  if (!dimension || !measure || !family) return null
  const fields = new Set(tableFields(raw).map((f) => f.id))
  if (!fields.has(dimension.field) || !fields.has(measure.field)) return null
  const series = encoding(p.series)
  const now = new Date().toISOString()
  const intent: ChartViewSpec['intent'] = { family, dimension, measure }
  if (series && fields.has(series.field)) intent.series = series
  const presentation: NonNullable<ChartViewSpec['presentation']> = {}
  if (p.orientation === 'horizontal' || p.orientation === 'vertical') presentation.orientation = p.orientation
  if (p.stacked === true || p.stacked === false) presentation.stacked = p.stacked
  if (p.show_legend === true || p.show_legend === false) presentation.showLegend = p.show_legend
  // SAFETY: The Worker only emits supported CountryCode values in `country`; a preview spec is transient and never persisted.
  const spec: ChartViewSpec = {
    version: 1,
    id: 'view_preview',
    kind: 'chart',
    country: (isJsonString(raw.country) ? raw.country : 'LK') as ChartViewSpec['country'],
    // No description: in the inline frame a wrapped subtitle eats the plot.
    title: isJsonString(p.title) ? p.title : 'Preview',
    data: { queryId: 'preview', resultChecksum: 'preview', rowCount: tableRows(raw).length },
    evidence: { datasetVersions: [], sourceIds: [], generatedAt: now },
    theme: 'developing-country/v1',
    createdAt: now,
    intent,
    presentation,
  }
  return { spec, saved: false, presentation: p }
}

export function savedView(raw: JsonObject): DataViewSpec | null {
  const checked = raw.view === undefined ? null : validateDataViewSpec(raw.view)
  return checked?.ok ? checked.value : null
}

/** Source line for a result: "Central Bank of Sri Lanka · 2009-01–2026-08". */
export function provenanceLine(raw: JsonObject): string {
  const rows = Array.isArray(raw.provenance) ? raw.provenance.filter(isJsonObject) : []
  return rows
    .map((p) => [p.source, p.vintage].filter(isJsonString).join(' · '))
    .filter(Boolean)
    .join(' / ')
}

export function errorText(raw: JsonObject | null): string {
  if (!raw) return 'The tool returned no result.'
  const parts = [raw.error, raw.message, raw.hint].filter(isJsonString)
  if (Array.isArray(raw.issues)) parts.push(...raw.issues.filter(isJsonString))
  return parts.join(' — ') || 'The tool call failed.'
}

/** One line for the model's context when the viewer navigates in-app. */
export function modelContextForPanel(kind: DataPanelKind, raw: JsonObject): string {
  if (kind === 'dataset') {
    return `The user opened dataset "${String(raw.title ?? raw.dataset_id)}" (dataset_id ${String(raw.dataset_id ?? raw.id)}) in the developing-country.org dataset browser.`
  }
  if (kind === 'table') {
    const count = tableRows(raw).length
    return `The user ran a select on ${String(raw.dataset_id)} in the MCP App and is looking at ${count} row(s)${raw.truncated ? ' (truncated)' : ''}. Fields: ${tableFields(raw).map((f) => f.id).join(', ')}.`
  }
  if (kind === 'search') {
    const query = isJsonObject(raw.query) ? Object.values(raw.query).filter(isJsonString).join(' ') : ''
    return `The user searched the dataset browser for "${query}" and sees ${Array.isArray(raw.datasets) ? raw.datasets.length : 0} dataset(s).`
  }
  return 'The user is browsing the developing-country.org dataset index.'
}

/**
 * Whether a tool call's arguments promise a map answer, read before the result
 * lands so the map chunk can download while the Worker works. Data answers
 * (op=select, chart presentations, the dataset browser) never need it.
 */
export function expectsMap(args: JsonObject, toolName: string | undefined): boolean {
  if (toolName === 'analyze_location') return true
  if (toolName && toolName !== 'query_data') return false
  if (isJsonObject(args.presentation) && args.presentation.kind === 'chart') return false
  return isJsonString(args.op) && args.op !== 'select'
}
