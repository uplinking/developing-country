import { describe, expect, mock, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { MapViewSpec, ChartViewSpec } from '@developing-country/views'
import { publicationIssues } from '../../apps/site/src/publicationEvidence'
import {
  DEFAULT_EDITOR_VIEWS_PER_HOUR,
  DEFAULT_VIEWS_PER_HOUR,
  createDataView,
  hourlyViewLimit,
} from './dataViews'
import { ApiError } from './errors'
import type { QuerySpatialResult } from './querySpatial'
import { AGENT_PREVIEW_ROWS, UI_PREVIEW_ROWS, previewSavedResult } from './resultPreview'
import { query, viewEvidence } from './service'
import type { Env, Identity } from './types'

mock.module('cloudflare:workers', () => ({ DurableObject: class {} }))

const ROOT = resolve(import.meta.dir, '../..')
const AUTHOR: Identity = { email: 'author@example.org', emailVerified: true, mode: 'user' }

interface Harness {
  env: Env
  rows: Map<string, Record<string, unknown>>
  setRecentViews(count: number): void
}

/** In-memory D1/R2/ASSETS: enough of each binding for createDataView + getDataView. */
function harness(vars: Partial<Env> = {}): Harness {
  const rows = new Map<string, Record<string, unknown>>()
  const objects = new Map<string, string>()
  let recentViews = 0
  const columns = [
    'id', 'query_id', 'owner_email', 'visibility', 'kind', 'country', 'title', 'spec_json', 'result_json',
    'result_path', 'result_bytes', 'result_checksum', 'dataset_version_ids', 'row_count', 'created_at',
  ]
  const db = {
    prepare(sql: string) {
      let values: unknown[] = []
      const statement = {
        bind(...next: unknown[]) {
          values = next
          return statement
        },
        async run() {
          if (sql.includes('INSERT INTO data_views')) {
            const row: Record<string, unknown> = Object.fromEntries(columns.map((column, index) => [column, values[index]]))
            row.revoked_at = null
            rows.set(String(row.id), row)
          }
          return { success: true, meta: { changes: 1 } }
        },
        async first() {
          if (sql.includes('COALESCE(SUM(CASE WHEN owner_email')) {
            return {
              owner_views: 0, owner_bytes: 0, recent_views: recentViews,
              platform_views: 0, platform_bytes: 0, platform_inline_bytes: 0,
            }
          }
          return rows.get(String(values[0])) ?? null
        },
      }
      return statement
    },
  }
  const env = {
    DB: db,
    VIEWS: {
      async put(key: string, value: string) { objects.set(key, value) },
      async get() { return null },
      async delete(key: string) { objects.delete(key) },
    },
    ASSETS: {
      async fetch(request: Request) {
        const path = new URL(request.url).pathname
        if (!path.startsWith('/data/') || path.includes('..')) return new Response('missing', { status: 404 })
        try {
          return new Response(await readFile(resolve(ROOT, 'public', path.slice(1))), {
            headers: { 'content-type': 'application/json' },
          })
        } catch {
          return new Response('missing', { status: 404 })
        }
      },
    },
    BETTER_AUTH_SECRET: 'test',
    PUBLIC_VIEW_ORIGIN: 'https://explore.developing-country.org',
    ...vars,
  } as unknown as Env
  return { env, rows, setRecentViews: (count) => { recentViews = count } }
}

async function failure(run: () => Promise<unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  try {
    await run()
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError)
    const { status, message } = error as ApiError
    try {
      return { status, body: JSON.parse(message) }
    } catch {
      return { status, body: { error: message } }
    }
  }
  throw new Error('expected an ApiError')
}

