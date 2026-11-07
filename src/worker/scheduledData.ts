import { sourceForDataset } from '../../packages/ingestion/src/registry'
import { readLatest, readJson, readTable, digest, versionEvidence, type DatasetSnapshot } from '../../packages/ingestion/src/storage'
import { indicatorPreset, selectRows } from '@developing-country/datasets'
import type { Env } from './types'
import { ApiError } from './errors'

export async function runtimeVersion(env: Env, id: string, pinned?: string): Promise<DatasetSnapshot | null> {
  const source = sourceForDataset(id)
  if (!source || !env.DATASETS) return null
  let version: DatasetSnapshot | undefined | null
  if (pinned) {
    if (!/^dsv_[a-f0-9]{32}$/.test(pinned)) throw new ApiError(400, 'Invalid dataset version')
    version = await readJson(env.DATASETS, `ingestion/v1/${source.id}/versions/${id}/${pinned}.json`) as DatasetSnapshot | null
    if (!version) throw new ApiError(404, 'Dataset version not found')
  } else version = (await readLatest(env.DATASETS, source.id))?.datasets.find(d => d.datasetId === id)
  if (!version) return null
  const checksum = await digest(JSON.stringify({ datasetId: version.datasetId, country: version.country, sourceIds: version.sourceIds, partitions: version.partitions }))
  if (version.datasetId !== id || version.country !== 'LK' || version.sourceIds.join() !== source.id ||
    checksum !== version.checksum || version.versionId !== `dsv_${checksum.slice(7, 39)}` || (pinned && pinned !== version.versionId)) throw new Error('Invalid runtime dataset version')
  return version
}
export async function serveScheduledData(request: Request, env: Env, path: string): Promise<Response> {
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET' } })
  const id = path.slice('/api/datasets/'.length)
  if (!sourceForDataset(id)) return new Response('Not found', { status: 404 })
  const url = new URL(request.url)
  try {
    const version = await runtimeVersion(env, id, url.searchParams.get('version') || undefined)
    if (!version) return Response.json({ error: 'ingestion_not_initialized' }, { status: 404 })
    const status = await readJson(env.DATASETS!, `ingestion/v1/${sourceForDataset(id)!.id}/status.json`) as { status: string; startedAt: string; finishedAt: string } | null
    const date = url.searchParams.get('date') || version.partitions.at(-1)!.date
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return new Response('Invalid date', { status: 400 })
    const table = await readTable(env.DATASETS!, version, [date])
    const presetId = url.searchParams.get('preset')
    const preset = presetId ? indicatorPreset(id, presetId) : undefined
    if (presetId && !preset) return new Response('Unknown preset', { status: 400 })
    const selected = preset ? selectRows(table, preset.query) : null
    return Response.json({ table, version: versionEvidence(version), availableDates: version.partitions.map(p => p.date), selected,
      ingestion: status ? { status: status.status, lastAttemptAt: status.startedAt, finishedAt: status.finishedAt } : null,
      reportDate: date, publishedAt: version.refreshedAt }, { headers: { 'Cache-Control': 'public, max-age=60', 'Access-Control-Allow-Origin': '*' } })
  } catch (error) {
    if (error instanceof ApiError) return new Response(error.message, { status: error.status })
    console.error('scheduled_dataset_read_failed', error)
    return Response.json({ error: 'dataset_unavailable' }, { status: 503 })
  }
}
