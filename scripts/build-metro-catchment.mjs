// Build pedestrian-catchment (walkshed) isochrones for every Colombo Metro stop,
// rendered as the actual REACHABLE STREETS (a flood-fill of the road network),
// not a filled area.
//
// WHAT THIS IS
//   The standard transit "pedestrian catchment": which streets you can reach on
//   foot from a stop in 5 and 10 minutes, following the real network — so it
//   answers "which streets does this stop actually serve", and floods only the
//   roads. Plus a last-mile ring for bike/three-wheeler feeder trips.
//
//   Standard (ITDP/FTA/TCRP; Colombo planning follows the same via CoMTrans /
//   Western Region Megapolis):
//     • 5-min walk  ≈ 400 m   — primary bus catchment
//     • 10-min walk ≈ 800 m   — generous / rail-grade catchment
//     • last-mile   ≈ 3 km    — FTA "bikeshed" (bike / e-scooter / tuk feeder)
//   Walking speed assumed 80 m/min (~4.8 km/h).
//
// METHOD
//   Pull the walkable OSM street network around the stops (Overpass), build a
//   routable graph by merging shared coordinates into nodes, run Dijkstra from
//   each stop (cap 800 m), then emit every reached EDGE as a LineString stamped
//   with `d` = walking metres from the stop (so the map colours 5-min vs 10-min).
//   The blanket "coverage" view is just all stops' edges drawn together; the
//   per-stop view filters to one stop. The 3 km last-mile ring is a straight-line
//   circle (feeder modes aren't foot-network bound).
//
// PROVENANCE: geometry © OpenStreetMap (Overpass), ODbL. Idempotent + validates.
// Usage: bun run build:metro-catchment

import { readFile, writeFile } from 'node:fs/promises'
import * as turf from '@turf/turf'

const VINTAGE = '2026-10'
const SOURCE = 'OpenStreetMap walking network (Overpass) — walkshed by developing-country.org'
const LICENCE = 'ODbL (OpenStreetMap)'

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
]

const WALK_SPEED = 80 // m/min
const CAP_M = 800 // Dijkstra cap = 10-min walk
const BAND5_M = 400 // 5-min walk
const LASTMILE_M = 3000
const SNAP_RADIUS = 1000 // Overpass pull radius around each stop (≥ cap + slack)

