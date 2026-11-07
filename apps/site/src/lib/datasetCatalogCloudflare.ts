import { readLatest } from '../../../../packages/ingestion/src/storage'
import { scheduledSources } from '../../../../packages/ingestion/src/registry'
import { env } from 'cloudflare:workers'
import { DATASET_CATALOG_POINTER } from '../generated/datasetCatalogPointer'
import { createDatasetCatalogReader, type DatasetCatalogStore } from './datasetCatalog'
import { datasetNotes } from './datasets'

const bucket = (env as unknown as { DATASETS: DatasetCatalogStore }).DATASETS
if (!bucket) throw new Error('DATASETS R2 binding is required')

/** One R2 read per fresh Worker isolate; public page caching handles request fan-out. */
const loadBaseCatalog = createDatasetCatalogReader(
  bucket,
  DATASET_CATALOG_POINTER,
  datasetNotes.map((dataset) => dataset.id),
)

/** Runtime versions overlay the editorial catalogue; no CMS publication is involved. */
export async function loadSiteDatasetCatalog() {
  const base = await loadBaseCatalog()
  const snapshots = await Promise.all(scheduledSources.map(source => readLatest(bucket, source.id)))
  const versions = snapshots.flatMap(snapshot => snapshot?.datasets ?? [])
  return {
    ...base,
    versions: base.versions.map(version => {
      const current = versions.find(v => v.datasetId === version.datasetId)
      return current ? { ...version, ...current, refreshedAt: current.refreshedAt.slice(0, 10) } : version
    }),
    sources: base.sources.map(source => {
      const snapshot = snapshots.find(snapshot => snapshot?.sourceId === source.id)
      return snapshot ? { ...source, refreshed: snapshot.publishedAt.slice(0, 10), vintage: snapshot.datasets[0]!.vintage } : source
    }),
  }
}
