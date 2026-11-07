// GND (and DSD) centroid index: gig-data ents + Census 2024 Person-Sex.
// Join key is gig-data `id` = census `region_id` — names are not a key (DSD recodes
// reuse names). Centroids in ents are [lat, lon], not GeoJSON order.
//
// Completeness gate: GND id-match ≥ 98%. Below that we still write the index and
// scripts/census-2024-known-gaps.md, then exit 1 so we cannot silently mark complete.
//
// Usage: GIG_DIR=/tmp/gig-data CENSUS_DIR=/tmp/lk_census_2024 bun run build:admin-index

import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const GIG = process.env.GIG_DIR || '/tmp/gig-data'
const CENSUS = process.env.CENSUS_DIR || '/tmp/lk_census_2024'
const UA = 'developing-country.org/1.0'
const GATE = 0.98
const TODAY = new Date().toISOString().slice(0, 10)

const RAW = {
  gnd: 'https://raw.githubusercontent.com/nuuuwan/gig-data/master/ents/gnd.tsv',
  dsd: 'https://raw.githubusercontent.com/nuuuwan/gig-data/master/ents/dsd.tsv',
  district: 'https://raw.githubusercontent.com/nuuuwan/gig-data/master/ents/district.tsv',
  province: 'https://raw.githubusercontent.com/nuuuwan/gig-data/master/ents/province.tsv',
  census: 'https://raw.githubusercontent.com/nuuuwan/lk_census_2024/main/data/Person-Sex/data.tsv',
}

