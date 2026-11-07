// Builds public/data/boi-zones.geojson — the Board of Investment (BOI) economic
// zones: Sri Lanka's Export Processing Zones (EPZ) and Industrial Parks. Curated
// from BOI / press material; each zone cites the BOI catalogue source so the map
// popover can show provenance + last-checked without a second fetch.
//
// Boundaries are INDICATIVE — the BOI publishes no open GIS boundary set, so each
// zone is a hand-placed rectangle at the zone's known location, sized roughly to
// its published extent. Hence the "boundary approximate" note on every feature.
// Re-run (idempotent, self-checking): bun run build:boi

import { readFile, writeFile } from 'node:fs/promises'

const catalogue = JSON.parse(await readFile(new URL('./data-sources.json', import.meta.url), 'utf8'))
const SRC = Object.fromEntries(catalogue.sources.map((s) => [s.id, s]))
const boi = SRC['boi']
if (!boi) throw new Error('missing "boi" source in data-sources.json')

/** Axis-aligned rectangle (closed ring) around a centroid; hw/hh in degrees. */
const rect = (lng, lat, hw, hh) => [
  [
    [lng - hw, lat - hh],
    [lng + hw, lat - hh],
    [lng + hw, lat + hh],
    [lng - hw, lat + hh],
    [lng - hw, lat - hh],
  ],
]

// name, lng, lat, kind, status, established, extent (ha), half-width/height (°), note
const ZONES = [
  ['Katunayake EPZ', 79.888, 7.166, 'Export Processing Zone', 'operational', '1978', 180, 0.0075, 0.0075, "Sri Lanka's first EPZ, beside Bandaranaike Int'l Airport; apparel & light manufacturing."],
  ['Biyagama EPZ', 79.986, 6.974, 'Export Processing Zone', 'operational', '1985', 180, 0.0075, 0.0065, 'Second-largest EPZ, on the Kelani river; diversified manufacturing & IT.'],
  ['Koggala EPZ', 80.328, 5.996, 'Export Processing Zone', 'operational', '1991', 90, 0.006, 0.005, 'Southern coastal EPZ near Galle; apparel & rubber products.'],
  ['Malwatta EPZ', 79.994, 6.938, 'Export Processing Zone', 'operational', '1999', 40, 0.004, 0.004, 'Compact zone near Kelaniya; garments & accessories.'],
  ['Mirigama EPZ', 80.128, 7.242, 'Export Processing Zone', 'operational', '1998', 100, 0.006, 0.006, 'Gampaha-district EPZ off the A1; mixed manufacturing.'],
  ['Wathupitiwala EPZ', 80.103, 7.113, 'Export Processing Zone', 'operational', '1998', 65, 0.005, 0.005, 'Nittambuwa-area EPZ; food, rubber & light industry.'],
  ['Seethawaka Industrial Park', 80.148, 6.933, 'Industrial Park', 'operational', '1998', 180, 0.008, 0.007, 'Large park at Avissawella; heavy & diversified manufacturing.'],
  ['Horana Industrial Estate', 80.064, 6.716, 'Industrial Park', 'operational', '2001', 45, 0.0045, 0.0045, 'Kalutara-district estate; tyres, ceramics & garments.'],
  ['Mawathagama Industrial Park', 80.444, 7.248, 'Industrial Park', 'operational', '2003', 30, 0.004, 0.004, 'Kurunegala-district park; light industry.'],
  ['Polgahawela Industrial Park', 80.300, 7.331, 'Industrial Park', 'operational', '2005', 25, 0.004, 0.004, 'Kurunegala-district park on the rail line; light manufacturing.'],
  ['Pallekele Industrial Park', 80.698, 7.288, 'Industrial Park', 'operational', '2000', 90, 0.006, 0.005, 'Kandy-district park at Pallekele; food, printing & assembly.'],
  ['Mirijjawila EPZ (Hambantota)', 81.116, 6.171, 'Export Processing Zone', 'operational', '2012', 240, 0.009, 0.008, 'Zone within the Hambantota development area, beside the port & airport.'],
  ['Bingiriya EPZ', 79.906, 7.705, 'Export Processing Zone', 'under-construction', '2019', 900, 0.012, 0.011, 'Large new EPZ near the Norochcholai coast; being developed in phases.'],
  ['Eravur Industrial Zone', 81.595, 7.776, 'Industrial Park', 'under-construction', '2020', 210, 0.008, 0.007, 'Eastern-province zone near Batticaloa; textiles & manufacturing.'],
  ['Kuchchaveli Tourism SEZ', 81.100, 8.752, 'Special Economic Zone', 'proposed', '—', 400, 0.010, 0.010, 'Proposed tourism-focused SEZ on the Trincomalee coast.'],
]

const features = ZONES.map(([name, lng, lat, kind, status, established, extent, hw, hh, note]) => ({
  type: 'Feature',
  properties: {
    name,
    kind,
    status,
    established,
    extent_ha: extent,
    note,
    boundary: 'approximate',
    source: boi.name,
    source_url: boi.url,
    updated: boi.refreshed,
  },
  geometry: { type: 'Polygon', coordinates: rect(lng, lat, hw, hh) },
}))

// Self-check before writing: rings closed, plausible LK bounds, no dupes.
const seen = new Set()
for (const f of features) {
  const ring = f.geometry.coordinates[0]
  const a = ring[0]
  const z = ring[ring.length - 1]
  if (a[0] !== z[0] || a[1] !== z[1]) throw new Error(`ring not closed: ${f.properties.name}`)
  for (const [x, y] of ring) {
    if (x < 79 || x > 82 || y < 5.5 || y > 10) throw new Error(`out of LK bounds: ${f.properties.name}`)
  }
  if (seen.has(f.properties.name)) throw new Error(`duplicate zone: ${f.properties.name}`)
  seen.add(f.properties.name)
}

const fc = {
  type: 'FeatureCollection',
  source: boi.name,
  vintage: boi.vintage,
  licence: boi.licence,
  refreshed: boi.refreshed,
  features,
}

await writeFile('public/data/boi-zones.geojson', JSON.stringify(fc))
const byStatus = features.reduce((a, f) => ((a[f.properties.status] = (a[f.properties.status] || 0) + 1), a), {})
console.log(`Wrote ${features.length} BOI zones →`, byStatus)
