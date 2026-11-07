// Fetch Sri Lanka's "Explore" layers (nature, tourism, trails) from
// OpenStreetMap via the Overpass API and write them as GeoJSON in
// public/data/ for the explorer's nature and tourism layers.
//
// Produces five layers:
//   attractions.geojson  — points: tourism attractions/museums/zoos/viewpoints
//                          + historic forts/castles/archaeological sites/ruins
//   waterfalls.geojson   — points: waterway=waterfall
//   trails.geojson       — lines:  route=hiking|foot|walking relations (named)
//   cycling.geojson      — lines:  route=bicycle|mtb relations (named)
//   parks.geojson        — polys:  national parks, nature reserves, protected areas
//
// Plain Node >=18 (global fetch), no npm deps. Re-runnable / idempotent.
// Self-validating: asserts minimum feature counts and prints a summary table.
//
// Usage: bun run fetch:explore
//        bun scripts/fetch-explore.mjs attractions waterfalls   (subset)

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

// ---------------------------------------------------------------------------
// Overpass fetch with mirror failover + retry on 429/504.
// ---------------------------------------------------------------------------
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
            'User-Agent': 'developing-country.org/1.0 (explore data build; +https://explore.developing-country.org)',
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

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
const round5 = (n) => Math.round(n * 1e5) / 1e5

// Common web-link properties present on many OSM features.
function links(t) {
  const out = {}
  if (t.website || t['contact:website']) out.website = t.website || t['contact:website']
  if (t.wikipedia) out.wikipedia = t.wikipedia
  if (t.wikidata) out.wikidata = t.wikidata
  return out
}

function centerOf(el) {
  if (el.type === 'node') return [el.lon, el.lat]
  if (el.center) return [el.center.lon, el.center.lat]
  // Fallback: average the way geometry if present.
  if (el.geometry && el.geometry.length) {
    let x = 0, y = 0, n = 0
    for (const p of el.geometry) { x += p.lon; y += p.lat; n++ }
    if (n) return [x / n, y / n]
  }
  return null
}

// ---------------------------------------------------------------------------
// 1. Attractions
// ---------------------------------------------------------------------------
async function buildAttractions() {
  // category is derived below; keep the tag matrix in one place.
  const q = `
[out:json][timeout:180];
area(${AREA})->.lk;
(
  nwr(area.lk)["tourism"="attraction"];
  nwr(area.lk)["tourism"="museum"];
  nwr(area.lk)["tourism"="zoo"];
  nwr(area.lk)["tourism"="theme_park"];
  nwr(area.lk)["tourism"="viewpoint"];
  nwr(area.lk)["historic"="fort"];
  nwr(area.lk)["historic"="castle"];
  nwr(area.lk)["historic"="archaeological_site"];
  nwr(area.lk)["historic"="ruins"];
  nwr(area.lk)["historic"="monument"];
);
out center tags;
`
  const data = await queryOverpass(q, 'attractions')
  const features = []
  const seen = new Set()
  for (const el of data.elements) {
    const t = el.tags || {}
    const name = t.name || t['name:en']
    if (!name) continue // attractions must be named
    // Category: prefer a queried tourism value, else the queried historic value.
    // (Guard against secondary tags like tourism=hotel on a historic fort.)
    const TOURISM_CATS = new Set(['attraction', 'museum', 'zoo', 'theme_park', 'viewpoint'])
    const HISTORIC_CATS = new Set(['fort', 'castle', 'archaeological_site', 'ruins', 'monument'])
    let category
    if (t.tourism && TOURISM_CATS.has(t.tourism)) category = t.tourism
    else if (t.historic && HISTORIC_CATS.has(t.historic)) category = t.historic
    else continue
    const coord = centerOf(el)
    if (!coord) continue
    // De-dupe features tagged both tourism+historic (only one element each, but
    // guard against a node + enclosing way of the same place).
    const key = `${name}|${round5(coord[0])}|${round5(coord[1])}`
    if (seen.has(key)) continue
    seen.add(key)
    features.push({
      type: 'Feature',
      id: `${el.type}/${el.id}`,
      properties: {
        name,
        category,
        tourism: t.tourism || null,
        historic: t.historic || null,
        osm_type: el.type,
        osm_id: el.id,
        source: 'OpenStreetMap',
        ...links(t),
      },
      geometry: { type: 'Point', coordinates: [round5(coord[0]), round5(coord[1])] },
    })
  }
  return { features, min: 100, key: 'attractions' }
}

