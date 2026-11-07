import { scheduledSources } from '../../packages/ingestion/src/registry'
import { readLatest, type ReadStore } from '../../packages/ingestion/src/storage'
import { freshnessOf } from '../shared/freshness'
import type { getLayerCatalog } from './catalog'

export async function overlayRuntimeCatalog(catalog: ReturnType<typeof getLayerCatalog>, store: ReadStore) {
  const snapshots = await Promise.all(scheduledSources.map(source => readLatest(store, source.id)))
  return { ...catalog, layers: catalog.layers.map(layer => {
    const snapshot = snapshots.find(s => s && layer.source_ids.includes(s.sourceId))
    const version = snapshot?.datasets.find(d => layer.dataset_ids.includes(d.datasetId))
    if (!snapshot || !version) return layer
    const refreshed = version.refreshedAt.slice(0, 10)
    const freshness = freshnessOf({ refreshed, refresh: 'Scheduled API ingestion', freshness_days: 1, scheduled: true, refresh_mode: 'automated' }, { automated_default_days: 1, curated_default_days: 365 })
    return { ...layer, vintage: version.vintage, refreshed_at: refreshed, freshness,
      how_to_refresh: 'Cloudflare ingestion Worker, every six hours; three-day correction window and bounded historical retries.',
      path: `/api/datasets/${version.datasetId}`, runtime_version: version.versionId,
      completeness: { status: 'partial' as const, coverage: null, coverage_note: 'Archived source observations; unreported dates and intervals are not filled.', known_gaps: [] },
      sources: layer.sources.map(source => source.id === snapshot.sourceId ? { ...source, vintage: version.vintage, refreshed_at: refreshed, freshness } : source),
    }
  }) }
}