/** A select result over a manifest-versioned table, shaped like queryData's. */
function tableResult(rows: Record<string, unknown>[], overrides: Partial<QuerySpatialResult> = {}): QuerySpatialResult {
  return {
    op: 'select',
    result_kind: 'table',
    dataset_id: 'census-age-sex-dsd',
    entities: ['census_age_sex_dsd'],
    method: 'indicator_table_v1_select',
    generated_at: '2026-10-19T00:00:00.000Z',
    provenance: [{ source: 'DCS', vintage: '2024', licence: 'official', refresh: 'curated' }],
    completeness: [{ status: 'complete', coverage: 1, coverage_note: 'All rows.', known_gaps: [] }],
    summary: `${rows.length} rows`,
    count: rows.length,
    total_count: rows.length,
    truncated: false,
    rows,
    features: rows,
    web_url: 'https://developing-country.org/data/census-age-sex-dsd',
    stage: [],
    ...overrides,
  } as QuerySpatialResult
}

const spatialResult = (): QuerySpatialResult => ({
  op: 'gap',
  entities: ['gnd', 'metro_stop'],
  method: 'centroid_distance',
  generated_at: '2026-10-19T00:00:00.000Z',
  provenance: [{ source: 'DCS', vintage: '2024', licence: 'official', refresh: 'annual' }],
  completeness: [{ status: 'complete', coverage: 1, coverage_note: 'All rows.', known_gaps: [] }],
  summary: 'Two unserved GNDs',
  count: 2,
  truncated: false,
  features: [
    { id: 'LK-1127015', name: 'Kirulapone North', pop: 5400, dist_m: 950 },
    { id: 'LK-1127020', name: 'Pamankada East', pop: 4100, dist_m: 1200 },
  ],
  web_url: 'https://developing-country.org/',
  stage: [],
})

describe('presentation layers, annotations and highlight', () => {
  test('merges styled layers onto spatial result layers by id and keeps annotations', async () => {
    const { env } = harness()
    const created = await createDataView(env, AUTHOR, {
      kind: 'map',
      title: 'GNDs beyond a 10 minute walk',
      layers: [{
        id: 'gnd',
        label: 'Unserved GN divisions',
        style: { geometry: 'fill', colorBy: { field: 'pop', scale: 'sequential', label: 'Residents', unit: 'people' } },
        join: { tileset: 'demographics', sourceLayer: 'gnd', rowKey: 'id' },
        legend: true,
      }, { id: 'metro_stop', visible: false }],
      annotations: [{ id: 'fort', coordinates: [79.8428, 6.9344], text: 'Fort terminus', anchor: 'top' }],
    }, { op: 'gap' }, spatialResult())
    const view = created.view as MapViewSpec
    expect(view.layers).toEqual([
      {
        id: 'gnd',
        visible: true,
        label: 'Unserved GN divisions',
        style: { geometry: 'fill', colorBy: { field: 'pop', scale: 'sequential', label: 'Residents', unit: 'people' } },
        join: { tileset: 'demographics', sourceLayer: 'gnd', rowKey: 'id' },
        legend: true,
      },
      { id: 'metro_stop', visible: false },
    ])
    expect(view.annotations).toEqual([{ id: 'fort', coordinates: [79.8428, 6.9344], text: 'Fort terminus', anchor: 'top' }])
  })

  test('rejects presentation layers, style fields and annotations the result does not have', async () => {
    const { env } = harness()
    const unknownLayer = await failure(() => createDataView(env, AUTHOR, {
      kind: 'map', title: 'Wrong layer', layers: [{ id: 'district' }],
    }, { op: 'gap' }, spatialResult()))
    expect(unknownLayer).toMatchObject({ status: 422, body: { error: 'unknown_presentation_layer', valid_layer_ids: ['gnd', 'metro_stop'] } })

    const badField = await failure(() => createDataView(env, AUTHOR, {
      kind: 'map', title: 'Wrong field',
      layers: [{ id: 'gnd', style: { geometry: 'fill', colorBy: { field: 'households', scale: 'sequential' } }, join: { tileset: 'demographics', sourceLayer: 'gnd', rowKey: 'id' } }],
    }, { op: 'gap' }, spatialResult()))
    expect(badField).toMatchObject({ status: 422, body: { error: 'unknown_style_field', fields: ['households'] } })

    const duplicateNote = await failure(() => createDataView(env, AUTHOR, {
      kind: 'map', title: 'Duplicate notes',
      annotations: [
        { id: 'a', coordinates: [80, 7], text: 'One' },
        { id: 'a', coordinates: [80.1, 7], text: 'Two' },
      ],
    }, { op: 'gap' }, spatialResult()))
    expect(duplicateNote.body.error).toBe('duplicate_annotation')
  })

  test('carries chart highlight and rejects categories absent from the result', async () => {
    const { env } = harness()
    const rows = [
      { geography_name: 'Colombo', population: 292089 },
      { geography_name: 'Dehiwala', population: 240000 },
    ]
    const presentation = {
      kind: 'chart', title: 'Largest DSDs', family: 'ranking',
      dimension: { field: 'geography_name' }, measure: { field: 'population', unit: 'people' },
      orientation: 'horizontal', highlight: ['Colombo'],
    }
    const created = await createDataView(env, AUTHOR, presentation, { op: 'select' }, tableResult(rows))
    expect((created.view as ChartViewSpec).presentation?.highlight).toEqual(['Colombo'])
    const typo = await failure(() => createDataView(env, AUTHOR, { ...presentation, highlight: ['Colombmo'] }, { op: 'select' }, tableResult(rows)))
    expect(typo).toMatchObject({ status: 422, body: { error: 'unknown_highlight', values: ['Colombmo'] } })
  })
})

