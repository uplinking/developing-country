import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { selectRows, parseIndicatorTable } from '@developing-country/datasets'
import { chartForTable, dataPanelKind, errorText, nextSteps, rawFromResult, tableFields } from '../src/mcpData'
import { getLayerCatalog } from '../src/worker/catalog'
import { selectNext, slimCatalog, suggestedPresentation, type DatasetIndex } from '../src/worker/discovery'
import type { JsonObject } from '../src/shared/json'

const ROOT = resolve(import.meta.dir, '..')
const index = JSON.parse(readFileSync(resolve(ROOT, 'public/catalog/dataset-index.json'), 'utf8')) as DatasetIndex

/** A select result shaped like queryData's envelope, plus what the MCP handler adds. */
function selectResult(datasetId: string, fields: string[]): JsonObject {
  const table = parseIndicatorTable(JSON.parse(readFileSync(resolve(ROOT, 'public/data', `${datasetId}.json`), 'utf8')))
  const { rows, total, truncated } = selectRows(table, { fields, limit: 50 })
  const args = { op: 'select', dataset_id: datasetId, fields }
  const body: JsonObject = {
    op: 'select',
    result_kind: 'table',
    dataset_id: datasetId,
    rows: rows as JsonObject[],
    features: rows as JsonObject[],
    field_schema: table.fields.filter((f) => fields.includes(f.id)) as unknown as JsonObject[],
    total_count: total,
    truncated,
    country: 'LK',
    next: selectNext(index, args, { truncated, total_count: total, count: rows.length }) as unknown as JsonObject[],
  }
  const presentation = suggestedPresentation(index, args)
  return presentation ? { ...body, suggested_presentation: presentation } : body
}

describe('MCP App data routing', () => {
  test('routes catalog views and table results to the data panel, spatial results to the map', () => {
    expect(dataPanelKind({ view: 'index' })).toBe('index')
    expect(dataPanelKind({ view: 'dataset' })).toBe('dataset')
    expect(dataPanelKind({ op: 'select', result_kind: 'table' })).toBe('table')
    expect(dataPanelKind({ ...getLayerCatalog() } as unknown as JsonObject)).toBe('index')
    expect(dataPanelKind({ op: 'nearest', features: [] })).toBeNull()
    expect(dataPanelKind({ location: { lat: 1, lng: 2 }, summary: 'x' })).toBeNull()
  })

  test('reads the structured body or the text fallback', () => {
    expect(rawFromResult({ structuredContent: { view: 'index' } })?.view).toBe('index')
    expect(rawFromResult({ content: [{ type: 'text', text: '{"view":"search"}' }] })?.view).toBe('search')
  })

  test('the slim index renders as a browser', () => {
    const slim = slimCatalog(getLayerCatalog(), index) as unknown as JsonObject
    expect(dataPanelKind(slim)).toBe('index')
  })
})

describe('table preview chart', () => {
  test('builds a transient chart from the suggested presentation for a time series', () => {
    const raw = selectResult('workers-remittances-monthly', ['period', 'value_usd_million'])
    const chart = chartForTable(raw)
    expect(chart?.saved).toBe(false)
    expect(chart?.spec.intent.dimension.field).toBe('period')
    expect(chart?.spec.intent.measure.field).toBe('value_usd_million')
    expect(tableFields(raw).map((f) => f.id)).toEqual(['period', 'value_usd_million'])
  })

  test('declines to chart when no measure was selected', () => {
    const raw = selectResult('workers-remittances-monthly', ['period'])
    expect(chartForTable(raw)).toBeNull()
  })

  test('surfaces next steps and readable errors', () => {
    const raw = selectResult('census-age-sex-dsd', ['district', 'dsd', 'population'])
    expect(nextSteps(raw).length).toBeGreaterThan(0)
    expect(errorText({ error: 'invalid_query', issues: ['query.fields[0] is not a registered field'] })).toContain('registered field')
  })
})
