import type { DatasetVersionRef } from '@developing-country/domain'
import type { IndicatorRow } from '@developing-country/datasets'
import versionManifest from '../../scripts/dataset-versions.json'

interface ManifestVersion {
  checksum: string
  country: string
  datasetId: string
  refreshedAt: string
  sourceIds: string[]
  versionId: string
  vintage: string
}

const manifestVersions: readonly ManifestVersion[] = versionManifest.versions

export function canonicalRows(rows: readonly IndicatorRow[]): string {
  return JSON.stringify(rows.map((row) => Object.fromEntries(
    Object.keys(row)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => [key, row[key]]),
  )))
}

export async function resultChecksum(rows: readonly IndicatorRow[]): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalRows(rows))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `sha256:${hex}`
}

function utcTimestamp(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T00:00:00.000Z`
  throw new Error(`Dataset Version ${value} does not use an exact calendar date`)
}

export function datasetVersionEvidence(datasetId: string, expectedSourceIds: readonly string[]): DatasetVersionRef {
  const version = manifestVersions.find((candidate) => candidate.datasetId === datasetId)
  if (!version) throw new Error(`Missing Dataset Version for ${datasetId}`)
  if (version.country !== 'LK') throw new Error(`Dataset Version ${datasetId} is not registered to Sri Lanka`)
  const actualSources = [...version.sourceIds].sort()
  const expectedSources = [...expectedSourceIds].sort()
  if (actualSources.join('\0') !== expectedSources.join('\0')) {
    throw new Error(`Dataset Version ${datasetId} does not match the preset source registry`)
  }
  return {
    datasetId: version.datasetId,
    versionId: version.versionId,
    country: 'LK',
    sourceIds: version.sourceIds,
    vintage: version.vintage,
    refreshedAt: utcTimestamp(version.refreshedAt),
    checksum: version.checksum,
    completeness: {
      status: 'complete',
      coverage: 1,
      coverageNote: 'Complete for the source-table grain declared by this Dataset Version.',
      knownGaps: [],
    },
  }
}