// ---------------------------------------------------------------------------
// 2. Waterfalls
// ---------------------------------------------------------------------------
async function buildWaterfalls() {
  const q = `
[out:json][timeout:120];
area(${AREA})->.lk;
(
  nwr(area.lk)["waterway"="waterfall"];
  nwr(area.lk)["natural"="waterfall"];
);
out center tags;
`
  const data = await queryOverpass(q, 'waterfalls')
  const features = []
  const seen = new Set()
  for (const el of data.elements) {
    const t = el.tags || {}
    const coord = centerOf(el)
    if (!coord) continue
    const name = t.name || t['name:en'] || null // name optional for waterfalls
    const key = `${round5(coord[0])}|${round5(coord[1])}`
    if (seen.has(key)) continue
    seen.add(key)
    features.push({
      type: 'Feature',
      id: `${el.type}/${el.id}`,
      properties: {
        name,
        category: 'waterfall',
        height: t.height || null,
        osm_type: el.type,
        osm_id: el.id,
        source: 'OpenStreetMap',
        ...links(t),
      },
      geometry: { type: 'Point', coordinates: [round5(coord[0]), round5(coord[1])] },
    })
  }
  return { features, min: 30, key: 'waterfalls' }
}

// ---------------------------------------------------------------------------
// Route relations → (Multi)LineString  (shared by trails + cycling)
// ---------------------------------------------------------------------------
function buildRouteFeatures(data, category, { allowUnnamed = false } = {}) {
  const features = []
  for (const el of data.elements) {
    if (el.type !== 'relation' || !el.members) continue
    const t = el.tags || {}
    let name = t.name || t['name:en'] || null
    if (!name) {
      if (!allowUnnamed) continue // named routes only
      // Synthesize a label so the feature is still usable on the map.
      name = t.ref ? `${category === 'cycling' ? 'Cycling' : 'Route'} ${t.ref}` : null
    }
    // Collect way-member geometries as line segments.
    const lines = []
    for (const m of el.members) {
      if (m.type !== 'way' || !m.geometry || m.geometry.length < 2) continue
      // Skip stop/platform-ish roles that aren't the path itself.
      if (m.role && /stop|platform|guidepost|marker/i.test(m.role)) continue
      lines.push(m.geometry.map((p) => [round5(p.lon), round5(p.lat)]))
    }
    if (!lines.length) continue
    const geometry =
      lines.length === 1
        ? { type: 'LineString', coordinates: lines[0] }
        : { type: 'MultiLineString', coordinates: lines }
    features.push({
      type: 'Feature',
      id: `relation/${el.id}`,
      properties: {
        name,
        category,
        ref: t.ref || null,
        distance: t.distance || null,
        network: t.network || null,
        route: t.route || null,
        osm_type: 'relation',
        osm_id: el.id,
        source: 'OpenStreetMap',
        ...links(t),
      },
      geometry,
    })
  }
  return features
}

async function buildTrails() {
  const q = `
[out:json][timeout:240];
area(${AREA})->.lk;
(
  relation(area.lk)["route"="hiking"];
  relation(area.lk)["route"="foot"];
  relation(area.lk)["route"="walking"];
);
out geom;
`
  const data = await queryOverpass(q, 'trails')
  const features = buildRouteFeatures(data, 'hiking')
  return { features, min: 10, key: 'trails' }
}

async function buildCycling() {
  const q = `
[out:json][timeout:240];
area(${AREA})->.lk;
(
  relation(area.lk)["route"="bicycle"];
  relation(area.lk)["route"="mtb"];
);
out geom;
`
  const data = await queryOverpass(q, 'cycling')
  // OSM has very few cycling route relations for Sri Lanka (mostly unnamed), so
  // — like waterfalls — we keep unnamed ones (synthesizing a label). The
  // manifesto's curated hill-country biking routes will augment this later.
  const features = buildRouteFeatures(data, 'cycling', { allowUnnamed: true })
  return { features, min: 1, key: 'cycling' }
}

