// Dataset discovery for agents: the slim catalog index, ranked dataset search,
// one-dataset cards, and the `next` hints attached to tool results.
//
// The heavy lifting (field schemas, dimension values, time spans, relatedness)
// is precomputed by scripts/build-dataset-index.ts into the static asset
// /catalog/dataset-index.json. This module only reads it, joins live
// provenance from the catalog projection, and ranks. Everything here is a
// projection — it never introduces a dataset the ontology does not register.

import {
  DATASET_QUERY_LIMITS,
  PUBLIC_DATA_THEMES,
  indicatorDataset,
  type IndicatorChartPreset,
} from '@developing-country/datasets'
import { parseQuery, type SearchQuery } from '@developing-country/datasets/search'
import { SEARCH_SYNONYMS } from '@developing-country/datasets/search-synonyms'
import type { JsonObject } from '../shared/json'
import { isJsonString } from '../shared/json'
import { loadJson } from './assets'
import type { getLayerCatalog } from './catalog'
import type { Env } from './types'

export const DATASET_INDEX_PATH = '/catalog/dataset-index.json'

type Catalog = ReturnType<typeof getLayerCatalog>
type CatalogLayer = Catalog['layers'][number]

export interface IndexField {
  id: string
  role: 'dimension' | 'measure'
  type: string
  label: string
  unit?: string
  provenance?: true
  values?: string[]
  distinct?: number
  examples?: string[]
}

export interface IndexEntry {
  dataset_id: string
  title: string
  label: string
  description: string
  question: string
  themes: string[]
  publisher: { id: string; name: string }
  source_ids: string[]
  vintage: string
  grain?: string
  row_count: number
  time?: { field: string; type: 'year' | 'period'; min: string; max: string }
  geography?: { levels: string[]; fields: string[]; join_field?: string }
  fields: IndexField[]
  caveats?: string[]
  default_preset_id: string
  related: Array<{ dataset_id: string; score: number; why: string[] }>
}

export interface DatasetIndex {
  count: number
  datasets: IndexEntry[]
}

/** One suggested follow-up call. `arguments` is ready to send as-is. */
export interface NextStep {
  why: string
  tool: 'query_data' | 'get_layer_catalog' | 'analyze_location'
  arguments: JsonObject
}

export async function loadDatasetIndex(env: Env): Promise<DatasetIndex | null> {
  // Repository-owned asset written and self-validated by build-dataset-index.ts.
  const raw = await loadJson<DatasetIndex>(env, DATASET_INDEX_PATH)
  if (!raw || !Array.isArray(raw.datasets)) return null
  return raw
}

const THEME_LABEL = new Map<string, string>(PUBLIC_DATA_THEMES.map((t) => [t.id, t.label]))

function byId(index: DatasetIndex): Map<string, IndexEntry> {
  return new Map(index.datasets.map((d) => [d.dataset_id, d]))
}

function span(time: IndexEntry['time']): string | undefined {
  if (!time) return undefined
  return time.min === time.max ? time.min : `${time.min}–${time.max}`
}

function layerForDataset(catalog: Catalog, datasetId: string): CatalogLayer | undefined {
  return catalog.layers.find((layer) => layer.kind === 'table' && layer.dataset_ids.includes(datasetId))
}

function analysableFields(entry: IndexEntry): IndexField[] {
  return entry.fields.filter((f) => !f.provenance)
}

// ---- Presets → ready-to-run calls -------------------------------------------

function presetCall(datasetId: string, preset: IndicatorChartPreset): JsonObject {
  const call: JsonObject = {
    op: 'select',
    dataset_id: datasetId,
    fields: [...preset.query.fields],
  }
  if (preset.query.where?.length) call.where = preset.query.where
  if (preset.query.order_by?.length) call.order_by = preset.query.order_by.map((o) => ({ field: o.field, direction: o.direction }))
  if (preset.query.limit) call.limit = preset.query.limit
  return call
}

/** The chart presentation a preset implies, in query_data's snake_case form. */
export function presetPresentation(preset: IndicatorChartPreset): JsonObject {
  const c = preset.chart
  const enc = (e: { field: string; label: string; unit?: string }): JsonObject => {
    const encoded: JsonObject = { field: e.field, label: e.label }
    if (e.unit) encoded.unit = e.unit
    return encoded
  }
  const presentation: JsonObject = { kind: 'chart', title: preset.title }
  if (preset.description) presentation.description = preset.description.slice(0, 500)
  presentation.family = c.family
  presentation.dimension = enc(c.dimension)
  presentation.measure = enc(c.measure)
  if (c.series) presentation.series = enc(c.series)
  if (c.orientation) presentation.orientation = c.orientation
  if (c.stacked !== undefined) presentation.stacked = c.stacked
  if (c.showLegend !== undefined) presentation.show_legend = c.showLegend
  return presentation
}

