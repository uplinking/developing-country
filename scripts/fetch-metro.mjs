// Build the Colombo Metro (Lanka Metro Transit) bus-network layer as GeoJSON.
//
// PROVENANCE
//   Routes, stops, colours and distances: nuuuwan/lk_metro (MIT-licensed),
//   which compiled the seven "CM" Metro Bus lines — codes, official line
//   colours, per-line ordered stop lists and surveyed stop coordinates — from
//   the Lanka Metro Transit launch (Aug 2026). We fetch its data/routes.json +
//   data/stops.json at build time, so a re-run picks up their corrections.
//   Corridor geometry: LMT has not published route polylines, so we route the
//   (accurately surveyed, densely spaced) stops through the public OSRM demo
//   server (OpenStreetMap data, ODbL) to snap each line to real roads. If OSRM
//   is unreachable we fall back to straight segments and stamp
//   `geometry: 'straight'` so the map copy can stay honest.
//
// Idempotent + self-validating: re-running rebuilds public/data/metro.geojson
// and checks it before writing.
//
// Usage: bun run fetch:metro

import { writeFile } from 'node:fs/promises'

const VINTAGE = '2026-08'
const SOURCE = 'Lanka Metro Transit via nuuuwan/lk_metro + OSRM/OpenStreetMap geometry'
const LICENCE = 'Network data © nuuuwan/lk_metro (MIT) · geometry ODbL (OpenStreetMap)'

const LK_METRO = 'https://raw.githubusercontent.com/nuuuwan/lk_metro/main/data'
const OSRM = 'https://router.project-osrm.org/route/v1/driving/'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'developing-country.org/metro-build' } })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res.json()
}

/** Road-snapped corridor for a route via OSRM; throws if the router is unreachable. */
async function osrmGeometry(waypoints) {
  const path = waypoints.map(([lon, lat]) => `${lon},${lat}`).join(';')
  const url = `${OSRM}${path}?overview=full&geometries=geojson`
  const res = await fetch(url, { headers: { 'User-Agent': 'developing-country.org/metro-build' } })
  if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`)
  const json = await res.json()
  const line = json?.routes?.[0]?.geometry?.coordinates
  if (!Array.isArray(line) || line.length < 2) throw new Error('OSRM returned no geometry')
  return line
}

async function build() {
  console.log('Fetching route + stop data from nuuuwan/lk_metro …')
  const [routes, stops] = await Promise.all([
    fetchJson(`${LK_METRO}/routes.json`),
    fetchJson(`${LK_METRO}/stops.json`),
  ])

  // name -> [lon, lat]  (source stores [lat, lng]; GeoJSON wants [lon, lat]).
  const coordOf = new Map()
  const roadOf = new Map()
  for (const s of stops) {
    if (!Array.isArray(s.latlng) || s.latlng.length !== 2) continue
    coordOf.set(s.name, [s.latlng[1], s.latlng[0]])
    if (s.road) roadOf.set(s.name, s.road)
  }

  const lineFeatures = []
  const stopRoutes = new Map() // stop name -> Set of route codes (only stops we have coords for)

  for (const r of routes) {
    const known = r.stops.filter((n) => coordOf.has(n))
    const missing = r.stops.filter((n) => !coordOf.has(n))
    if (missing.length) console.warn(`  ${r.id}: no coordinate for ${missing.join(', ')} — omitted from the line`)
    const waypoints = known.map((n) => coordOf.get(n))
    if (waypoints.length < 2) throw new Error(`${r.id} has < 2 locatable stops`)

    let coords
    let geometry = 'osrm'
    try {
      coords = await osrmGeometry(waypoints)
      await sleep(1100) // be polite to the shared demo server
    } catch (e) {
      console.warn(`  ${r.id}: OSRM failed (${e.message}) — straight-line fallback`)
      coords = waypoints
      geometry = 'straight'
    }

    lineFeatures.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: coords },
      properties: {
        kind: 'line',
        code: r.id,
        name: r.name,
        color: r.color,
        distance_km: r.distance_km,
        from: r.stops[0],
        to: r.stops[r.stops.length - 1],
        stops: r.stops.join(' · '),
        stop_count: r.stops.length,
        geometry,
        source: SOURCE,
        vintage: VINTAGE,
      },
    })
    console.log(`  ${r.id} ${r.name} — ${known.length} stops, ${coords.length} pts (${geometry})`)

    for (const n of known) {
      if (!stopRoutes.has(n)) stopRoutes.set(n, new Set())
      stopRoutes.get(n).add(r.id)
    }
  }

  const stopFeatures = [...stopRoutes.entries()].map(([name, codes]) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: coordOf.get(name) },
    properties: {
      kind: 'stop',
      name,
      road: roadOf.get(name) ?? '',
      routes: [...codes].sort().join(', '),
      route_count: codes.size,
      source: SOURCE,
      vintage: VINTAGE,
    },
  }))

  return {
    type: 'FeatureCollection',
    source: SOURCE,
    vintage: VINTAGE,
    licence: LICENCE,
    features: [...lineFeatures, ...stopFeatures],
  }
}

/** Self-validation: bail before writing if the output is obviously wrong. */
function validate(fc) {
  const lines = fc.features.filter((f) => f.properties.kind === 'line')
  const stops = fc.features.filter((f) => f.properties.kind === 'stop')
  if (lines.length < 6) throw new Error(`expected ≥6 lines, got ${lines.length}`)
  if (stops.length < 40) throw new Error(`suspiciously few stops: ${stops.length}`)
  for (const f of lines) {
    if (f.geometry.coordinates.length < 2) throw new Error(`${f.properties.code} has < 2 points`)
    if (!/^#[0-9a-f]{6}$/i.test(f.properties.color)) throw new Error(`${f.properties.code} bad colour "${f.properties.color}"`)
  }
}

const run = async () => {
  const fc = await build()
  validate(fc)
  await writeFile('public/data/metro.geojson', JSON.stringify(fc))
  const straight = fc.features.filter((f) => f.properties.geometry === 'straight').length
  const lines = fc.features.filter((f) => f.properties.kind === 'line').length
  const stops = fc.features.filter((f) => f.properties.kind === 'stop').length
  console.log(`Wrote public/data/metro.geojson — ${lines} lines, ${stops} stops` + (straight ? ` (${straight} straight-line)` : ' (all road-snapped)'))
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
