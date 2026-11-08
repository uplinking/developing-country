import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { selectRows, parseIndicatorTable } from '@developing-country/datasets'
import { getLayerCatalog } from './catalog'
import {
  analyzeNext,
  datasetCard,
  inferPresentation,
  searchDatasets,
  selectNext,
  selectRepair,
  slimCatalog,
  type DatasetIndex,
} from './discovery'
import type { JsonObject } from '../shared/json'

const ROOT = resolve(import.meta.dir, '../..')
const index = JSON.parse(readFileSync(resolve(ROOT, 'public/catalog/dataset-index.json'), 'utf8')) as DatasetIndex
const catalog = getLayerCatalog()

/** query_data select arguments → the SelectRowsInput the table engine takes. */
function rowsInput(args: JsonObject): never {
  const { op: _op, dataset_id: _id, presentation: _p, ...rest } = args
  return rest as never
}

function table(id: string) {
  return parseIndicatorTable(JSON.parse(readFileSync(resolve(ROOT, 'public/data', `${id}.json`), 'utf8')))
}

describe('slim catalog', () => {
  const slim = slimCatalog(catalog, index)

  test('lists every registered table and spatial entity', () => {
    const tableIds = catalog.layers.filter((l) => l.kind === 'table').flatMap((l) => l.dataset_ids)
    expect(slim.indicator_tables.map((t) => t.dataset_id)).toEqual(tableIds)
    expect(slim.count.spatial_entities).toBe(catalog.layers.filter((l) => l.kind !== 'table').length)
  })

  test('is a fraction of the full provenance catalog', () => {
    const slimBytes = JSON.stringify(slim).length
    expect(slimBytes).toBeLessThan(JSON.stringify(catalog).length / 5)
    expect(slimBytes).toBeLessThan(60_000)
  })

  test('indexes every registered table (index is not stale)', () => {
    const indexed = new Set(index.datasets.map((d) => d.dataset_id))
    for (const row of slim.indicator_tables) expect(indexed.has(String(row.dataset_id))).toBe(true)
  })
})

describe('dataset search', () => {
  test('finds remittances by a word prefix', () => {
    const hits = searchDatasets(catalog, index, { q: 'remit' })
    expect(hits.datasets[0]?.dataset_id).toBe('workers-remittances-monthly')
  })

  test('matches dimension values such as a district name', () => {
    const hits = searchDatasets(catalog, index, { q: 'jaffna population' })
    expect(hits.datasets.length).toBeGreaterThan(0)
    expect(hits.datasets.some((d) => (d.matching_values ?? []).some((v) => v.toLowerCase().includes('jaffna')))).toBe(true)
  })

  test('filters by theme and requires every query word to match', () => {
    const econ = searchDatasets(catalog, index, { theme: 'econ', limit: 50 })
    expect(econ.datasets.every((d) => d.themes.includes('ECON'))).toBe(true)
    expect(searchDatasets(catalog, index, { q: 'remittances zzzqqq' }).datasets).toHaveLength(0)
  })

  test('also surfaces spatial entities', () => {
    expect(searchDatasets(catalog, index, { q: 'metro' }).spatial_entities.length).toBeGreaterThan(0)
  })
})

// Plain-language queries an assistant passes straight through from a reader.
// The synonym map is the one /data uses (@developing-country/datasets/search-synonyms).
describe('plain-language dataset search', () => {
  const search = (q: string) => searchDatasets(catalog, index, { q })
  const ids = (q: string) => search(q).datasets.map((d) => d.dataset_id)
  const hit = (q: string, id: string) => search(q).datasets.find((d) => d.dataset_id === id)

  test('"school dropouts" finds school enrolment through a synonym', () => {
    expect(ids('school dropouts')[0]).toBe('school-resources')
    expect(hit('school dropouts', 'school-resources')?.matched_on).toContain('synonym')
  })

  test('"Colombo rent" finds Colombo asking prices as well as housing tenure', () => {
    const found = ids('Colombo rent')
    expect(found).toContain('colombo-asking-price-indices')
    expect(found).toContain('housing-occupancy-tenure')
    expect(hit('Colombo rent', 'colombo-asking-price-indices')?.matched_on).toContain('synonym')
  })

  test('"power cuts" and "blackouts" reach electricity supply reliability', () => {
    for (const q of ['power cuts', 'blackouts', 'power cut', 'blackout']) {
      expect(ids(q)[0]).toBe('electricity-supply-reliability')
      expect(search(q).datasets[0]?.matched_on).toContain('synonym')
    }
  })

  test('queries that matched before still match on the typed words', () => {
    const outages = search('electricity outages').datasets
    expect(outages[0]?.dataset_id).toBe('electricity-supply-reliability')
    expect(outages[0]?.matched_on).not.toContain('synonym')

    const inflation = search('inflation').datasets
    expect(inflation.slice(0, 2).map((d) => d.dataset_id).sort()).toEqual(['ccpi-monthly', 'ncpi-monthly'])
    expect(inflation[0]?.matched_on).not.toContain('synonym')

    const poverty = search('poverty').datasets
    expect(poverty.length).toBeGreaterThanOrEqual(4)
    for (const d of poverty.slice(0, 4)) {
      expect(d.title.toLowerCase()).toContain('poverty')
      expect(d.matched_on).toEqual(['title'])
    }
  })

  test('a synonym match ranks below every match on the typed word, even a description match', () => {
    const inflation = search('inflation').datasets
    const synonymOnly = inflation.filter((d) => d.matched_on.includes('synonym'))
    const typed = inflation.filter((d) => !d.matched_on.includes('synonym'))
    expect(synonymOnly.some((d) => d.matched_on.includes('title'))).toBe(true)
    expect(typed.some((d) => d.matched_on.includes('description'))).toBe(true)
    expect(inflation).toEqual([...typed, ...synonymOnly])
    expect(Math.min(...typed.map((d) => d.score))).toBeGreaterThan(Math.max(...synonymOnly.map((d) => d.score)))
  })

  test('title and field matches rank above description matches', () => {
    const inflation = search('inflation').datasets
    const fields = inflation.find((d) => d.matched_on.includes('fields') && !d.matched_on.includes('synonym'))!
    const description = inflation.find((d) => d.matched_on.includes('description') && !d.matched_on.includes('synonym'))!
    expect(fields.score).toBeGreaterThan(description.score)
    expect(inflation.indexOf(fields)).toBeLessThan(inflation.indexOf(description))
  })

  test('keeps the response shape', () => {
    const result = search('school dropouts')
    expect(Object.keys(result).sort()).toEqual(['datasets', 'next', 'query', 'spatial_entities', 'total', 'view'])
    expect(result.next[0]).toEqual({
      why: expect.any(String),
      tool: 'get_layer_catalog',
      arguments: { dataset_id: 'school-resources' },
    })
    expect(result.datasets[0]?.score).toBeGreaterThan(0)
    expect(result.datasets[0]?.matched_on).toEqual(['title', 'synonym'])
  })
})