// ---- Slim index (get_layer_catalog with no arguments) ------------------------

export function slimCatalog(catalog: Catalog, index: DatasetIndex | null) {
  const entries = index ? byId(index) : new Map<string, IndexEntry>()
  const tables: JsonObject[] = []
  const spatial: JsonObject[] = []
  for (const layer of catalog.layers) {
    if (layer.kind === 'table') {
      for (const datasetId of layer.dataset_ids) {
        const entry = entries.get(datasetId)
        const table: JsonObject = { dataset_id: datasetId, title: layer.title }
        if (entry) {
          table.themes = entry.themes
          table.publisher = entry.publisher.name
          if (entry.time) table.time = span(entry.time)
          if (entry.geography) table.by = entry.geography.levels
          table.rows = entry.row_count
        }
        table.freshness = layer.freshness.status
        tables.push(table)
      }
    } else {
      spatial.push({
        entity: layer.id,
        title: layer.title,
        kind: layer.kind,
        geometry: layer.geometry,
        operators: layer.operators,
        completeness: layer.completeness.status,
        freshness: layer.freshness.status,
      })
    }
  }
  const themeCounts = new Map<string, number>()
  for (const entry of index?.datasets ?? []) for (const t of entry.themes) themeCounts.set(t, (themeCounts.get(t) ?? 0) + 1)
  return {
    schema_version: 3,
    product: catalog.product,
    country: catalog.country,
    view: 'index',
    count: { indicator_tables: tables.length, spatial_entities: spatial.length },
    how_to_use:
      'This is the slim index. To research: (1) search with get_layer_catalog {q} or {theme}; ' +
      '(2) open one with get_layer_catalog {dataset_id} for its real field ids, filterable values, ' +
      'time span, ready-to-run presets and related datasets; (3) run a preset or your own query_data ' +
      '{op:"select"}; (4) follow each result\'s `next` hints. Spatial entities go to query_data via ' +
      '`entities` (bbox/nearest/overlay/gap/…). Full provenance for everything: get_layer_catalog {full:true} ' +
      'or resource developing-country://catalog.',
    themes: [...themeCounts].sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ id, label: THEME_LABEL.get(id) ?? id, datasets: n })),
    indicator_tables: tables,
    spatial_entities: spatial,
    runtime_capabilities: catalog.runtime_capabilities,
    completeness: catalog.completeness,
  }
}

// ---- Search ------------------------------------------------------------------

export interface SearchParams {
  q?: string
  theme?: string
  publisher?: string
  limit?: number
}

/** One ranked Indicator Table in a search result. */
export type SearchHit = {
  dataset_id: string
  title: string
  question: string
  publisher: string
  themes: string[]
  time?: string
  by?: string[]
  rows: number
  score: number
  matched_on: string[]
  matching_values?: string[]
}

function words(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1)
}

// A query word hits a haystack word when one is a prefix of the other
// ("remit" → "remittances", "prices" → "price").
function wordHits(queryWord: string, w: string): boolean {
  return w.startsWith(queryWord) || (queryWord.length > 3 && queryWord.startsWith(w) && w.length > 3)
}

function hits(queryWord: string, hay: string[]): boolean {
  return hay.some((w) => wordHits(queryWord, w))
}

/** Every word of a phrase ("power cut", "asking price"), in order and adjacent. */
function phraseHits(phrase: readonly string[], hay: string[], match = wordHits): boolean {
  if (phrase.length === 0 || phrase.length > hay.length) return false
  for (let start = 0; start + phrase.length <= hay.length; start++) {
    if (phrase.every((word, offset) => match(word, hay[start + offset]!))) return true
  }
  return false
}

// The query is parsed by the same parser and synonym map as the /data page
// (@developing-country/datasets/search): plurals stemmed, filler words dropped,
// and each concept carries the words the reader typed plus its synonyms.
type Concept = SearchQuery['concepts'][number]

function queryConcepts(q: string | undefined): Concept[] {
  // Single letters carry no meaning on their own unless they start a synonym ("o level").
  return (parseQuery(q, SEARCH_SYNONYMS)?.concepts ?? []).filter((c) => c.term.length > 1 || c.alternatives.length > 1)
}

