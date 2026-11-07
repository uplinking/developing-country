#!/usr/bin/env bun
// Dataset Version manifest guard — `bun run check:dataset-versions`.
//
// Recomputes every locally reproducible tracked artifact set (same derivation
// as build-dataset-versions.mjs: ontology + data-sources.json + git-tracked
// public/data bytes; no network, no timestamps) and fails when the committed
// scripts/dataset-versions.json drifts from it. It also validates the committed
// file on its own terms so a hand edit cannot slip through as "matching":
// schema version, unknown source/dataset ids, duplicate versions, non-canonical
// ordering/serialisation, checksum/versionId integrity, a rowCount on every
// version (or an explicit ROW_COUNT_EXEMPT reason), and every queryable
// local artifact (ontology geojson/index/table storage) having a manifest entry.
// PMTiles are never consulted, so a tile present in gitignored data/build on
// one machine cannot make the result differ from CI.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  MANIFEST_PATH,
  ROOT,
  ROW_COUNT_EXEMPT,
  SCHEMA_VERSION,
  buildManifest,
  canonicalJson,
  loadInputs,
  rowCountPathFor,
  sha256,
} from './build-dataset-versions.mjs'

const failures = []
const fail = (msg) => failures.push(msg)

let committedText
try {
  committedText = readFileSync(MANIFEST_PATH, 'utf8')
} catch {
  console.error('check-dataset-versions: scripts/dataset-versions.json is missing — run `bun scripts/build-dataset-versions.mjs`')
  process.exit(1)
}

