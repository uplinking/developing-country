import { test, expect } from 'bun:test'
import { MemoryStore } from '../../packages/ingestion/src/testStore'
import { ingest, type ApiAdapter } from '../../packages/ingestion/src/pipeline'
import { POWER_ID, normalizePower, tableFor } from '../../packages/ingestion/src/electricity'
import { readLatest } from '../../packages/ingestion/src/storage'
import { queryData } from './queryData'
import { serveScheduledData } from './scheduledData'
import { overlayRuntimeCatalog } from './scheduledCatalog'
import { getLayerCatalog } from './catalog'
import type { Env } from './types'

const adapter: ApiAdapter = {
  id: 'nso-generation-api', datasetIds: [POWER_ID], startDate: '2026-09-11', timeZone: 'Asia/Colombo', lookbackDays: 3, backfillDaysPerRun: 3, maxResponseBytes: 10000,
  requests: date => [{ id: 'power', url: `https://example.test/?date=${date}` }],
  normalize: (date, payload) => [tableFor(POWER_ID, normalizePower(payload.power, date))],
}
const upstream = (mw: number) => (async (url: string) => Response.json([{ DateTime: `${new URL(url).searchParams.get('date')} 18:45:00`, BESS: mw }])) as typeof fetch
const query = { op: 'select', dataset_id: POWER_ID, fields: ['timestamp', 'bess_mw'], limit: 200 }
test('runtime queries, catalogue, and previews use archived versions; pinned reads survive revisions', async () => {
  const store = new MemoryStore()
  const env = { DATASETS: store } as unknown as Env
  await ingest(store, adapter, new Date('2026-09-13T02:00:00Z'), upstream(10))
  const first = (await readLatest(store, adapter.id))!.datasets[0]!
  const result = await queryData(env, query)
  expect(result.rows.length).toBe(2)
  expect(result.dataset_versions![0]!.versionId).toBe(first.versionId)
  expect(result.provenance[0]!.vintage).toBe(first.vintage)
  const catalog = await overlayRuntimeCatalog(getLayerCatalog(), store)
  expect(catalog.layers.find(layer => layer.dataset_ids.includes(POWER_ID))!.vintage).toBe(first.vintage)
  const path = `/api/datasets/${POWER_ID}`
  const preview = await serveScheduledData(new Request(`https://example.test${path}`), env, path)
  const body = await preview.json() as { reportDate: string; table: { rows: unknown[] }; version: { versionId: string } }
  expect(body.reportDate).toBe('2026-09-12')
  expect(body.table.rows.length).toBe(1)
  expect(body.version.versionId).toBe(first.versionId)
  await ingest(store, adapter, new Date('2026-09-13T02:00:00Z'), upstream(12))
  const pinned = await queryData(env, { ...query, version_id: first.versionId })
  expect(pinned.rows[0]!.bess_mw).toBe(10)
  expect((await queryData(env, query)).rows[0]!.bess_mw).toBe(12)
  const filtered = await queryData(env, { ...query, where: [{ field: 'report_date', op: 'eq', value: '2026-09-11' }] })
  expect(filtered.rows.length).toBe(1)
  expect((await serveScheduledData(new Request(`https://example.test${path}`, { method: 'POST' }), env, path)).status).toBe(405)
})
