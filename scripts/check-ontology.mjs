#!/usr/bin/env bun
// Dual-SSOT check: registry-ids.json + ontology.ts + coverage-ledger.json.
// Does not scrape src/map/layers.ts — that file asserts the same JSON at load.

import { readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { getCountryProfile } from '@developing-country/countries'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fail = (msg) => {
  console.error(`check-ontology: ${msg}`)
  process.exitCode = 1
}

const registry = JSON.parse(readFileSync(join(root, 'src/shared/registry-ids.json'), 'utf8'))
const coverage = JSON.parse(readFileSync(join(root, 'scripts/coverage-ledger.json'), 'utf8'))
const dataSources = JSON.parse(readFileSync(join(root, 'scripts/data-sources.json'), 'utf8'))
const ontoSrc = readFileSync(join(root, 'src/worker/ontology.ts'), 'utf8')
const { ONTOLOGY, catalogEntries } = await import(pathToFileURL(join(root, 'src/worker/ontology.ts')).href)

const entitiesBlock = ontoSrc.split('entities: [')[1]
if (!entitiesBlock) {
  fail('could not find entities: [ in ontology.ts')
  process.exit(1)
}
const entitiesBody = entitiesBlock.split('start_here:')[0] ?? entitiesBlock

/** Entity objects are formatted with `id:` as the first key at 6-space indent. */
const entityIds = ONTOLOGY.entities.map((entity) => entity.id)
const layerIds = ONTOLOGY.entities.flatMap((entity) => entity.layer_id ? [entity.layer_id] : [])
const relatedIds = ONTOLOGY.entities.flatMap((entity) => entity.related.map((related) => related.id))
const searchableBlocks = [
  ...entitiesBody.matchAll(/searchable: (true|false),\n      storage: \{ kind: 'geojson', path: '([^']+)' \}/g),
]

if (entityIds.length === 0) fail('no entity ids parsed — check ontology.ts formatting (id as first key)')

const uniqueEntities = new Set(entityIds)
if (uniqueEntities.size !== entityIds.length) {
  const dup = entityIds.filter((id, i) => entityIds.indexOf(id) !== i)
  fail(`duplicate entity id(s): ${[...new Set(dup)].join(', ')}`)
}

for (const id of registry.layer_groups) {
  if (!layerIds.includes(id)) fail(`layer_groups ${id} has no ontology entity.layer_id`)
}

for (const id of registry.pop_levels) {
  if (!uniqueEntities.has(id)) fail(`pop_levels ${id} has no ontology entity`)
}

for (const id of registry.climate_variables) {
  if (!ontoSrc.includes(`'${id}'`) && !ontoSrc.includes(`"${id}"`)) {
    fail(`climate variable ${id} not mentioned in ontology.ts`)
  }
}
if (registry.sun && !uniqueEntities.has('sun')) fail('sun flag is true but no sun entity')

for (const id of relatedIds) {
  if (!uniqueEntities.has(id)) fail(`related id '${id}' does not resolve to an entity`)
}

const MAX_SEARCHABLE = 2.1 * 1024 * 1024
for (const [, flag, path] of searchableBlocks) {
  if (flag !== 'true') continue
  const rel = path.replace(/^\//, '')
  const disk = join(root, 'public', rel)
  let size = 0
  try {
    size = statSync(disk).size
  } catch {
    // File may not exist yet (planned searchable extract) — skip size, still record.
    continue
  }
  if (size > MAX_SEARCHABLE) {
    fail(`searchable geojson ${path} is ${(size / 1024 / 1024).toFixed(1)} MB (> ~2 MB). Mark searchable: false.`)
  }
}

const coverageIds = new Set((coverage.rows ?? []).map((r) => r.id))
for (const must of ['silent_zone', 'school', 'hospital', 'gnd', 'metro_stop']) {
  if (!coverageIds.has(must)) fail(`coverage-ledger missing row ${must}`)
}

const sources = Array.isArray(dataSources.sources) ? dataSources.sources : []
if (sources.length === 0) fail('data-sources.json has no sources')
try {
  if (typeof dataSources.country !== 'string') throw new Error('missing country')
  const country = getCountryProfile(dataSources.country)
  if (country.code !== ONTOLOGY.country) fail(`source registry country ${country.code} != ontology ${ONTOLOGY.country}`)
} catch {
  fail(`data-sources.json has unsupported country '${dataSources.country ?? ''}'`)
}
const sourceIds = new Set()
for (const source of sources) {
  if (!/^[a-z0-9-]+$/.test(source.id ?? '')) fail(`invalid source id '${source.id ?? ''}'`)
  if (sourceIds.has(source.id)) fail(`duplicate source id '${source.id}'`)
  sourceIds.add(source.id)
  for (const field of ['name', 'publisher', 'url', 'licence', 'vintage', 'refreshed', 'refresh']) {
    if (typeof source[field] !== 'string' || !source[field].trim()) {
      fail(`source ${source.id} is missing ${field}`)
    }
  }
  try {
    const sourceUrl = new URL(source.url)
    if (sourceUrl.protocol !== 'https:') fail(`source ${source.id} url must be https`)
  } catch {
    fail(`source ${source.id} has an invalid url`)
  }
  const refreshed = String(source.refreshed ?? '')
  const yearOnly = /^\d{4}$/.test(refreshed)
  const monthOnly = /^(\d{4})-(\d{2})$/.exec(refreshed)
  const dayTimestamp = Date.parse(`${refreshed}T00:00:00.000Z`)
  const dayExact = /^\d{4}-\d{2}-\d{2}$/.test(refreshed) && !Number.isNaN(dayTimestamp) &&
    new Date(dayTimestamp).toISOString().slice(0, 10) === refreshed
  if (!yearOnly && !(monthOnly && Number(monthOnly[2]) >= 1 && Number(monthOnly[2]) <= 12) && !dayExact) {
    fail(`source ${source.id} refreshed must be YYYY, YYYY-MM, or YYYY-MM-DD`)
  }
  if (/\b(npm|pnpm|yarn)\b/.test(source.refresh ?? '')) {
    fail(`source ${source.id} refresh must be a Bun command`)
  }
  const kind = source.refresh_mode ?? (source.refresh === 'live' ? 'live' : source.refresh === 'curated' ? 'curated' : 'automated')
  if (!['automated', 'curated', 'live'].includes(kind)) {
    fail(`source ${source.id} has invalid refresh_mode '${kind}'`)
  }
  if (source.scheduled === true && kind !== 'automated') {
    fail(`source ${source.id} is scheduled but is not automated`)
  }
  if (source.scheduled === true && !String(source.refresh).startsWith('bun ')) {
    fail(`source ${source.id} scheduled refresh must be an explicit Bun command`)
  }
  if (source.freshness_days != null && (!Number.isInteger(source.freshness_days) || source.freshness_days < 1)) {
    fail(`source ${source.id} freshness_days must be a positive integer`)
  }
  // Every source states whether it may be reused; without it the site shows "Licence status not recorded".
  if (!['open', 'permission_unclear', 'restricted'].includes(source.licence_status)) {
    fail(`source ${source.id} licence_status must be open, permission_unclear, or restricted`)
  }
  if (!Array.isArray(source.layers) || source.layers.length === 0) {
    fail(`source ${source.id} must name at least one dataset/layer`)
  }
}

const sourceById = new Map(sources.map((source) => [source.id, source]))
const referencedSourceIds = new Set()
for (const entity of ONTOLOGY.entities) {
  if (!Array.isArray(entity.source_ids) || entity.source_ids.length === 0) {
    fail(`ontology entity ${entity.id} must reference at least one source_id`)
    continue
  }
  const datasetIds = entity.dataset_ids ?? [entity.layer_id ?? entity.catalog_id ?? entity.id]
  for (const sourceId of entity.source_ids) {
    referencedSourceIds.add(sourceId)
    const source = sourceById.get(sourceId)
    if (!source) {
      fail(`ontology entity ${entity.id} references missing source ${sourceId}`)
      continue
    }
    if (!datasetIds.some((datasetId) => source.layers.includes(datasetId))) {
      fail(`source ${sourceId} does not declare entity ${entity.id} dataset(s): ${datasetIds.join(', ')}`)
    }
  }
  if (/\b(npm|pnpm|yarn|node)\b/.test(entity.provenance.refresh)) {
    fail(`ontology entity ${entity.id} provenance refresh must use Bun`)
  }
}
for (const source of sources) {
  if (!referencedSourceIds.has(source.id)) fail(`source ${source.id} is not referenced by any ontology entity`)
}

const catalog = catalogEntries()
const catalogDatasetIds = new Set(catalog.flatMap((entry) => entry.dataset_ids))
for (const source of sources) {
  for (const datasetId of source.layers) {
    if (!catalogDatasetIds.has(datasetId)) fail(`source ${source.id} declares unknown dataset ${datasetId}`)
  }
}
for (const dataset of catalog) {
  if (!dataset.refreshed_at) fail(`catalog dataset ${dataset.id} has no refreshed_at`)
  if (dataset.sources.length !== dataset.source_ids.length || dataset.sources.length === 0) {
    fail(`catalog dataset ${dataset.id} has an invalid source projection`)
  }
  for (const projected of dataset.sources) {
    const registry = sourceById.get(projected.id)
    if (!registry) {
      fail(`catalog dataset ${dataset.id} projects unknown source ${projected.id}`)
      continue
    }
    if (projected.refreshed_at !== registry.refreshed || projected.vintage !== registry.vintage) {
      fail(`catalog dataset ${dataset.id} source ${projected.id} drifted from registry freshness/vintage`)
    }
    if (projected.freshness.refreshed_at !== registry.refreshed) {
      fail(`catalog dataset ${dataset.id} source ${projected.id} drifted from registry freshness state`)
    }
  }
}

if (process.exitCode) {
  console.error('check-ontology: FAILED')
  process.exit(process.exitCode)
}
console.log(
  `check-ontology: ok — ${uniqueEntities.size} entities, ${sources.length} sources, ${registry.layer_groups.length} layer_groups, ${coverage.rows.length} coverage rows`,
)
