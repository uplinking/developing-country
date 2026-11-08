#!/usr/bin/env bun
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { IndexEntry } from '../../../scripts/build-dataset-index'
import { SEARCH_SYNONYMS } from '@developing-country/datasets/search-synonyms'
import { datasetNotes } from '../src/lib/datasets'

const root = resolve(import.meta.dir, '../../..')
const artifactPath = resolve(import.meta.dir, '../data/dataset-catalog.json')
const pointerPath = resolve(import.meta.dir, '../src/generated/datasetCatalogPointer.ts')
const check = process.argv.includes('--check')

interface VersionManifest {
  versions: Array<{
    checksum: string
    country: string
    datasetId: string
    refreshedAt: string
    rowCount?: number
    sourceIds: string[]
    versionId: string
    vintage: string
  }>
}

interface SourceRegistry {
  sources: Array<{
    id: string
    name: string
    publisher: string
    url: string
    licence?: string
    licence_status?: string
    vintage: string
    refreshed: string
  }>
}

interface CoverageLedger {
  rows: Array<{
    id: string
    title: string
    blocker: string
    last_checked: string
    ours: { status: string }
  }>
}

const versions = (JSON.parse(readFileSync(resolve(root, 'scripts/dataset-versions.json'), 'utf8')) as VersionManifest).versions
const sources = (JSON.parse(readFileSync(resolve(root, 'scripts/data-sources.json'), 'utf8')) as SourceRegistry).sources
const coverage = JSON.parse(readFileSync(resolve(root, 'scripts/coverage-ledger.json'), 'utf8')) as CoverageLedger
const versionById = new Map(versions.map((version) => [version.datasetId, version]))
const expectedIds = new Set(datasetNotes.map((dataset) => dataset.id))
const selectedVersions = datasetNotes.map((dataset) => {
  const version = versionById.get(dataset.id)
  if (!version) throw new Error(`Missing Dataset Version for ${dataset.id}`)
  return {
    checksum: version.checksum,
    country: version.country,
    datasetId: version.datasetId,
    refreshedAt: version.refreshedAt,
    ...(version.rowCount === undefined ? {} : { rowCount: version.rowCount }),
    sourceIds: version.sourceIds,
    versionId: version.versionId,
    vintage: version.vintage,
  }
})
const unregistered = versions.filter((version) => !expectedIds.has(version.datasetId))
if (unregistered.length > 0) {
  throw new Error(`Dataset Versions lack public notes: ${unregistered.map((version) => version.datasetId).join(', ')}`)
}

const requiredSourceIds = new Set(selectedVersions.flatMap((version) => version.sourceIds))
const selectedSources = sources
  .filter((source) => requiredSourceIds.has(source.id))
  .map((source) => ({
    id: source.id,
    name: source.name,
    publisher: source.publisher,
    url: source.url,
    ...(source.licence === undefined ? {} : { licence: source.licence }),
    ...(source.licence_status === undefined ? {} : { licence_status: source.licence_status }),
    vintage: source.vintage,
    refreshed: source.refreshed,
  }))
  .sort((left, right) => left.id.localeCompare(right.id))
const foundSourceIds = new Set(selectedSources.map((source) => source.id))
const missingSources = [...requiredSourceIds].filter((sourceId) => !foundSourceIds.has(sourceId))
if (missingSources.length > 0) throw new Error(`Missing Source records: ${missingSources.join(', ')}`)

const gapSummaries: Record<string, string> = {
  clinic_moh: 'The Health Ministry does not publish a national facility map.',
  courthouse: 'No national map of courthouses has been published.',
  silent_zone: 'Silent zones exist in law, but no official map of them exists.',
  landslide: 'No national landslide-hazard map has been published in a usable form.',
  flood: 'No national flood-risk map has been published in a usable form.',
}
const knownDataGaps = coverage.rows
  .filter((row) => row.ours.status === 'known_absent')
  .map((row) => ({
    id: row.id,
    title: row.title,
    summary: gapSummaries[row.id] ?? row.blocker,
    lastChecked: row.last_checked,
  }))