// --- geo helpers -------------------------------------------------------------
const R = 6371000
const rad = (x) => (x * Math.PI) / 180
function haversine([lo1, la1], [lo2, la2]) {
  const h =
    Math.sin(rad(la2 - la1) / 2) ** 2 +
    Math.cos(rad(la1)) * Math.cos(rad(la2)) * Math.sin(rad(lo2 - lo1) / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
const nodeKey = ([lon, lat]) => `${lon.toFixed(7)},${lat.toFixed(7)}`
const round6 = ([lon, lat]) => [Math.round(lon * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6]

// --- Overpass ----------------------------------------------------------------
function buildQuery(stops) {
  // Keep trunk (A0/A1) — pedestrians here do walk along them, and several stops
  // sit right on one. Only drop genuinely non-walkable classes.
  const excl = '^(motorway|motorway_link|construction|proposed|raceway|bus_guideway|escape)$'
  const arounds = stops
    .map((s) => `way(around:${SNAP_RADIUS},${s.lat},${s.lon})["highway"]["highway"!~"${excl}"]["area"!="yes"];`)
    .join('\n  ')
  return `[out:json][timeout:300];\n(\n  ${arounds}\n);\nout geom;`
}

async function queryOverpass(query) {
  let lastErr
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      console.log(`Querying ${endpoint} …`)
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'User-Agent': 'developing-country.org/metro-catchment' },
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

// --- graph -------------------------------------------------------------------
function buildGraph(elements) {
  const adj = new Map() // key -> [{to, w}]
  const coord = new Map() // key -> [lon,lat]
  const add = (aKey, bKey, w) => {
    if (!adj.has(aKey)) adj.set(aKey, [])
    adj.get(aKey).push({ to: bKey, w })
  }
  for (const el of elements) {
    if (el.type !== 'way' || !el.geometry) continue
    let prev = null
    for (const g of el.geometry) {
      const c = [g.lon, g.lat]
      const k = nodeKey(c)
      if (!coord.has(k)) coord.set(k, c)
      if (prev) {
        const w = haversine(coord.get(prev), c)
        if (w > 0) { add(prev, k, w); add(k, prev, w) }
      }
      prev = k
    }
  }
  return { adj, coord }
}

/** Connected-component size for each node (union-find), so snapping can ignore
 *  tiny disconnected stubs (driveways, fragments) and hit the real network. */
function componentSizes(coord, adj) {
  const parent = new Map()
  for (const k of coord.keys()) parent.set(k, k)
  const find = (x) => { let r = x; while (parent.get(r) !== r) r = parent.get(r); while (parent.get(x) !== r) { const n = parent.get(x); parent.set(x, r); x = n } return r }
  for (const [u, nbrs] of adj) for (const { to: v } of nbrs) { const ru = find(u), rv = find(v); if (ru !== rv) parent.set(ru, rv) }
  const rootSize = new Map()
  for (const k of coord.keys()) { const r = find(k); rootSize.set(r, (rootSize.get(r) ?? 0) + 1) }
  const size = new Map()
  for (const k of coord.keys()) size.set(k, rootSize.get(find(k)))
  return size
}

/** Perpendicular distance (m) from p to segment a–b, and the parameter t of the
 *  foot of the perpendicular (0 = at a, 1 = at b). Local equirectangular metres. */
function segDist(p, a, b) {
  const mLat = 111320
  const mLon = 111320 * Math.cos(rad(p[1]))
  const ax = (a[0] - p[0]) * mLon, ay = (a[1] - p[1]) * mLat
  const bx = (b[0] - p[0]) * mLon, by = (b[1] - p[1]) * mLat
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 > 0 ? -(ax * dx + ay * dy) / len2 : 0
  t = Math.max(0, Math.min(1, t))
  return { dist: Math.hypot(ax + t * dx, ay + t * dy), t }
}

/** Snap a stop to the nearest EDGE (road), not the nearest vertex — long road
 *  segments can put the nearest vertex hundreds of metres off. Returns Dijkstra
 *  seeds: both endpoints of that edge with the correct along-road distances, so
 *  the walkshed originates at the stop itself. null if no road is within `maxM`. */
function snapSeeds(edgeList, coord, pt, maxM) {
  let best = { dist: Infinity, u: null, v: null, t: 0 }
  for (const [u, v] of edgeList) {
    const r = segDist(pt, coord.get(u), coord.get(v))
    if (r.dist < best.dist) best = { dist: r.dist, u, v, t: r.t }
  }
  if (!best.u || best.dist > maxM) return null
  const segLen = haversine(coord.get(best.u), coord.get(best.v))
  return { seeds: [[best.u, best.dist + best.t * segLen], [best.v, best.dist + (1 - best.t) * segLen]], perp: best.dist }
}

// --- minimal binary min-heap -------------------------------------------------
class Heap {
  constructor() { this.a = [] }
  get size() { return this.a.length }
  push(item) {
    const a = this.a
    a.push(item)
    let i = a.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (a[p].d <= a[i].d) break
      ;[a[p], a[i]] = [a[i], a[p]]
      i = p
    }
  }
  pop() {
    const a = this.a
    const top = a[0]
    const last = a.pop()
    if (a.length) {
      a[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1, r = l + 1
        let s = i
        if (l < a.length && a[l].d < a[s].d) s = l
        if (r < a.length && a[r].d < a[s].d) s = r
        if (s === i) break
        ;[a[s], a[i]] = [a[i], a[s]]
        i = s
      }
    }
    return top
  }
}

/** Dijkstra from seed nodes (each with a starting distance), capped at CAP_M. */
function dijkstra(adj, seeds) {
  const dist = new Map()
  const heap = new Heap()
  for (const [k, d] of seeds) if (d < (dist.get(k) ?? Infinity)) { dist.set(k, d); heap.push({ k, d }) }
  while (heap.size) {
    const { k, d } = heap.pop()
    if (d > (dist.get(k) ?? Infinity)) continue
    if (d > CAP_M) continue
    for (const { to, w } of adj.get(k) ?? []) {
      const nd = d + w
      if (nd <= CAP_M && nd < (dist.get(to) ?? Infinity)) {
        dist.set(to, nd)
        heap.push({ k: to, d: nd })
      }
    }
  }
  return dist
}

/** Reached edges for one stop: each graph edge with both endpoints in reach,
 *  as a LineString stamped with `d` (metres from the stop, the nearer endpoint). */
function stopEdges(adj, coord, dist, stopName) {
  const seen = new Set()
  const out = []
  for (const [u, du] of dist) {
    const cu = coord.get(u)
    for (const { to: v } of adj.get(u) ?? []) {
      const dv = dist.get(v)
      if (dv === undefined) continue
      const ek = u < v ? `${u}|${v}` : `${v}|${u}`
      if (seen.has(ek)) continue
      seen.add(ek)
      out.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [round6(cu), round6(coord.get(v))] },
        properties: { kind: 'stop', stop: stopName, d: Math.round(Math.min(du, dv)) },
      })
    }
  }
  return out
}