const KEYS = ['id', 'name', 'pop', 'pop_2012', 'pop_vintage', 'dens', 'area', 'parent', 'district', 'lat', 'lng']
const FIXTURES = {
  'LK-1103045': { name: 'Kotahena East', expect: 6090 },
  'LK-1103010': { name: 'Mattakkuliya', expect: 28135 },
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

async function ensure(path, url) {
  if (existsSync(path) && (await readFile(path, 'utf8')).trim().length > 40) return
  await mkdir(dirname(path), { recursive: true })
  console.log(`  fetch ${url}`)
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}`)
  await writeFile(path, Buffer.from(await res.arrayBuffer()))
}

function parseTsv(text) {
  const lines = text.trim().split(/\r?\n/)
  const cols = lines[0].split('\t').map((c) => c.trim())
  const rows = []
  for (const line of lines.slice(1)) {
    if (!line) continue
    const v = line.split('\t')
    rows.push(Object.fromEntries(cols.map((c, i) => [c, (v[i] ?? '').trim()])))
  }
  return rows
}

async function loadEnts(level) {
  const path = `${GIG}/ents/${level}.tsv`
  await ensure(path, RAW[level])
  const map = new Map()
  for (const r of parseTsv(await readFile(path, 'utf8'))) {
    if (r.id) map.set(r.id, r)
  }
  return map
}

function censusPaths() {
  return [
    `${CENSUS}/data/Person-Sex/data.tsv`,
    `${CENSUS}/Person-Sex/data.tsv`,
    `${CENSUS}/data.tsv`,
  ]
}

async function loadCensus() {
  let path = censusPaths().find((p) => existsSync(p))
  if (!path) {
    path = censusPaths()[0]
    await ensure(path, RAW.census)
  }
  const byId = new Map()
  const byType = new Map()
  for (const r of parseTsv(await readFile(path, 'utf8'))) {
    const id = r.region_id
    if (!id) continue
    const rec = {
      id,
      name: r.region_name,
      type: r.region_ent_type,
      pop: Number(r.total_value),
    }
    if (!Number.isFinite(rec.pop)) continue
    byId.set(id, rec)
    if (!byType.has(rec.type)) byType.set(rec.type, new Map())
    byType.get(rec.type).set(id, rec)
  }
  return { byId, byType, path }
}

// ents.centroid is "[lat, lon]"; swap only if someone stored GeoJSON order.
function centroid(raw) {
  const m = String(raw ?? '').match(/\[\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)\s*\]/)
  if (!m) return null
  let lat = Number(m[1])
  let lng = Number(m[2])
  if (lat > 20 && lng < 20) [lat, lng] = [lng, lat]
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return { lat, lng }
}

const round6 = (n) => Math.round(n * 1e6) / 1e6
const round1 = (n) => Math.round(n * 10) / 10

async function polygonArea(level, id) {
  try {
    const coords = JSON.parse(await readFile(`${GIG}/geo/${level}/${id}.json`, 'utf8'))
    if (!Array.isArray(coords) || !coords.length) return 0
    return Math.max(0.05, coords.reduce((s, r) => s + ringAreaKm2(r), 0))
  } catch {
    return 0
  }
}

async function mapPool(items, n, fn) {
  const out = new Array(items.length)
  let i = 0
  const worker = async () => {
    while (i < items.length) {
      const k = i++
      out[k] = await fn(items[k], k)
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker))
  return out
}

function assertRows(rows, label) {
  if (!rows.length) throw new Error(`${label}: empty index`)
  for (const r of rows) {
    for (const k of KEYS) {
      if (!(k in r)) throw new Error(`${label} ${r.id ?? '?'}: missing ${k}`)
    }
    if (!Number.isFinite(r.pop)) throw new Error(`${label} ${r.id}: bad pop`)
    if (!Number.isFinite(r.pop_2012)) throw new Error(`${label} ${r.id}: bad pop_2012`)
    if (!(r.lat > 5.4 && r.lat < 10.2 && r.lng > 79.4 && r.lng < 82.1)) {
      throw new Error(`${label} ${r.id}: centroid not in SL (${r.lat}, ${r.lng}) — ents are [lat,lon]`)
    }
  }
}

async function atomicWrite(path, text) {
  const tmp = `${path}.tmp`
  await mkdir(dirname(path), { recursive: true })
  await writeFile(tmp, text)
  await rename(tmp, path)
}

function joinLevel(ents, censusType) {
  const unmatchedGig = []
  const extra = []
  const census = censusType ?? new Map()
  for (const [id, rec] of census) {
    if (!ents.has(id)) extra.push(rec)
  }
  const matched = []
  for (const [id, e] of ents) {
    if (census.has(id)) matched.push(id)
    else unmatchedGig.push({ id, name: e.name, district_id: e.district_id, dsd_id: e.dsd_id, pop_2012: Number(e.population) || 0 })
  }
  return { matched, unmatchedGig, extra, rate: ents.size ? matched.length / ents.size : 0 }
}

async function buildRows(level, ents, census, parentOf, districtOf) {
  const ids = [...ents.keys()]
  const areas = existsSync(`${GIG}/geo/${level}`)
    ? await mapPool(ids, 32, (id) => polygonArea(level, id))
    : ids.map(() => 0)
  const rows = []
  let skipped = 0
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]
    const e = ents.get(id)
    const c = centroid(e.centroid)
    if (!c) {
      skipped++
      continue
    }
    const pop2012 = Number(e.population) || 0
    const hit = census.get(id)
    const joined = hit && Number.isFinite(hit.pop)
    const pop = joined ? hit.pop : pop2012
    const area = areas[i] || 0
    const dens = area > 0 ? Math.round(pop / area) : 0
    rows.push({
      id,
      name: e.name,
      pop,
      pop_2012: pop2012,
      pop_vintage: joined ? 2024 : 2012,
      dens,
      area: round1(area),
      parent: parentOf(e),
      district: districtOf(e),
      lat: round6(c.lat),
      lng: round6(c.lng),
    })
  }
  if (skipped) console.warn(`  ${level}: skipped ${skipped} ents without centroid`)
  return rows
}

function gapsMarkdown({ gnd, dsd, district, fixtures }) {
  const fmtUn = (rows, distNames, dsdNames) =>
    rows
      .map((r) => {
        const dist = distNames.get(r.district_id)?.name ?? r.district_id ?? ''
        const dsd = dsdNames.get(r.dsd_id)?.name ?? r.dsd_id ?? ''
        return `- \`${r.id}\` ${r.name}${dist ? ` — ${dist}` : ''}${dsd ? ` / ${dsd}` : ''} (pop_2012=${r.pop_2012})`
      })
      .join('\n')
  const fmtExtra = (rows) => rows.map((r) => `- \`${r.id}\` ${r.name} (${r.type}, pop=${r.pop})`).join('\n')
  const pct = (n) => `${(n * 100).toFixed(2)}%`
  const fixtureLines = Object.entries(fixtures)
    .map(([id, f]) => `- \`${id}\` ${f.name}: joined pop=${f.got}${f.got === f.expect ? '' : ` (expected ~${f.expect})`}`)
    .join('\n')
  return `# Census 2024 join gaps

Join key: gig-data \`id\` = [nuuuwan/lk_census_2024](https://github.com/nuuuwan/lk_census_2024) Person-Sex \`region_id\`.
2024 population is Person-Sex \`total_value\`. Centroids are gig-data \`[lat, lon]\` (not GeoJSON order).
Generated ${TODAY}.

| level | gig-data | census | id-matched | match rate | unmatched gig | extra census |
|---|---:|---:|---:|---:|---:|---:|
| gnd | ${gnd.ents} | ${gnd.census} | ${gnd.matched} | ${pct(gnd.rate)} | ${gnd.unmatchedGig.length} | ${gnd.extra.length} |
| dsd | ${dsd.ents} | ${dsd.census} | ${dsd.matched} | ${pct(dsd.rate)} | ${dsd.unmatchedGig.length} | ${dsd.extra.length} |
| district | ${district.ents} | ${district.census} | ${district.matched} | ${pct(district.rate)} | ${district.unmatchedGig.length} | ${district.extra.length} |

**Gate:** GND id match ≥ 98%. **${gnd.rate >= GATE ? 'PASSED' : 'FAILED'}** (${pct(gnd.rate)}).
Completeness stays \`partial\` until the gate passes. Unmatched GND ids cluster on DSD recodes
(Nuwara Eliya Kothmale/Norwood/Hanguranketha splits, Galle Hikkaduwa/Baddegama, Ratnapura Kalthota,
Matale Naula/Laggala). We do not name-match — the join key is id.

## Fixtures

${fixtureLines}

## gig-data GNDs with no Census 2024 row

${fmtUn(gnd.unmatchedGig, gnd.distNames, gnd.dsdNames) || '(none)'}

## Census 2024 GND rows with no gig-data ent

${fmtExtra(gnd.extra) || '(none)'}

## Extra census DSDs (no gig-data geometry)

${fmtExtra(dsd.extra) || '(none)'}
`
}