// ---------------------------------------------------------------- /data search
// Field labels and dimension values (districts, crops, utilities…) make the
// catalogue searchable by field name and place. They live here, in R2, rather
// than in the Worker bundle, which has almost no headroom.

// Dimensions whose values are codes, periods or bookkeeping rather than subject words.
const NON_SUBJECT_FIELD = /(^|_)(id|status|report|period|month|quarter|code|year|order|role|scope|flag|note)s?($|_)/
const isSubjectValue = (value: string) => /^\p{L}/u.test(value) && !(/_/.test(value) && !/ /.test(value))
const distinct = (values: string[]) => [...new Map(values.map((value) => [value.toLowerCase(), value.trim()])).values()]

// SAFETY: scripts/build-dataset-index.ts writes this file from IndexEntry and
// `bun run check:dataset-index` fails when it is stale.
const datasetIndex = JSON.parse(readFileSync(resolve(root, 'public/catalog/dataset-index.json'), 'utf8')) as { datasets: IndexEntry[] }
const searchTerms = Object.fromEntries(datasetIndex.datasets
  .filter((dataset) => expectedIds.has(dataset.dataset_id))
  .sort((left, right) => left.dataset_id.localeCompare(right.dataset_id))
  .map((dataset) => {
    const fields = dataset.fields.filter((field) => !field.provenance)
    const values = fields
      .filter((field) => !NON_SUBJECT_FIELD.test(field.id))
      .flatMap((field) => (field.values ?? []).filter(isSubjectValue))
    return [dataset.dataset_id, {
      fields: distinct(fields.map((field) => field.label)).join(' · '),
      values: distinct(values).join(' · '),
      description: dataset.description,
    }]
  }))

const synonyms = Object.fromEntries(Object.entries(SEARCH_SYNONYMS)
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([key, values]) => {
    if (!key || key !== key.trim().toLowerCase()) throw new Error(`search synonym key "${key}" must be lowercase and unpadded`)
    if (values.length === 0 || values.some((value) => !value.trim())) {
      throw new Error(`search synonym "${key}" must list at least one non-empty phrase`)
    }
    if (values.some((value) => value.toLowerCase() === key)) throw new Error(`search synonym "${key}" lists itself`)
    return [key, values]
  }))

const artifact = `${JSON.stringify({
  schemaVersion: 1,
  country: 'LK',
  versions: selectedVersions,
  sources: selectedSources,
  knownDataGaps,
  search: { synonyms, datasets: searchTerms },
}, null, 2)}\n`
const digest = createHash('sha256').update(artifact).digest('hex')
const pointer = `// Generated by apps/site/scripts/build-dataset-catalog.ts. Do not edit.\n` +
  `export const DATASET_CATALOG_POINTER = ${JSON.stringify({
    key: `catalog/LK/${digest}.json`,
    sha256: digest,
    bytes: Buffer.byteLength(artifact),
  }, null, 2)} as const\n`

function verify(path: string, expected: string): void {
  let actual = ''
  try { actual = readFileSync(path, 'utf8') } catch {}
  if (actual !== expected) {
    console.error(`dataset-catalog: ${path} is stale; run bun run --cwd apps/site data:catalog`)
    process.exitCode = 1
  }
}

if (check) {
  verify(artifactPath, artifact)
  verify(pointerPath, pointer)
  if (!process.exitCode) console.log(`dataset-catalog: ok — ${selectedVersions.length} datasets, ${selectedSources.length} sources, ${digest}`)
} else {
  mkdirSync(dirname(artifactPath), { recursive: true })
  mkdirSync(dirname(pointerPath), { recursive: true })
  writeFileSync(artifactPath, artifact)
  writeFileSync(pointerPath, pointer)
  console.log(`dataset-catalog: wrote ${selectedVersions.length} datasets to ${artifactPath}`)
  console.log(`dataset-catalog: R2 key catalog/LK/${digest}.json`)
}