/** The zone that won, so `matched_on` can say a synonym produced it. */
interface ConceptMatch { score: number; zone: string; synonym: boolean; value?: string }

interface Scored { score: number; words: number; matched: Set<string>; values: string[] }

const VALUE_WEIGHT = 1.2
// A synonym counts for this share of the word the reader typed. Lower than
// /data's factor because these zone weights span 4:1 (title 4 … description 1):
// below 1/4, any synonym match ranks below any typed-word match, so a generic
// synonym ("prices" for "inflation") never outranks the tables that use the word.
const SYNONYM_FACTOR = 0.2

// Ranking rules (as on /data): a concept scores the weight of the best zone it
// matched, so title/field matches outrank description matches, and a synonym
// match counts for less than a match on the word the reader typed.
function scoreConcept(zones: Array<[string, number, string[]]>, fields: IndexField[], concept: Concept): ConceptMatch | null {
  let best: ConceptMatch | null = null
  for (const alternative of concept.alternatives) {
    const factor = alternative.synonym ? SYNONYM_FACTOR : 1
    for (const [zone, weight, hay] of zones) {
      const score = weight * factor
      if (score > (best?.score ?? 0) && phraseHits(alternative.tokens, hay)) best = { score, zone, synonym: alternative.synonym }
    }
  }
  if (best && !best.synonym) return best
  // Dimension values, when the typed word hit no zone: "jaffna" finds every
  // table with a Jaffna row, "rent" a tenure of "Free of rent".
  for (const alternative of concept.alternatives) {
    const score = VALUE_WEIGHT * (alternative.synonym ? SYNONYM_FACTOR : 1)
    if (score <= (best?.score ?? 0)) continue
    for (const f of fields) {
      const v = (f.values ?? f.examples ?? []).find((value) => phraseHits(alternative.tokens, words(value), (q, w) => w.startsWith(q)))
      if (v) {
        best = { score, zone: 'values', synonym: alternative.synonym, value: `${f.id}=${v}` }
        break
      }
    }
  }
  return best
}

function scoreEntry(entry: IndexEntry, concepts: Concept[]): Scored {
  const fields = analysableFields(entry)
  const zones: Array<[string, number, string[]]> = [
    ['title', 4, words(`${entry.title} ${entry.label} ${entry.dataset_id}`)],
    ['publisher', 2, words(entry.publisher.name)],
    ['theme', 1.5, words(entry.themes.map((t) => THEME_LABEL.get(t) ?? t).join(' '))],
    ['fields', 1.5, words(fields.map((f) => `${f.id} ${f.label}`).join(' '))],
    ['description', 1, words(`${entry.description} ${entry.question}`)],
  ]
  const out: Scored = { score: 0, words: 0, matched: new Set(), values: [] }
  for (const concept of concepts) {
    const match = scoreConcept(zones, fields, concept)
    if (!match) continue
    out.score += match.score
    out.words += 1
    out.matched.add(match.zone)
    if (match.synonym) out.matched.add('synonym')
    if (match.value) out.values.push(match.value)
  }
  return out
}

