import { parseIndicatorTable, type IndicatorTableV1 } from '../../datasets/src/table'
import { digest, latestKey, readLatest, readJson, readTable, tableSchema, type DatasetSnapshot, type SourceSnapshot, type Partition, type ObjectRef } from './storage'

export interface ApiAdapter {
  id: string; datasetIds: readonly string[]; startDate: string; timeZone: string;
  lookbackDays: number; backfillDaysPerRun: number; maxResponseBytes: number;
  requests(date: string): { id: string; url: string }[];
  normalize(date: string, responses: Record<string, unknown>): IndicatorTableV1[];
}
export interface Store {
  get(key: string): Promise<{ etag: string; arrayBuffer(): Promise<ArrayBuffer> } | null>;
  put(key: string, value: string, options?: { onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string } }): Promise<unknown | null>;
}
const shift = (date: string, days: number) => new Date(Date.parse(date) + days * 86400000).toISOString().slice(0, 10)
function sourceDate(adapter: ApiAdapter, now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: adapter.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const part = (type: string) => parts.find(p => p.type === type)!.value
  return `${part('year')}-${part('month')}-${part('day')}`
}
export function plannedDates(adapter: ApiAdapter, previous: SourceSnapshot | null, now: Date): string[] {
  const yesterday = shift(sourceDate(adapter, now), -1)
  const coverage = adapter.datasetIds.map(id => new Set(previous?.datasets.find(dataset => dataset.datasetId === id)?.partitions.map(p => p.date)))
  const dates = new Set<string>()
  // Revisit recent reports for upstream corrections; never ingest an unfinished day.
  for (let i = 0; i < adapter.lookbackDays; i++) {
    const date = shift(yesterday, -i)
    if (date >= adapter.startDate) dates.add(date)
  }
  const missing: string[] = []
  for (let date = adapter.startDate; date <= yesterday; date = shift(date, 1)) {
    if (!coverage.every(dates => dates.has(date)) && !dates.has(date)) missing.push(date)
  }
  // Rotate retries so a permanently absent early report cannot starve later gaps.
  const batches = Math.ceil(missing.length / adapter.backfillDaysPerRun)
  const offset = batches ? (Math.floor(now.getTime() / 21600000) % batches) * adapter.backfillDaysPerRun : 0
  missing.slice(offset, offset + adapter.backfillDaysPerRun).forEach(date => dates.add(date))
  return [...dates].sort()
}
async function immutable(store: Store, prefix: string, body: string): Promise<ObjectRef> {
  const checksum = await digest(body)
  const key = `${prefix}/${checksum.slice(7)}.json`
  await store.put(key, body, { onlyIf: { etagDoesNotMatch: '*' } })
  return { key, checksum }
}
async function boundedBody(response: Response, limit: number): Promise<string> {
  if (!response.ok) throw new Error(`upstream_http_${response.status}`)
  if (!response.body) throw new Error('empty_upstream_body')
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break
      size += value.byteLength
      if (size > limit) throw new Error('upstream_response_too_large')
      chunks.push(value)
    }
  } finally { await reader.cancel() }
  const bytes = new Uint8Array(size); let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return new TextDecoder().decode(bytes)
}
async function recordRun(store: Store, prefix: string, runKey: string, run: { startedAt: string; [key: string]: unknown }) {
  await store.put(runKey, JSON.stringify(run))
  const key = `${prefix}/status.json`
  const old = await store.get(key)
  const prior = old ? JSON.parse(new TextDecoder().decode(await old.arrayBuffer())) : null
  if (prior && prior.startedAt > run.startedAt) return
  await store.put(key, JSON.stringify(run), { onlyIf: old ? { etagMatches: old.etag } : { etagDoesNotMatch: '*' } })
}
export async function ingest(store: Store, adapter: ApiAdapter, now = new Date(), fetcher: typeof fetch = fetch, requestedDates?: string[]) {
  const prefix = `ingestion/v1/${adapter.id}`
  const runKey = `${prefix}/runs/${now.toISOString()}-${crypto.randomUUID()}.json`
  const startedAt = new Date().toISOString()
  await store.put(runKey, JSON.stringify({ sourceId: adapter.id, startedAt, status: 'running' }))
  const failures: { date: string; reason: string }[] = []
  try {
    const base = await store.get(latestKey(adapter.id))
    const previous = await readLatest(store, adapter.id)
    const dates = requestedDates ?? plannedDates(adapter, previous, now)
    if (requestedDates && (dates.length > 31 || new Set(dates).size !== dates.length || dates.some(date => !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || shift(date, 0) !== date || date < adapter.startDate || date >= sourceDate(adapter, now)))) {
      throw new Error('invalid_backfill_dates')
    }
    const byDataset = new Map(adapter.datasetIds.map(id => [id, new Map((previous?.datasets.find(d => d.datasetId === id)?.partitions ?? []).map(p => [p.date, p]))]))
    const schemas = new Map<string, string>()
    for (const dataset of previous?.datasets ?? []) {
      if (adapter.datasetIds.includes(dataset.datasetId)) {
        const table = await readTable(store, dataset, [dataset.partitions.at(-1)!.date])
        schemas.set(dataset.datasetId, tableSchema(table))
      }
    }
    const accepted: string[] = []
    for (const date of dates) {
      try {
        const responses: Record<string, unknown> = {}
        for (const request of adapter.requests(date)) {
          const body = await boundedBody(await fetcher(request.url, { signal: AbortSignal.timeout(25000) }), adapter.maxResponseBytes)
          const raw = await immutable(store, `${prefix}/raw/${date}/${request.id}`, body)
          await immutable(store, `${prefix}/receipts/${date}`, JSON.stringify({ ...raw, url: request.url, retrievedAt: startedAt }))
          responses[request.id] = JSON.parse(body)
        }
        const tables = adapter.normalize(date, responses).map(parseIndicatorTable)
        if (tables.length !== adapter.datasetIds.length || new Set(tables.map(t => t.dataset_id)).size !== tables.length || tables.some(t => !adapter.datasetIds.includes(t.dataset_id) || t.country !== 'LK' || t.source_ids.join() !== adapter.id || !t.rows.length || t.rows.some(row => row.report_date !== date))) throw new Error('adapter_contract_mismatch')
        for (const table of tables) {
          const expected = schemas.get(table.dataset_id)
          if (expected !== undefined && expected !== tableSchema(table)) throw new Error('incompatible_dataset_schema: register a new dataset for changed fields or units')
        }
        // Stage every table first: a failed second write must not publish half a report.
        const staged: { id: string; partition: Partition }[] = []
        for (const table of tables) {
          const ref = await immutable(store, `${prefix}/tables/${table.dataset_id}/${date}`, JSON.stringify(table))
          staged.push({ id: table.dataset_id, partition: { ...ref, date, rowCount: table.rows.length } })
        }
        for (const item of staged) byDataset.get(item.id)!.set(date, item.partition)
        for (const table of tables) schemas.set(table.dataset_id, tableSchema(table))
        accepted.push(date)
      } catch (error) {
        failures.push({ date, reason: error instanceof Error ? error.message : 'ingestion_failed' })
      }
    }
    const datasets = []
    for (const [datasetId, parts] of byDataset) {
      const partitions = [...parts.values()].sort((a, b) => a.date.localeCompare(b.date))
      if (!partitions.length) continue
      const content = { datasetId, country: 'LK' as const, sourceIds: [adapter.id], partitions }
      const checksum = await digest(JSON.stringify(content))
      const old = previous?.datasets.find(d => d.datasetId === datasetId && d.checksum === checksum)
      let version = old ?? { ...content, checksum, versionId: `dsv_${checksum.slice(7, 39)}`,
        vintage: `${partitions[0]!.date}–${partitions.at(-1)!.date}`, refreshedAt: startedAt,
        rowCount: partitions.reduce((n, p) => n + p.rowCount, 0) }
      const versionKey = `${prefix}/versions/${datasetId}/${version.versionId}.json`
      const created = await store.put(versionKey, JSON.stringify(version), { onlyIf: { etagDoesNotMatch: '*' } })
      if (!created) version = await readJson(store, versionKey) as DatasetSnapshot
      if (!version || version.checksum !== checksum) throw new Error('immutable_version_conflict')
      datasets.push(version)
    }
    const changed = accepted.length && datasets.some(d => previous?.datasets.find(p => p.datasetId === d.datasetId)?.versionId !== d.versionId)
    if (changed) {
      const snapshot: SourceSnapshot = { schemaVersion: 1, sourceId: adapter.id, publishedAt: startedAt, datasets }
      const ref = await immutable(store, `${prefix}/manifests`, JSON.stringify(snapshot))
      const committed = await store.put(latestKey(adapter.id), JSON.stringify(ref), { onlyIf: base ? { etagMatches: base.etag } : { etagDoesNotMatch: '*' } })
      if (!committed) throw new Error('concurrent_publication_retry_next_run')
    }
    const status = failures.length ? (accepted.length ? 'partial' : 'failed') : 'succeeded'
    const run = { sourceId: adapter.id, startedAt, finishedAt: new Date().toISOString(), status, dates, accepted, failures, changed: !!changed }
    await recordRun(store, prefix, runKey, run)
    console.log(JSON.stringify(run))
    if (status === 'failed') throw new Error('all_report_dates_failed')
    return run
  } catch (error) {
    await recordRun(store, prefix, runKey, { sourceId: adapter.id, startedAt, finishedAt: new Date().toISOString(), status: 'failed', failures, reason: error instanceof Error ? error.message : 'ingestion_failed' })
    throw error
  }
}
