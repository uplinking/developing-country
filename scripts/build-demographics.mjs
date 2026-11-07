// Builds Sri Lanka population choropleth data from nuuuwan/gig-data (MIT) at
// FOUR levels — province (9), district (25), DSD / Divisional Secretariat (331,
// ≈ town/suburb), GND / Grama Niladhari (~14,000, ≈ village/neighbourhood).
//
// Reads a local gig-data checkout (GND is 14k files — clone it, don't HTTP each):
//   git clone --depth 1 --filter=blob:none --sparse \
//     https://github.com/nuuuwan/gig-data.git /tmp/gig-data
//   cd /tmp/gig-data && git sparse-checkout set geo ents
// Boundaries (geo/<level>/<id>.json = raw ring arrays) join ents/<level>.tsv
// (name, population, parents). Density = population / spherical area.
//
// Output: newline-delimited GeoJSON per level in $OUT_DIR (default /tmp/demo),
// which scripts/build-demographics-tiles.sh feeds to tippecanoe → one
// demographics.pmtiles (4 source-layers). Also writes the small
// public/data/demographics.geojson (district) for anything still on GeoJSON.
//
// Data: DCS Census 2012 on gig-data geometries; Census 2024 Person-Sex joined when
// CENSUS_DIR is present (id = region_id). Missing census is a warning, not a hard fail —
// tiles can still build from 2012. properties.id is required for feature-state / promoteId.
// Re-run: GIG_DIR=/tmp/gig-data CENSUS_DIR=/tmp/lk_census_2024 bun scripts/build-demographics.mjs

import { existsSync } from 'node:fs'
import { createWriteStream } from 'node:fs'
import { readFile, writeFile, mkdir } from 'node:fs/promises'

const GIG = process.env.GIG_DIR || '/tmp/gig-data'
const OUT = process.env.OUT_DIR || '/tmp/demo'
const CENSUS = process.env.CENSUS_DIR || '/tmp/lk_census_2024'

const PROVINCE = {
  'LK-1': 'Western', 'LK-2': 'Central', 'LK-3': 'Southern', 'LK-4': 'Northern',
  'LK-5': 'Eastern', 'LK-6': 'North Western', 'LK-7': 'North Central',
  'LK-8': 'Uva', 'LK-9': 'Sabaragamuwa',
}

const toRad = (d) => (d * Math.PI) / 180
function ringAreaKm2(ring) {
  const R = 6371.0088
  let area = 0
  for (let i = 0; i < ring.length; i++) {
    const [lon1, lat1] = ring[i]
    const [lon2, lat2] = ring[(i + 1) % ring.length]
    area += (toRad(lon2) - toRad(lon1)) * (2 + Math.sin(toRad(lat1)) + Math.sin(toRad(lat2)))
  }
  return Math.abs((area * R * R) / 2)
}

async function loadEnts(level) {
  const tsv = await readFile(`${GIG}/ents/${level}.tsv`, 'utf8')
  const [header, ...lines] = tsv.trim().split(/\r?\n/)
  const cols = header.split('\t').map((c) => c.trim())
  const ents = {}
  for (const line of lines) {
    const v = line.split('\t')
    ents[v[0]] = Object.fromEntries(cols.map((c, i) => [c, (v[i] ?? '').trim()]))
  }
  return ents
}

function censusTsvPath() {
  return [
    `${CENSUS}/data/Person-Sex/data.tsv`,
    `${CENSUS}/Person-Sex/data.tsv`,
    `${CENSUS}/data.tsv`,
  ].find((p) => existsSync(p))
}

/** region_id → 2024 Person-Sex total_value. Empty map if the checkout is absent. */
async function loadCensusPop() {
  const path = censusTsvPath()
  if (!path) {
    console.warn(`Census 2024 not found under ${CENSUS} — stamping id + pop_2012 only (pop stays 2012)`)
    return new Map()
  }
  const tsv = await readFile(path, 'utf8')
  const [header, ...lines] = tsv.trim().split(/\r?\n/)
  const cols = header.split('\t').map((c) => c.trim())
  const idIdx = cols.indexOf('region_id')
  const popIdx = cols.indexOf('total_value')
  if (idIdx < 0 || popIdx < 0) {
    console.warn(`Census TSV at ${path} missing region_id/total_value — skipping 2024 join`)
    return new Map()
  }
  const out = new Map()
  for (const line of lines) {
    const v = line.split('\t')
    const id = (v[idIdx] ?? '').trim()
    const pop = Number(v[popIdx])
    if (id && Number.isFinite(pop)) out.set(id, pop)
  }
  console.log(`  Census 2024: ${out.size} region_ids from ${path}`)
  return out
}

// province -> (no parent); district -> province; dsd -> district; gnd -> dsd
const PARENT_LEVEL = { district: 'province', dsd: 'district', gnd: 'dsd' }