describe('dataset card', () => {
  const card = datasetCard(catalog, index, 'census-age-sex-dsd') as JsonObject & {
    fields: Array<{ id: string }>
    presets: Array<{ call: { arguments: JsonObject } }>
    related: Array<{ dataset_id: string }>
    next: Array<{ tool: string; arguments: JsonObject }>
  }

  test('carries the real field ids and drops row-provenance columns', () => {
    expect(card.fields.map((f) => f.id)).toContain('older_60_plus_share_pct')
    expect(card.fields.map((f) => f.id)).not.toContain('record_id')
  })

  test('every preset call and next select runs against the real artifact', () => {
    const artifact = table('census-age-sex-dsd')
    for (const preset of card.presets) {
      expect(() => selectRows(artifact, rowsInput(preset.call.arguments))).not.toThrow()
    }
    for (const step of card.next.filter((s) => s.tool === 'query_data')) {
      expect(() => selectRows(artifact, rowsInput(step.arguments))).not.toThrow()
    }
  })

  test('links ranked related datasets that resolve', () => {
    expect(card.related.length).toBeGreaterThan(0)
    for (const r of card.related) expect(datasetCard(catalog, index, r.dataset_id)).not.toBeNull()
  })

  test('opens a spatial entity with operator examples', () => {
    const metro = datasetCard(catalog, index, 'metro_stop') as JsonObject & { next: unknown[] }
    expect(metro.view).toBe('dataset')
    expect(metro.next.length).toBeGreaterThan(0)
  })

  test('returns null for an unknown id', () => {
    expect(datasetCard(catalog, index, 'no-such-dataset')).toBeNull()
  })
})

describe('next hints', () => {
  test('a truncated select suggests a narrowing filter that still runs', () => {
    const args = { op: 'select', dataset_id: 'workers-remittances-monthly', fields: ['period', 'value'] }
    const steps = selectNext(index, args, { truncated: true, count: 50, total_count: 212 }, false)
    const narrow = steps[0]!
    expect(narrow.why).toContain('Truncated')
    expect(Array.isArray(narrow.arguments.where)).toBe(true)
  })

  test('an unsaved select offers a chart presentation', () => {
    const entry = index.datasets.find((d) => d.dataset_id === 'workers-remittances-monthly')!
    const fields = entry.fields.filter((f) => !f.provenance).map((f) => f.id)
    const steps = selectNext(index, { op: 'select', dataset_id: entry.dataset_id, fields }, {}, false)
    expect(steps.some((s) => (s.arguments.presentation as JsonObject | undefined)?.kind === 'chart')).toBe(true)
    expect(selectNext(index, { op: 'select', dataset_id: entry.dataset_id, fields }, {}, true)
      .some((s) => s.arguments.presentation)).toBe(false)
  })

  test('inferred charts use time for trends and names for rankings', () => {
    const entry = index.datasets.find((d) => d.dataset_id === 'population-change-district')!
    const p = inferPresentation(entry, entry.fields.map((f) => f.id))
    expect(p?.family).toBeDefined()
  })

  test('a rejected select lists the valid field ids', () => {
    const repair = selectRepair(index, { dataset_id: 'census-age-sex-dsd' })
    expect(String(repair.valid_fields)).toContain('population')
    expect(selectRepair(index, { dataset_id: 'remittances' }).did_you_mean).toContain('workers-remittances-monthly')
  })

  test('analyze_location hands off to district tables whose filters run', () => {
    const steps = analyzeNext(index, { id: 'LK-11', name: 'Colombo' })
    const selects = steps.filter((s) => s.tool === 'query_data')
    expect(selects.length).toBeGreaterThan(0)
    for (const step of selects) {
      const result = selectRows(table(String(step.arguments.dataset_id)), rowsInput(step.arguments))
      expect(result.total).toBeGreaterThan(0)
    }
  })
})