export function searchDatasets(catalog: Catalog, index: DatasetIndex, params: SearchParams) {
  const concepts = queryConcepts(params.q)
  const theme = params.theme?.toUpperCase()
  const publisher = params.publisher?.toLowerCase()
  const limit = Math.min(Math.max(Math.trunc(params.limit ?? 12), 1), 50)

  const tableHits = index.datasets.flatMap((entry) => {
    if (theme && !entry.themes.includes(theme)) return []
    if (publisher && !`${entry.publisher.id} ${entry.publisher.name}`.toLowerCase().includes(publisher)) return []
    const scored = concepts.length ? scoreEntry(entry, concepts) : { score: 1, words: 0, matched: new Set<string>(), values: [] }
    // Every query concept (a word, or a phrase from the synonym map) must land somewhere, or the hit is noise.
    if (scored.words < concepts.length) return []
    return [{ entry, ...scored }]
  })
  tableHits.sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title))

  const spatialHits = theme || publisher || !concepts.length ? [] : catalog.layers.flatMap((layer) => {
    if (layer.kind === 'table') return []
    const hay = words(`${layer.id} ${layer.title} ${layer.description}`)
    const n = concepts.filter((c) => c.alternatives.some((a) => phraseHits(a.tokens, hay))).length
    return n === concepts.length ? [{ layer, score: n }] : []
  })

  const datasets = tableHits.slice(0, limit).map(({ entry, score, matched, values }) => {
    const hit: SearchHit = {
      dataset_id: entry.dataset_id,
      title: entry.title,
      question: entry.question,
      publisher: entry.publisher.name,
      themes: entry.themes,
      rows: entry.row_count,
      score: Math.round(score * 10) / 10,
      matched_on: [...matched],
    }
    if (entry.time) hit.time = span(entry.time)
    if (entry.geography) hit.by = entry.geography.levels
    if (values.length) hit.matching_values = values
    return hit
  })
  const entities = spatialHits.slice(0, 8).map(({ layer }) => ({
    entity: layer.id,
    title: layer.title,
    geometry: layer.geometry,
    operators: layer.operators,
    completeness: layer.completeness.status,
  }))

  const next: NextStep[] = datasets.slice(0, 3).map((d) => ({
    why: `Open "${d.title}" for its fields, presets and related datasets`,
    tool: 'get_layer_catalog',
    arguments: { dataset_id: d.dataset_id },
  }))
  if (!datasets.length && !entities.length) {
    next.push({ why: 'No match — browse by theme instead', tool: 'get_layer_catalog', arguments: {} })
  }
  const query: Pick<SearchParams, 'q' | 'theme' | 'publisher'> = {}
  if (params.q) query.q = params.q
  if (theme) query.theme = theme
  if (params.publisher) query.publisher = params.publisher
  return {
    view: 'search',
    query,
    total: tableHits.length,
    datasets,
    spatial_entities: entities,
    next,
  }
}

// ---- One dataset card ----------------------------------------------------------

function exampleFilter(entry: IndexEntry): JsonObject | null {
  if (entry.time) {
    return { field: entry.time.field, op: 'gte', value: entry.time.type === 'year' ? Number(entry.time.max.slice(0, 4)) - 5 : entry.time.max.slice(0, 4) }
  }
  const dim = analysableFields(entry).find((f) => f.values && f.values.length > 1)
  return dim?.values ? { field: dim.id, op: 'eq', value: dim.values[0]! } : null
}

export function datasetCard(catalog: Catalog, index: DatasetIndex | null, datasetId: string) {
  const entries = index ? byId(index) : new Map<string, IndexEntry>()
  const entry = entries.get(datasetId)
  const layer = layerForDataset(catalog, datasetId)
  if (layer && entry) return indicatorCard(layer, entry, entries)

  // Spatial entity (or a table missing from a stale index): the catalog row
  // is already the full contract; add operator examples as next steps.
  const spatial = catalog.layers.find((l) => l.id === datasetId || l.dataset_ids.includes(datasetId))
  if (!spatial) return null
  return {
    view: 'dataset',
    ...spatial,
    next: spatialNext(spatial),
  }
}

function indicatorCard(layer: CatalogLayer, entry: IndexEntry, entries: Map<string, IndexEntry>) {
  const definition = indicatorDataset(entry.dataset_id)
  const presets = (definition?.presets ?? []).map((preset) => ({
    id: preset.id,
    title: preset.title,
    description: preset.description,
    family: preset.chart.family,
    call: { tool: 'query_data', arguments: presetCall(entry.dataset_id, preset) },
    presentation: presetPresentation(preset),
  }))
  const related = entry.related.map((r) => ({
    dataset_id: r.dataset_id,
    title: entries.get(r.dataset_id)?.title ?? r.dataset_id,
    why: r.why.join('; '),
  }))
  const fields = analysableFields(entry)
  const filter = exampleFilter(entry)
  const next: NextStep[] = []
  if (presets[0]) {
    next.push({ why: `Run the default preset "${presets[0].title}" (the MCP App charts it inline)`, tool: 'query_data', arguments: presets[0].call.arguments })
  }
  const measures = fields.filter((f) => f.role === 'measure').slice(0, 2).map((f) => f.id)
  const dims = fields.filter((f) => f.role === 'dimension').slice(0, 3).map((f) => f.id)
  if (measures.length) {
    const own: JsonObject = { op: 'select', dataset_id: entry.dataset_id, fields: [...dims, ...measures] }
    if (filter) own.where = [filter]
    own.limit = 50
    next.push({ why: 'Or write your own select from these exact field ids', tool: 'query_data', arguments: own })
  }
  if (related[0]) {
    next.push({ why: `Related: ${related[0].title} (${related[0].why})`, tool: 'get_layer_catalog', arguments: { dataset_id: related[0].dataset_id } })
  }
  return {
    view: 'dataset',
    dataset_id: entry.dataset_id,
    entity: layer.id,
    title: entry.title,
    description: entry.description,
    question: entry.question,
    themes: entry.themes.map((id) => ({ id, label: THEME_LABEL.get(id) ?? id })),
    publisher: entry.publisher,
    grain: entry.grain,
    row_count: entry.row_count,
    time: entry.time,
    geography: entry.geography,
    fields,
    provenance_fields: entry.fields.filter((f) => f.provenance).map((f) => f.id),
    caveats: entry.caveats,
    query_limits: { max_rows: DATASET_QUERY_LIMITS.maxRows, max_predicates: DATASET_QUERY_LIMITS.maxPredicates, max_in_values: DATASET_QUERY_LIMITS.maxInValues },
    provenance: {
      sources: layer.sources,
      vintage: layer.vintage,
      refreshed_at: layer.refreshed_at,
      freshness: layer.freshness,
      licence: layer.licence,
      licence_status: layer.licence_status,
    },
    completeness: layer.completeness,
    web_url: `https://developing-country.org/data/${entry.dataset_id}`,
    presets,
    related,
    next,
  }
}

