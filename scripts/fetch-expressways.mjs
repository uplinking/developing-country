// Fetch Sri Lanka's expressway network (open + under-construction + proposed)
// from OpenStreetMap via the Overpass API and write it as GeoJSON.
//
// This seeds the "Highways (incl. projected)" layer with REAL data without
// needing the heavy osmium/tippecanoe toolchain. The full pipeline (data/
// pipeline.sh) supersedes this for the tier-classified road network, but this
// gives us the projected-expressway showcase immediately.
//
// Usage: bun run fetch:expressways

import { writeFile } from 'node:fs/promises'
import { curatedExpresswayFeatures } from './expressways-curated.mjs'

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
]

// Ways whose ref starts with "E0" (E01..E09) plus any motorway classified as
// construction/proposed. `area["ISO3166-1"="LK"]` scopes to Sri Lanka.
const query = `
[out:json][timeout:180];
area["ISO3166-1"="LK"][admin_level=2]->.lk;
(
  way(area.lk)["highway"="motorway"]["ref"~"^E0"];
  way(area.lk)["highway"="motorway_link"]["ref"~"^E0"];
  way(area.lk)["highway"="trunk"]["ref"~"^E0"];
  way(area.lk)["highway"="construction"]["ref"~"^E0"];
  way(area.lk)["highway"="proposed"]["ref"~"^E0"];
  way(area.lk)["highway"="construction"]["construction"="motorway"];
  way(area.lk)["highway"="proposed"]["proposed"="motorway"];
  way(area.lk)["highway"="construction"]["name"~"Central Expressway",i];
  way(area.lk)["highway"="proposed"]["name"~"Central Expressway",i];
  way(area.lk)["highway"="motorway"]["name"~"Central Expressway",i];
  node(area.lk)["highway"="motorway_junction"];
);
out geom;
`

function statusOf(tags) {
  const hw = tags.highway
  if (hw === 'construction') return 'construction'
  if (hw === 'proposed') return 'proposed'
  return 'open' // motorway / trunk
}

async function queryOverpass() {
  let lastErr
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      console.log(`Querying ${endpoint} …`)
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          'User-Agent': 'developing-country.org/1.0 (expressway data build; +https://explore.developing-country.org)',
        },
        body: 'data=' + encodeURIComponent(query),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
      return await res.json()
    } catch (e) {
      console.warn(`  failed: ${e.message}`)
      lastErr = e
    }
  }
  throw lastErr
}

