import { describe, expect, test } from 'bun:test'
import { isDataViewUrl } from '@developing-country/views'
import { liveViewUrlFromNode } from '../../packages/emdash-blocks/src/live-view'
import {
  createDataView,
  getDataView,
  getDataViewResult,
  revokeDataView,
  sha256,
} from './dataViews'
import type { QuerySpatialResult } from './querySpatial'
import type { Env } from './types'

interface StoredRow {
  id: string
  query_id: string
  owner_email: string
  visibility: 'link' | 'public'
  kind: 'map' | 'chart'
  country: string
  title: string
  spec_json: string
  result_json: string | null
  result_path: string | null
  result_bytes: number
  result_checksum: string
  dataset_version_ids: string
  row_count: number
  created_at: string
  revoked_at: string | null
}

interface MemoryHarness {
  env: Env
  objects: Map<string, { value: string; customMetadata?: Record<string, string> }>
  row: () => StoredRow | null
}

function memoryHarness(): MemoryHarness {
  let row: StoredRow | null = null
  const objects = new Map<string, string>()
  const db = {
    prepare(sql: string) {
      let values: unknown[] = []
      const statement = {
        bind(...next: unknown[]) {
          values = next
          return statement
        },
        async run() {
          if (sql.startsWith('INSERT INTO data_views')) {
            row = {
              id: String(values[0]),
              query_id: String(values[1]),
              owner_email: String(values[2]),
              visibility: values[3] as StoredRow['visibility'],
              kind: values[4] as StoredRow['kind'],
              country: String(values[5]),
              title: String(values[6]),
              spec_json: String(values[7]),
              result_json: values[8] === null ? null : String(values[8]),
              result_path: values[9] === null ? null : String(values[9]),
              result_bytes: Number(values[10]),
              result_checksum: String(values[11]),
              dataset_version_ids: String(values[12]),
              row_count: Number(values[13]),
              created_at: String(values[14]),
              revoked_at: null,
            }
            return { success: true, meta: { changes: 1 } }
          }
          if (sql.startsWith('UPDATE data_views SET revoked_at')) {
            if (row && row.id === values[1] && row.owner_email === values[2] && row.revoked_at === null) {
              row.revoked_at = String(values[0])
              return { success: true, meta: { changes: 1 } }
            }
            return { success: true, meta: { changes: 0 } }
          }
          return { success: true, meta: { changes: 0 } }
        },
        async first() {
          if (sql.includes('COALESCE(SUM(CASE WHEN owner_email')) {
            return {
              owner_views: 0,
              owner_bytes: 0,
              recent_views: 0,
              platform_views: 0,
              platform_bytes: 0,
              platform_inline_bytes: 0,
            }
          }
          if (sql.includes('SELECT result_path FROM data_views')) {
            return row && row.id === values[0] && row.owner_email === values[1] && row.revoked_at === null
              ? { result_path: row.result_path }
              : null
          }
          return row && row.id === values[0] ? row : null
        },
      }
      return statement
    },
  }
  const views = {
    async put(
      key: string,
      value: string,
      options?: { customMetadata?: Record<string, string> },
    ) { objects.set(key, { value, customMetadata: options?.customMetadata }) },
    async get(key: string) {
      const stored = objects.get(key)
      if (stored === undefined) return null
      return {
        body: new Response(stored.value).body,
        size: new TextEncoder().encode(stored.value).byteLength,
        customMetadata: stored.customMetadata,
      }
    },
    async delete(key: string) { objects.delete(key) },
  }
  const env = {
    DB: db,
    VIEWS: views,
    BETTER_AUTH_SECRET: 'test',
    BETTER_AUTH_URL: 'https://developing-country.org',
    PUBLIC_VIEW_ORIGIN: 'https://explore.developing-country.org',
  } as unknown as Env
  return { env, objects, row: () => row }
}