describe('maps from Indicator Table selects', () => {
  test('rows with numeric lng/lat become a circle layer named by the dataset id, framed by its points', async () => {
    const { env } = harness()
    const rows = [
      { geography_name: 'Fort', lng: 79.84, lat: 6.93, population: 10 },
      { geography_name: 'Kandy', lng: 80.63, lat: 7.29, population: 20 },
    ]
    const created = await createDataView(env, AUTHOR, {
      kind: 'map', title: 'Points',
      layers: [{ id: 'census-age-sex-dsd', style: { geometry: 'circle', radiusBy: { field: 'population', range: [3, 12] }, labelField: 'geography_name' } }],
    }, { op: 'select' }, tableResult(rows))
    const view = created.view as MapViewSpec
    expect(view.layers).toEqual([{
      id: 'census-age-sex-dsd',
      visible: true,
      style: { geometry: 'circle', radiusBy: { field: 'population', range: [3, 12] }, labelField: 'geography_name' },
    }])
    expect(view.camera.center[0]).toBeCloseTo(80.235)
    expect(view.camera.center[1]).toBeCloseTo(7.11)

    const unstyled = await createDataView(env, AUTHOR, { kind: 'map', title: 'Default points' }, { op: 'select' }, tableResult(rows))
    expect((unstyled.view as MapViewSpec).layers).toEqual([{ id: 'census-age-sex-dsd', visible: true, style: { geometry: 'circle' } }])
  })

  test('rows without coordinates need a tile join, and the join key must exist and be unique', async () => {
    const { env } = harness()
    const rows = [
      { geography_id: 'LK-1103', population: 292089 },
      { geography_id: 'LK-1106', population: 240000 },
    ]
    const join = { tileset: 'demographics', sourceLayer: 'dsd', rowKey: 'geography_id' } as const
    const created = await createDataView(env, AUTHOR, {
      kind: 'map', title: 'DSD population', layers: [{ id: 'census-age-sex-dsd', join }],
    }, { op: 'select' }, tableResult(rows))
    expect((created.view as MapViewSpec).layers).toEqual([{ id: 'census-age-sex-dsd', visible: true, style: { geometry: 'fill' }, join }])

    const noJoin = await failure(() => createDataView(env, AUTHOR, { kind: 'map', title: 'No geometry' }, { op: 'select' }, tableResult(rows)))
    expect(noJoin).toMatchObject({ status: 422, body: { error: 'map_requires_points_or_join' } })

    const missingKey = await failure(() => createDataView(env, AUTHOR, {
      kind: 'map', title: 'Wrong key', layers: [{ id: 'census-age-sex-dsd', join: { ...join, rowKey: 'gnd_id' } }],
    }, { op: 'select' }, tableResult(rows)))
    expect(missingKey.body.error).toBe('join_row_key_missing')

    const duplicate = await failure(() => createDataView(env, AUTHOR, {
      kind: 'map', title: 'Two years', layers: [{ id: 'census-age-sex-dsd', join }],
    }, { op: 'select' }, tableResult([...rows, { geography_id: 'LK-1103', population: 1 }])))
    expect(duplicate.body).toMatchObject({ error: 'join_row_key_not_unique', duplicate: 'LK-1103' })
  })

  test('warns when a saved map is truncated', async () => {
    const { env } = harness()
    const created = await createDataView(env, AUTHOR, {
      kind: 'map', title: 'Partial', layers: [{ id: 'census-age-sex-dsd', join: { tileset: 'demographics', sourceLayer: 'dsd', rowKey: 'geography_id' } }],
    }, { op: 'select' }, tableResult([{ geography_id: 'LK-1103', population: 1 }], { truncated: true, total_count: 340 } as Partial<QuerySpatialResult>))
    expect(created.warnings?.[0]).toContain('1 of 340')
  })
})