async function buildLevel(level, parentNames, censusPop) {
  const ents = await loadEnts(level)
  const ids = Object.keys(ents)
  const parentKey = PARENT_LEVEL[level] ? `${PARENT_LEVEL[level]}_id` : null
  const stream = createWriteStream(`${OUT}/${level}.geojsonl`)
  const districtFeatures = level === 'district' ? [] : null
  let done = 0
  let joined = 0

  for (const id of ids) {
    let coords
    try {
      coords = JSON.parse(await readFile(`${GIG}/geo/${level}/${id}.json`, 'utf8'))
    } catch {
      continue // a few GND ids lack a boundary file
    }
    const areaKm2 = Math.max(0.05, coords.reduce((s, r) => s + ringAreaKm2(r), 0))
    const e = ents[id]
    const pop2012 = Number(e.population) || 0
    const pop2024 = censusPop.get(id)
    const pop = Number.isFinite(pop2024) ? pop2024 : pop2012
    if (Number.isFinite(pop2024)) joined++
    const parent = level === 'district'
      ? PROVINCE[e.province_id] ?? e.province_id
      : parentKey ? (parentNames?.[e[parentKey]] ?? '') : ''
    const feat = {
      type: 'Feature',
      properties: {
        id,
        name: e.name,
        pop,
        pop_2012: pop2012,
        dens: Math.round(pop / areaKm2),
        area: Math.round(areaKm2 * 10) / 10,
        parent,
        vintage: Number.isFinite(pop2024) ? '2024' : '2012',
      },
      geometry: { type: 'MultiPolygon', coordinates: coords.map((r) => [r]) },
    }
    stream.write(JSON.stringify(feat) + '\n')
    if (districtFeatures) {
      districtFeatures.push({
        ...feat,
        properties: {
          ...feat.properties,
          province: parent,
          population: pop,
          density: feat.properties.dens,
        },
      })
    }
    if (++done % 2000 === 0) process.stdout.write(`  ${level}: ${done}/${ids.length}\r`)
  }
  await new Promise((r) => stream.end(r))
  console.log(`  ${level}: ${done} units → ${OUT}/${level}.geojsonl (${joined} with 2024 pop)`)

  if (districtFeatures) {
    await writeFile('public/data/demographics.geojson', JSON.stringify({
      type: 'FeatureCollection',
      source: 'Dept. of Census & Statistics via nuuuwan/lk_census_2024 + gig-data',
      vintage: joined ? '2024' : '2012',
      licence: 'MIT (parser/geometries); official census (figures)',
      features: districtFeatures,
    }))
  }
  return Object.fromEntries(ids.map((id) => [id, ents[id].name]))
}

const FIXTURES = {
  'LK-1103045': { name: 'Kotahena East', pop: 6090 },
  'LK-1103010': { name: 'Mattakkuliya', pop: 28135 },
}

async function assertGeojsonl(level, fixtures = {}) {
  const text = await readFile(`${OUT}/${level}.geojsonl`, 'utf8')
  const lines = text.trim().split('\n')
  if (lines.length === 0) throw new Error(`${level}.geojsonl is empty`)
  let missingId = 0
  const byId = new Map()
  for (const line of lines) {
    const f = JSON.parse(line)
    const id = f.properties?.id
    if (!id) missingId++
    else byId.set(String(id), f.properties)
  }
  if (missingId) throw new Error(`${level}: ${missingId}/${lines.length} features missing properties.id`)
  for (const [id, spec] of Object.entries(fixtures)) {
    const p = byId.get(id)
    if (!p) throw new Error(`${level} missing fixture ${id}`)
    if (p.name !== spec.name) console.warn(`  fixture ${id} name ${p.name} ≠ ${spec.name}`)
    if (spec.pop != null && p.pop !== spec.pop) throw new Error(`fixture ${id} pop ${p.pop} ≠ ${spec.pop}`)
    if (p.vintage !== '2024') throw new Error(`fixture ${id} vintage ${p.vintage} (want 2024)`)
  }
  console.log(`  ${level}: ${lines.length} features, all have id`)
}

async function main() {
  await mkdir(OUT, { recursive: true })
  console.log(`Reading gig-data from ${GIG} → ${OUT}`)
  const censusPop = await loadCensusPop()
  if (censusPop.size === 0) throw new Error('Census 2024 Person-Sex not loaded — refusing to rebuild tiles from 2012-only')
  const province = await buildLevel('province', undefined, censusPop)
  const district = await buildLevel('district', province, censusPop)
  const dsd = await buildLevel('dsd', district, censusPop)
  await buildLevel('gnd', dsd, censusPop)
  await assertGeojsonl('province')
  await assertGeojsonl('district')
  await assertGeojsonl('dsd')
  await assertGeojsonl('gnd', FIXTURES)
  console.log('Done. Next: scripts/build-demographics-tiles.sh')
}

main().catch((e) => { console.error(e); process.exit(1) })