function spatialNext(layer: CatalogLayer): NextStep[] {
  const fort = { lat: 6.9344, lng: 79.8428 }
  const next: NextStep[] = []
  if (layer.operators.includes('nearest')) {
    next.push({ why: `Nearest ${layer.title} to a point (Colombo Fort shown)`, tool: 'query_data', arguments: { op: 'nearest', entities: layer.id, origin: fort, n: 10 } })
  }
  if (layer.operators.includes('overlay')) {
    next.push({ why: `${layer.title} inside one district`, tool: 'query_data', arguments: { op: 'overlay', entities: layer.id, within: { district: 'Colombo' }, method: 'centroid_in_polygon' } })
  }
  if (layer.operators.includes('bbox')) {
    next.push({ why: `${layer.title} inside a bounding box (greater Colombo shown)`, tool: 'query_data', arguments: { op: 'bbox', entities: layer.id, bbox: [79.8, 6.8, 80.0, 7.0] } })
  }
  if (layer.operators.includes('choropleth_join')) {
    next.push({ why: `${layer.title} as a choropleth`, tool: 'query_data', arguments: { op: 'choropleth_join', entities: layer.id } })
  }
  return next
}

// ---- `next` hints on query results --------------------------------------------

/**
 * The chart an unsaved select would draw: the matching preset, else an inferred
 * trend or ranking. The MCP App draws it inline, and it is the `presentation`
 * to pass if the user asks for a saved link. It is never offered as a next step:
 * saving is the user's call, not a default.
 */
export function suggestedPresentation(index: DatasetIndex | null, args: JsonObject): JsonObject | null {
  const datasetId = isJsonString(args.dataset_id) ? args.dataset_id : ''
  const entry = index ? byId(index).get(datasetId) : undefined
  if (!entry) return null
  const fields = Array.isArray(args.fields) ? args.fields.filter(isJsonString) : []
  const definition = indicatorDataset(datasetId)
  const preset = definition?.presets.find((p) => p.chart.dimension.field && fields.includes(p.chart.dimension.field) && fields.includes(p.chart.measure.field))
  return preset ? presetPresentation(preset) : inferPresentation(entry, fields)
}

/** Hints after an Indicator Table select. Pure: index + args + result shape. */
export function selectNext(index: DatasetIndex | null, args: JsonObject, result: { truncated?: boolean; total_count?: number; count?: number }): NextStep[] {
  const datasetId = isJsonString(args.dataset_id) ? args.dataset_id : ''
  const entry = index ? byId(index).get(datasetId) : undefined
  const next: NextStep[] = []

  if (result.truncated && entry) {
    const filter = exampleFilter(entry)
    const narrowed: JsonObject = { ...args }
    if (filter) narrowed.where = [...(Array.isArray(args.where) ? args.where : []), filter]
    next.push({
      why: `Truncated: ${result.count} of ${result.total_count} rows. Narrow with a where filter${entry.time ? ` on ${entry.time.field} (${span(entry.time)})` : ''}`,
      tool: 'query_data',
      arguments: narrowed,
    })
  }

  const entries = index ? byId(index) : new Map<string, IndexEntry>()
  for (const r of entry?.related.slice(0, 2) ?? []) {
    const title = entries.get(r.dataset_id)?.title ?? r.dataset_id
    next.push({ why: `Related: ${title} (${r.why.slice(0, 2).join('; ')})`, tool: 'get_layer_catalog', arguments: { dataset_id: r.dataset_id } })
  }
  return next
}