describe('end-to-end authoring through query_data', () => {
  test('saves a 340-row DSD choropleth and returns publication evidence the CMS gate accepts', async () => {
    const { env } = harness()
    const saved = await query(env, AUTHOR, {
      op: 'select',
      dataset_id: 'census-age-sex-dsd',
      fields: ['geography_id', 'geography_name', 'population'],
      where: [{ field: 'year', op: 'eq', value: 2024 }],
      limit: 1000,
      presentation: {
        kind: 'map',
        title: 'Population by Divisional Secretariat, 2024',
        layers: [{
          id: 'census-age-sex-dsd',
          label: 'Residents',
          style: { geometry: 'fill', colorBy: { field: 'population', scale: 'threshold', breaks: [50000, 100000, 200000], colors: ['#f1eee6', '#c9d8c5', '#7fa88a', '#2f6b4f'] } },
          join: { tileset: 'demographics', sourceLayer: 'dsd', rowKey: 'geography_id' },
        }],
      },
    }) as unknown as { rows: unknown[]; view_url: string; publication: unknown }
    expect(saved.rows.length).toBeGreaterThan(200)

    const publication = saved.publication as {
      dataView: { viewUrl: string; queryId: string; resultChecksum: string }
      datasetVersions: Array<{ datasetId: string; sourceIds: string[] }>
      sourceManifest: Array<{ sourceId: string; title: string; url: string }>
    }
    expect(publication.dataView.viewUrl).toBe(saved.view_url)
    expect(publication.datasetVersions.map((version) => version.datasetId)).toEqual(['census-age-sex-dsd'])
    expect(publication.datasetVersions[0]).not.toHaveProperty('completeness')
    expect(publication.sourceManifest.map((source) => source.sourceId)).toEqual(
      [...new Set(publication.datasetVersions.flatMap((version) => version.sourceIds))].sort(),
    )
    expect(publication).not.toHaveProperty('unresolvedSourceIds')

    const article = {
      format: 'analysis',
      country_code: 'LK',
      research_question: 'Where do Sri Lankans live by Divisional Secretariat?',
      methodology: 'Census 2024 DSD population, mapped by joining rows to DSD boundaries.',
      evidence_bundle: {
        version: 1,
        kind: 'platform-query',
        country: 'LK',
        generatedAt: '2026-10-19T00:00:00.000Z',
        datasetVersions: publication.datasetVersions,
        dataViews: [publication.dataView],
      },
      source_manifest: publication.sourceManifest,
      primary_view_url: publication.dataView.viewUrl,
      content: [{ _type: 'block', children: [{ _type: 'span', text: 'Evidence travels with the claim.' }] }],
    }
    expect(publicationIssues(article)).toEqual([])

    const viewId = saved.view_url.split('/').at(-1)!
    expect(await viewEvidence(env, viewId) as unknown).toEqual(saved.publication)
    expect(await viewEvidence(env, 'view_missing')).toBeNull()
    expect(await viewEvidence(env, '../etc')).toBeNull()
  })

  test('aggregates a table into a ranking chart in one call', async () => {
    const { env } = harness()
    const saved = await query(env, AUTHOR, {
      op: 'select',
      dataset_id: 'census-age-sex-dsd',
      where: [{ field: 'year', op: 'eq', value: 2024 }],
      group_by: ['district'],
      aggregates: [{ fn: 'sum', field: 'population', as: 'population' }, { fn: 'count', as: 'dsds' }],
      order_by: [{ field: 'population', direction: 'desc' }],
      limit: 25,
      presentation: {
        kind: 'chart', title: 'Population by district, 2024', family: 'ranking',
        dimension: { field: 'district' }, measure: { field: 'population', unit: 'people' },
        orientation: 'horizontal', highlight: ['Colombo'],
      },
    }) as unknown as { rows: Array<{ district: string; population: number }>; view: ChartViewSpec }
    expect(saved.rows[0]?.district).toBe('Gampaha')
    expect(saved.rows).toHaveLength(25)
    expect(saved.view.presentation?.highlight).toEqual(['Colombo'])
  })
})