// ---------------------------------------------------------------------------
// 5. Parks / protected areas → polygons
// ---------------------------------------------------------------------------

// Stitch relation way-members into closed rings (outer + inner).
function stitchRings(members) {
  const segs = members
    .filter((m) => m.type === 'way' && m.geometry && m.geometry.length >= 2)
    .map((m) => ({
      role: m.role === 'inner' ? 'inner' : 'outer',
      pts: m.geometry.map((p) => [p.lon, p.lat]),
    }))
  const rings = { outer: [], inner: [] }
  for (const role of ['outer', 'inner']) {
    const pool = segs.filter((s) => s.role === role).map((s) => s.pts.slice())
    while (pool.length) {
      let ring = pool.shift()
      let extended = true
      while (extended && !isClosed(ring)) {
        extended = false
        for (let i = 0; i < pool.length; i++) {
          const seg = pool[i]
          const rEnd = ring[ring.length - 1]
          const sStart = seg[0]
          const sEnd = seg[seg.length - 1]
          if (samePt(rEnd, sStart)) { ring = ring.concat(seg.slice(1)); pool.splice(i, 1); extended = true; break }
          if (samePt(rEnd, sEnd)) { ring = ring.concat(seg.slice(0, -1).reverse()); pool.splice(i, 1); extended = true; break }
        }
      }
      if (ring.length >= 4) {
        if (!isClosed(ring)) ring.push(ring[0].slice()) // force-close if slightly open
        rings[role].push(ring)
      }
    }
  }
  return rings
}

const samePt = (a, b) => a[0] === b[0] && a[1] === b[1]
const isClosed = (r) => r.length >= 4 && samePt(r[0], r[r.length - 1])

// Ring signed area (shoelace) in squared degrees — used to drop tiny inner rings.
function ringArea(ring) {
  let a = 0
  for (let i = 0; i < ring.length - 1; i++) {
    a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
  }
  return Math.abs(a / 2)
}

// Perpendicular-distance simplification (Douglas–Peucker) on a ring/line.
function simplify(points, tol) {
  if (points.length <= 3) return points
  const keep = new Array(points.length).fill(false)
  keep[0] = keep[points.length - 1] = true
  const stack = [[0, points.length - 1]]
  while (stack.length) {
    const [s, e] = stack.pop()
    let maxD = 0, idx = -1
    for (let i = s + 1; i < e; i++) {
      const d = perpDist(points[i], points[s], points[e])
      if (d > maxD) { maxD = d; idx = i }
    }
    if (maxD > tol && idx !== -1) {
      keep[idx] = true
      stack.push([s, idx], [idx, e])
    }
  }
  return points.filter((_, i) => keep[i])
}

function perpDist(p, a, b) {
  const [x, y] = p, [x1, y1] = a, [x2, y2] = b
  const dx = x2 - x1, dy = y2 - y1
  if (dx === 0 && dy === 0) return Math.hypot(x - x1, y - y1)
  const t = ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)
  const cx = x1 + t * dx, cy = y1 + t * dy
  return Math.hypot(x - cx, y - cy)
}

function roundRing(ring) {
  return ring.map((p) => [round5(p[0]), round5(p[1])])
}