const run = async () => {
  console.log('Fetching Sri Lanka expressways from Overpass…')
  const data = await queryOverpass()

  const features = []
  for (const el of data.elements) {
    if (el.type !== 'way' || !el.geometry) continue
    const t = el.tags || {}
    features.push({
      type: 'Feature',
      id: el.id,
      properties: {
        ref: t.ref || null,
        name: t.name || null,
        status: statusOf(t),
        highway: t.highway || null,
        lanes: t.lanes ? Number(t.lanes) : null,
        opening_date: t.opening_date || t['opening_date:planned'] || null,
      },
      geometry: {
        type: 'LineString',
        coordinates: el.geometry.map((p) => [p.lon, p.lat]),
      },
    })
  }

  // --- Expressway exits / interchanges (OSM highway=motorway_junction) -------
  // The canonical exit markers. Each carriageway maps its own junction node, so
  // cluster same-named nodes into one interchange and attach it to the nearest
  // expressway (its ref + status), dropping any that aren't near a known road.
  const R = 6371e3
  const rad = (x) => (x * Math.PI) / 180
  const hav = (a, b) => {
    const h = Math.sin(rad(b[1] - a[1]) / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(rad(b[0] - a[0]) / 2) ** 2
    return 2 * R * Math.asin(Math.sqrt(h))
  }
  const normName = (s) => (s || '').replace(/\s*(Exit|Interchange|IC|Junction)\s*/gi, ' ').trim()
  const nearestRoad = (p) => {
    let best = { d: Infinity, ref: null, status: null }
    for (const f of features) {
      if (f.geometry.type !== 'LineString' || !f.properties.ref) continue
      for (const c of f.geometry.coordinates) {
        const d = hav(p, c)
        if (d < best.d) best = { d, ref: f.properties.ref, status: f.properties.status }
      }
    }
    return best
  }
  const junctions = data.elements.filter(
    (e) => e.type === 'node' && e.tags?.highway === 'motorway_junction' && (e.tags.name || e.tags.ref),
  )
  const clusters = []
  for (const n of junctions) {
    const p = [n.lon, n.lat]
    const key = normName(n.tags.name) || n.tags.ref
    let c = clusters.find((c) => c.key === key && hav(c.pts[0], p) < 1500)
    if (!c) { c = { key, pts: [], name: n.tags.name || null, exit: n.tags.ref || null }; clusters.push(c) }
    c.pts.push(p)
    if (n.tags.ref) c.exit = n.tags.ref
    if (n.tags.name && !c.name) c.name = n.tags.name
  }
  let icCount = 0
  for (const c of clusters) {
    const lon = c.pts.reduce((s, p) => s + p[0], 0) / c.pts.length
    const lat = c.pts.reduce((s, p) => s + p[1], 0) / c.pts.length
    const road = nearestRoad([lon, lat])
    if (road.d > 1200) continue // not near a known expressway — skip off-network / mismapped
    features.push({
      type: 'Feature',
      id: 'ic-osm-' + c.key.replace(/\s+/g, '-').toLowerCase(),
      properties: {
        type: 'interchange',
        name: c.name || c.key,
        exit: c.exit || null,
        ref: road.ref,
        status: road.status,
        source: 'OpenStreetMap',
        highway: 'motorway_junction',
      },
      geometry: { type: 'Point', coordinates: [lon, lat] },
    })
    icCount++
  }
  console.log(`Interchanges (OSM motorway_junction): ${icCount} added`)

  // Curated additions — Central Expressway "Kandy Link" (Section 3, proposed,
  // ~32 km), which has its own RDA EIA and is absent from OSM. Alignment and
  // interchange positions were re-digitised (2026-07) by reading exact vertex
  // coordinates out of the shared "CEP 1,2,3,4 mapped out" Google Earth project
  // (the Reddit-sourced mapping) via Earth's per-placemark location readout —
  // Pothuhera IC → kaha turn → Galagedara IC. The link runs east/south-east
  // staying around lat 7.37–7.42 (an earlier hand-drawn version wrongly dipped
  // to ~7.29); it terminates at Galagedara IC, ~10 km NW of Kandy.
  const CEP3_SRC =
    'https://rda.gov.lk/images/publications/pdf/Proposed_Central_Expressway_Project_Section_03/1%20EMP_Final_CEP%203_3%20March%202017%20%20with%20Annexes.pdf'
  features.push({
    type: 'Feature',
    id: 'cep-section3-kandy-link',
    properties: {
      ref: 'E04',
      name: 'Central Expressway – Kandy Link (Section 3)',
      status: 'proposed',
      highway: 'proposed',
      lanes: 4,
      curated: true,
      note: 'Pothuhera → kaha turn → Galagedara (terminates ~10 km NW of Kandy). Vertices read from the shared Google Earth project; alignment indicative.',
      source_url: CEP3_SRC,
    },
    geometry: {
      type: 'LineString',
      // West→east, from the E04 main-line junction near Pothuhera to Galagedara IC.
      coordinates: [
        [80.3644, 7.4181], [80.4160, 7.4076], [80.4377, 7.3929],
        [80.4653, 7.3993], [80.4687, 7.3970], [80.4799, 7.3872],
        [80.5061, 7.3724], [80.5130, 7.3698], [80.5174, 7.3698],
        [80.5284, 7.3698],
      ],
    },
  })
  // Section 3 interchanges (proposed) — coordinates read from the Google Earth
  // project's placemarks. Pothuhera IC is the western junction with the E04 main
  // line; Galagedara IC is the eastern terminus (Kandy gateway).
  const cep3ICs = [
    ['Pothuhera IC', 80.3644, 7.4181, 'Junction with E04 main line (Kandy Link start)'],
    ['Galagedara IC', 80.5284, 7.3698, 'Galagedara — Kandy gateway (~10 km NW of Kandy)'],
  ]
  for (const [name, lng, lat, connects] of cep3ICs) {
    features.push({
      type: 'Feature',
      id: 'ic-' + name.replace(/\s+/g, '-').toLowerCase(),
      properties: { ref: 'E04', name, type: 'interchange', status: 'proposed', connects, curated: true, source_url: CEP3_SRC },
      geometry: { type: 'Point', coordinates: [lng, lat] },
    })
  }

  // Curated additions — proposed expressways not yet in OSM (Ruwanpura). These
  // budget/timeline-bearing project alignments used to sit in the developments
  // layer; they belong here, drawn dotted (proposed). Only add one where OSM has
  // no representation — the Central Expressway northern extension (Kurunegala–
  // Dambulla) is already in OSM as `E04 Central Expressway`, so it is NOT curated.
  // Shared with apply-curated-expressways.mjs so the two never drift.
  for (const f of curatedExpresswayFeatures()) features.push(f)

  const fc = { type: 'FeatureCollection', features }
  const counts = features.reduce((a, f) => {
    a[f.properties.status] = (a[f.properties.status] || 0) + 1
    return a
  }, {})
  await writeFile('public/data/expressways.geojson', JSON.stringify(fc))
  console.log(`Wrote ${features.length} segments →`, counts)
  const refs = [...new Set(features.map((f) => f.properties.ref).filter(Boolean))].sort()
  console.log('Refs found:', refs.join(', '))
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