describe('MCP discovery resources', () => {
  test('developing-country://evidence/{view_id} re-reads publication evidence for a saved view', async () => {
    const { readMcpResource } = await import('./mcp')
    const { env } = harness()
    const saved = await query(env, AUTHOR, {
      op: 'select', dataset_id: 'census-age-sex-dsd', fields: ['geography_name', 'population'], limit: 5,
      presentation: { kind: 'chart', title: 'Five DSDs', family: 'ranking', dimension: { field: 'geography_name' }, measure: { field: 'population' } },
    }) as unknown as { view_url: string; publication: unknown }
    const viewId = saved.view_url.split('/').at(-1)!
    const contents = await readMcpResource(`developing-country://evidence/${viewId}`, env)
    expect(JSON.parse(contents?.[0]?.text ?? 'null')).toEqual(saved.publication)
    expect(await readMcpResource('developing-country://evidence/view_unknown', env)).toBeNull()
  })

  test('the operators resource documents select limits, aggregation and map presentation', async () => {
    const { readMcpResource } = await import('./mcp')
    const contents = await readMcpResource('developing-country://operators', harness().env)
    const select = (JSON.parse(contents?.[0]?.text ?? '[]') as Array<Record<string, unknown>>).find((op) => op.id === 'select')
    expect(select?.limits).toMatchObject({ max_rows: 200, max_rows_with_presentation: 5000 })
    expect((select?.aggregation as { functions: string[] }).functions).toEqual(['sum', 'mean', 'min', 'max', 'count'])
    expect(select?.presentation).toHaveProperty('map')
  })
})

describe('agent preview of saved results', () => {
  test('trims saved rows for the agent and keeps unsaved results whole', () => {
    const rows = Array.from({ length: 300 }, (_, index) => ({ id: index }))
    const body = { view_url: 'https://explore.developing-country.org/views/view_x', rows, features: rows, total_count: 900 }
    const agent = previewSavedResult(body, AGENT_PREVIEW_ROWS)
    expect(agent.rows).toHaveLength(AGENT_PREVIEW_ROWS)
    expect(agent.features).toHaveLength(AGENT_PREVIEW_ROWS)
    expect(agent.rows_preview).toMatchObject({ shown: AGENT_PREVIEW_ROWS, saved: 300, total_matching: 900 })
    expect(previewSavedResult(body, UI_PREVIEW_ROWS).rows).toHaveLength(UI_PREVIEW_ROWS)
    const unsaved = { rows, features: rows }
    expect(previewSavedResult(unsaved, AGENT_PREVIEW_ROWS)).toBe(unsaved)
  })
})