async function build() {
  const metro = JSON.parse(await readFile('public/data/metro.geojson', 'utf8'))
  const stops = metro.features
    .filter((f) => f.properties.kind === 'stop')
    .map((f) => ({ name: f.properties.name, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] }))
  console.log(`Stops: ${stops.length}. Fetching walking network (around ${SNAP_RADIUS} m) …`)

  const osm = await queryOverpass(buildQuery(stops))
  const { adj, coord } = buildGraph(osm.elements ?? [])
  // Unique undirected edges, for nearest-edge snapping.
  const edgeList = []
  const seenEdge = new Set()
  for (const [u, nbrs] of adj) for (const { to: v } of nbrs) {
    const ek = u < v ? `${u}|${v}` : `${v}|${u}`
    if (!seenEdge.has(ek)) { seenEdge.add(ek); edgeList.push([u, v]) }
  }
  // Snap only against edges in a well-connected component (skip stubs/fragments).
  const compSize = componentSizes(coord, adj)
  const mainEdges = edgeList.filter(([u]) => (compSize.get(u) ?? 0) >= 200)
  console.log(`Graph: ${coord.size} nodes, ${edgeList.length} edges (${mainEdges.length} on the main network)`)

  const edgeFeatures = []
  const ringFeatures = []
  let reachedStops = 0
  for (const stop of stops) {
    const snap = snapSeeds(mainEdges, coord, [stop.lon, stop.lat], 400)
    if (snap) {
      const edges = stopEdges(adj, coord, dijkstra(adj, snap.seeds), stop.name)
      if (edges.length) reachedStops++
      edgeFeatures.push(...edges)
    } else {
      console.warn(`  ${stop.name}: no road within 400 m — no walkshed`)
    }
    // Last-mile feeder ring (straight-line; feeder modes aren't foot-network bound).
    ringFeatures.push({
      type: 'Feature',
      geometry: turf.circle([stop.lon, stop.lat], LASTMILE_M / 1000, { steps: 48 }).geometry,
      properties: { kind: 'lastmile', stop: stop.name, radius_m: LASTMILE_M, source: SOURCE, vintage: VINTAGE },
    })
  }
  // Draw far edges first, near edges last, so in the blanket view the 5-min
  // streets sit on top of the 10-min ones (a feature can't set its own z).
  edgeFeatures.sort((a, b) => b.properties.d - a.properties.d)
  console.log(`Edges: ${edgeFeatures.length} across ${reachedStops}/${stops.length} stops`)

  return {
    type: 'FeatureCollection',
    source: SOURCE, vintage: VINTAGE, licence: LICENCE,
    band5_m: BAND5_M, band10_m: CAP_M, walk_speed_m_per_min: WALK_SPEED,
    features: [...ringFeatures, ...edgeFeatures],
  }
}

function validate(fc, nStops) {
  const edges = fc.features.filter((f) => f.properties.kind === 'stop')
  const rings = fc.features.filter((f) => f.properties.kind === 'lastmile')
  if (rings.length !== nStops) throw new Error(`expected ${nStops} last-mile rings, got ${rings.length}`)
  if (edges.length < nStops * 20) throw new Error(`too few reached edges (${edges.length}) — Overpass/graph likely failed`)
  const stopsWithEdges = new Set(edges.map((f) => f.properties.stop)).size
  if (stopsWithEdges < nStops * 0.9) throw new Error(`only ${stopsWithEdges}/${nStops} stops have street edges`)
}

const run = async () => {
  const metro = JSON.parse(await readFile('public/data/metro.geojson', 'utf8'))
  const nStops = metro.features.filter((f) => f.properties.kind === 'stop').length
  const fc = await build()
  validate(fc, nStops)
  await writeFile('public/data/metro_catchment.geojson', JSON.stringify(fc))
  console.log(`Wrote public/data/metro_catchment.geojson — ${fc.features.length} features`)
}

run().catch((e) => { console.error(e); process.exit(1) })