function result(overrides: Partial<QuerySpatialResult> = {}): QuerySpatialResult {
  return {
    op: 'gap',
    entities: ['gnd', 'metro_stop'],
    method: 'centroid_distance',
    generated_at: '2026-08-26T01:00:00.000Z',
    provenance: [
      { source: 'Department of Census and Statistics', vintage: '2024', licence: 'official', refresh: 'annual' },
    ],
    completeness: [
      { status: 'complete', coverage: 1, coverage_note: 'All published rows.', known_gaps: [] },
    ],
    summary: 'One aggregate result',
    count: 1,
    truncated: false,
    features: [],
    aggregates: { population_unserved: 123 },
    web_url: 'https://developing-country.org/',
    stage: [],
    ...overrides,
  }
}

describe('durable live views', () => {
  test('persists the runtime Dataset Version supplied by the query', async () => {
    const { env } = memoryHarness()
    const runtime = {
      datasetId: 'electricity-generation-quarter-hourly', versionId: 'dsv_' + 'a'.repeat(32),
      country: 'LK' as const, sourceIds: ['nso-generation-api'], vintage: '2026-09-11–2026-09-12',
      refreshedAt: '2026-09-13T00:00:00.000Z', checksum: 'sha256:' + 'a'.repeat(64),
      completeness: { status: 'partial' as const, coverage: null, coverageNote: 'Archived observations.', knownGaps: [] },
    }
    const created = await createDataView(env,
      { email: 'Researcher@Example.com', emailVerified: true, mode: 'user' },
      { kind: 'chart', title: 'Battery power', family: 'comparison', dimension: { field: 'label' }, measure: { field: 'population_unserved' } },
      { op: 'select' }, result({ dataset_versions: [runtime] }))
    expect(created.view.evidence.datasetVersions).toEqual([runtime])
  })

  test('persists a checksummed result with real Dataset Versions', async () => {
    const { env, objects, row } = memoryHarness()
    const created = await createDataView(
      env,
      { email: 'Researcher@Example.com', emailVerified: true, mode: 'user' },
      {
        kind: 'chart',
        title: 'Population outside metro access',
        family: 'comparison',
        dimension: { field: 'label' },
        measure: { field: 'population_unserved', unit: 'people' },
      },
      { op: 'gap' },
      result(),
    )
    expect(created.view.data.rowCount).toBe(1)
    expect(created.view.data.resultChecksum).toBe(await sha256(created.result))
    expect(created.view.evidence.datasetVersions.map((version) => version.datasetId)).toEqual([
      'demographics',
      'metro',
    ])
    expect(created.view.evidence.datasetVersions.every((version) => version.versionId.startsWith('dsv_'))).toBe(true)
    expect(created.view.evidence.datasetVersions.some((version) => version.versionId === created.view.data.queryId)).toBe(false)
    expect(JSON.parse(row()?.dataset_version_ids ?? '[]')).toEqual(
      created.view.evidence.datasetVersions.map((version) => version.versionId),
    )
    expect(row()?.result_path).toBeNull()
    expect(objects.size).toBe(0)
    expect(created.view_url).toBe(`https://explore.developing-country.org/views/${created.view.id}`)
    expect(isDataViewUrl(created.view_url)).toBe(true)
    expect(liveViewUrlFromNode({ id: created.view_url })).toBe(created.view_url)

    const resolved = await getDataView(env, created.view.id)
    expect(resolved?.view).toEqual(created.view)
    expect(resolved?.result).toEqual(created.result)
  })

  test('keeps a large geometry byte-for-byte in R2 and resolves it by checksum URL', async () => {
    const { env, objects, row } = memoryHarness()
    const hugeGeometry = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: null, properties: { blob: 'x'.repeat(800 * 1024) } }],
    } as QuerySpatialResult['geometry']
    const created = await createDataView(
      env,
      { email: 'researcher@example.com', emailVerified: true, mode: 'user' },
      { kind: 'map', title: 'Bounded geometry view' },
      { op: 'gap' },
      result({ geometry: hugeGeometry }),
    )
    expect(created.result?.geometry).toEqual(hugeGeometry)
    expect(row()?.result_json).toBeNull()
    expect(objects.has(row()?.result_path ?? '')).toBe(true)

    const metadata = await getDataView(env, created.view.id)
    expect(metadata?.result).toBeNull()
    const hash = created.view.data.resultChecksum.replace('sha256:', '')
    const response = await getDataViewResult(env, created.view.id, hash)
    expect(response?.headers.get('Cache-Control')).toBe('public, max-age=300, must-revalidate')
    expect(response?.headers.get('ETag')).toBe(`"${created.view.data.resultChecksum}"`)
    expect(await response?.json()).toEqual(created.result)
    expect((await getDataViewResult(env, created.view.id, hash, `"${created.view.data.resultChecksum}"`))?.status).toBe(304)
  })

  test('does not render a view whose stored country is unregistered', async () => {
    const { env, row } = memoryHarness()
    const created = await createDataView(
      env,
      { email: 'researcher@example.com', emailVerified: true, mode: 'user' },
      { kind: 'map', title: 'Country-bound view' },
      { op: 'gap', country: 'LK' },
      result(),
    )
    const stored = row()
    if (!stored) throw new Error('expected a stored data view')
    stored.country = 'IN'
    expect(await getDataView(env, created.view.id)).toBeNull()
    const hash = created.view.data.resultChecksum.replace('sha256:', '')
    expect(await getDataViewResult(env, created.view.id, hash)).toBeNull()
  })

  test('rejects any mismatch between the immutable row and its spec', async () => {
    const { env, row } = memoryHarness()
    const created = await createDataView(
      env,
      { email: 'researcher@example.com', emailVerified: true, mode: 'user' },
      { kind: 'map', title: 'Row-bound view' },
      { op: 'gap' },
      result(),
    )
    const stored = row()
    if (!stored) throw new Error('expected a stored data view')
    stored.query_id = 'query_tampered'
    expect(await getDataView(env, created.view.id)).toBeNull()
    const hash = created.view.data.resultChecksum.replace('sha256:', '')
    expect(await getDataViewResult(env, created.view.id, hash)).toBeNull()
  })

  test('refuses an R2 object whose metadata no longer matches the claim', async () => {
    const { env, objects, row } = memoryHarness()
    const hugeGeometry = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: null, properties: { blob: 'x'.repeat(800 * 1024) } }],
    } as QuerySpatialResult['geometry']
    const created = await createDataView(
      env,
      { email: 'researcher@example.com', emailVerified: true, mode: 'user' },
      { kind: 'map', title: 'Metadata-bound result' },
      { op: 'gap' },
      result({ geometry: hugeGeometry }),
    )
    const stored = row()
    if (!stored?.result_path) throw new Error('expected an R2-backed data view')
    const object = objects.get(stored.result_path)
    if (!object) throw new Error('expected a stored R2 object')
    object.customMetadata = { checksum: `sha256:${'0'.repeat(64)}`, viewId: created.view.id }
    const hash = created.view.data.resultChecksum.replace('sha256:', '')
    expect(await getDataViewResult(env, created.view.id, hash)).toBeNull()
  })

  test('validates the public origin before writing storage', async () => {
    const { env, objects, row } = memoryHarness()
    env.PUBLIC_VIEW_ORIGIN = 'https://explore.developing-country.org/not-an-origin'
    await expect(
      createDataView(
        env,
        { email: 'researcher@example.com', emailVerified: true, mode: 'user' },
        { kind: 'map', title: 'Misconfigured view' },
        { op: 'gap' },
        result(),
      ),
    ).rejects.toThrow('PUBLIC_VIEW_ORIGIN must be a valid origin')
    expect(objects.size).toBe(0)
    expect(row()).toBeNull()
  })

  test('rejects chart fields that cannot render the result', async () => {
    const env = memoryHarness().env
    await expect(
      createDataView(
        env,
        { email: 'researcher@example.com', emailVerified: true, mode: 'user' },
        {
          kind: 'chart',
          title: 'Broken chart',
          family: 'comparison',
          dimension: { field: 'missing_dimension' },
          measure: { field: 'population_unserved' },
        },
        { op: 'gap' },
        result(),
      ),
    ).rejects.toThrow('chart dimension field does not exist')
    await expect(
      createDataView(
        env,
        { email: 'researcher@example.com', emailVerified: true, mode: 'user' },
        {
          kind: 'chart',
          title: 'Broken measure',
          family: 'comparison',
          dimension: { field: 'label' },
          measure: { field: 'summary' },
        },
        { op: 'gap' },
        result(),
      ),
    ).rejects.toThrow('chart measure field has no finite numeric values')
  })

  test('rejects a snapshot over 8 MiB without leaving an R2 object', async () => {
    const { env, objects } = memoryHarness()
    await expect(
      createDataView(
        env,
        { email: 'researcher@example.com', emailVerified: true, mode: 'user' },
        { kind: 'chart', title: 'Oversized result', family: 'ranking', dimension: { field: 'name' }, measure: { field: 'value' } },
        { op: 'gap' },
        result({ features: [{ name: 'oversized', value: 'x'.repeat(8 * 1024 * 1024) }], aggregates: undefined }),
      ),
    ).rejects.toThrow('live view result exceeds the 8 MiB snapshot limit')
    expect(objects.size).toBe(0)
  })

  test('rejects a persistent view when any result entity lacks a Dataset Version', async () => {
    await expect(
      createDataView(
        memoryHarness().env,
        { email: 'researcher@example.com', emailVerified: true, mode: 'user' },
        { kind: 'map', title: 'Live prospects only' },
        { op: 'bbox' },
        result({ entities: ['gnd', 'prospects'] }),
      ),
    ).rejects.toThrow('unversioned: prospects')
  })

  test('requires a verified account for persistent storage', async () => {
    await expect(
      createDataView(
        memoryHarness().env,
        { email: 'unverified@example.com', emailVerified: false, mode: 'user' },
        { kind: 'map', title: 'Unverified result' },
        { op: 'gap' },
        result(),
      ),
    ).rejects.toThrow('sign in with Google or GitHub')
  })

  test('only the owner can revoke a view and revoked results return 410', async () => {
    const { env, objects, row } = memoryHarness()
    const created = await createDataView(
      env,
      { email: 'owner@example.com', emailVerified: true, mode: 'user' },
      { kind: 'map', title: 'Revocable result' },
      { op: 'gap' },
      result(),
    )
    expect(await revokeDataView(env, { email: 'other@example.com', emailVerified: true, mode: 'user' }, created.view.id)).toBe(false)
    expect(await revokeDataView(env, { email: 'OWNER@example.com', emailVerified: true, mode: 'user' }, created.view.id)).toBe(true)
    expect(objects.has(row()?.result_path ?? '')).toBe(false)
    expect((await getDataView(env, created.view.id))?.revoked_at).toBeString()
    const hash = created.view.data.resultChecksum.replace('sha256:', '')
    expect((await getDataViewResult(env, created.view.id, hash))?.status).toBe(410)
  })

  test('rejects presentation fields that bypass the MCP schema', async () => {
    await expect(
      createDataView(
        memoryHarness().env,
        { email: 'researcher@example.com', emailVerified: true, mode: 'user' },
        { kind: 'map', title: 'x'.repeat(161), renderer: 'raw-maplibre' },
        { op: 'gap' },
        result(),
      ),
    ).rejects.toThrow('invalid_presentation')
  })

  test('checksums object key order canonically', async () => {
    expect(await sha256({ b: 2, a: { d: 4, c: 3 } })).toBe(
      await sha256({ a: { c: 3, d: 4 }, b: 2 }),
    )
  })
})
