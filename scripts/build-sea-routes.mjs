// Builds public/data/sea-routes.geojson — Sri Lanka's sea routes: container-
// shipping lanes from the Port of Colombo AND the KKS passenger ferry to India.
//
// CARGO lanes are computed by SEA ROUTING over a real global marine network
// (Eurostat's `marnet` via searoute-js) so they stay in the water and thread the
// actual corridors — around southern Sri Lanka (the Palk Strait is non-
// navigable), up the Indian coast, through Hormuz, Bab-el-Mandeb → Suez, and the
// Malacca Strait. Not AIS/vessel-track data (that is proprietary).
//
// FERRIES are the real ferry routes from OpenStreetMap (route=ferry), with their
// actual geometry — the KKS↔Nagapattinam international ferry, the Jaffna lagoon
// island ferries, Trincomalee↔Mutur, and the small river/lake crossings. Their
// snapshot lives in scripts/ferries.json (refresh with fetch-ferries.mjs).
//
// Re-run (idempotent, self-checking): bun run build:sea-routes
// Build-time dependency only: searoute-js (devDependency; nothing ships to the client).

import { readFile, writeFile } from 'node:fs/promises'
import searoute from 'searoute-js'

const catalogue = JSON.parse(await readFile(new URL('./data-sources.json', import.meta.url), 'utf8'))
const SRC = Object.fromEntries(catalogue.sources.map((s) => [s.id, s]))
const src = SRC['sea-routes']
if (!src) throw new Error('missing "sea-routes" source in data-sources.json')

const sea = searoute.default || searoute
const pt = (lng, lat) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [lng, lat] } })

// --- Cargo lanes from Colombo ----------------------------------------------
// The Port of Colombo, then a harbour approach hugging the SW coast in open
// water out to the marine network's nearest node (~[80.1,5.8], south of the
// island). Every cargo lane shares this approach, then joins the routed path.
const COLOMBO_PORT = [79.84, 6.96]
const COLOMBO_APPROACH = [COLOMBO_PORT, [79.75, 6.6], [79.82, 6.2], [79.98, 6.0], [80.08, 5.86]]
const ORIGIN_ANCHOR = [79.8, 6.4]

const LANES = [
  ['Singapore', 'trunk', [103.85, 1.27]],
  ['Jebel Ali (Dubai)', 'trunk', [55.03, 25.01]],
  ['Rotterdam (via Suez)', 'trunk', [4.05, 51.95]],
  ['Hong Kong', 'trunk', [114.15, 22.3]],
  ['Chennai', 'feeder', [80.3, 13.1]],
  ['Tuticorin', 'feeder', [78.15, 8.76]],
  ['Kochi (Cochin)', 'feeder', [76.24, 9.97]],
  ['Nhava Sheva (Mumbai)', 'feeder', [72.95, 18.95]],
  ['Malé', 'feeder', [73.52, 4.18]],
  ['Chittagong', 'feeder', [91.8, 22.32]],
]

const dedupe = (coords) =>
  coords.filter((c, i) => i === 0 || c[0] !== coords[i - 1][0] || c[1] !== coords[i - 1][1])

const cargo = LANES.map(([to, service, dest]) => {
  const route = sea(pt(...ORIGIN_ANCHOR), pt(...dest), 'kilometers')
  if (!route || !route.geometry) throw new Error(`no sea route found: Colombo → ${to}`)
  return {
    type: 'Feature',
    properties: {
      name: `Colombo – ${to}`,
      from: 'Colombo',
      to,
      service, // 'trunk' | 'feeder'
      distance_km: Math.round(route.properties.length),
      note: 'Sea-routed over a global marine network (realistic corridor, not an AIS-surveyed lane).',
      source: src.name,
      source_url: src.url,
      updated: src.refreshed,
    },
    geometry: { type: 'LineString', coordinates: dedupe([...COLOMBO_APPROACH, ...route.geometry.coordinates]) },
  }
})

// --- Ferries (real OSM routes) ----------------------------------------------
// Snapshot from scripts/ferries.json (produced by fetch-ferries.mjs from OSM).
const ferrySnapshot = JSON.parse(await readFile(new URL('./ferries.json', import.meta.url), 'utf8'))
const ferries = ferrySnapshot.map((f) => ({
  type: 'Feature',
  properties: {
    name: f.name,
    service: 'ferry',
    ferry_class: f.ferry_class, // 'international' | 'lagoon' | 'river'
    distance_km: f.distance_km,
    note: 'Ferry route from OpenStreetMap (route=ferry), real geometry.',
    source: 'OpenStreetMap contributors',
    source_url: `https://www.openstreetmap.org/way/${f.osm_id}`,
    updated: SRC['osm']?.refreshed ?? src.refreshed,
  },
  geometry: { type: 'LineString', coordinates: f.coordinates },
}))

const features = [...cargo, ...ferries]

// Self-check: sane geometry & bounds; cargo anchored at Colombo.
for (const f of features) {
  const c = f.geometry.coordinates
  if (c.length < 2) throw new Error(`too few points: ${f.properties.name}`)
  if (!(f.properties.distance_km > 0)) throw new Error(`missing distance: ${f.properties.name}`)
  for (const [x, y] of c) {
    if (x < -20 || x > 125 || y < -10 || y > 60) throw new Error(`wild coordinate in ${f.properties.name}: ${x},${y}`)
  }
}
if (cargo[0].geometry.coordinates[0][0] !== COLOMBO_PORT[0]) throw new Error('cargo lane not anchored at Colombo')
if (!ferries.length) throw new Error('no ferries — run: bun run fetch:ferries')

const fc = {
  type: 'FeatureCollection',
  source: src.name,
  vintage: src.vintage,
  licence: src.licence,
  refreshed: src.refreshed,
  features,
}

await writeFile('public/data/sea-routes.geojson', JSON.stringify(fc))
const byService = features.reduce((a, f) => ((a[f.properties.service] = (a[f.properties.service] || 0) + 1), a), {})
console.log(`Wrote ${features.length} sea routes →`, byService)
for (const f of features) console.log(`  ${f.properties.name.padEnd(38)} ${f.properties.distance_km} km`)
