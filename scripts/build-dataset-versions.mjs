#!/usr/bin/env bun
// Dataset Version manifest builder — writes scripts/dataset-versions.json.
//
//   bun scripts/build-dataset-versions.mjs          # (re)generate the manifest
//   bun scripts/check-dataset-versions.mjs          # recompute + fail on drift
//
// A Dataset Version (CONTEXT.md) is an immutable snapshot of a Dataset,
// identified by its checksum and source vintage. It is never a query id.
//
// One version is emitted per dataset id (ontology `dataset_ids`, the same ids
// `scripts/data-sources.json#sources[].layers` name) whose artifact set is
// locally reproducible from a clean checkout: git-tracked files under
// `public/data/` referenced by ontology `geojson` / `index` / `table` storage, plus the
// sibling files listed in EXTRA_ARTIFACTS that the same refresh command emits.
//
// Deliberately NOT versioned (recorded under `excluded` so the omission is
// itself checked): `pmtiles` (data/build is gitignored; a tile that happens to
// exist on one machine must never change the committed manifest), `d1`
// (mutable live records), `adapter` (live third-party feed), `none` (statute /
// on-device / known-absent). Everything is derived from the ontology + the
// source registry + tracked file bytes — no timestamps, no network, no git
// history — so re-running on an unchanged tree is byte-for-byte idempotent.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { parseIndicatorTable } from '@developing-country/datasets'
import { refreshedPeriod } from '../src/shared/freshness.ts'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const MANIFEST_PATH = join(ROOT, 'scripts/dataset-versions.json')
export const SCHEMA_VERSION = 1

/** Storage kinds that can never yield a reproducible tracked artifact set. */
export const EXCLUDED_STORAGE = {
  pmtiles: 'PMTiles live in gitignored data/build and R2; absent from a clean checkout',
  d1: 'mutable live D1 records; not a source dataset artifact',
  adapter: 'live third-party adapter; no local artifact',
  none: 'no stored artifact (statute, on-device computation, or known-absent)',
  r2: 'served from R2 only; no tracked local artifact',
}

/**
 * Tracked files under public/data that the ontology does not reference by
 * storage path but that belong to the same artifact set as a dataset (emitted
 * by the same refresh command). Keyed by repo-relative path.
 */
export const EXTRA_ARTIFACTS = {
  // build-admin-index.mjs writes gnd-index.json (ontology `gnd`) and
  // dsd-index.json together from the same census join.
  'public/data/dsd-index.json': 'demographics',
  // build-walk-graph.mjs output; the r2 key graphs/walk/colombo.json is the
  // production copy, this tracked file is the ASSETS mirror graph.ts reads.
  'public/data/walk-colombo.json': 'osm_foot_graph',
  // scripts/initiatives/build.ts writes the dashboard ledger beside the two tables.
  'public/data/lk-initiatives.json': 'lk-initiative-events',
}

/**
 * Every Dataset Version carries a `rowCount`: the number of records at the
 * dataset's own grain, counted from tracked bytes by `rowCountOf`.
 *   - GeoJSON FeatureCollection / feature index → features
 *   - Indicator Table                            → rows
 *   - routing graph `{ nodes, edges }`           → undirected edges (a node is
 *     only an edge endpoint; an edge is one walkable street/path segment)
 * A single-artifact version counts its one artifact. A multi-artifact version
 * mixes grains, so it must name here the artifact whose rows are the record
 * grain — never a sum across grains.
 */
export const ROW_COUNT_ARTIFACT = {
  // lk-initiatives.json is the dashboard ledger of the same events; rows are counted in the table.
  'lk-initiative-events': 'public/data/lk-initiative-events.json',
  // demographics.geojson (province/district boundaries), dsd-index.json and
  // gnd-index.json carry the same census population at coarser-to-finer
  // grains. The record grain is the Grama Niladhari division: the finest
  // published unit and the one the census join and explorer key on.
  demographics: 'public/data/gnd-index.json',
  // build-metro-alternatives.mjs writes each outline/route GeoJSON beside the
  // Indicator Table with the same ids; the table row is the record grain.
  'metro-gap-clusters': 'public/data/metro-gap-clusters.json',
  'metro-route-candidates': 'public/data/metro-route-candidates.json',
}

