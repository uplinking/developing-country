#!/usr/bin/env bun
// Dataset index for agent discovery: one compact card per Indicator Table with
// its real field schema, time span, geography grain, filterable dimension
// values and ranked related Datasets. The MCP reads it to search, describe and
// suggest next queries without loading 109 table artifacts per request.
//
// Inputs: INDICATOR_DATASETS (packages/datasets) + public/data/<id>.json.
// Output: public/catalog/dataset-index.json, served at /catalog/dataset-index.json
// and loaded lazily by the Worker (kept out of the Worker bundle).
//   bun scripts/build-dataset-index.ts          write
//   bun scripts/build-dataset-index.ts --check  fail if stale
// Idempotent: output is a pure function of the inputs (no timestamps).

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  INDICATOR_DATASETS,
  datasetPublisher,
  parseIndicatorTable,
  type IndicatorField,
  type IndicatorTableV1,
} from '@developing-country/datasets'
import { isJsonString } from '../src/shared/json'

const ROOT = resolve(import.meta.dir, '..')
const OUTPUT = resolve(ROOT, 'public/catalog/dataset-index.json')

// Columns that carry row-level provenance rather than analysable content.
const PROVENANCE_FIELDS = new Set(['record_id', 'review_note', 'reported_token', 'extraction_method'])
const isProvenanceField = (id: string) => PROVENANCE_FIELDS.has(id) || id.startsWith('source_')

const MAX_LISTED_VALUES = 30
const MAX_RELATED = 6
const ADMIN_LEVELS = ['country', 'province', 'district', 'dsd', 'gnd'] as const
type AdminLevel = typeof ADMIN_LEVELS[number]
const isAdminLevel = (level: string): level is AdminLevel => ADMIN_LEVELS.some((known) => known === level)

export interface IndexField {
  id: string
  role: IndicatorField['role']
  type: IndicatorField['type']
  label: string
  unit?: string
  provenance?: true
  /** Every distinct value, when a string dimension has few enough to filter on. */
  values?: string[]
  /** Distinct count when values are too many to list. */
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
  geography?: { levels: AdminLevel[]; fields: string[]; join_field?: string }
  fields: IndexField[]
  caveats?: string[]
  default_preset_id: string
  related: Array<{ dataset_id: string; score: number; why: string[] }>
}

interface DatasetIndex {
  count: number
  datasets: IndexEntry[]
}

function loadTable(id: string): IndicatorTableV1 {
  const path = resolve(ROOT, 'public/data', `${id}.json`)
  const table = parseIndicatorTable(JSON.parse(readFileSync(path, 'utf8')))
  if (table.dataset_id !== id) throw new Error(`${path} declares dataset_id ${table.dataset_id}`)
  return table
}

function describeField(field: IndicatorField, table: IndicatorTableV1): IndexField {
  const out: IndexField = { id: field.id, role: field.role, type: field.type, label: field.label }
  if (field.unit) out.unit = field.unit
  if (isProvenanceField(field.id)) return { ...out, provenance: true }
  if (field.role !== 'dimension' || field.type !== 'string') return out
  const distinct = [...new Set(table.rows.map((row) => row[field.id]).filter(isJsonString))]
  if (distinct.length <= MAX_LISTED_VALUES) return { ...out, values: distinct.sort() }
  return { ...out, distinct: distinct.length, examples: distinct.slice(0, 5) }
}

function timeSpan(table: IndicatorTableV1): IndexEntry['time'] {
  const field =
    table.fields.find((f) => f.role === 'dimension' && f.type === 'year' && f.id === 'year') ??
    table.fields.find((f) => f.role === 'dimension' && (f.type === 'year' || f.type === 'period'))
  if (!field) return undefined
  const values = table.rows.map((row) => row[field.id]).filter((v) => v !== null && v !== undefined).map(String).sort()
  if (values.length === 0) return undefined
  // SAFETY: `field` was found by a predicate that only accepts type 'year' or 'period'.
  return { field: field.id, type: field.type as 'year' | 'period', min: values[0]!, max: values.at(-1)! }
}

