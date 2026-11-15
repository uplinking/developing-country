import { describe, expect, test } from 'bun:test'
import { ApiError } from './errors'
import { ONTOLOGY, type EntityType } from './ontology'
import { queryData } from './queryData'
import type { Env } from './types'

const ARTIFACT = {
  schema_version: 1,
  dataset_id: 'test-indicators',
  country: 'LK',
  source_ids: ['test-table-source'],
  vintage: '2026',
  title: 'Test indicators',
  description: 'A Worker adapter fixture.',
  grain: 'One row per year and category.',
  primary_key: ['year', 'category'],
  fields: [
    { id: 'year', role: 'dimension', type: 'year', label: 'Year' },
    { id: 'category', role: 'dimension', type: 'string', label: 'Category' },
    { id: 'value', role: 'measure', type: 'number', label: 'Value', unit: 'index', aggregation: 'none' },
  ],
  rows: [
    { year: 2025, category: 'B', value: 12 },
    { year: 2024, category: 'A', value: 10 },
    { year: 2025, category: 'A', value: 11 },
  ],
}

const TABLE_ENTITY = {
  id: 'test_indicator_entity',
  source_ids: ['test-table-source'],
  dataset_ids: ['test-indicators'],
  title: 'Test indicators',
  description: 'Worker adapter fixture.',
  geometry: 'none',
  id_field: 'year',
  name_field: 'category',
  operators: [],
  related: [],
  completeness: {
    status: 'complete',
    coverage: 1,
    coverage_note: 'All fixture rows.',
    known_gaps: [],
  },
  provenance: {
    source: 'Fixture publisher',
    vintage: '2026',
    licence: 'test-only',
    refresh: 'test fixture',
  },
  searchable: false,
  storage: { kind: 'table', path: '/data/test-indicators.json' },
} as unknown as EntityType

function envWith(artifact: object | null, assetPath = '/data/test-indicators.json'): Env {
  return {
    ASSETS: {
      async fetch(request: Request) {
        const path = new URL(request.url).pathname
        if (path !== assetPath || artifact === null) return new Response('missing', { status: 404 })
        return Response.json(artifact)
      },
    },
  } as unknown as Env
}

async function withTableEntity<T>(run: () => Promise<T>, entity = TABLE_ENTITY): Promise<T> {
  ONTOLOGY.entities.push(entity)
  try {
    return await run()
  } finally {
    const index = ONTOLOGY.entities.indexOf(entity)
    if (index >= 0) ONTOLOGY.entities.splice(index, 1)
  }
}

async function apiError(run: () => Promise<unknown>): Promise<ApiError> {
  try {
    await run()
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError)
    return error as ApiError
  }
  throw new Error('expected an ApiError')
}

describe('queryData', () => {
  test('loads one ontology-registered table and returns a Data View-compatible result', async () => {
    await withTableEntity(async () => {
      const result = await queryData(envWith(ARTIFACT), {
        op: 'select',
        dataset_id: 'test-indicators',
        fields: ['year', 'value'],
        where: [{ field: 'category', op: 'eq', value: 'A' }],
        order_by: [{ field: 'year', direction: 'desc' }],
        limit: 1,
      })
      expect(result.rows).toEqual([{ year: 2025, value: 11 }])
      expect(result.features).toBe(result.rows)
      expect(result.count).toBe(1)
      expect(result.total_count).toBe(2)
      expect(result.truncated).toBe(true)
      expect(result.entities).toEqual(['test_indicator_entity'])
      expect(result.field_schema.map((field) => field.id)).toEqual(['year', 'value'])
      expect(result.web_url).toBe('https://developing-country.org/data/test-indicators')
    })
  })

  test('fails closed for unknown, non-table, missing, and mismatched datasets', async () => {
    expect((await apiError(() => queryData(envWith(ARTIFACT), {
      op: 'select', dataset_id: 'does-not-exist', fields: ['year'],
    }))).status).toBe(400)
    expect((await apiError(() => queryData(envWith(ARTIFACT), {
      op: 'select', dataset_id: 'demographics', fields: ['year'],
    }))).status).toBe(400)

    await withTableEntity(async () => {
      expect((await apiError(() => queryData(envWith(null), {
        op: 'select', dataset_id: 'test-indicators-missing', fields: ['year'],
      }))).status).toBe(503)
    }, {
      ...TABLE_ENTITY,
      id: 'test_indicator_missing',
      dataset_ids: ['test-indicators-missing'],
      storage: { kind: 'table', path: '/data/test-indicators-missing.json' },
    } as unknown as EntityType)

    const mismatchEntity = {
      ...TABLE_ENTITY,
      id: 'test_indicator_mismatch',
      dataset_ids: ['test-indicators-mismatch'],
      storage: { kind: 'table', path: '/data/test-indicators-mismatch.json' },
    } as unknown as EntityType
    await withTableEntity(async () => {
      const mismatch = { ...ARTIFACT, dataset_id: 'other-indicators' }
      const error = await apiError(() => queryData(envWith(mismatch, '/data/test-indicators-mismatch.json'), {
        op: 'select', dataset_id: 'test-indicators-mismatch', fields: ['year'],
      }))
      expect(error.status).toBe(500)
      expect(JSON.parse(error.message).error).toBe('dataset_artifact_mismatch')
    }, mismatchEntity)
  })

  test('turns strict row-query failures into a bounded 400 response', async () => {
    await withTableEntity(async () => {
      const error = await apiError(() => queryData(envWith(ARTIFACT), {
        op: 'select',
        dataset_id: 'test-indicators',
        fields: ['not_registered'],
      }))
      expect(error.status).toBe(400)
      expect(JSON.parse(error.message)).toEqual({
        error: 'invalid_query',
        issues: ['query.fields[0] is not a registered field'],
      })
    })
  })
})
