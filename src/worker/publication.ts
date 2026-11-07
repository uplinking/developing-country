// Publication helper: the exact evidence shapes the CMS publication gate
// (apps/site/src/publicationEvidence.ts, ADR 0007) requires for one saved Data
// View. An author concatenates these blocks across views into
// evidence_bundle.dataViews / datasetVersions and source_manifest. Sources are
// resolved from the same registry the ontology and catalog project
// (scripts/data-sources.json), never from agent input.

import type { DataViewSpec } from '@developing-country/views'
import dataSourceRegistry from '../../scripts/data-sources.json' with { type: 'json' }

export interface PublicationDataView {
  viewUrl: string
  queryId: string
  resultChecksum: string
}

export interface PublicationDatasetVersion {
  datasetId: string
  versionId: string
  country: string
  checksum: string
  vintage: string
  refreshedAt: string
  sourceIds: string[]
}

export interface PublicationSource {
  sourceId: string
  title: string
  url: string
}

export interface PublicationEvidence {
  dataView: PublicationDataView
  datasetVersions: PublicationDatasetVersion[]
  sourceManifest: PublicationSource[]
  /** Present only when a cited source id has no registry row (the CMS gate would reject it). */
  unresolvedSourceIds?: string[]
}

interface RegistrySource {
  id: string
  name: string
  url: string
}

const sourceById = new Map(
  (dataSourceRegistry.sources as RegistrySource[]).map((source) => [source.id, source]),
)

export function publicationEvidence(view: DataViewSpec, viewUrl: string): PublicationEvidence {
  const datasetVersions = view.evidence.datasetVersions.map((version) => ({
    datasetId: version.datasetId,
    versionId: version.versionId,
    country: version.country,
    checksum: version.checksum,
    vintage: version.vintage,
    refreshedAt: version.refreshedAt,
    sourceIds: [...version.sourceIds],
  }))
  const sourceIds = [...new Set([
    ...datasetVersions.flatMap((version) => version.sourceIds),
    ...view.evidence.sourceIds,
  ])].sort()
  const sourceManifest: PublicationSource[] = []
  const unresolved: string[] = []
  for (const sourceId of sourceIds) {
    const source = sourceById.get(sourceId)
    if (source?.url?.startsWith('https://')) sourceManifest.push({ sourceId, title: source.name, url: source.url })
    else unresolved.push(sourceId)
  }
  return {
    dataView: { viewUrl, queryId: view.data.queryId, resultChecksum: view.data.resultChecksum },
    datasetVersions,
    sourceManifest,
    ...(unresolved.length > 0 ? { unresolvedSourceIds: unresolved } : {}),
  }
}
