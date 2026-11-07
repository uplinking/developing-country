// Fetch Sri Lanka civic POIs (schools, hospitals) from OpenStreetMap via
// Overpass and write GeoJSON in public/data/. osm_only — not MoE/MoH registers.
//
// Produces:
//   schools.geojson    — amenity=school|college|university|kindergarten (named)
//   hospitals.geojson  — amenity=hospital|clinic (named); kind hospital|clinic
//
// Plain Node >=18 (global fetch), no npm deps. Re-runnable / idempotent.
// Self-validating: asserts minimum feature counts before write.
//
// Usage: bun run fetch:civic
//        bun scripts/fetch-civic-poi.mjs schools hospitals   (subset)

import { writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = resolve(__dirname, '..', 'public', 'data')

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
]

// Sri Lanka: relation 536807 → area id 3600536807.
const AREA = 3600536807
const VINTAGE = '2026-10'
const COMMON = { source: 'OpenStreetMap', vintage: VINTAGE, licence: 'ODbL' }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function queryOverpass(query, label) {
  let lastErr
  for (const endpoint of OVERPASS_ENDPOINTS) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`  [${label}] ${endpoint} (try ${attempt})…`)
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
            'User-Agent': 'developing-country.org/1.0',
          },
          body: 'data=' + encodeURIComponent(query),
        })
        if (res.status === 429 || res.status === 504) {
          const wait = 3000 * attempt
          console.warn(`    HTTP ${res.status} — backing off ${wait}ms`)
          await sleep(wait)
          continue
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
        return await res.json()
      } catch (e) {
        console.warn(`    failed: ${e.message}`)
        lastErr = e
        await sleep(1500 * attempt)
      }
    }
  }
  throw lastErr || new Error('all Overpass mirrors failed')
}

const round5 = (n) => Math.round(n * 1e5) / 1e5

function centerOf(el) {
  if (el.type === 'node') return [el.lon, el.lat]
  if (el.center) return [el.center.lon, el.center.lat]
  if (el.geometry && el.geometry.length) {
    let x = 0, y = 0, n = 0
    for (const p of el.geometry) { x += p.lon; y += p.lat; n++ }
    if (n) return [x / n, y / n]
  }
  return null
}

function collectPoints(data, kinds) {
  const kindSet = new Set(kinds)
  const features = []
  const seen = new Set()
  for (const el of data.elements) {
    const t = el.tags || {}
    const name = t.name || t['name:en']
    if (!name) continue
    const kind = t.amenity
    if (!kindSet.has(kind)) continue
    const coord = centerOf(el)
    if (!coord) continue
    const key = `${name}|${round5(coord[0])}|${round5(coord[1])}`
    if (seen.has(key)) continue
    seen.add(key)
    features.push({
      type: 'Feature',
      id: `${el.type}/${el.id}`,
      properties: {
        name,
        kind,
        osm_type: el.type,
        osm_id: el.id,
        source: 'OpenStreetMap',
      },
      geometry: { type: 'Point', coordinates: [round5(coord[0]), round5(coord[1])] },
    })
  }
  return features
}

async function buildSchools() {
  const q = `
[out:json][timeout:180];
area(${AREA})->.lk;
(
  nwr(area.lk)["amenity"="school"];
  nwr(area.lk)["amenity"="college"];
  nwr(area.lk)["amenity"="university"];
  nwr(area.lk)["amenity"="kindergarten"];
);
out center tags;
`
  const data = await queryOverpass(q, 'schools')
  return { features: collectPoints(data, ['school', 'college', 'university', 'kindergarten']), min: 200, key: 'schools' }
}

async function buildHospitals() {
  const q = `
[out:json][timeout:180];
area(${AREA})->.lk;
(
  nwr(area.lk)["amenity"="hospital"];
  nwr(area.lk)["amenity"="clinic"];
);
out center tags;
`
  const data = await queryOverpass(q, 'hospitals')
  return { features: collectPoints(data, ['hospital', 'clinic']), min: 50, key: 'hospitals' }
}

const BUILDERS = {
  schools: buildSchools,
  hospitals: buildHospitals,
}

async function run() {
  await mkdir(OUT_DIR, { recursive: true })
  const which = process.argv.slice(2).filter((a) => BUILDERS[a])
  const selected = which.length ? which : Object.keys(BUILDERS)
  const summary = []
  let failed = false

  for (const key of selected) {
    console.log(`\n▶ ${key}`)
    try {
      const { features, min } = await BUILDERS[key]()
      const n = features.length
      if (n < min) {
        failed = true
        summary.push({ key, count: n, min, sizeMB: '0', ok: false })
        console.error(`  FAIL: ${n} features (min ${min}) — not writing public/data/${key}.geojson`)
        continue
      }
      const fc = { type: 'FeatureCollection', ...COMMON, features }
      const json = JSON.stringify(fc)
      JSON.parse(json)
      const sizeMB = (Buffer.byteLength(json) / 1e6).toFixed(2)
      await writeFile(resolve(OUT_DIR, `${key}.geojson`), json)
      summary.push({ key, count: n, min, sizeMB, ok: true })
      console.log(`  wrote ${n} features → public/data/${key}.geojson (${sizeMB}MB) OK`)
    } catch (e) {
      failed = true
      summary.push({ key, count: 0, min: '?', sizeMB: '0', ok: false })
      console.error(`  ERROR: ${e.message}`)
    }
  }

  console.log('\n─── Civic POI layers summary ───')
  console.log('layer         count   min   size     status')
  for (const s of summary) {
    console.log(
      `${s.key.padEnd(13)} ${String(s.count).padStart(5)}  ${String(s.min).padStart(4)}  ${String(s.sizeMB + 'MB').padStart(7)}   ${s.ok ? 'OK' : 'FAIL'}`
    )
  }

  if (failed) {
    console.error('\nOne or more layers failed validation (below minimum or errored).')
    process.exit(1)
  }
  console.log('\nAll civic POI layers built and validated.')
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