async function patchDistrictGeojson(districtEnts, census, provinceEnts) {
  const path = resolve(ROOT, 'public/data/demographics.geojson')
  if (!existsSync(path)) {
    console.warn('  public/data/demographics.geojson missing — skip district patch')
    return
  }
  const fc = JSON.parse(await readFile(path, 'utf8'))
  if (fc?.type !== 'FeatureCollection' || !Array.isArray(fc.features)) {
    throw new Error('demographics.geojson is not a FeatureCollection')
  }
  const byName = new Map([...districtEnts.values()].map((e) => [e.name, e]))
  let joined = 0
  for (const f of fc.features) {
    const p = f.properties ?? (f.properties = {})
    const ent = districtEnts.get(p.id) || byName.get(p.name)
    if (!ent) continue
    p.id = ent.id
    if (p.pop_2012 == null) p.pop_2012 = Number(p.pop) || Number(ent.population) || 0
    const hit = census.get(ent.id)
    if (hit) {
      p.pop = hit.pop
      p.population = hit.pop
      p.vintage = '2024'
      joined++
      const area = Number(p.area)
      if (area > 0) {
        p.dens = Math.round(hit.pop / area)
        p.density = p.dens
      }
    }
    if (!p.name) p.name = ent.name
    if (!p.parent) p.parent = provinceEnts.get(ent.province_id)?.name ?? p.province ?? ''
  }
  fc.source = 'Dept. of Census & Statistics via nuuuwan/lk_census_2024 + gig-data'
  fc.vintage = '2024'
  fc.licence = 'MIT (parser/geometries); official census (figures)'
  fc.refreshed = TODAY
  await atomicWrite(path, JSON.stringify(fc))
  console.log(`  demographics.geojson: ${joined}/${fc.features.length} districts → 2024 pop`)
}