async function buildParks() {
  const q = `
[out:json][timeout:300];
area(${AREA})->.lk;
(
  nwr(area.lk)["boundary"="national_park"];
  nwr(area.lk)["leisure"="nature_reserve"];
  nwr(area.lk)["boundary"="protected_area"];
);
out geom;
`
  const data = await queryOverpass(q, 'parks')

  const MIN_INNER_AREA = 1e-6 // ~ small; drop tiny holes to save bytes
  const SIMPLIFY_TOL = 0.0002 // ~20m; light vertex thinning

  const raw = []
  for (const el of data.elements) {
    const t = el.tags || {}
    const name = t.name || t['name:en']
    if (!name) continue

    // protect_class filter: keep <=6 or unset (drop high-class e.g. military).
    const pc = t.protect_class != null ? Number(t.protect_class) : null
    if (pc != null && !Number.isNaN(pc) && pc > 6) continue

    let category = 'protected_area'
    if (t.boundary === 'national_park') category = 'national_park'
    else if (t.leisure === 'nature_reserve') category = 'nature_reserve'

    // Assemble polygon geometry.
    let polygons = [] // array of polygons, each [outer, ...inners]
    if (el.type === 'way' && el.geometry && el.geometry.length >= 4) {
      let ring = el.geometry.map((p) => [p.lon, p.lat])
      if (!isClosed(ring)) ring.push(ring[0].slice())
      polygons = [[ring]]
    } else if (el.type === 'relation' && el.members) {
      const { outer, inner } = stitchRings(el.members)
      if (!outer.length) continue
      // Assign each inner ring to the first outer (simple heuristic — fine here).
      const inners = inner.filter((r) => ringArea(r) >= MIN_INNER_AREA)
      if (outer.length === 1) {
        polygons = [[outer[0], ...inners]]
      } else {
        // Multiple outers → separate polygons; attach all inners to first (rare).
        polygons = outer.map((o, i) => (i === 0 ? [o, ...inners] : [o]))
      }
    } else continue
    if (!polygons.length) continue

    raw.push({ el, t, name, category, pc, polygons })
  }

  // Simplify + round, then build features. Tighten simplification adaptively if
  // the serialized size is over the budget.
  function makeFeatures(tol) {
    const feats = []
    for (const r of raw) {
      const polys = r.polygons
        .map((poly) =>
          poly
            .map((ring) => {
              const simp = simplify(ring, tol)
              const rr = roundRing(simp)
              if (!isClosed(rr)) rr.push(rr[0].slice())
              return rr
            })
            .filter((ring) => ring.length >= 4)
        )
        .filter((poly) => poly.length >= 1)
      if (!polys.length) continue
      const geometry =
        polys.length === 1
          ? { type: 'Polygon', coordinates: polys[0] }
          : { type: 'MultiPolygon', coordinates: polys.map((p) => p) }
      feats.push({
        type: 'Feature',
        id: `${r.el.type}/${r.el.id}`,
        properties: {
          name: r.name,
          category: r.category,
          boundary: r.t.boundary || null,
          leisure: r.t.leisure || null,
          protect_class: r.pc,
          protection_title: r.t.protection_title || null,
          osm_type: r.el.type,
          osm_id: r.el.id,
          source: 'OpenStreetMap',
          ...links(r.t),
        },
        geometry,
      })
    }
    return feats
  }

  let tol = SIMPLIFY_TOL
  let features = makeFeatures(tol)
  const BUDGET = 3 * 1024 * 1024
  for (let i = 0; i < 4; i++) {
    const size = Buffer.byteLength(JSON.stringify({ type: 'FeatureCollection', features }))
    if (size <= BUDGET) break
    tol *= 2
    console.log(`  [parks] ${(size / 1e6).toFixed(2)}MB over budget — re-simplifying at tol=${tol}`)
    features = makeFeatures(tol)
  }
  return { features, min: 20, key: 'parks' }
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------
const BUILDERS = {
  attractions: buildAttractions,
  waterfalls: buildWaterfalls,
  trails: buildTrails,
  cycling: buildCycling,
  parks: buildParks,
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
      const fc = { type: 'FeatureCollection', ...COMMON, features }
      const json = JSON.stringify(fc)
      const path = resolve(OUT_DIR, `${key}.geojson`)
      // Validate: parse back + count.
      const parsed = JSON.parse(json)
      const n = parsed.features.length
      const sizeMB = (Buffer.byteLength(json) / 1e6).toFixed(2)
      const ok = n >= min
      if (!ok) failed = true
      await writeFile(path, json)
      summary.push({ key, count: n, min, sizeMB, ok })
      console.log(`  wrote ${n} features → public/data/${key}.geojson (${sizeMB}MB) ${ok ? 'OK' : 'FAIL (below min ' + min + ')'}`)
    } catch (e) {
      failed = true
      summary.push({ key, count: 0, min: BUILDERS[key] ? '?' : '?', sizeMB: '0', ok: false })
      console.error(`  ERROR: ${e.message}`)
    }
  }

  // Summary table
  console.log('\n─── Explore layers summary ───')
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
  console.log('\nAll Explore layers built and validated.')
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
