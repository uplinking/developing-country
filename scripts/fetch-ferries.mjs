// Refreshes scripts/ferries.json — Sri Lanka's real ferry routes, straight from
// OpenStreetMap (route=ferry ways) with their actual geometry. Unnamed ferries
// are labelled from the nearest ferry_terminal. Abandoned/cancelled routes and
// non-Sri-Lanka routes are dropped.
//
// This is the network step (Overpass is flaky); the snapshot it writes,
// scripts/ferries.json, is committed and consumed offline by build-sea-routes.mjs
// — same fetch-then-snapshot split as the expressways.
//
// Run: bun run fetch:ferries   (then: bun run build:sea-routes)

import { readFile, writeFile } from 'node:fs/promises'

const QUERY = `[out:json][timeout:120];
(
  way["route"="ferry"](5.7,79.3,10.9,82.4);
  node["amenity"="ferry_terminal"](5.7,79.3,10.9,82.4);
);
out tags geom;`

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function overpass() {
  // Offline path: OVERPASS_JSON=<file> reuses a raw Overpass response (same
  // QUERY), for when the public endpoints are rate-limiting.
  if (process.env.OVERPASS_JSON) {
    console.warn('  using cached Overpass response:', process.env.OVERPASS_JSON)
    return JSON.parse(await readFile(process.env.OVERPASS_JSON, 'utf8'))
  }
  let lastErr
  // A couple of passes with backoff — Overpass rate-limits (429) under load.
  for (let attempt = 0; attempt < 4; attempt++) {
    for (const url of ENDPOINTS) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ data: QUERY }),
        })
        if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`)
        const text = await res.text()
        if (text[0] !== '{') throw new Error(`${url} → non-JSON (rate-limited?)`)
        return JSON.parse(text)
      } catch (e) {
        lastErr = e
        console.warn(`  overpass (attempt ${attempt + 1}):`, String(e.message || e))
      }
    }
    await sleep(6000 * (attempt + 1))
  }
  throw lastErr
}

const R = 6371, rad = (d) => (d * Math.PI) / 180
const haversineKm = (coords) => {
  let km = 0
  for (let i = 1; i < coords.length; i++) {
    const [lo1, la1] = coords[i - 1], [lo2, la2] = coords[i]
    const a = Math.sin(rad(la2 - la1) / 2) ** 2 + Math.cos(rad(la1)) * Math.cos(rad(la2)) * Math.sin(rad(lo2 - lo1) / 2) ** 2
    km += 2 * R * Math.asin(Math.sqrt(a))
  }
  return km
}
const distDeg = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])

const data = await overpass()

// Ferry terminals → names, for labelling unnamed ferry ways by their endpoints.
const terminals = data.elements
  .filter((e) => e.type === 'node' && e.tags?.amenity === 'ferry_terminal' && (e.tags.name || e.tags['name:en']))
  .map((e) => ({ name: (e.tags['name:en'] || e.tags.name).replace(/\s+(Jatty|Jetty|Ferry|Terminal)\.?$/i, '').trim(), lng: e.lon, lat: e.lat }))

const nearestTerminal = (lng, lat) => {
  let best = null, bd = 0.012 // ~1.3 km
  for (const t of terminals) {
    const d = distDeg([lng, lat], [t.lng, t.lat])
    if (d < bd) { bd = d; best = t.name }
  }
  return best
}

// Region labels by the route's location — accurate without over-claiming which
// exact jetty an unnamed OSM ferry hits. Used only when OSM has no name and no
// nearby named terminal. [minLng, minLat, maxLng, maxLat, label].
const REGIONS = [
  [79.5, 9.3, 80.0, 9.9, 'Jaffna lagoon ferry'],
  [81.0, 8.5, 81.35, 8.8, 'Trincomalee – Mutur ferry'],
  [81.4, 7.6, 81.95, 8.15, 'Batticaloa lagoon ferry'],
  [79.9, 6.3, 80.05, 6.5, 'Bentota river ferry'],
  [79.9, 6.6, 80.05, 6.85, 'Bolgoda lake ferry'],
  [79.95, 6.85, 80.1, 7.0, 'Kelani river ferry'],
  [79.75, 7.2, 79.95, 7.4, 'Negombo lagoon ferry'],
  [79.7, 7.4, 79.9, 7.6, 'Chilaw lagoon ferry'],
]
const regionLabel = (lng, lat) => {
  for (const [x0, y0, x1, y1, label] of REGIONS) if (lng >= x0 && lng <= x1 && lat >= y0 && lat <= y1) return label
  return null
}

const isDead = (t, nm) =>
  t.abandoned || t.disused || t['abandoned:route'] || t['disused:route'] || /abandon|cancel|disused/i.test(nm)

const ferries = []
for (const e of data.elements) {
  if (e.type !== 'way' || e.tags?.route !== 'ferry') continue
  const t = e.tags || {}
  const g = e.geometry || []
  if (g.length < 2) continue
  const nmRaw = t.name || t['name:en'] || ''
  if (isDead(t, nmRaw)) continue

  const coordinates = g.map((p) => [p.lon, p.lat])
  const [a, b] = [coordinates[0], coordinates[coordinates.length - 1]]
  const midLat = (a[1] + b[1]) / 2
  const km = haversineKm(coordinates)

  // Drop routes wholly in India (both ends east of the SL landmass, e.g. Port Blair).
  if (a[0] > 82.5 && b[0] > 82.5) continue

  // Name: prefer OSM's own name; else a named nearby terminal; else the region.
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  let name = nmRaw
  if (!name) {
    const ta = nearestTerminal(...a), tb = nearestTerminal(...b)
    name =
      (ta && tb && ta !== tb ? `${ta} – ${tb}` : ta || tb ? `${ta || tb} ferry` : '') ||
      regionLabel(...mid) ||
      'Ferry crossing'
  }

  // International if it touches India (Nagapattinam ~10.8N/79.85E); else class by
  // what the name says (lagoon/island vs river/lake), falling back to latitude.
  const international = /kankesanthurai|kks|nagapattin/i.test(name) || b[1] > 10.3 || a[1] > 10.3
  const ferry_class = international
    ? 'international'
    : /lagoon|island|jaffna|nasivantivu|mutur|nagadeepa|maveliturai/i.test(name)
      ? 'lagoon'
      : /river|lake|bentota|aruggoda|kelani/i.test(name)
        ? 'river'
        : midLat >= 7.8 ? 'lagoon' : 'river'

  ferries.push({
    name: name.replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+/g, ' ').trim(),
    ferry_class,
    distance_km: km < 1 ? Math.round(km * 1000) / 1000 : Math.round(km * 10) / 10,
    osm_id: e.id,
    coordinates,
  })
}

// Order: international, then lagoon, then river — north to south within.
const rank = { international: 0, lagoon: 1, river: 2 }
ferries.sort((x, y) => rank[x.ferry_class] - rank[y.ferry_class] || y.coordinates[0][1] - x.coordinates[0][1])

if (ferries.length < 8) throw new Error(`only ${ferries.length} ferries — expected the OSM SL set (~17); aborting`)
if (!ferries.some((f) => f.ferry_class === 'international')) throw new Error('missing the KKS international ferry')

await writeFile(new URL('./ferries.json', import.meta.url), JSON.stringify(ferries, null, 1) + '\n')
const byClass = ferries.reduce((m, f) => ((m[f.ferry_class] = (m[f.ferry_class] || 0) + 1), m), {})
console.log(`Wrote ${ferries.length} ferries → scripts/ferries.json`, byClass)
for (const f of ferries) console.log(`  [${f.ferry_class.padEnd(13)}] ${f.name.padEnd(38)} ${f.distance_km} km`)