describe('authoring quota', () => {
  test('defaults stay at 5/hour; editors and the DEV_AUTH user get the editor limit', () => {
    const base = harness().env
    expect(hourlyViewLimit(base, AUTHOR)).toBe(DEFAULT_VIEWS_PER_HOUR)
    expect(hourlyViewLimit({ ...base, VIEW_EDITOR_EMAILS: ' Editor@Example.org , other@example.org' }, { ...AUTHOR, email: 'editor@example.org' }))
      .toBe(DEFAULT_EDITOR_VIEWS_PER_HOUR)
    expect(hourlyViewLimit({ ...base, VIEW_EDITOR_EMAILS: 'editor@example.org' }, AUTHOR)).toBe(DEFAULT_VIEWS_PER_HOUR)
    expect(hourlyViewLimit(base, { email: 'dev@local', emailVerified: true, mode: 'dev' })).toBe(DEFAULT_EDITOR_VIEWS_PER_HOUR)
    expect(hourlyViewLimit({ ...base, VIEW_HOURLY_LIMIT: '8' }, AUTHOR)).toBe(8)
    expect(hourlyViewLimit({ ...base, VIEW_HOURLY_LIMIT: 'lots', VIEW_EDITOR_EMAILS: '' }, AUTHOR)).toBe(DEFAULT_VIEWS_PER_HOUR)
    expect(hourlyViewLimit({ ...base, VIEW_EDITOR_HOURLY_LIMIT: '25' }, { email: 'dev@local', emailVerified: true, mode: 'dev' })).toBe(25)
    expect(hourlyViewLimit({ ...base, VIEW_EDITOR_HOURLY_LIMIT: '999999' }, { email: 'dev@local', emailVerified: true, mode: 'dev' })).toBe(120)
  })

  test('enforces the resolved limit when saving', async () => {
    const standard = harness()
    standard.setRecentViews(DEFAULT_VIEWS_PER_HOUR)
    const presentation = { kind: 'map', title: 'Quota probe' }
    const limited = await failure(() => createDataView(standard.env, AUTHOR, presentation, { op: 'gap' }, spatialResult()))
    expect(limited.status).toBe(429)

    const editor = harness({ VIEW_EDITOR_EMAILS: AUTHOR.email })
    editor.setRecentViews(DEFAULT_VIEWS_PER_HOUR)
    expect((await createDataView(editor.env, AUTHOR, presentation, { op: 'gap' }, spatialResult())).view.title).toBe('Quota probe')
    editor.setRecentViews(DEFAULT_EDITOR_VIEWS_PER_HOUR)
    expect((await failure(() => createDataView(editor.env, AUTHOR, presentation, { op: 'gap' }, spatialResult()))).status).toBe(429)
  })
})

describe('snapshot byte cap', () => {
  test('fails with a typed 413 naming the limit', async () => {
    const { env } = harness()
    const rows = [{ geography_name: 'x', population: 1, blob: 'x'.repeat(5 * 1024 * 1024) }]
    const { status, body } = await failure(() => createDataView(env, AUTHOR, {
      kind: 'chart', title: 'Too big', family: 'ranking', dimension: { field: 'geography_name' }, measure: { field: 'population' },
    }, { op: 'select' }, tableResult(rows)))
    expect(status).toBe(413)
    expect(body).toMatchObject({ error: 'snapshot_too_large', limit_bytes: 8 * 1024 * 1024 })
    expect(String(body.message)).toContain('8 MiB snapshot limit')
  })
})