function geography(table: IndicatorTableV1): IndexEntry['geography'] {
  const ids = new Set(table.fields.map((f) => f.id))
  const levels = new Set<AdminLevel>()
  const fields: string[] = []
  for (const level of ['province', 'district', 'dsd', 'gnd'] as const) {
    if (ids.has(level)) {
      levels.add(level)
      fields.push(level)
    }
  }
  if (ids.has('geography_type')) {
    fields.push('geography_type')
    for (const row of table.rows) {
      const raw = String(row.geography_type ?? '').toLowerCase()
      const level = raw === 'national' ? 'country' : raw
      if (isAdminLevel(level)) levels.add(level)
    }
  }
  // ISO 3166-2:LK and its census extension: LK / LK-1 province / LK-11
  // district / LK-1103 DSD / LK-1103005 GND. The id shape is the grain.
  if (ids.has('geography_id')) {
    for (const row of table.rows) {
      const code = row.geography_id
      if (!isJsonString(code)) continue
      if (code === 'LK') levels.add('country')
      const digits = /^LK-(\d+)$/.exec(code)?.[1]?.length
      if (digits === 1) levels.add('province')
      else if (digits === 2) levels.add('district')
      else if (digits === 4) levels.add('dsd')
      else if (digits !== undefined && digits >= 5) levels.add('gnd')
    }
    if (levels.size && !fields.includes('geography_id')) fields.push('geography_id')
  }
  if (levels.size === 0) return undefined
  const joinField = ids.has('geography_id') &&
    table.rows.some((row) => isJsonString(row.geography_id) && row.geography_id.startsWith('LK-'))
    ? 'geography_id'
    : undefined
  const geo: NonNullable<IndexEntry['geography']> = {
    levels: ADMIN_LEVELS.filter((level) => levels.has(level)),
    fields,
  }
  if (joinField) geo.join_field = joinField
  return geo
}

// ---- Relatedness -------------------------------------------------------------
// Explainable, not learned: every point of score comes with a reason string.

const STOP = new Set(('the and for with from into per by of in on to at as or an a is are be this that these ' +
  'than its their over under each all total data dataset table series sri lanka national annual monthly ' +
  'year years source sources reported official figures number numbers share rate rates ' +
  'how have has had changed change what which where when does did much many since across between ' +
  'compare compared over time latest recent published shows show ' +
  'date dates period periods value values status unit units count counts observation observations ' +
  'category categories indicator indicators type types code codes label labels metric metrics').split(' '))

// Cross-vocabulary concepts the text vectors cannot bridge on their own
// ("remittances" and "foreign employment departures" share no words). Small,
// curated, explainable: a shared concept is printed as the reason.
const CONCEPTS = {
  migration: ['remittance', 'migrant', 'departure', 'emigration', 'foreign employment', 'diaspora'],
  prices: ['price', 'inflation', 'ccpi', 'consumer price', 'cost'],
  'public debt': ['debt', 'borrowing', 'creditor', 'treasury bill', 'bond'],
  trade: ['export', 'import', 'trade', 'cargo', 'port'],
  tourism: ['tourism', 'tourist', 'arrival', 'hotel'],
  energy: ['electricity', 'energy', 'generation', 'fuel', 'petroleum'],
  housing: ['housing', 'dwelling', 'household', 'building', 'construction', 'land valuation', 'asking price'],
  labour: ['employment', 'unemployment', 'labour', 'wage', 'occupation', 'worker'],
  'food and farming': ['crop', 'paddy', 'agricultur', 'fisher', 'livestock', 'food'],
  health: ['health', 'hospital', 'disease', 'mortality', 'clinic'],
  education: ['school', 'pupil', 'teacher', 'literacy', 'universit', 'education'],
  transport: ['vehicle', 'road', 'rail', 'bus ', 'buses', 'passenger', 'transport'],
  population: ['population', 'census', 'age ', 'ages ', 'ethnicity', 'religion', 'birth'],
} satisfies Record<string, string[]>