/**
 * Dataset ids allowed to ship without a `rowCount`, each with the reason.
 * Keep this empty unless an artifact genuinely has no countable record; the
 * builder and `check:dataset-versions` fail on any other version without one.
 */
export const ROW_COUNT_EXEMPT = {}

/** Recursively sort object keys so JSON output is canonical. */
export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, canonicalize(value[key])]),
    )
  }
  return value
}

export function canonicalJson(value) {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

export function assessmentDateFor(country, now = new Date()) {
  const timeZone = country === 'LK' ? 'Asia/Colombo' : 'UTC'
  const parts = new Intl.DateTimeFormat('en', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const part = (type) => parts.find((candidate) => candidate.type === type)?.value
  return `${part('year')}-${part('month')}-${part('day')}`
}

/** Git-tracked paths under public/data (empty set if git is unavailable). */
export function trackedDataFiles(root = ROOT) {
  const proc = Bun.spawnSync(['git', 'ls-files', '-z', '--', 'public/data'], { cwd: root })
  if (proc.exitCode !== 0) {
    throw new Error(`git ls-files failed: ${new TextDecoder().decode(proc.stderr).trim()}`)
  }
  return new Set(
    new TextDecoder()
      .decode(proc.stdout)
      .split('\0')
      .filter(Boolean),
  )
}

/** Record count (see ROW_COUNT_ARTIFACT for units) when unambiguous; otherwise undefined. */
export function rowCountOf(bytes) {
  let parsed
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return undefined
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
  if (Array.isArray(parsed.features)) {
    if (typeof parsed.count === 'number' && parsed.count !== parsed.features.length) return undefined
    return parsed.features.length
  }
  if (Array.isArray(parsed.rows)) {
    try {
      return parseIndicatorTable(parsed).rows.length
    } catch {
      return undefined
    }
  }
  // build-walk-graph.mjs routing graph: one record per undirected edge. The
  // packed form flattens edges into [a, b, metres] triplets.
  if (Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)) {
    if (parsed.packed === true) return parsed.edges.length % 3 === 0 ? parsed.edges.length / 3 : undefined
    return parsed.edges.every((edge) => Array.isArray(edge) && edge.length === 3) ? parsed.edges.length : undefined
  }
  return undefined
}

/** Repo path of the artifact whose rows are a version's rowCount, if determinable. */
export function rowCountPathFor(datasetId, artifactPaths, rowCountArtifacts = ROW_COUNT_ARTIFACT) {
  return rowCountArtifacts[datasetId] ?? (artifactPaths.length === 1 ? artifactPaths[0] : undefined)
}

function storagePathToRepo(path) {
  // ontology paths are served at /data/<file>; on disk they are public/data/<file>
  return `public/${path.replace(/^\//, '')}`
}

/**
 * Pure derivation: ontology + source registry + a file reader → manifest object.
 * `readArtifact(repoRelativePath)` must return a Uint8Array or throw.
 */
export function deriveManifest({
  ontology,
  catalog,
  sources,
  registryCountry,
  tracked,
  readArtifact,
  assessedAt,
  rowCountArtifacts = ROW_COUNT_ARTIFACT,
  rowCountExempt = ROW_COUNT_EXEMPT,
}) {
  const sourceById = new Map(sources.map((source) => [source.id, source]))
  const problems = []
  const assessmentDate = assessedAt ?? assessmentDateFor(ontology.country)
  if (typeof registryCountry !== 'string') {
    problems.push('source registry country is missing')
  } else if (registryCountry !== ontology.country) {
    problems.push(`source registry country ${registryCountry} != ontology ${ontology.country}`)
  }

  /** datasetId → { entityIds:Set, sourceIds:Set, artifactPaths:Set, kinds:Set } */
  const datasets = new Map()
  const datasetFor = (datasetId) => {
    let dataset = datasets.get(datasetId)
    if (!dataset) {
      dataset = { entityIds: new Set(), sourceIds: new Set(), artifactPaths: new Set(), kinds: new Set() }
      datasets.set(datasetId, dataset)
    }
    return dataset
  }

  // Use ontology entity ids here, not catalog presentation ids. Several catalog
  // entries intentionally collapse singular query entities into one plural
  // surface (for example `school` -> `schools` and `metro_line` -> `metro`).
  // Evidence matching operates on query entity ids, so losing that identity
  // would make a real artifact look unversioned at publication time.
  for (const entity of ontology.entities) {
    const datasetIds = entity.dataset_ids ?? [entity.layer_id ?? entity.catalog_id ?? entity.id]
    for (const datasetId of datasetIds) {
      const dataset = datasetFor(datasetId)
      dataset.entityIds.add(entity.id)
      for (const id of entity.source_ids) dataset.sourceIds.add(id)
      dataset.kinds.add(entity.storage.kind)
      if (entity.storage.kind === 'geojson' || entity.storage.kind === 'index' || entity.storage.kind === 'table') {
        dataset.artifactPaths.add(storagePathToRepo(entity.storage.path))
      }
    }
  }

  for (const [path, datasetId] of Object.entries(EXTRA_ARTIFACTS)) {
    if (!datasets.has(datasetId)) {
      problems.push(`EXTRA_ARTIFACTS ${path} names unknown dataset ${datasetId}`)
      continue
    }
    datasetFor(datasetId).artifactPaths.add(path)
  }

  const versions = []
  const excluded = []
  const claimed = new Set()

  for (const datasetId of [...datasets.keys()].sort()) {
    const dataset = datasets.get(datasetId)
    const paths = [...dataset.artifactPaths].sort()
    if (paths.length === 0) {
      const kinds = [...dataset.kinds].sort()
      excluded.push({
        datasetId,
        entityIds: [...dataset.entityIds].sort(),
        storageKinds: kinds,
        reason: kinds.map((kind) => EXCLUDED_STORAGE[kind] ?? `unhandled storage kind ${kind}`).join(' · '),
      })
      continue
    }

    const artifacts = []
    for (const path of paths) {
      if (!tracked.has(path)) {
        problems.push(`${datasetId}: artifact ${path} is not git-tracked (ignored or missing) — cannot version it`)
        continue
      }
      let bytes
      try {
        bytes = readArtifact(path)
      } catch (error) {
        problems.push(`${datasetId}: cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`)
        continue
      }
      claimed.add(path)
      const artifact = { path, bytes: bytes.byteLength, sha256: sha256(bytes) }
      const rows = rowCountOf(bytes)
      if (rows !== undefined) artifact.rows = rows
      artifacts.push(artifact)
    }
    if (artifacts.length !== paths.length) continue

    const sourceIds = [...dataset.sourceIds].sort()
    const sourceRows = sourceIds.map((id) => {
      const source = sourceById.get(id)
      if (!source) problems.push(`${datasetId}: unknown source ${id}`)
      return source ? { id, vintage: source.vintage, refreshed: source.refreshed } : null
    }).filter(Boolean)
    const assessed = Date.parse(`${assessmentDate}T00:00:00.000Z`)
    for (const source of sourceRows) {
      const period = refreshedPeriod(source.refreshed)
      if (!period) problems.push(`${datasetId}: source ${source.id} has invalid refreshed date ${String(source.refreshed)}`)
      else if (Number.isNaN(assessed) || period.start > assessed) {
        problems.push(`${datasetId}: source ${source.id} refreshed date ${source.refreshed} is after assessment date ${assessmentDate}`)
      }
    }
    if (problems.some((problem) => problem.startsWith(`${datasetId}: source `))) continue

    const checksum = `sha256:${sha256(artifacts.map((a) => `${a.path}\0${a.sha256}\n`).join(''))}`
    const version = {
      datasetId,
      country: ontology.country,
      entityIds: [...dataset.entityIds].sort(),
      sourceIds,
      sources: sourceRows,
      vintage: [...new Set(sourceRows.map((s) => s.vintage))].join(' · '),
      // A Dataset Version is only as recently verified as its oldest required
      // source. Using the newest date here masks a stale input in the compact
      // evidence projection even though the catalog correctly reports the
      // worst per-source freshness state.
      refreshedAt: sourceRows.map((s) => s.refreshed).sort().at(0) ?? '',
      checksum,
      artifacts,
    }
    // Multi-file sets mix grains (e.g. demographics = province/district
    // geojson + DSD + GND indexes), so they count only their declared artifact.
    const rowPath = rowCountPathFor(datasetId, paths, rowCountArtifacts)
    if (rowCountArtifacts[datasetId] && !paths.includes(rowCountArtifacts[datasetId])) {
      problems.push(`${datasetId}: ROW_COUNT_ARTIFACT names ${rowCountArtifacts[datasetId]}, which is not one of its artifacts`)
    }
    const rows = artifacts.find((artifact) => artifact.path === rowPath)?.rows
    if (typeof rows === 'number') {
      version.rowCount = rows
      if (rowCountExempt[datasetId]) problems.push(`${datasetId}: has a rowCount but is listed in ROW_COUNT_EXEMPT — remove the exemption`)
    } else if (!rowCountExempt[datasetId]) {
      problems.push(
        `${datasetId}: no rowCount — teach rowCountOf the artifact format, name the record-grain artifact in ROW_COUNT_ARTIFACT, or add a reason to ROW_COUNT_EXEMPT`,
      )
    }
    version.versionId = `dsv_${sha256(canonicalJson(version)).slice(0, 32)}`
    versions.push(version)
  }

  for (const datasetId of new Set([...Object.keys(rowCountArtifacts), ...Object.keys(rowCountExempt)])) {
    if (!datasets.has(datasetId)) problems.push(`row-count rule names unknown dataset ${datasetId}`)
  }
  for (const [datasetId, reason] of Object.entries(rowCountExempt)) {
    if (typeof reason !== 'string' || !reason.trim()) problems.push(`ROW_COUNT_EXEMPT ${datasetId}: reason missing`)
  }

  const unclaimed = [...tracked].filter((path) => !claimed.has(path)).sort()
  for (const path of unclaimed) {
    problems.push(`tracked ${path} belongs to no dataset — reference it from the ontology or EXTRA_ARTIFACTS`)
  }

  const manifest = {
    $comment:
      'Dataset Version manifest — generated by `bun scripts/build-dataset-versions.mjs`; verified by `bun run check:dataset-versions`. Do not edit by hand. versionId = dsv_ + sha256(canonical version JSON without versionId)[0:32]; checksum = sha256 over sorted "path\\0sha256\\n" artifact lines.',
    schemaVersion: SCHEMA_VERSION,
    country: ontology.country,
    ontologyVersion: ontology.version,
    versions,
    excluded,
  }
  return { manifest, problems }
}

export async function loadInputs(root = ROOT) {
  const { ONTOLOGY, catalogEntries } = await import(pathToFileURL(join(root, 'src/worker/ontology.ts')).href)
  const registry = JSON.parse(readFileSync(join(root, 'scripts/data-sources.json'), 'utf8'))
  return {
    ontology: ONTOLOGY,
    catalog: catalogEntries(),
    registryCountry: registry.country,
    sources: registry.sources,
  }
}

export async function buildManifest(root = ROOT) {
  const inputs = await loadInputs(root)
  return deriveManifest({
    ...inputs,
    tracked: trackedDataFiles(root),
    readArtifact: (path) => new Uint8Array(readFileSync(join(root, path))),
  })
}

if (import.meta.main) {
  const { manifest, problems } = await buildManifest()
  for (const problem of problems) console.error(`build-dataset-versions: ${problem}`)
  if (problems.length) {
    console.error('build-dataset-versions: FAILED — manifest not written')
    process.exit(1)
  }
  const text = canonicalJson(manifest)
  // Self-validate: the canonical text must round-trip to an identical structure.
  if (canonicalJson(JSON.parse(text)) !== text) {
    console.error('build-dataset-versions: canonical JSON did not round-trip')
    process.exit(1)
  }
  let previous = null
  try {
    previous = readFileSync(MANIFEST_PATH, 'utf8')
  } catch {
    // first run
  }
  if (previous === text) {
    console.log(`build-dataset-versions: unchanged — ${manifest.versions.length} versions, ${manifest.excluded.length} excluded`)
  } else {
    writeFileSync(MANIFEST_PATH, text)
    console.log(`build-dataset-versions: wrote ${manifest.versions.length} versions, ${manifest.excluded.length} excluded → scripts/dataset-versions.json`)
  }
}
