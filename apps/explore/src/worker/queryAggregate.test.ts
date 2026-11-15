import { describe, expect, test } from 'bun:test'
import { ApiError } from './errors'
import { ONTOLOGY, type EntityType } from './ontology'
import { PRESENTATION_MAX_ROWS, SELECT_MAX_ROWS, queryData } from './queryData'
import type { Env } from './types'

const ARTIFACT = {
  schema_version: 1,
  dataset_id: 'test-aggregate',
  country: 'LK',
  source_ids: ['test-aggregate-source'],
  vintage: '2026',
  title: 'Aggregate fixture',
  primary_key: ['gnd'],
  fields: [
    { id: 'district', role: 'dimension', type: 'string', label: 'District' },
    { id: 'gnd', role: 'dimension', type: 'string', label: 'GN division' },
    { id: 'population', role: 'measure', type: 'integer', label: 'Population', unit: 'people', aggregation: 'sum' },
    { id: 'share_pct', role: 'measure', type: 'number', label: 'Share', unit: '%', aggregation: 'none' },
  ],
  rows: [
    { district: 'Colombo', gnd: 'LK-1', population: 100, share_pct: 10 },
    { district: 'Colombo', gnd: 'LK-2', population: 300, share_pct: 30 },
    { district: 'Gampaha', gnd: 'LK-3', population: 400, share_pct: null },
    { district: 'Kalutara', gnd: 'LK-4', population: 50, share_pct: 5 },
    { district: 'Kalutara', gnd: 'LK-5', population: 350, share_pct: 15 },
    { district: null, gnd: 'LK-6', population: 1, share_pct: 1 },
  ],
}

const ENTITY = {
  id: 'test_aggregate_entity',
  source_ids: ['test-aggregate-source'],
  dataset_ids: ['test-aggregate'],
  title: 'Aggregate fixture',
  description: 'Worker aggregation fixture.',
  geometry: 'none',
  id_field: 'gnd',
  name_field: 'gnd',
  operators: ['select'],
  related: [],
  completeness: { status: 'complete', coverage: 1, coverage_note: 'All fixture rows.', known_gaps: [] },
  provenance: { source: 'Fixture', vintage: '2026', licence: 'test-only', refresh: 'test fixture' },
  searchable: false,
  storage: { kind: 'table', path: '/data/test-aggregate.json' },
} as unknown as EntityType

const env = {
  ASSETS: {
    async fetch(request: Request) {
      return new URL(request.url).pathname === '/data/test-aggregate.json'
        ? Response.json(ARTIFACT)
        : new Response('missing', { status: 404 })
    },
  },
} as unknown as Env

async function withEntity<T>(run: () => Promise<T>): Promise<T> {
  ONTOLOGY.entities.push(ENTITY)
  try {
    return await run()
  } finally {
    ONTOLOGY.entities.splice(ONTOLOGY.entities.indexOf(ENTITY), 1)
  }
}

async function failure(run: () => Promise<unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  try {
    await run()
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError)
    return { status: (error as ApiError).status, body: JSON.parse((error as ApiError).message) }
  }
  throw new Error('expected an ApiError')
}