let committed
try {
  committed = JSON.parse(committedText)
} catch (error) {
  console.error(`check-dataset-versions: manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}

// --- 1. Structural validation of the committed manifest ---------------------
if (committed.schemaVersion !== SCHEMA_VERSION) fail(`schemaVersion must be ${SCHEMA_VERSION}`)
if (canonicalJson(committed) !== committedText) fail('manifest is not canonical JSON (sorted keys, 2-space indent, trailing newline)')

const { ontology, catalog, sources } = await loadInputs(ROOT)
const sourceById = new Map(sources.map((source) => [source.id, source]))
const knownDatasetIds = new Set(catalog.flatMap((entry) => entry.dataset_ids))
const versions = Array.isArray(committed.versions) ? committed.versions : []
const excluded = Array.isArray(committed.excluded) ? committed.excluded : []
if (!Array.isArray(committed.versions)) fail('manifest.versions must be an array')
if (!Array.isArray(committed.excluded)) fail('manifest.excluded must be an array')
if (committed.country !== ontology.country) fail(`manifest country ${committed.country} ≠ ontology ${ontology.country}`)

const isSorted = (values) => values.every((value, i) => i === 0 || values[i - 1] < value)
const seenVersionIds = new Set()
const seenDatasetIds = new Set()
const ID_RE = /^dsv_[0-9a-f]{32}$/
const SHA_RE = /^[0-9a-f]{64}$/

for (const version of versions) {
  const label = `version ${version.datasetId ?? '?'}`
  if (!knownDatasetIds.has(version.datasetId)) fail(`${label}: unknown dataset id`)
  if (seenDatasetIds.has(version.datasetId)) fail(`${label}: duplicate dataset entry`)
  seenDatasetIds.add(version.datasetId)
  if (!ID_RE.test(version.versionId ?? '')) fail(`${label}: versionId must match ${ID_RE}`)
  if (seenVersionIds.has(version.versionId)) fail(`${label}: duplicate versionId ${version.versionId}`)
  seenVersionIds.add(version.versionId)
  if (version.country !== ontology.country) fail(`${label}: country ${version.country} ≠ ${ontology.country}`)
  if (!Array.isArray(version.sourceIds) || version.sourceIds.length === 0) fail(`${label}: sourceIds must be non-empty`)
  else {
    if (!isSorted(version.sourceIds)) fail(`${label}: sourceIds not in canonical (sorted, unique) order`)
    for (const id of version.sourceIds) if (!sourceById.has(id)) fail(`${label}: unknown source ${id}`)
    const projected = (version.sources ?? []).map((s) => s.id)
    if (projected.join() !== version.sourceIds.join()) fail(`${label}: sources[] does not mirror sourceIds`)
    for (const s of version.sources ?? []) {
      const registry = sourceById.get(s.id)
      if (registry && (registry.vintage !== s.vintage || registry.refreshed !== s.refreshed)) {
        fail(`${label}: source ${s.id} vintage/refreshed drifted from data-sources.json`)
      }
    }
  }
  if (!Array.isArray(version.entityIds) || !isSorted(version.entityIds)) fail(`${label}: entityIds must be sorted`)
  if (typeof version.vintage !== 'string' || !version.vintage) fail(`${label}: vintage missing`)
  if (!/^\d{4}(-\d{2}(-\d{2})?)?$/.test(version.refreshedAt ?? '')) fail(`${label}: refreshedAt must be YYYY[-MM[-DD]]`)
  if (!Array.isArray(version.artifacts) || version.artifacts.length === 0) {
    fail(`${label}: artifacts must be non-empty`)
    continue
  }
  const paths = version.artifacts.map((a) => a.path)
  if (!isSorted(paths)) fail(`${label}: artifacts not sorted by path`)
  for (const artifact of version.artifacts) {
    if (!/^public\/data\/[^/]+$/.test(artifact.path ?? '')) fail(`${label}: artifact path ${artifact.path} must be repo-relative under public/data/`)
    if (!Number.isInteger(artifact.bytes) || artifact.bytes < 0) fail(`${label}: ${artifact.path} bytes invalid`)
    if (!SHA_RE.test(artifact.sha256 ?? '')) fail(`${label}: ${artifact.path} sha256 invalid`)
    if ('rows' in artifact && !Number.isInteger(artifact.rows)) fail(`${label}: ${artifact.path} rows must be an integer`)
  }
  const expectedChecksum = `sha256:${sha256(version.artifacts.map((a) => `${a.path}\0${a.sha256}\n`).join(''))}`
  if (version.checksum !== expectedChecksum) fail(`${label}: checksum does not match its artifacts`)
  const { versionId, ...withoutId } = version
  if (versionId !== `dsv_${sha256(canonicalJson(withoutId)).slice(0, 32)}`) fail(`${label}: versionId does not hash its content`)
  // Every version needs a rowCount equal to its record-grain artifact's rows,
  // unless ROW_COUNT_EXEMPT records an explicit reason it has none.
  const rowPath = rowCountPathFor(version.datasetId, paths)
  const exemption = ROW_COUNT_EXEMPT[version.datasetId]
  if ('rowCount' in version) {
    const expected = version.artifacts.find((a) => a.path === rowPath)?.rows
    if (!Number.isInteger(version.rowCount) || version.rowCount < 0 || version.rowCount !== expected) {
      fail(`${label}: rowCount must equal the rows of its record-grain artifact (${rowPath ?? 'undeclared — see ROW_COUNT_ARTIFACT'})`)
    }
    if (exemption) fail(`${label}: has a rowCount but is listed in ROW_COUNT_EXEMPT`)
  } else if (typeof exemption !== 'string' || !exemption.trim()) {
    fail(`${label}: rowCount missing — every Dataset Version needs one unless ROW_COUNT_EXEMPT records why`)
  }
}
if (!isSorted(versions.map((v) => v.datasetId ?? ''))) fail('versions are not sorted by datasetId')

const excludedIds = excluded.map((e) => e.datasetId ?? '')
if (!isSorted(excludedIds)) fail('excluded entries are not sorted by datasetId')
for (const entry of excluded) {
  if (!knownDatasetIds.has(entry.datasetId)) fail(`excluded ${entry.datasetId}: unknown dataset id`)
  if (seenDatasetIds.has(entry.datasetId)) fail(`excluded ${entry.datasetId}: also has a version`)
  if (typeof entry.reason !== 'string' || !entry.reason) fail(`excluded ${entry.datasetId}: reason missing`)
}
for (const datasetId of knownDatasetIds) {
  if (!seenDatasetIds.has(datasetId) && !excludedIds.includes(datasetId)) {
    fail(`dataset ${datasetId} is neither versioned nor listed under excluded`)
  }
}

// Every queryable local artifact (ontology geojson/index/table storage) must be versioned.
const versionedPaths = new Set(versions.flatMap((v) => (v.artifacts ?? []).map((a) => a.path)))
for (const entry of catalog) {
  if (entry.storage.kind !== 'geojson' && entry.storage.kind !== 'index' && entry.storage.kind !== 'table') continue
  const path = `public/${entry.storage.path.replace(/^\//, '')}`
  if (!versionedPaths.has(path)) fail(`queryable artifact ${path} (entity ${entry.id}) has no manifest entry`)
}

// --- 2. Recompute from tracked bytes and diff --------------------------------
const { manifest: recomputed, problems } = await buildManifest(ROOT)
for (const problem of problems) fail(`recompute: ${problem}`)
const recomputedText = canonicalJson(recomputed)
if (recomputedText !== committedText) {
  const committedById = new Map(versions.map((v) => [v.datasetId, v]))
  for (const version of recomputed.versions) {
    const prior = committedById.get(version.datasetId)
    if (!prior) fail(`drift: ${version.datasetId} is missing from the committed manifest`)
    else if (prior.versionId !== version.versionId) {
      const changed = version.artifacts
        .filter((a) => !(prior.artifacts ?? []).some((p) => p.path === a.path && p.sha256 === a.sha256))
        .map((a) => a.path)
      fail(`drift: ${version.datasetId} ${prior.versionId} → ${version.versionId} (${changed.join(', ') || 'metadata'})`)
    }
  }
  for (const datasetId of committedById.keys()) {
    if (!recomputed.versions.some((v) => v.datasetId === datasetId)) fail(`drift: committed ${datasetId} no longer derivable`)
  }
  fail('manifest drifted from tracked artifacts — run `bun scripts/build-dataset-versions.mjs` and commit the result')
}

if (failures.length) {
  for (const message of failures) console.error(`check-dataset-versions: ${message}`)
  console.error('check-dataset-versions: FAILED')
  process.exit(1)
}
console.log(
  `check-dataset-versions: ok — ${versions.length} versions, ${excluded.length} excluded, ${versionedPaths.size} artifacts (${join('scripts', 'dataset-versions.json')})`,
)