async function main() {
  console.log(`Reading gig-data ${GIG} + census ${CENSUS}`)
  const [gndEnts, dsdEnts, districtEnts, provinceEnts, census] = await Promise.all([
    loadEnts('gnd'),
    loadEnts('dsd'),
    loadEnts('district'),
    loadEnts('province'),
    loadCensus(),
  ])
  const gndCensus = census.byType.get('gnd') ?? new Map()
  const dsdCensus = census.byType.get('dsd') ?? new Map()
  const distCensus = census.byType.get('district') ?? new Map()

  const gndJoin = joinLevel(gndEnts, gndCensus)
  const dsdJoin = joinLevel(dsdEnts, dsdCensus)
  const distJoin = joinLevel(districtEnts, distCensus)
  console.log(
    `  GND id match ${gndJoin.matched.length}/${gndEnts.size} (${(gndJoin.rate * 100).toFixed(2)}%)  DSD ${(dsdJoin.rate * 100).toFixed(2)}%  district ${(distJoin.rate * 100).toFixed(2)}%`,
  )

  const parentDsd = (e) => dsdEnts.get(e.dsd_id)?.name ?? ''
  const parentDist = (e) => districtEnts.get(e.district_id)?.name ?? ''

  console.log('  building GND rows (area from geo/ if present)…')
  const gndRows = await buildRows('gnd', gndEnts, gndCensus, parentDsd, parentDist)
  console.log('  building DSD rows…')
  const dsdRows = await buildRows('dsd', dsdEnts, dsdCensus, parentDist, parentDist)

  assertRows(gndRows, 'gnd')
  assertRows(dsdRows, 'dsd')
  if (gndRows.length < 13000) throw new Error(`gnd index too small: ${gndRows.length}`)
  if (dsdRows.length < 300) throw new Error(`dsd index too small: ${dsdRows.length}`)

  const byId = new Map(gndRows.map((r) => [r.id, r]))
  const fixtureInfo = {}
  for (const [id, spec] of Object.entries(FIXTURES)) {
    const row = byId.get(id)
    if (!row) throw new Error(`fixture ${id} (${spec.name}) missing from index`)
    if (row.name !== spec.name) console.warn(`  fixture ${id} name ${row.name} ≠ ${spec.name}`)
    const joined2024 = gndCensus.get(id)?.pop
    if (joined2024 == null) throw new Error(`fixture ${id} has no Census 2024 Person-Sex row`)
    if (row.pop !== joined2024) throw new Error(`fixture ${id} pop ${row.pop} ≠ census ${joined2024}`)
    if (Math.abs(joined2024 - spec.expect) / spec.expect > 0.05) {
      console.warn(`  fixture ${id} pop ${joined2024} differs from expected ~${spec.expect}`)
    }
    fixtureInfo[id] = { name: row.name, expect: spec.expect, got: joined2024 }
  }

  const provenance = {
    source: 'Dept. of Census & Statistics via nuuuwan/lk_census_2024 + gig-data',
    vintage: '2024',
    licence: 'MIT (lk_census_2024 parser, gig-data geometries); DCS official census (figures)',
    refreshed: TODAY,
    join_key: 'gig-data id = Person-Sex region_id',
    match_rate: Math.round(gndJoin.rate * 1e6) / 1e6,
  }

  const gndOut = resolve(ROOT, 'public/data/gnd-index.json')
  const dsdOut = resolve(ROOT, 'public/data/dsd-index.json')
  const gndDoc = { ...provenance, count: gndRows.length, features: gndRows }
  const dsdDoc = { ...provenance, match_rate: Math.round(dsdJoin.rate * 1e6) / 1e6, count: dsdRows.length, features: dsdRows }

  // Validate in memory before touching disk.
  const gndJson = JSON.stringify(gndDoc)
  const dsdJson = JSON.stringify(dsdDoc)
  const gndCheck = JSON.parse(gndJson)
  for (const id of Object.keys(FIXTURES)) {
    const row = gndCheck.features.find((r) => r.id === id)
    if (!row || row.pop !== fixtureInfo[id].got) throw new Error(`self-check failed for ${id}`)
  }

  const gapsPath = resolve(ROOT, 'scripts/census-2024-known-gaps.md')
  const gaps = gapsMarkdown({
    gnd: {
      ents: gndEnts.size,
      census: gndCensus.size,
      matched: gndJoin.matched.length,
      rate: gndJoin.rate,
      unmatchedGig: gndJoin.unmatchedGig,
      extra: gndJoin.extra,
      distNames: districtEnts,
      dsdNames: dsdEnts,
    },
    dsd: {
      ents: dsdEnts.size,
      census: dsdCensus.size,
      matched: dsdJoin.matched.length,
      rate: dsdJoin.rate,
      unmatchedGig: dsdJoin.unmatchedGig,
      extra: dsdJoin.extra,
    },
    district: {
      ents: districtEnts.size,
      census: distCensus.size,
      matched: distJoin.matched.length,
      rate: distJoin.rate,
      unmatchedGig: distJoin.unmatchedGig,
      extra: distJoin.extra,
    },
    fixtures: fixtureInfo,
  })
  await atomicWrite(gapsPath, gaps)
  console.log(`  wrote ${gapsPath}`)

  await atomicWrite(gndOut, gndJson)
  await atomicWrite(dsdOut, dsdJson)
  console.log(`  wrote ${gndOut} (${gndRows.length} rows, ${(gndJson.length / 1e6).toFixed(2)} MB)`)
  console.log(`  wrote ${dsdOut} (${dsdRows.length} rows)`)

  await patchDistrictGeojson(districtEnts, distCensus, provinceEnts)

  if (gndJoin.rate < GATE) {
    console.error(
      `\nGATE FAILED: GND id match ${(gndJoin.rate * 100).toFixed(2)}% < ${GATE * 100}%. ` +
        `Index written; completeness stays partial. See ${gapsPath}`,
    )
    process.exit(1)
  }
  console.log(`Done. GND id match ${(gndJoin.rate * 100).toFixed(2)}% ≥ ${GATE * 100}%`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