describe('query_data select aggregation', () => {
  test('groups, aggregates with named outputs and orders deterministically', async () => {
    await withEntity(async () => {
      const result = await queryData(env, {
        op: 'select',
        dataset_id: 'test-aggregate',
        group_by: ['district'],
        aggregates: [
          { fn: 'sum', field: 'population', as: 'population' },
          { fn: 'mean', field: 'share_pct', as: 'mean_share' },
          { fn: 'min', field: 'population', as: 'smallest' },
          { fn: 'max', field: 'population', as: 'largest' },
          { fn: 'count', as: 'gnds' },
          { fn: 'count', field: 'share_pct', as: 'with_share' },
        ],
        order_by: [{ field: 'population', direction: 'desc' }],
      })
      expect(result.method).toBe('indicator_table_v1_aggregate')
      // Colombo and Kalutara tie on 400: the group key breaks the tie ascending; null groups sort last.
      expect(result.rows).toEqual([
        { district: 'Colombo', population: 400, mean_share: 20, smallest: 100, largest: 300, gnds: 2, with_share: 2 },
        { district: 'Gampaha', population: 400, mean_share: null, smallest: 400, largest: 400, gnds: 1, with_share: 0 },
        { district: 'Kalutara', population: 400, mean_share: 10, smallest: 50, largest: 350, gnds: 2, with_share: 2 },
        { district: null, population: 1, mean_share: 1, smallest: 1, largest: 1, gnds: 1, with_share: 1 },
      ])
      expect(result.total_count).toBe(4)
      expect(result.field_schema.map((field) => [field.id, field.role, field.type])).toEqual([
        ['district', 'dimension', 'string'],
        ['population', 'measure', 'number'],
        ['mean_share', 'measure', 'number'],
        ['smallest', 'measure', 'number'],
        ['largest', 'measure', 'number'],
        ['gnds', 'measure', 'integer'],
        ['with_share', 'measure', 'integer'],
      ])
      expect(result.field_schema[1]?.unit).toBe('people')
      expect(result.summary).toContain('4 of 4 matching groups')
    })
  })

  test('filters before grouping, totals without group_by, and pages groups by limit', async () => {
    await withEntity(async () => {
      const total = await queryData(env, {
        op: 'select',
        dataset_id: 'test-aggregate',
        where: [{ field: 'district', op: 'in', value: ['Colombo', 'Gampaha'] }],
        aggregates: [{ fn: 'sum', field: 'population', as: 'population' }],
      })
      expect(total.rows).toEqual([{ population: 800 }])

      const paged = await queryData(env, {
        op: 'select',
        dataset_id: 'test-aggregate',
        group_by: ['district'],
        aggregates: [{ fn: 'count', as: 'n' }],
        limit: 2,
      })
      expect(paged.rows.map((row) => row.district)).toEqual(['Colombo', 'Gampaha'])
      expect(paged.truncated).toBe(true)
    })
  })

  test('fails closed on unsummable fields, fields with aggregates, measures in group_by and unknown outputs', async () => {
    await withEntity(async () => {
      const base = { op: 'select', dataset_id: 'test-aggregate' }
      const cases = [
        { ...base, aggregates: [{ fn: 'sum', field: 'share_pct', as: 'x' }] },
        { ...base, group_by: ['population'], aggregates: [{ fn: 'count', as: 'n' }] },
        { ...base, aggregates: [{ fn: 'median', field: 'population', as: 'x' }] },
        { ...base, aggregates: [{ fn: 'count', as: 'district' }], group_by: ['district'] },
        { ...base, aggregates: [{ fn: 'count', as: 'n' }], order_by: [{ field: 'gnd', direction: 'asc' }] },
        { ...base, aggregates: [{ fn: 'mean', as: 'n' }] },
      ]
      for (const args of cases) {
        const { status, body } = await failure(() => queryData(env, args))
        expect(status).toBe(400)
        expect(body.error).toBe('invalid_query')
      }
      const mixed = await failure(() => queryData(env, { ...base, fields: ['district'], aggregates: [{ fn: 'count', as: 'n' }] }))
      expect(mixed.body.issues).toEqual([expect.stringContaining('fields must be omitted with aggregates')])
      const unsummable = await failure(() => queryData(env, { ...base, aggregates: [{ fn: 'sum', field: 'share_pct', as: 'x' }] }))
      expect(String((unsummable.body.issues as string[])[0])).toContain('not declared summable')
    })
  })
})

describe('query_data select row caps', () => {
  test('a plain select stays at 200 rows and names the presentation ceiling', async () => {
    await withEntity(async () => {
      const { status, body } = await failure(() => queryData(env, {
        op: 'select', dataset_id: 'test-aggregate', fields: ['gnd'], limit: SELECT_MAX_ROWS + 1,
      }))
      expect(status).toBe(400)
      expect(body).toMatchObject({
        error: 'row_limit_exceeded',
        max_rows: SELECT_MAX_ROWS,
        max_rows_with_presentation: PRESENTATION_MAX_ROWS,
      })
    })
  })

  test('a select being saved may request up to 5000 rows, never more', async () => {
    await withEntity(async () => {
      const saved = await queryData(env, {
        op: 'select', dataset_id: 'test-aggregate', fields: ['gnd'], limit: PRESENTATION_MAX_ROWS,
      }, { maxRows: PRESENTATION_MAX_ROWS })
      expect(saved.rows).toHaveLength(ARTIFACT.rows.length)
      const over = await failure(() => queryData(env, {
        op: 'select', dataset_id: 'test-aggregate', fields: ['gnd'], limit: PRESENTATION_MAX_ROWS + 1,
      }, { maxRows: 1_000_000 }))
      expect(over.body).toMatchObject({ error: 'row_limit_exceeded', max_rows: PRESENTATION_MAX_ROWS })
    })
  })
})