/** A defensible chart for an ad-hoc select: time → trend, else ranking. */
export function inferPresentation(entry: IndexEntry, fields: string[]): JsonObject | null {
  const selected = entry.fields.filter((f) => fields.includes(f.id) && !f.provenance)
  const measure = selected.find((f) => f.role === 'measure')
  if (!measure) return null
  const time = entry.time && fields.includes(entry.time.field) ? selected.find((f) => f.id === entry.time!.field) : undefined
  const dimension = time ?? selected.find((f) => f.role === 'dimension' && f.type === 'string')
  if (!dimension) return null
  const series = time ? selected.find((f) => f.role === 'dimension' && f.type === 'string' && f.values && f.values.length <= 8) : undefined
  const enc = (f: IndexField): JsonObject => {
    const encoded: JsonObject = { field: f.id, label: f.label }
    if (f.unit) encoded.unit = f.unit
    return encoded
  }
  const presentation: JsonObject = {
    kind: 'chart',
    title: `${measure.label} by ${dimension.label.toLowerCase()}`.slice(0, 160),
    family: time ? 'trend' : 'ranking',
    dimension: enc(dimension),
    measure: enc(measure),
  }
  if (series) presentation.series = enc(series)
  return presentation
}

/** Repair hints when a select is rejected: the real field ids, closest datasets. */
export function selectRepair(index: DatasetIndex | null, args: JsonObject): JsonObject {
  const datasetId = isJsonString(args.dataset_id) ? args.dataset_id : ''
  const entries = index ? byId(index) : new Map<string, IndexEntry>()
  const entry = entries.get(datasetId)
  if (entry) {
    const repair: JsonObject = {
      valid_fields: analysableFields(entry).map((f) => `${f.id} (${f.role}, ${f.type}${f.unit ? `, ${f.unit}` : ''})`),
    }
    if (entry.time) {
      repair.time_field = entry.time.field
      repair.time_span = span(entry.time)
    }
    repair.hint = `Field ids are exact. get_layer_catalog {dataset_id:"${datasetId}"} lists filterable values and ready-to-run presets.`
    return repair
  }
  if (!index) return {}
  const qWords = words(datasetId.replace(/[-_]/g, ' '))
  const closest = index.datasets
    .map((d) => ({ id: d.dataset_id, n: qWords.filter((w) => hits(w, words(`${d.dataset_id} ${d.title}`))).length }))
    .filter((d) => d.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, 5)
    .map((d) => d.id)
  const repair: JsonObject = {}
  if (closest.length) repair.did_you_mean = closest
  repair.hint = 'dataset_id must be an exact id. Search with get_layer_catalog {q:"…"}.'
  return repair
}

/** After analyze_location: district-level tables filtered to this district. */
export function analyzeNext(index: DatasetIndex | null, district: { id?: string; name?: string } | null): NextStep[] {
  if (!index || !district?.id) return []
  const wanted = ['population-change-district', 'census-age-sex-dsd', 'census-basic-services-district', 'poverty-headcount-district', 'household-income-inequality']
  const entries = byId(index)
  const next: NextStep[] = []
  for (const id of wanted) {
    const entry = entries.get(id)
    if (!entry?.geography?.join_field || !entry.geography.levels.includes('district')) continue
    const fields = analysableFields(entry)
    const measures = fields.filter((f) => f.role === 'measure').slice(0, 3).map((f) => f.id)
    const dims = fields.filter((f) => f.role === 'dimension' && ['geography_name', 'district', 'dsd', 'year'].includes(f.id)).map((f) => f.id)
    // DSD tables carry the district as a name column; district tables join on id.
    const where = entry.geography.levels.includes('dsd') && fields.some((f) => f.id === 'district')
      ? [{ field: 'district', op: 'eq', value: district.name ?? '' }]
      : [{ field: entry.geography.join_field, op: 'eq', value: district.id }]
    next.push({
      why: `${entry.title} for ${district.name ?? district.id}`,
      tool: 'query_data',
      arguments: { op: 'select', dataset_id: id, fields: [...dims, ...measures], where, limit: 50 },
    })
    if (next.length >= 3) break
  }
  next.push({ why: 'Find more district-level tables', tool: 'get_layer_catalog', arguments: { q: district.name ?? 'district' } })
  return next
}