// Terms match at a word start ("age " never matches "average"); a trailing
// space in a term pins the word end too.
function concepts(text: string): Set<string> {
  const low = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `
  return new Set(Object.entries(CONCEPTS).filter(([, terms]) => terms.some((t) => low.includes(` ${t}`))).map(([name]) => name))
}

function tokens(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOP.has(t) && !/^\d+$/.test(t))
    .map((t) => t.replace(/ies$/, 'y').replace(/(?<=[a-z]{3}[^su])s$/, ''))
}

function tfidfVectors(docs: string[][]): Array<Map<string, number>> {
  const df = new Map<string, number>()
  for (const doc of docs) for (const term of new Set(doc)) df.set(term, (df.get(term) ?? 0) + 1)
  return docs.map((doc) => {
    const tf = new Map<string, number>()
    for (const term of doc) tf.set(term, (tf.get(term) ?? 0) + 1)
    const vec = new Map<string, number>()
    let norm = 0
    for (const [term, count] of tf) {
      const w = count * Math.log(docs.length / (df.get(term) ?? 1))
      vec.set(term, w)
      norm += w * w
    }
    norm = Math.sqrt(norm) || 1
    for (const [term, w] of vec) vec.set(term, w / norm)
    return vec
  })
}

interface TextOverlap {
  score: number
  shared: string[]
}

function cosine(a: Map<string, number>, b: Map<string, number>): TextOverlap {
  let score = 0
  const shared: Array<[string, number]> = []
  for (const [term, w] of a) {
    const v = b.get(term)
    if (v) {
      score += w * v
      shared.push([term, w * v])
    }
  }
  return { score, shared: shared.sort((x, y) => y[1] - x[1]).slice(0, 3).map(([t]) => t) }
}

function overlapYears(a?: IndexEntry['time'], b?: IndexEntry['time']): string | null {
  if (!a || !b) return null
  const lo = a.min.slice(0, 4) > b.min.slice(0, 4) ? a.min.slice(0, 4) : b.min.slice(0, 4)
  const hi = a.max.slice(0, 4) < b.max.slice(0, 4) ? a.max.slice(0, 4) : b.max.slice(0, 4)
  return lo <= hi ? (lo === hi ? lo : `${lo}–${hi}`) : null
}

function relate(entries: Omit<IndexEntry, 'related'>[]): IndexEntry[] {
  const docs = entries.map((e) => tokens([
    e.title, e.title, e.label, e.description, e.question,
    ...e.fields.filter((f) => !f.provenance).map((f) => f.label),
  ].join(' ')))
  const vectors = tfidfVectors(docs)
  const conceptSets = entries.map((e) => concepts(`${e.title} ${e.label} ${e.description}`))

  return entries.map((a, i) => {
    const scored = entries.flatMap((b, j) => {
      if (i === j) return []
      const why: string[] = []
      let score = 0
      const text = cosine(vectors[i]!, vectors[j]!)
      if (text.score > 0.05) {
        score += 4 * text.score
        why.push(`about ${text.shared.join(', ')}`)
      }
      const shared = [...conceptSets[i]!].filter((c) => conceptSets[j]!.has(c))
      if (shared.length) {
        score += 0.9 * shared.length
        why.push(`concept ${shared.join('+')}`)
      }
      const themes = a.themes.filter((t) => b.themes.includes(t))
      if (themes.length) {
        score += 0.4 * themes.length
        why.push(`theme ${themes.join('+')}`)
      }
      const sources = a.source_ids.filter((s) => b.source_ids.includes(s))
      if (sources.length) {
        score += 0.8
        why.push(`same source ${sources[0]}`)
      } else if (a.publisher.id === b.publisher.id) {
        score += 0.4
        why.push(`same publisher ${a.publisher.name}`)
      }
      const levels = (a.geography?.levels ?? []).filter((l) => l !== 'country' && b.geography?.levels.includes(l))
      if (levels.length) {
        score += 0.6
        why.push(`both by ${levels.at(-1)}`)
      }
      const years = overlapYears(a.time, b.time)
      if (years && score > 0) {
        score += 0.3
        why.push(`overlapping ${years}`)
      }
      // Theme or publisher alone is not relatedness; require substance.
      if (text.score <= 0.05 && !shared.length && !sources.length && !levels.length) return []
      return [{ dataset_id: b.dataset_id, score: Math.round(score * 100) / 100, why }]
    })
    scored.sort((x, y) => y.score - x.score || x.dataset_id.localeCompare(y.dataset_id))
    return { ...a, related: scored.filter((r) => r.score >= 0.8).slice(0, MAX_RELATED) }
  })
}

// ---- Build -------------------------------------------------------------------

function build(): DatasetIndex {
  const seen = new Set<string>()
  const entries = INDICATOR_DATASETS.map((definition) => {
    if (seen.has(definition.id)) throw new Error(`duplicate dataset ${definition.id}`)
    seen.add(definition.id)
    const table = loadTable(definition.id)
    const firstPreset = definition.presets[0]
    if (!firstPreset) throw new Error(`${definition.id} has no default preset`)
    const publisher = datasetPublisher(definition.id)
    const time = timeSpan(table)
    const geo = geography(table)
    // Absent optional keys are `undefined`, which JSON.stringify omits, so the
    // serialised key order stays fixed by this literal.
    const entry: Omit<IndexEntry, 'related'> = {
      dataset_id: definition.id,
      title: definition.title,
      label: definition.label,
      description: definition.description,
      question: definition.note.question,
      themes: [...definition.themeIds],
      publisher: { id: publisher.id, name: publisher.name },
      source_ids: [...definition.sourceIds],
      vintage: definition.vintage,
      grain: table.grain ? table.grain : undefined,
      row_count: table.rows.length,
      time,
      geography: geo,
      fields: table.fields.map((field) => describeField(field, table)),
      caveats: table.caveats?.length ? table.caveats : undefined,
      default_preset_id: firstPreset.id,
    }
    return entry
  })
  const datasets = relate(entries)

  // Self-validate before writing: every related id resolves, no self-links,
  // every preset field exists in the table, and the index stays bundle-sized.
  const ids = new Set(datasets.map((d) => d.dataset_id))
  for (const d of datasets) {
    for (const r of d.related) {
      if (!ids.has(r.dataset_id) || r.dataset_id === d.dataset_id) throw new Error(`${d.dataset_id}: bad related ${r.dataset_id}`)
    }
    const fieldIds = new Set(d.fields.map((f) => f.id))
    const definition = INDICATOR_DATASETS.find((x) => x.id === d.dataset_id)!
    for (const preset of definition.presets) {
      for (const f of preset.query.fields) {
        if (!fieldIds.has(f)) throw new Error(`${d.dataset_id}/${preset.id}: unknown field ${f}`)
      }
    }
  }
  return { count: datasets.length, datasets }
}

const index = build()
// One dataset per line: compact to load, still reviewable as a diff.
const text = [
  `{"generated_by":"scripts/build-dataset-index.ts","count":${index.count},"datasets":[`,
  index.datasets.map((d) => JSON.stringify(d)).join(',\n'),
  ']}',
  '',
].join('\n')
const kb = Math.round(Buffer.byteLength(text) / 1024)
if (kb > 800) throw new Error(`dataset index is ${kb} KB; trim value lists before the Worker loads it per isolate`)

if (process.argv.includes('--check')) {
  let current = ''
  try { current = readFileSync(OUTPUT, 'utf8') } catch { /* missing = stale */ }
  if (current !== text) {
    console.error('Dataset index is stale. Run bun run datasets:index.')
    process.exit(1)
  }
  console.log(`Dataset index is in sync (${index.count} datasets, ${kb} KB).`)
} else {
  writeFileSync(OUTPUT, text)
  console.log(`Wrote ${index.count} datasets (${kb} KB) to ${OUTPUT}.`)
}
