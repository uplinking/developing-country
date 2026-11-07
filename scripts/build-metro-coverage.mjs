#!/usr/bin/env bun
// Colombo Metro Bus coverage — "Who will Colombo's metro buses reach?"
//
// WHAT THIS BUILDS (derived Dataset Versions, completeness `derived`)
//   public/data/metro_walksheds.geojson     5/10-min network walksheds + 800 m circles
//                                           per stop, per line and for the network
//   public/data/metro-coverage-stops.json   Indicator Table, one row per stop
//   public/data/metro-coverage-lines.json   Indicator Table, one row per line + 'ALL'
//   public/data/metro-coverage-gnd.json     Indicator Table, one row per study-area GN division
//   public/data/metro-coverage-facilities.json  Indicator Table, schools, hospitals + offices
//   public/data/metro-coverage-deciles.json Indicator Table, study-area density deciles
//
// INPUTS (all already tracked except the GN polygons, which are cached)
//   public/data/metro.geojson     7 CM lines + 110 stops (lk-metro, MIT; OSRM geometry ODbL)
//   public/data/walk-colombo.json OSM foot graph (osm-walk-colombo, ODbL) — envelope
//                                 = stop bbox + 1.5 km, so every stop is inside it
//   public/data/gnd-index.json    GN population (Census 2024 via lk_census_2024; the
//                                 Census 2012 count where the 2024 id join failed)
//   public/data/schools.geojson, hospitals.geojson (OSM, ODbL)
//   Overture Maps Places (CDLA-Permissive-2.0), classified into offices and other
//   businesses by scripts/build-workplaces.mjs from the gitignored cache written by
//   `uvx --with duckdb python -I scripts/fetch-overture-places.py` (needs uv)
//   GN division polygons from nuuuwan/gig-data (MIT) geo/gnd/<id>.json — only the
//   candidates near the lines are fetched, into the gitignored cache
//   data/src/gig-data/geo/gnd/ (or read from $GIG_DIR/geo/gnd when set). Downloaded
//   content is parsed as coordinate data only and validated before use.
//
// METHOD (conventions shared with build-metro-catchment.mjs)
//   • Walking speed 80 m/min: 5 min = 400 m, 10 min = 800 m of network distance.
//   • Stops (and every other origin) snap to the nearest EDGE of the main walk
//     network (components ≥ 200 nodes); the perpendicular offset counts as walking.
//   • Dijkstra from the snapped stop; edges are cut exactly where the budget runs
//     out (partial edges count), so a long street is not all-or-nothing.
//   • Walkshed area = every reached street segment buffered 50 m either side and
//     unioned (a "sausage" network buffer, cf. Oliver, Schuurman & Hall 2007). 50 m
//     is the plot depth a pedestrian reaches from the street they are on: it keeps
//     the frontage, and excludes block interiors, rail yards, water and parks that no
//     street reaches. Line and network walksheds are multi-source Dijkstra from all
//     of their stops, which equals the union of the stop walksheds exactly.
//   • Comparison: the conventional 800 m straight-line circle around each stop.
//   • All areas are computed on a 5 m raster in a local equal-area (sinusoidal)
//     projection: polygons are only for display. Raster unions are exact set
//     unions, so "unique population" never double counts overlapping stops.
//   • Study area: every GN division whose polygon lies within 2 km of a CM line.
//   • Population inside a shape = Σ pop(GND) × share of the GND's raster cells
//     inside it (uniform density within each GN division — a known limitation).
//   • Nearest stop (GND centroid, facility) = shortest network walk to any stop.
//
// Idempotent: deterministic, sorted, rounded; validates everything before writing
// and only rewrites files whose bytes change. Second run is a no-op.
// Usage: bun scripts/build-metro-coverage.mjs [--check]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseIndicatorTable } from '@developing-country/datasets'
import { OFFICE_TYPES as OFFICE_TYPE_LABELS, loadPlaces } from './build-workplaces.mjs'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const GIG_CACHE = join(ROOT, 'data/src/gig-data/geo/gnd')
const GIG_RAW = 'https://raw.githubusercontent.com/nuuuwan/gig-data/master/geo/gnd'
const UA = 'developing-country.org/metro-coverage'

export const CONFIG = Object.freeze({
  walkMetresPerMinute: 80,
  band5m: 400,
  band10m: 800,
  circleM: 800,
  frontageM: 50,
  studyBufferM: 2000,
  cellM: 5,
  simplifyM: 5,
  mainComponentMinNodes: 200,
  stopSnapMaxM: 250,
  pointSnapMaxM: 1000,
  districts: ['Colombo', 'Gampaha', 'Kalutara'],
})

export const SOURCE_IDS = Object.freeze([
  'metro-coverage',
  'lk-metro',
  'osm-walk-colombo',
  'lk-census-2024',
  'gig-data-gnd-boundaries',
  'osm',
  'overture-places',
])
export const VINTAGE = 'Walk graph 2026-10 · Census 2024 · CM stops 2026-08 · Overture 2026-09-23.1'
const COUNTRY = 'LK'

// ---------------------------------------------------------------------------
// Projection: sinusoidal about the study area (equal-area; < 0.01 % scale error
// across the 45 km extent). x/y in metres.
const LAT0 = 6.9
const LNG0 = 79.92
const rad = (d) => (d * Math.PI) / 180
const KY = 111132.954 - 559.822 * Math.cos(2 * rad(LAT0)) + 1.175 * Math.cos(4 * rad(LAT0))
const kx = (lat) => 111412.84 * Math.cos(rad(lat)) - 93.5 * Math.cos(3 * rad(lat)) + 0.118 * Math.cos(5 * rad(lat))
export function project(lng, lat) {
  return [(lng - LNG0) * kx(lat), (lat - LAT0) * KY]
}
export function unproject(x, y) {
  const lat = LAT0 + y / KY
  return [LNG0 + x / kx(lat), lat]
}

// ---------------------------------------------------------------------------
// Small numeric helpers
export const round = (v, d = 0) => {
  const f = 10 ** d
  const r = Math.round(v * f) / f
  return Object.is(r, -0) ? 0 : r
}

export function slug(name) {
  return name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Distance² from point (px,py) to segment (ax,ay)-(bx,by) and the foot parameter t. */
export function segFoot(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0
  if (t < 0) t = 0
  else if (t > 1) t = 1
  const fx = ax + t * dx - px
  const fy = ay + t * dy - py
  return { d2: fx * fx + fy * fy, t }
}

// ---------------------------------------------------------------------------
// Binary heap keyed on Float64 priorities (node ids in an Int32 store).
class Heap {
  constructor() {
    this.k = []
    this.v = []
  }
  get size() {
    return this.k.length
  }
  push(key, val) {
    const k = this.k
    const v = this.v
    k.push(key)
    v.push(val)
    let i = k.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (k[p] <= k[i]) break
      ;[k[p], k[i]] = [k[i], k[p]]
      ;[v[p], v[i]] = [v[i], v[p]]
      i = p
    }
  }
  pop() {
    const k = this.k
    const v = this.v
    const topK = k[0]
    const topV = v[0]
    const lk = k.pop()
    const lv = v.pop()
    if (k.length) {
      k[0] = lk
      v[0] = lv
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let s = i
        if (l < k.length && k[l] < k[s]) s = l
        if (r < k.length && k[r] < k[s]) s = r
        if (s === i) break
        ;[k[s], k[i]] = [k[i], k[s]]
        ;[v[s], v[i]] = [v[i], v[s]]
        i = s
      }
    }
    return [topK, topV]
  }
}

// ---------------------------------------------------------------------------
// Walk graph
export function buildGraph(raw) {
  if (!raw || raw.packed !== true || !Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) {
    throw new Error('walk graph: expected packed { nodes, edges }')
  }
  const n = raw.nodes.length / 2
  const m = raw.edges.length / 3
  if (!Number.isInteger(n) || !Number.isInteger(m)) throw new Error('walk graph: malformed packed arrays')
  const lng = new Float64Array(n)
  const lat = new Float64Array(n)
  const x = new Float64Array(n)
  const y = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    lng[i] = raw.nodes[2 * i]
    lat[i] = raw.nodes[2 * i + 1]
    const p = project(lng[i], lat[i])
    x[i] = p[0]
    y[i] = p[1]
  }
  const ea = new Int32Array(m)
  const eb = new Int32Array(m)
  const ew = new Float64Array(m)
  const deg = new Int32Array(n + 1)
  for (let e = 0; e < m; e++) {
    const a = raw.edges[3 * e]
    const b = raw.edges[3 * e + 1]
    const w = raw.edges[3 * e + 2]
    if (!(a >= 0 && a < n && b >= 0 && b < n && w > 0)) throw new Error(`walk graph: bad edge ${e}`)
    ea[e] = a
    eb[e] = b
    ew[e] = w
    deg[a + 1]++
    deg[b + 1]++
  }
  for (let i = 0; i < n; i++) deg[i + 1] += deg[i]
  const adjNode = new Int32Array(2 * m)
  const adjEdge = new Int32Array(2 * m)
  const fill = deg.slice(0, n)
  for (let e = 0; e < m; e++) {
    adjNode[fill[ea[e]]] = eb[e]
    adjEdge[fill[ea[e]]++] = e
    adjNode[fill[eb[e]]] = ea[e]
    adjEdge[fill[eb[e]]++] = e
  }
  // Connected components (union-find), to snap only onto the real network.
  const parent = new Int32Array(n)
  for (let i = 0; i < n; i++) parent[i] = i
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]
      i = parent[i]
    }
    return i
  }
  for (let e = 0; e < m; e++) {
    const ra = find(ea[e])
    const rb = find(eb[e])
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb)
  }
  const compSize = new Int32Array(n)
  for (let i = 0; i < n; i++) compSize[find(i)]++
  const nodeComp = new Int32Array(n)
  for (let i = 0; i < n; i++) nodeComp[i] = compSize[find(i)]
  return { n, m, lng, lat, x, y, ea, eb, ew, off: deg, adjNode, adjEdge, nodeComp, bbox: raw.bbox }
}

/** Uniform grid over main-network edges for nearest-edge snapping. */
export function edgeIndex(g, cell = 200) {
  const cells = new Map()
  for (let e = 0; e < g.m; e++) {
    if (g.nodeComp[g.ea[e]] < CONFIG.mainComponentMinNodes) continue
    const ax = g.x[g.ea[e]]
    const ay = g.y[g.ea[e]]
    const bx = g.x[g.eb[e]]
    const by = g.y[g.eb[e]]
    const i0 = Math.floor(Math.min(ax, bx) / cell)
    const i1 = Math.floor(Math.max(ax, bx) / cell)
    const j0 = Math.floor(Math.min(ay, by) / cell)
    const j1 = Math.floor(Math.max(ay, by) / cell)
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const key = `${i},${j}`
        let list = cells.get(key)
        if (!list) cells.set(key, (list = []))
        list.push(e)
      }
    }
  }
  return { cell, cells }
}

/** Nearest main-network edge to (px,py) within maxM: { edge, t, perp } or null. */
export function snap(g, idx, px, py, maxM) {
  const { cell, cells } = idx
  const ci = Math.floor(px / cell)
  const cj = Math.floor(py / cell)
  let best = null
  const maxRing = Math.ceil(maxM / cell) + 1
  for (let ring = 0; ring <= maxRing; ring++) {
    if (best && (ring - 1) * cell > Math.sqrt(best.d2)) break
    for (let i = ci - ring; i <= ci + ring; i++) {
      for (let j = cj - ring; j <= cj + ring; j++) {
        if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== ring) continue
        const list = cells.get(`${i},${j}`)
        if (!list) continue
        for (const e of list) {
          const r = segFoot(px, py, g.x[g.ea[e]], g.y[g.ea[e]], g.x[g.eb[e]], g.y[g.eb[e]])
          if (!best || r.d2 < best.d2 || (r.d2 === best.d2 && e < best.edge)) best = { edge: e, t: r.t, d2: r.d2 }
        }
      }
    }
  }
  if (!best) return null
  const perp = Math.sqrt(best.d2)
  if (perp > maxM) return null
  return { edge: best.edge, t: best.t, perp, x: px, y: py }
}

/**
 * Multi-source Dijkstra. `sources` = [{ edge, t, perp, label }]. Returns node
 * distances (Infinity = unreached) and the label of the nearest source. `cap`
 * bounds the search (Infinity for an uncapped nearest-stop run).
 */
export function dijkstra(g, sources, cap = Infinity) {
  const dist = new Float64Array(g.n).fill(Infinity)
  const label = new Int32Array(g.n).fill(-1)
  const heap = new Heap()
  const seed = (node, d, lab) => {
    if (d > cap) return
    if (d < dist[node] || (d === dist[node] && lab < label[node])) {
      dist[node] = d
      label[node] = lab
      heap.push(d, node)
    }
  }
  for (const s of sources) {
    const w = g.ew[s.edge]
    seed(g.ea[s.edge], s.perp + s.t * w, s.label)
    seed(g.eb[s.edge], s.perp + (1 - s.t) * w, s.label)
  }
  const touched = []
  while (heap.size) {
    const [d, u] = heap.pop()
    if (d > dist[u]) continue
    touched.push(u)
    for (let k = g.off[u]; k < g.off[u + 1]; k++) {
      const v = g.adjNode[k]
      const nd = d + g.ew[g.adjEdge[k]]
      if (nd > cap) continue
      if (nd < dist[v] || (nd === dist[v] && label[u] < label[v])) {
        dist[v] = nd
        label[v] = label[u]
        heap.push(nd, v)
      }
    }
  }
  return { dist, label, touched, sources }
}

/** Network walk distance from a snapped point to the nearest source in `run`. */
export function walkFrom(g, run, sn) {
  if (!sn) return { d: Infinity, label: -1 }
  const w = g.ew[sn.edge]
  const a = g.ea[sn.edge]
  const b = g.eb[sn.edge]
  let best = Infinity
  let lab = -1
  const consider = (d, l) => {
    if (d < best || (d === best && l < lab)) {
      best = d
      lab = l
    }
  }
  if (run.dist[a] < Infinity) consider(sn.perp + run.dist[a] + sn.t * w, run.label[a])
  if (run.dist[b] < Infinity) consider(sn.perp + run.dist[b] + (1 - sn.t) * w, run.label[b])
  for (const s of run.sources) {
    if (s.edge === sn.edge) consider(sn.perp + s.perp + Math.abs(s.t - sn.t) * w, s.label)
  }
  return { d: best, label: lab }
}

/**
 * Reached street pieces within `cap` metres: [ax, ay, bx, by] segments in metres,
 * cut where the walking budget runs out, plus each source's snap connector.
 */
export function reachedSegments(g, run, cap) {
  const segs = []
  const seen = new Set()
  const lerp = (e, t) => {
    const a = g.ea[e]
    const b = g.eb[e]
    return [g.x[a] + (g.x[b] - g.x[a]) * t, g.y[a] + (g.y[b] - g.y[a]) * t]
  }
  const piece = (e, t0, t1) => {
    if (t1 < t0) return
    const p = lerp(e, t0)
    const q = lerp(e, t1)
    segs.push([p[0], p[1], q[0], q[1]])
  }
  for (const u of run.touched) {
    if (run.dist[u] > cap) continue
    for (let k = g.off[u]; k < g.off[u + 1]; k++) {
      const e = g.adjEdge[k]
      if (seen.has(e)) continue
      seen.add(e)
      const w = g.ew[e]
      const du = run.dist[g.ea[e]]
      const dv = run.dist[g.eb[e]]
      const ra = du <= cap ? Math.min(w, cap - du) : 0
      const rb = dv <= cap ? Math.min(w, cap - dv) : 0
      if (ra + rb >= w) piece(e, 0, 1)
      else {
        if (ra > 0) piece(e, 0, ra / w)
        if (rb > 0) piece(e, 1 - rb / w, 1)
      }
    }
  }
  for (const s of run.sources) {
    const r = cap - s.perp
    if (r <= 0) continue
    const w = g.ew[s.edge]
    const t0 = Math.max(0, s.t - r / w)
    const t1 = Math.min(1, s.t + r / w)
    piece(s.edge, t0, t1)
    const foot = lerp(s.edge, s.t)
    segs.push([s.x, s.y, foot[0], foot[1]])
  }
  return segs
}

// ---------------------------------------------------------------------------
// Raster masks on one global 5 m grid. A mask is a window { i0, j0, w, h, data }.
export function makeGrid(minX, minY, maxX, maxY, cell = CONFIG.cellM) {
  const x0 = Math.floor(minX / cell) * cell
  const y0 = Math.floor(minY / cell) * cell
  const w = Math.ceil((maxX - x0) / cell)
  const h = Math.ceil((maxY - y0) / cell)
  return { x0, y0, w, h, cell }
}

function windowFor(grid, minX, minY, maxX, maxY) {
  const i0 = Math.max(0, Math.floor((minX - grid.x0) / grid.cell) - 1)
  const j0 = Math.max(0, Math.floor((minY - grid.y0) / grid.cell) - 1)
  const i1 = Math.min(grid.w, Math.ceil((maxX - grid.x0) / grid.cell) + 1)
  const j1 = Math.min(grid.h, Math.ceil((maxY - grid.y0) / grid.cell) + 1)
  const w = Math.max(1, i1 - i0)
  const h = Math.max(1, j1 - j0)
  return { i0, j0, w, h, data: new Uint8Array(w * h) }
}

/** Cells whose centre lies within r of any segment. */
export function maskFromSegments(grid, segs, r) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [ax, ay, bx, by] of segs) {
    minX = Math.min(minX, ax, bx)
    minY = Math.min(minY, ay, by)
    maxX = Math.max(maxX, ax, bx)
    maxY = Math.max(maxY, ay, by)
  }
  const mask = windowFor(grid, minX - r, minY - r, maxX + r, maxY + r)
  const r2 = r * r
  const c = grid.cell
  for (const [ax, ay, bx, by] of segs) {
    const ci0 = Math.max(0, Math.floor((Math.min(ax, bx) - r - grid.x0) / c) - mask.i0)
    const ci1 = Math.min(mask.w - 1, Math.floor((Math.max(ax, bx) + r - grid.x0) / c) - mask.i0)
    const cj0 = Math.max(0, Math.floor((Math.min(ay, by) - r - grid.y0) / c) - mask.j0)
    const cj1 = Math.min(mask.h - 1, Math.floor((Math.max(ay, by) + r - grid.y0) / c) - mask.j0)
    for (let j = cj0; j <= cj1; j++) {
      const py = grid.y0 + (mask.j0 + j + 0.5) * c
      const row = j * mask.w
      for (let i = ci0; i <= ci1; i++) {
        if (mask.data[row + i]) continue
        const px = grid.x0 + (mask.i0 + i + 0.5) * c
        if (segFoot(px, py, ax, ay, bx, by).d2 <= r2) mask.data[row + i] = 1
      }
    }
  }
  return mask
}

/** Cells whose centre lies within r of any centre point (straight-line circles). */
export function maskFromCircles(grid, centres, r) {
  const segs = centres.map(([x, y]) => [x, y, x, y])
  return maskFromSegments(grid, segs, r)
}

export function maskCells(mask) {
  let n = 0
  for (let k = 0; k < mask.data.length; k++) n += mask.data[k]
  return n
}

/** Is global cell (gi, gj) set in mask? */
function maskHas(mask, gi, gj) {
  const i = gi - mask.i0
  const j = gj - mask.j0
  if (i < 0 || j < 0 || i >= mask.w || j >= mask.h) return false
  return mask.data[j * mask.w + i] === 1
}

/** Per-GND cell counts of a mask against the global GND raster. */
export function countByGnd(grid, gndRaster, nG, mask) {
  const counts = new Float64Array(nG + 1)
  for (let j = 0; j < mask.h; j++) {
    const gRow = (mask.j0 + j) * grid.w + mask.i0
    const row = j * mask.w
    for (let i = 0; i < mask.w; i++) {
      if (mask.data[row + i]) counts[gndRaster[gRow + i]]++
    }
  }
  return counts
}

/** Scanline fill of polygon rings (each ring an outer polygon, gig-data style). */
function fillRings(grid, rings, visit) {
  for (const ring of rings) {
    let minY = Infinity
    let maxY = -Infinity
    for (const [, y] of ring) {
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
    const j0 = Math.max(0, Math.floor((minY - grid.y0) / grid.cell))
    const j1 = Math.min(grid.h - 1, Math.floor((maxY - grid.y0) / grid.cell))
    for (let j = j0; j <= j1; j++) {
      const py = grid.y0 + (j + 0.5) * grid.cell
      const xs = []
      for (let k = 0, l = ring.length - 1; k < ring.length; l = k++) {
        const [xa, ya] = ring[k]
        const [xb, yb] = ring[l]
        if (ya > py !== yb > py) xs.push(xa + ((py - ya) * (xb - xa)) / (yb - ya))
      }
      xs.sort((a, b) => a - b)
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.max(0, Math.ceil((xs[k] - grid.x0) / grid.cell - 0.5))
        const i1 = Math.min(grid.w - 1, Math.floor((xs[k + 1] - grid.x0) / grid.cell - 0.5))
        for (let i = i0; i <= i1; i++) visit(j * grid.w + i)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Vectorise a mask: trace cell-boundary rings (inside on the left, left-turn rule
// at ambiguous vertices), drop collinear points, Douglas–Peucker simplify, nest
// holes into their smallest containing outer ring.
export function ringArea(ring) {
  let a = 0
  for (let k = 0, l = ring.length - 1; k < ring.length; l = k++) {
    a += ring[l][0] * ring[k][1] - ring[k][0] * ring[l][1]
  }
  return a / 2
}

export function pointInRing(x, y, ring) {
  let inside = false
  for (let k = 0, l = ring.length - 1; k < ring.length; l = k++) {
    const [xa, ya] = ring[k]
    const [xb, yb] = ring[l]
    if (ya > y !== yb > y && x < xa + ((y - ya) * (xb - xa)) / (yb - ya)) inside = !inside
  }
  return inside
}

function douglasPeucker(points, tol) {
  // points: open polyline; returns kept indices (first and last always kept).
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const stack = [[0, points.length - 1]]
  const tol2 = tol * tol
  while (stack.length) {
    const [s, e] = stack.pop()
    let maxD = -1
    let idx = -1
    for (let k = s + 1; k < e; k++) {
      const d = segFoot(points[k][0], points[k][1], points[s][0], points[s][1], points[e][0], points[e][1]).d2
      if (d > maxD) {
        maxD = d
        idx = k
      }
    }
    if (idx >= 0 && maxD > tol2) {
      keep[idx] = 1
      stack.push([s, idx], [idx, e])
    }
  }
  return points.filter((_, k) => keep[k])
}

function simplifyRing(ring, tol) {
  // ring is open (no repeated closing point). Split at vertex 0 and the vertex
  // farthest from it, simplify both halves.
  if (ring.length < 8) return ring
  let far = 0
  let farD = -1
  for (let k = 1; k < ring.length; k++) {
    const d = (ring[k][0] - ring[0][0]) ** 2 + (ring[k][1] - ring[0][1]) ** 2
    if (d > farD) {
      farD = d
      far = k
    }
  }
  const a = douglasPeucker(ring.slice(0, far + 1), tol)
  const b = douglasPeucker([...ring.slice(far), ring[0]], tol)
  return [...a.slice(0, -1), ...b.slice(0, -1)]
}

export function vectorize(grid, mask, tol = CONFIG.simplifyM) {
  const { w, h, data } = mask
  const W = w + 1
  const out = new Map() // start vertex -> [end vertices]
  const add = (a, b) => {
    const list = out.get(a)
    if (list) list.push(b)
    else out.set(a, [b])
  }
  const at = (i, j) => (i < 0 || j < 0 || i >= w || j >= h ? 0 : data[j * w + i])
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      if (!data[j * w + i]) continue
      if (!at(i, j - 1)) add(j * W + i, j * W + i + 1)
      if (!at(i + 1, j)) add(j * W + i + 1, (j + 1) * W + i + 1)
      if (!at(i, j + 1)) add((j + 1) * W + i + 1, (j + 1) * W + i)
      if (!at(i - 1, j)) add((j + 1) * W + i, j * W + i)
    }
  }
  const starts = [...out.keys()].sort((a, b) => a - b)
  const rings = []
  for (const s of starts) {
    for (;;) {
      const list = out.get(s)
      if (!list || list.length === 0) break
      const ring = []
      let prev = s
      let cur = list.shift()
      ring.push(s)
      while (cur !== s) {
        ring.push(cur)
        const nexts = out.get(cur)
        const dx = (cur % W) - (prev % W)
        const dy = Math.floor(cur / W) - Math.floor(prev / W)
        let pick = 0
        if (nexts.length > 1) {
          // left turn of (dx,dy) is (-dy,dx); prefer it, then straight, then right.
          const pref = [[-dy, dx], [dx, dy], [dy, -dx]]
          let bestRank = 9
          nexts.forEach((v, k) => {
            const vx = (v % W) - (cur % W)
            const vy = Math.floor(v / W) - Math.floor(cur / W)
            const rank = pref.findIndex(([px, py]) => px === vx && py === vy)
            if (rank >= 0 && rank < bestRank) {
              bestRank = rank
              pick = k
            }
          })
        }
        const next = nexts.splice(pick, 1)[0]
        prev = cur
        cur = next
      }
      // drop collinear vertices
      const pts = ring.map((v) => [v % W, Math.floor(v / W)])
      const corners = []
      for (let k = 0; k < pts.length; k++) {
        const p = pts[(k - 1 + pts.length) % pts.length]
        const q = pts[k]
        const r = pts[(k + 1) % pts.length]
        if ((q[0] - p[0]) * (r[1] - q[1]) - (q[1] - p[1]) * (r[0] - q[0]) !== 0) corners.push(q)
      }
      const metres = corners.map(([i, j]) => [grid.x0 + (mask.i0 + i) * grid.cell, grid.y0 + (mask.j0 + j) * grid.cell])
      rings.push(metres)
    }
  }
  const outers = []
  const holes = []
  for (const r of rings) {
    const a = ringArea(r)
    if (a > 0) outers.push({ ring: r, area: a, holes: [], bbox: bboxOf(r) })
    else if (a < 0) holes.push(r)
  }
  outers.sort((p, q) => p.area - q.area)
  for (const hole of holes) {
    // a point just inside the hole: first edge midpoint, nudged to its right side
    const [ax, ay] = hole[0]
    const [bx, by] = hole[1]
    const len = Math.hypot(bx - ax, by - ay) || 1
    const tx = (ax + bx) / 2 + ((by - ay) / len) * grid.cell * 0.5
    const ty = (ay + by) / 2 - ((bx - ax) / len) * grid.cell * 0.5
    const host = outers.find(
      (o) => tx >= o.bbox[0] && tx <= o.bbox[2] && ty >= o.bbox[1] && ty <= o.bbox[3] && pointInRing(tx, ty, o.ring),
    )
    if (host) host.holes.push(hole)
  }
  const polys = []
  for (const o of outers) {
    const outer = simplifyRing(o.ring, tol)
    if (outer.length < 3 || Math.abs(ringArea(outer)) < grid.cell * grid.cell) continue
    const poly = [outer]
    for (const hole of o.holes) {
      const sh = simplifyRing(hole, tol)
      if (sh.length >= 3 && Math.abs(ringArea(sh)) >= grid.cell * grid.cell) poly.push(sh)
    }
    polys.push(poly)
  }
  return polys
}

export function bboxOf(points) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of points) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  return [minX, minY, maxX, maxY]
}

/** Metre polygons → GeoJSON geometry in lng/lat (5 dp ≈ 1 m), RFC 7946 winding. */
export function toGeometry(polys) {
  const ll = (ring, ccw) => {
    let pts = ring.map(([x, y]) => {
      const [lng, lat] = unproject(x, y)
      return [round(lng, 5), round(lat, 5)]
    })
    pts = pts.filter((p, k) => k === 0 || p[0] !== pts[k - 1][0] || p[1] !== pts[k - 1][1])
    if ((ringArea(pts) > 0) !== ccw) pts.reverse()
    return [...pts, pts[0]]
  }
  const coords = polys
    .map(([outer, ...holes]) => [ll(outer, true), ...holes.map((r) => ll(r, false))])
    .filter((p) => p[0].length >= 4)
  if (coords.length === 1) return { type: 'Polygon', coordinates: coords[0] }
  return { type: 'MultiPolygon', coordinates: coords }
}

/** Analytic circle polygon (64 steps) for single-stop 800 m circles. */
function circleGeometry(x, y, r) {
  const ring = []
  for (let k = 0; k < 64; k++) {
    const a = (2 * Math.PI * k) / 64
    ring.push([x + r * Math.cos(a), y + r * Math.sin(a)])
  }
  return toGeometry([[ring]])
}

// ---------------------------------------------------------------------------
// Inputs
export function readJson(rel) {
  return JSON.parse(readFileSync(join(ROOT, rel), 'utf8'))
}

function validRings(value) {
  if (!Array.isArray(value) || value.length === 0) return false
  return value.every(
    (ring) =>
      Array.isArray(ring) &&
      ring.length >= 4 &&
      ring.every(
        (p) =>
          Array.isArray(p) &&
          p.length >= 2 &&
          Number.isFinite(p[0]) &&
          Number.isFinite(p[1]) &&
          p[0] > 79 && p[0] < 82.5 && p[1] > 5.5 && p[1] < 10,
      ),
  )
}

async function fetchRings(id) {
  const local = process.env.GIG_DIR ? join(process.env.GIG_DIR, 'geo/gnd', `${id}.json`) : null
  const cached = join(GIG_CACHE, `${id}.json`)
  for (const path of [local, cached]) {
    if (path && existsSync(path)) {
      const text = readFileSync(path, 'utf8')
      if (text.trim() === 'null') return null
      const rings = JSON.parse(text)
      if (!validRings(rings)) throw new Error(`gig-data ${id}: cached file is not a ring array`)
      return rings
    }
  }
  let lastErr
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${GIG_RAW}/${id}.json`, { headers: { 'User-Agent': UA } })
      if (res.status === 404) {
        mkdirSync(GIG_CACHE, { recursive: true })
        writeFileSync(cached, 'null\n') // the source has no boundary for this id
        return null
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const text = await res.text()
      const rings = JSON.parse(text) // data only — never evaluated
      if (!validRings(rings)) throw new Error('not a ring array')
      mkdirSync(GIG_CACHE, { recursive: true })
      writeFileSync(cached, JSON.stringify(rings))
      return rings
    } catch (e) {
      lastErr = e
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)))
    }
  }
  throw new Error(`gig-data ${id}: ${lastErr?.message ?? 'fetch failed'}`)
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const k = next++
        out[k] = await fn(items[k], k)
      }
    }),
  )
  return out
}

/** Segment grid for "distance to the nearest CM line" queries. */
function lineIndex(lineSegs, cell = 1000) {
  const cells = new Map()
  lineSegs.forEach(([ax, ay, bx, by], k) => {
    for (let i = Math.floor(Math.min(ax, bx) / cell); i <= Math.floor(Math.max(ax, bx) / cell); i++) {
      for (let j = Math.floor(Math.min(ay, by) / cell); j <= Math.floor(Math.max(ay, by) / cell); j++) {
        const key = `${i},${j}`
        let list = cells.get(key)
        if (!list) cells.set(key, (list = []))
        list.push(k)
      }
    }
  })
  return (px, py, within) => {
    const reach = Math.ceil(within / cell)
    const ci = Math.floor(px / cell)
    const cj = Math.floor(py / cell)
    let best = Infinity
    for (let i = ci - reach; i <= ci + reach; i++) {
      for (let j = cj - reach; j <= cj + reach; j++) {
        for (const k of cells.get(`${i},${j}`) ?? []) {
          const [ax, ay, bx, by] = lineSegs[k]
          const d = segFoot(px, py, ax, ay, bx, by).d2
          if (d < best) best = d
        }
      }
    }
    return Math.sqrt(best)
  }
}

// ---------------------------------------------------------------------------
// Indicator table helpers
const dim = (id, type, label, unit) => ({ id, role: 'dimension', type, label, ...(unit ? { unit } : {}) })
const measure = (id, type, label, unit, aggregation = 'none') => ({
  id,
  role: 'measure',
  type,
  label,
  ...(unit ? { unit } : {}),
  aggregation,
})

const COMMON_NOTES = [
  'Derived by developing-country.org with scripts/build-metro-coverage.mjs from lk_metro stops and lines (MIT), the OpenStreetMap walking network (ODbL), Census 2024 GN-division population (Department of Census and Statistics via nuuuwan/lk_census_2024) and GN boundaries from nuuuwan/gig-data (MIT).',
  'Walking speed 80 m/min: 5 minutes = 400 m and 10 minutes = 800 m of walking along the OSM street and path network, starting from the stop snapped to its nearest street.',
  'A walkshed is every reached street segment buffered 50 m either side (the plot frontage a pedestrian reaches) and unioned; the comparison is an 800 m straight-line circle around each stop.',
  'Population inside a walkshed is the area-weighted share of each GN division inside it times the division population, computed on a 5 m equal-area raster; unions never double count overlapping stops.',
  'Offices and other businesses are Overture Maps Places release 2026-09-23.1 listings (CDLA-Permissive-2.0) with confidence ≥ 0.5 and not closed, counted when their network walk to a stop is within the time band. Businesses exclude offices, geographic entities, cultural and historic sites, places of worship and uncategorised listings.',
]
const COMMON_CAVEATS = [
  'Assumes people are spread uniformly within each GN division; real homes cluster along roads, so walkshed population is probably understated and circle population overstated.',
  'Residential (census night-time) population only: workers, students and visitors in Colombo during the day are not counted.',
  'OSM path completeness varies: missing lanes and private short-cuts shrink walksheds; mapped paths that are gated or unsafe enlarge them. Slope, crossings and footpath quality are ignored.',
  'Stop locations are as compiled by nuuuwan/lk_metro and may differ from the kerbside stops in operation.',
  'Office and business counts are Overture listings, not jobs: no headcount or floor area, uneven coverage, and only listings with confidence ≥ 0.5.',
]

function table(id, title, description, grain, primaryKey, fields, rows, extra = {}) {
  return {
    schema_version: 1,
    dataset_id: id,
    country: COUNTRY,
    source_ids: SOURCE_IDS,
    vintage: VINTAGE,
    title,
    description,
    grain,
    notes: [...COMMON_NOTES, ...(extra.notes ?? [])],
    caveats: [...COMMON_CAVEATS, ...(extra.caveats ?? [])],
    primary_key: primaryKey,
    fields,
    rows,
  }
}

// ---------------------------------------------------------------------------
/**
 * Everything the coverage outputs and the alternatives analysis share: inputs,
 * snapped stops, study-area GN raster, counted points and the per-set evaluator.
 */
export async function prepare({ log = console.log } = {}) {
  const metro = readJson('public/data/metro.geojson')
  const gndIndex = readJson('public/data/gnd-index.json')
  const schoolsFc = readJson('public/data/schools.geojson')
  const hospitalsFc = readJson('public/data/hospitals.geojson')
  const g = buildGraph(readJson('public/data/walk-colombo.json'))
  const eidx = edgeIndex(g)
  log(`walk graph: ${g.n} nodes, ${g.m} edges`)

  // ---- stops + lines ------------------------------------------------------
  const lineFeatures = metro.features
    .filter((f) => f.properties?.kind === 'line')
    .sort((a, b) => a.properties.code.localeCompare(b.properties.code))
  const stopFeatures = metro.features.filter((f) => f.properties?.kind === 'stop')
  if (lineFeatures.length !== 7) throw new Error(`expected 7 CM lines, got ${lineFeatures.length}`)
  if (stopFeatures.length !== 110) throw new Error(`expected 110 CM stops, got ${stopFeatures.length}`)
  const lineCodes = lineFeatures.map((f) => f.properties.code)
  const stops = stopFeatures
    .map((f) => {
      const [lng, lat] = f.geometry.coordinates
      const [x, y] = project(lng, lat)
      const routes = String(f.properties.routes)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .sort()
      return { id: slug(f.properties.name), name: f.properties.name, lng, lat, x, y, routes }
    })
    .sort((a, b) => a.id.localeCompare(b.id))
  const stopIds = new Set(stops.map((s) => s.id))
  if (stopIds.size !== stops.length) throw new Error('stop slugs are not unique')
  for (const s of stops) {
    if (s.routes.length === 0 || s.routes.some((r) => !lineCodes.includes(r))) {
      throw new Error(`stop ${s.name} has unknown routes ${s.routes.join(',')}`)
    }
  }
  stops.forEach((s, k) => {
    s.label = k
  })

  // Step 1: every stop must snap onto the walk graph.
  const [bw, bs, be, bn] = g.bbox
  const snapReport = []
  for (const s of stops) {
    if (s.lng < bw || s.lng > be || s.lat < bs || s.lat > bn) {
      throw new Error(`stop ${s.name} is outside the walk-graph envelope — extend scripts/build-walk-graph.mjs`)
    }
    const sn = snap(g, eidx, s.x, s.y, CONFIG.stopSnapMaxM)
    if (!sn) throw new Error(`stop ${s.name}: no main-network street within ${CONFIG.stopSnapMaxM} m`)
    s.snap = { ...sn, label: s.label }
    snapReport.push({ stop: s.name, snap_m: round(sn.perp, 1) })
  }
  snapReport.sort((a, b) => b.snap_m - a.snap_m)
  log(
    `stops snapped: ${stops.length}/${stops.length}; max ${snapReport[0].snap_m} m (${snapReport[0].stop}), ` +
      `median ${snapReport[Math.floor(snapReport.length / 2)].snap_m} m, ` +
      `${snapReport.filter((r) => r.snap_m > 50).length} over 50 m`,
  )

  const lines = lineFeatures.map((f) => {
    const p = f.properties
    const pts = f.geometry.coordinates.map(([lng, lat]) => project(lng, lat))
    let len = 0
    for (let k = 1; k < pts.length; k++) len += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1])
    return {
      code: p.code,
      name: p.name,
      color: p.color,
      sourceKm: p.distance_km,
      geomKm: len / 1000,
      pts,
      stops: stops.filter((s) => s.routes.includes(p.code)),
    }
  })
  for (const l of lines) {
    if (l.stops.length === 0) throw new Error(`line ${l.code} has no stops`)
  }

  // ---- study area ---------------------------------------------------------
  const lineSegs = []
  for (const l of lines) for (let k = 1; k < l.pts.length; k++) lineSegs.push([...l.pts[k - 1], ...l.pts[k]])
  const distToLines = lineIndex(lineSegs)
  const gndById = new Map(gndIndex.features.map((r) => [r.id, r]))
  const candidates = gndIndex.features
    .filter((r) => CONFIG.districts.includes(r.district))
    .filter((r) => {
      const [x, y] = project(r.lng, r.lat)
      const reach = CONFIG.studyBufferM + 3000 * Math.sqrt(Math.max(r.area, 0.05) / Math.PI) + 1000
      return distToLines(x, y, reach) <= reach
    })
    .map((r) => r.id)
    .sort()
  log(`GND candidates near the lines: ${candidates.length} (fetching/caching boundaries)`)
  const ringsList = await mapLimit(candidates, 12, (id) => fetchRings(id))
  const missingBoundaries = []
  const study = []
  for (let k = 0; k < candidates.length; k++) {
    const id = candidates[k]
    const rings = ringsList[k]
    if (!rings) {
      missingBoundaries.push(id)
      continue
    }
    const proj = rings.map((ring) => {
      const pts = ring.map(([lng, lat]) => project(lng, lat))
      const last = pts.at(-1)
      if (last[0] === pts[0][0] && last[1] === pts[0][1]) pts.pop()
      return pts
    })
    // Distance polygon ↔ lines: vertices of the polygon to the lines, and any line
    // vertex inside the polygon (a line crossing a large division).
    let near = false
    for (const ring of proj) {
      for (const [x, y] of ring) {
        if (distToLines(x, y, CONFIG.studyBufferM) <= CONFIG.studyBufferM) {
          near = true
          break
        }
      }
      if (near) break
    }
    if (!near) {
      outer: for (const l of lines) {
        for (const [x, y] of l.pts) {
          for (const ring of proj) {
            if (pointInRing(x, y, ring)) {
              near = true
              break outer
            }
          }
        }
      }
    }
    if (!near) continue
    const row = gndById.get(id)
    let areaM2 = 0
    for (const ring of proj) areaM2 += Math.abs(ringArea(ring))
    study.push({ id, row, rings: proj, areaM2, bbox: bboxOf(proj.flat()) })
  }
  const missingInStudy = missingBoundaries.filter((id) => {
    const r = gndById.get(id)
    const [x, y] = project(r.lng, r.lat)
    return distToLines(x, y, CONFIG.studyBufferM) <= CONFIG.studyBufferM
  })
  if (missingInStudy.length > 0) {
    throw new Error(`gig-data has no boundary for study-area GNDs: ${missingInStudy.join(', ')}`)
  }
  study.sort((a, b) => a.id.localeCompare(b.id))
  log(`study area: ${study.length} GN divisions within ${CONFIG.studyBufferM} m of a line`)

  // ---- global raster ------------------------------------------------------
  let ext = [Infinity, Infinity, -Infinity, -Infinity]
  const grow = ([a, b, c, d]) => {
    ext = [Math.min(ext[0], a), Math.min(ext[1], b), Math.max(ext[2], c), Math.max(ext[3], d)]
  }
  for (const s of study) grow(s.bbox)
  for (const s of stops) grow([s.x - 1200, s.y - 1200, s.x + 1200, s.y + 1200])
  const grid = makeGrid(ext[0], ext[1], ext[2], ext[3])
  const gndRaster = new Uint16Array(grid.w * grid.h) // 0 = outside study area, else index+1
  if (study.length >= 65535) throw new Error('too many GNDs for a Uint16 raster')
  const gndCells = new Float64Array(study.length + 1)
  study.forEach((s, k) => {
    fillRings(grid, s.rings, (cell) => {
      if (gndRaster[cell] === 0) {
        gndRaster[cell] = k + 1
        gndCells[k + 1]++
      }
    })
  })
  for (let k = 0; k < study.length; k++) {
    if (gndCells[k + 1] === 0) throw new Error(`GND ${study[k].id} has no raster cells`)
  }
  log(`raster: ${grid.w} × ${grid.h} cells at ${grid.cell} m`)
  const pops = study.map((s) => s.row.pop)
  const popOf = (counts) => {
    let p = 0
    for (let k = 1; k < counts.length; k++) if (counts[k]) p += (pops[k - 1] * counts[k]) / gndCells[k]
    return p
  }
  const cellKm2 = (grid.cell * grid.cell) / 1e6

  // ---- facilities ---------------------------------------------------------
  const cellOf = (x, y) => {
    const i = Math.floor((x - grid.x0) / grid.cell)
    const j = Math.floor((y - grid.y0) / grid.cell)
    if (i < 0 || j < 0 || i >= grid.w || j >= grid.h) return 0
    return gndRaster[j * grid.w + i]
  }
  const facilities = [...schoolsFc.features, ...hospitalsFc.features]
    .map((f) => {
      const [lng, lat] = f.geometry.coordinates
      const [x, y] = project(lng, lat)
      return {
        id: String(f.id ?? `${f.properties.osm_type}/${f.properties.osm_id}`),
        name: String(f.properties.name ?? '').trim() || null,
        kind: String(f.properties.kind),
        lng,
        lat,
        x,
        y,
        gnd: cellOf(x, y),
      }
    })
    .filter((f) => f.gnd > 0)
    .sort((a, b) => a.id.localeCompare(b.id))
  // Overture workplaces: offices join the facilities table; other businesses are
  // only counted.
  const { places } = loadPlaces()
  const workplaces = places
    .map((p) => {
      const [x, y] = project(p.lng, p.lat)
      return {
        id: `overture/${p.id}`,
        name: p.name,
        kind: p.cls,
        office_type: p.office_type,
        lng: p.lng,
        lat: p.lat,
        x,
        y,
        gnd: cellOf(x, y),
      }
    })
    .filter((p) => p.gnd > 0)
    .sort((a, b) => a.id.localeCompare(b.id))
  for (const f of facilities) f.office_type = null
  facilities.push(...workplaces.filter((p) => p.kind === 'office'))
  facilities.sort((a, b) => a.id.localeCompare(b.id))
  const businesses = workplaces.filter((p) => p.kind === 'business')
  const facIds = new Set(facilities.map((f) => f.id))
  if (facIds.size !== facilities.length) throw new Error('duplicate facility ids')
  // Every counted point: facilities table rows, then businesses (counted only).
  const points = [...facilities, ...businesses]
  for (const f of points) {
    f.snap = snap(g, eidx, f.x, f.y, CONFIG.pointSnapMaxM)
  }
  const facCounts = (pred) => {
    const out = { schools: 0, hospitals: 0, offices: 0, businesses: 0 }
    points.forEach((f, k) => {
      if (!pred(f, k)) return
      if (f.kind === 'school') out.schools++
      else if (f.kind === 'hospital') out.hospitals++
      else if (f.kind === 'office') out.offices++
      else if (f.kind === 'business') out.businesses++
    })
    return out
  }
  const studyOffices = facilities.filter((f) => f.kind === 'office').length
  log(`facilities in study area: ${facilities.length} (${studyOffices} offices); other businesses: ${businesses.length}`)

  // ---- per-set computation ------------------------------------------------
  const evaluate = (members) => {
    const run = dijkstra(g, members.map((s) => s.snap), CONFIG.band10m)
    const masks = {}
    for (const [minutes, cap] of [[5, CONFIG.band5m], [10, CONFIG.band10m]]) {
      masks[minutes] = maskFromSegments(grid, reachedSegments(g, run, cap), CONFIG.frontageM)
    }
    masks.circle = maskFromCircles(grid, members.map((s) => [s.x, s.y]), CONFIG.circleM)
    const counts = {}
    const stats = {}
    for (const key of [5, 10, 'circle']) {
      counts[key] = countByGnd(grid, gndRaster, study.length, masks[key])
      stats[key] = { cells: maskCells(masks[key]), pop: popOf(counts[key]) }
    }
    const walk = points.map((f) => walkFrom(g, run, f.snap).d)
    const net = (limit) => facCounts((_f, k) => walk[k] <= limit)
    const r2 = CONFIG.circleM * CONFIG.circleM
    const circ = facCounts((f) => members.some((s) => (s.x - f.x) ** 2 + (s.y - f.y) ** 2 <= r2))
    return { run, masks, counts, stats, fac: { 5: net(CONFIG.band5m), 10: net(CONFIG.band10m), circle: circ } }
  }
  // Nearest stop by network walk, uncapped (GND centroids, facilities).
  const nearestRun = dijkstra(g, stops.map((s) => s.snap), Infinity)
  const nearest = (lng, lat, x, y) => {
    if (lng < bw - 0.01 || lng > be + 0.01 || lat < bs - 0.01 || lat > bn + 0.01) return { d: null, stop: null }
    const sn = snap(g, eidx, x, y, CONFIG.pointSnapMaxM)
    const r = walkFrom(g, nearestRun, sn)
    if (!Number.isFinite(r.d)) return { d: null, stop: null }
    return { d: Math.round(r.d), stop: stops[r.label].name }
  }
  return {
    g, eidx, stops, lines, lineCodes, study, grid, gndRaster, gndCells, pops, popOf, cellKm2, cellOf,
    facilities, businesses, points, facCounts, studyOffices, evaluate, nearest, gndById, snapReport,
    bbox: [bw, bs, be, bn],
  }
}

export async function build({ log = console.log } = {}) {
  const {
    g, stops, lines, lineCodes, study, grid, gndRaster, gndCells, pops, popOf, cellKm2,
    facilities, points, studyOffices, evaluate, nearest, gndById, snapReport,
  } = await prepare({ log })
  const stopResults = new Map()
  for (const s of stops) stopResults.set(s.id, evaluate([s]))
  log('stop walksheds done')
  const lineResults = new Map()
  for (const l of lines) lineResults.set(l.code, evaluate(l.stops))
  const network = evaluate(stops)
  log('line + network walksheds done')

  // Line overlap: count lines covering each network 10-min cell.
  const nm = network.masks[10]
  const lineCount = new Uint8Array(nm.data.length)
  for (const l of lines) {
    const m = lineResults.get(l.code).masks[10]
    for (let j = 0; j < m.h; j++) {
      for (let i = 0; i < m.w; i++) {
        if (!m.data[j * m.w + i]) continue
        const ni = m.i0 + i - nm.i0
        const nj = m.j0 + j - nm.j0
        if (ni < 0 || nj < 0 || ni >= nm.w || nj >= nm.h) throw new Error('line mask escapes network mask')
        lineCount[nj * nm.w + ni]++
      }
    }
  }
  for (let k = 0; k < nm.data.length; k++) {
    if (nm.data[k] && lineCount[k] === 0) throw new Error('network cell not covered by any line')
    if (!nm.data[k] && lineCount[k] > 0) throw new Error('line cell outside the network walkshed')
  }
  const sharedPop = (mask) => {
    const counts = new Float64Array(study.length + 1)
    for (let j = 0; j < mask.h; j++) {
      for (let i = 0; i < mask.w; i++) {
        if (!mask.data[j * mask.w + i]) continue
        const gi = mask.i0 + i
        const gj = mask.j0 + j
        if (lineCount[(gj - nm.j0) * nm.w + (gi - nm.i0)] >= 2) counts[gndRaster[gj * grid.w + gi]]++
      }
    }
    return popOf(counts)
  }

  // ---- GND rows ------------------------------------------------------------
  const studyPop = pops.reduce((a, b) => a + b, 0)
  const netWalk = points.map((f) => walkFrom(g, network.run, f.snap).d)
  const officeByGnd = {}
  facilities.forEach((f, k) => {
    if (f.kind !== 'office') return
    const c = (officeByGnd[f.gnd] ??= [0, 0])
    c[0]++
    if (netWalk[k] <= CONFIG.band10m) c[1]++
  })
  const gndRows = study.map((s, k) => {
    const share = (key) => network.counts[key][k + 1] / gndCells[k + 1]
    const areaKm2 = s.areaM2 / 1e6
    const [cx, cy] = project(s.row.lng, s.row.lat)
    const nr = nearest(s.row.lng, s.row.lat, cx, cy)
    const pop = s.row.pop
    const served10 = pop * share(10)
    const offices = officeByGnd[k + 1] ?? [0, 0]
    return {
      gnd_id: s.id,
      gnd: s.row.name,
      dsd: s.row.parent,
      district: s.row.district,
      pop_2024: pop,
      pop_vintage: s.row.pop === s.row.pop_2012 ? 2012 : 2024,
      area_km2: round(areaKm2, 3),
      density_per_km2: round(pop / areaKm2, 0),
      share_5min: round(share(5), 4),
      share_10min: round(share(10), 4),
      share_10min_pct: round(share(10) * 100, 1),
      share_circle_800m: round(share('circle'), 4),
      served_pop_5min: Math.round(pop * share(5)),
      served_pop_10min: Math.round(served10),
      served_pop_circle_800m: Math.round(pop * share('circle')),
      unserved_pop_10min: pop - Math.round(served10),
      nearest_stop: nr.stop,
      walk_m_to_stop: nr.d,
      offices: offices[0],
      offices_within_10min: offices[1],
      density_decile: 0,
      _density: pop / areaKm2,
      _served: served10,
    }
  })
  const byDensity = [...gndRows].sort((a, b) => a._density - b._density || a.gnd_id.localeCompare(b.gnd_id))
  byDensity.forEach((r, rank) => {
    r.density_decile = Math.floor((rank * 10) / byDensity.length) + 1
  })
  const deciles = []
  for (let d = 1; d <= 10; d++) {
    const rows = gndRows.filter((r) => r.density_decile === d)
    const pop = rows.reduce((a, r) => a + r.pop_2024, 0)
    const served = rows.reduce((a, r) => a + r._served, 0)
    deciles.push({
      density_decile: d,
      density_min_per_km2: round(Math.min(...rows.map((r) => r._density)), 0),
      density_max_per_km2: round(Math.max(...rows.map((r) => r._density)), 0),
      gnd_count: rows.length,
      pop_2024: pop,
      served_pop_10min: Math.round(served),
      unserved_pop_10min: pop - Math.round(served),
      share_10min_pct: round((served / pop) * 100, 1),
    })
  }
  for (const r of gndRows) {
    delete r._density
    delete r._served
  }

  // ---- facility rows ---------------------------------------------------------
  const facilityRows = facilities.map((f, k) => {
    const nr = nearest(f.lng, f.lat, f.x, f.y)
    return {
      facility_id: f.id,
      name: f.name,
      kind: f.kind,
      office_type: f.office_type,
      lng: round(f.lng, 6),
      lat: round(f.lat, 6),
      gnd_id: study[f.gnd - 1].id,
      nearest_stop: nr.stop,
      walk_m: nr.d,
      within_5min: netWalk[k] <= CONFIG.band5m,
      within_10min: netWalk[k] <= CONFIG.band10m,
    }
  })

  // ---- stop + line rows ----------------------------------------------------
  const pct = (a, b) => (b > 0 ? round((a / b) * 100, 1) : null)
  const stopRows = stops.map((s) => {
    const r = stopResults.get(s.id)
    return {
      stop_id: s.id,
      stop: s.name,
      routes: s.routes.join(', '),
      route_count: s.routes.length,
      lng: round(s.lng, 6),
      lat: round(s.lat, 6),
      snap_m: round(s.snap.perp, 1),
      pop_5min: Math.round(r.stats[5].pop),
      pop_10min: Math.round(r.stats[10].pop),
      pop_circle_800m: Math.round(r.stats.circle.pop),
      circle_overstatement_pct: pct(r.stats.circle.pop - r.stats[10].pop, r.stats[10].pop),
      walkshed_km2_5min: round(r.stats[5].cells * cellKm2, 3),
      walkshed_km2_10min: round(r.stats[10].cells * cellKm2, 3),
      schools_10min: r.fac[10].schools,
      hospitals_10min: r.fac[10].hospitals,
      offices_5min: r.fac[5].offices,
      offices_10min: r.fac[10].offices,
      businesses_10min: r.fac[10].businesses,
    }
  })
  const lineRow = (code, name, lengthKm, stopCount, r, shared) => ({
    line_code: code,
    line_name: name,
    length_km: round(lengthKm, 1),
    stop_count: stopCount,
    study_area_pop: studyPop,
    pop_5min: Math.round(r.stats[5].pop),
    pop_10min: Math.round(r.stats[10].pop),
    pop_circle_800m: Math.round(r.stats.circle.pop),
    share_5min_pct: pct(r.stats[5].pop, studyPop),
    share_10min_pct: pct(r.stats[10].pop, studyPop),
    share_circle_800m_pct: pct(r.stats.circle.pop, studyPop),
    pop_per_route_km: Math.round(r.stats[10].pop / lengthKm),
    shared_with_other_lines_pct: pct(shared, r.stats[10].pop),
    walkshed_km2_10min: round(r.stats[10].cells * cellKm2, 2),
    schools_10min: r.fac[10].schools,
    hospitals_10min: r.fac[10].hospitals,
    study_area_offices: studyOffices,
    offices_10min: r.fac[10].offices,
    offices_share_10min_pct: pct(r.fac[10].offices, studyOffices),
    businesses_10min: r.fac[10].businesses,
  })
  const lineRows = lines.map((l) => {
    const r = lineResults.get(l.code)
    return lineRow(l.code, l.name, l.sourceKm, l.stops.length, r, sharedPop(r.masks[10]))
  })
  const routeKm = lines.reduce((a, l) => a + l.sourceKm, 0)
  lineRows.push(lineRow('ALL', 'All seven CM lines', routeKm, stops.length, network, sharedPop(network.masks[10])))

  // ---- walkshed features ------------------------------------------------------
  const features = []
  const feature = (kind, id, name, routes, color, minutes, method, r, key, geometry) => {
    features.push({
      type: 'Feature',
      properties: {
        kind,
        id,
        name,
        routes,
        color,
        minutes,
        method,
        area_km2: round(r.stats[key].cells * cellKm2, 3),
        pop_est: Math.round(r.stats[key].pop),
        schools: r.fac[key].schools,
        hospitals: r.fac[key].hospitals,
        offices: r.fac[key].offices,
      },
      geometry,
    })
  }
  const NETWORK_COLOR = '#0f766e'
  const emitSet = (kind, id, name, routes, color, r, centre) => {
    for (const minutes of [5, 10]) {
      feature(kind, id, name, routes, color, minutes, 'network', r, minutes, toGeometry(vectorize(grid, r.masks[minutes])))
    }
    const circleGeom = centre ? circleGeometry(centre[0], centre[1], CONFIG.circleM) : toGeometry(vectorize(grid, r.masks.circle))
    feature(kind, id, name, routes, color, 10, 'circle_800m', r, 'circle', circleGeom)
  }
  emitSet('network', 'ALL', 'All seven CM lines', lineCodes.join(', '), NETWORK_COLOR, network)
  for (const l of lines) emitSet('line', l.code, l.name, l.code, l.color, lineResults.get(l.code))
  for (const s of stops) {
    const color = lines.find((l) => l.code === s.routes[0]).color
    emitSet('stop', s.id, s.name, s.routes.join(', '), color, stopResults.get(s.id), [s.x, s.y])
  }
  log('vectorised walksheds')

  // ---- assemble outputs --------------------------------------------------------
  const walksheds = {
    type: 'FeatureCollection',
    source: 'Derived by developing-country.org from lk_metro (MIT), OpenStreetMap walking network (ODbL), Census 2024 GN population, gig-data GN boundaries (MIT) and Overture Maps Places (CDLA-Permissive-2.0)',
    vintage: VINTAGE,
    licence: 'ODbL (derived from OpenStreetMap); inputs MIT (lk_metro, gig-data), CDLA-Permissive-2.0 (Overture); census figures DCS',
    refreshed: '2026-10-20',
    refresh: 'bun scripts/build-metro-coverage.mjs',
    method: {
      walk_m_per_min: CONFIG.walkMetresPerMinute,
      band5_m: CONFIG.band5m,
      band10_m: CONFIG.band10m,
      circle_m: CONFIG.circleM,
      frontage_buffer_m: CONFIG.frontageM,
      raster_cell_m: CONFIG.cellM,
      simplify_m: CONFIG.simplifyM,
      study_buffer_m: CONFIG.studyBufferM,
    },
    features,
  }

  const stopsTable = table(
    'metro-coverage-stops',
    'Metro Bus stop walking coverage',
    'Residents within a 5- and 10-minute walk of each Colombo Metro Bus stop, compared with the 800 m circle.',
    'One row per Colombo Metro Bus (CM) stop.',
    ['stop_id'],
    [
      dim('stop_id', 'string', 'Stop ID'),
      dim('stop', 'string', 'Stop'),
      dim('routes', 'string', 'CM routes'),
      measure('route_count', 'integer', 'Routes serving the stop', 'routes'),
      dim('lng', 'number', 'Longitude', 'degrees'),
      dim('lat', 'number', 'Latitude', 'degrees'),
      measure('snap_m', 'number', 'Distance from stop to nearest mapped street', 'm'),
      measure('pop_5min', 'integer', 'Residents within a 5-minute walk', 'people'),
      measure('pop_10min', 'integer', 'Residents within a 10-minute walk', 'people'),
      measure('pop_circle_800m', 'integer', 'Residents within 800 m straight line', 'people'),
      measure('circle_overstatement_pct', 'number', 'Circle overstatement versus 10-minute walk', '%'),
      measure('walkshed_km2_5min', 'number', '5-minute walkshed area', 'km²'),
      measure('walkshed_km2_10min', 'number', '10-minute walkshed area', 'km²'),
      measure('schools_10min', 'integer', 'Schools within a 10-minute walk', 'schools'),
      measure('hospitals_10min', 'integer', 'Hospitals within a 10-minute walk', 'hospitals'),
      measure('offices_5min', 'integer', 'Offices within a 5-minute walk', 'offices'),
      measure('offices_10min', 'integer', 'Offices within a 10-minute walk', 'offices'),
      measure('businesses_10min', 'integer', 'Other businesses within a 10-minute walk', 'businesses'),
    ],
    stopRows,
    {
      notes: ['Stop populations and facility counts overlap where walksheds overlap, so their fields are not summable (aggregation none); use metro-coverage-lines (ALL row) for unique totals, metro-coverage-gnd to sum residents and metro-coverage-facilities to sum facilities.'],
    },
  )
  const linesTable = table(
    'metro-coverage-lines',
    'Metro Bus line walking coverage',
    'Unique residents within a 5- and 10-minute walk of each Colombo Metro Bus line and of the whole network.',
    "One row per CM line plus one network row (line_code 'ALL').",
    ['line_code'],
    [
      dim('line_code', 'string', 'Line'),
      dim('line_name', 'string', 'Line name'),
      measure('length_km', 'number', 'Route length', 'km'),
      measure('stop_count', 'integer', 'Stops', 'stops'),
      measure('study_area_pop', 'integer', 'Study-area population', 'people'),
      measure('pop_5min', 'integer', 'Residents within a 5-minute walk', 'people'),
      measure('pop_10min', 'integer', 'Residents within a 10-minute walk', 'people'),
      measure('pop_circle_800m', 'integer', 'Residents within 800 m straight line', 'people'),
      measure('share_5min_pct', 'number', 'Study-area residents within a 5-minute walk', '%'),
      measure('share_10min_pct', 'number', 'Study-area residents within a 10-minute walk', '%'),
      measure('share_circle_800m_pct', 'number', 'Study-area residents within 800 m', '%'),
      measure('pop_per_route_km', 'integer', 'Residents within a 10-minute walk per route km', 'people per km'),
      measure('shared_with_other_lines_pct', 'number', '10-minute residents also within another line’s walkshed', '%'),
      measure('walkshed_km2_10min', 'number', '10-minute walkshed area', 'km²'),
      measure('schools_10min', 'integer', 'Schools within a 10-minute walk', 'schools'),
      measure('hospitals_10min', 'integer', 'Hospitals within a 10-minute walk', 'hospitals'),
      measure('study_area_offices', 'integer', 'Offices in the study area', 'offices'),
      measure('offices_10min', 'integer', 'Offices within a 10-minute walk', 'offices'),
      measure('offices_share_10min_pct', 'number', 'Study-area offices within a 10-minute walk', '%'),
      measure('businesses_10min', 'integer', 'Other businesses within a 10-minute walk', 'businesses'),
    ],
    lineRows,
    {
      notes: [
        'Line populations are unique within the line (overlapping stops counted once). The ALL row is unique across the network; line rows overlap each other, so they do not add up to ALL.',
        'study_area_pop is the population of every GN division within 2 km of any CM line, the same denominator for every row.',
        'length_km is the route length published by lk_metro; the ALL row sums route km, so corridors shared by several lines count once per line.',
        "For the ALL row, shared_with_other_lines_pct is the share of network 10-minute residents within the walkshed of two or more lines.",
      ],
    },
  )
  const gndTable = table(
    'metro-coverage-gnd',
    'Metro Bus walking coverage by GN division',
    'Share of each GN division’s residents within a 5- and 10-minute walk of a Colombo Metro Bus stop.',
    'One row per Grama Niladhari division within 2 km of a CM line.',
    ['gnd_id'],
    [
      dim('gnd_id', 'string', 'GN division ID'),
      dim('gnd', 'string', 'GN division'),
      dim('dsd', 'string', 'Divisional Secretariat division'),
      dim('district', 'string', 'District'),
      measure('pop_2024', 'integer', 'Population', 'people', 'sum'),
      dim('pop_vintage', 'year', 'Population census year'),
      measure('area_km2', 'number', 'Area', 'km²', 'sum'),
      measure('density_per_km2', 'number', 'Population density', 'people per km²'),
      measure('share_5min', 'number', 'Share of area within a 5-minute walk', 'share 0–1'),
      measure('share_10min', 'number', 'Share of area within a 10-minute walk', 'share 0–1'),
      measure('share_10min_pct', 'number', 'Residents within a 10-minute walk', '%'),
      measure('share_circle_800m', 'number', 'Share of area within 800 m of a stop', 'share 0–1'),
      measure('served_pop_5min', 'integer', 'Residents within a 5-minute walk', 'people', 'sum'),
      measure('served_pop_10min', 'integer', 'Residents within a 10-minute walk', 'people', 'sum'),
      measure('served_pop_circle_800m', 'integer', 'Residents within 800 m', 'people', 'sum'),
      measure('unserved_pop_10min', 'integer', 'Residents beyond a 10-minute walk', 'people', 'sum'),
      dim('nearest_stop', 'string', 'Nearest stop by walking'),
      measure('walk_m_to_stop', 'integer', 'Walk from division centroid to nearest stop', 'm'),
      measure('offices', 'integer', 'Offices', 'offices', 'sum'),
      measure('offices_within_10min', 'integer', 'Offices within a 10-minute walk of a stop', 'offices', 'sum'),
      dim('density_decile', 'integer', 'Density decile in the study area (10 = densest)'),
    ],
    gndRows,
    {
      notes: [
        'gnd_id equals the feature id of the gnd source layer in demographics.pmtiles, so rows can colour the GN map directly.',
        'Shares are of the division’s area; served population = population × share (uniform density). Centroid walk distance uses the gig-data centroid snapped to the nearest street.',
      ],
      caveats: [
        'Where the Census 2024 id join failed, pop_2024 holds the Census 2012 count and pop_vintage is 2012.',
        'GN boundaries are the Census 2012 boundaries published in gig-data; walk_m_to_stop is null where the centroid lies outside the walk-graph envelope or off the street network.',
      ],
    },
  )
  const facilitiesTable = table(
    'metro-coverage-facilities',
    'Schools, hospitals and offices near Metro Bus stops',
    'Walking distance from each mapped school, hospital and office in the study area to its nearest Colombo Metro Bus stop.',
    'One row per OpenStreetMap school, college, university, kindergarten, hospital or clinic, and per Overture Maps office listing, within the study area.',
    ['facility_id'],
    [
      dim('facility_id', 'string', 'Facility ID (OpenStreetMap node/way, or overture/<id>)'),
      dim('name', 'string', 'Name'),
      dim('kind', 'string', 'Kind'),
      dim('office_type', 'string', 'Office type'),
      dim('lng', 'number', 'Longitude', 'degrees'),
      dim('lat', 'number', 'Latitude', 'degrees'),
      dim('gnd_id', 'string', 'GN division ID'),
      dim('nearest_stop', 'string', 'Nearest stop by walking'),
      measure('walk_m', 'integer', 'Walk to nearest stop', 'm'),
      dim('within_5min', 'boolean', 'Within a 5-minute walk of a stop'),
      dim('within_10min', 'boolean', 'Within a 10-minute walk of a stop'),
    ],
    facilityRows,
    {
      notes: [
        'schools_10min and hospitals_10min in the other coverage tables count kind = school and kind = hospital only; offices_* count kind = office.',
        `Offices (kind = office) are Overture Maps Places listings with confidence ≥ 0.5, not closed, from CDLA-Permissive-2.0, Apache-2.0 or CC0 sources, whose basic_category is ${Object.keys(OFFICE_TYPE_LABELS).join(', ')} (or whose taxonomy includes corporate_or_business_office or professional_service). office_type groups them as corporate, government, financial, professional, real_estate, media, design or logistics; it is null for schools and hospitals.`,
        'Count facilities with a grouped select (count by kind, nearest_stop or within_10min).',
        'within_5min / within_10min use the network walk to the nearest stop, including the straight walk from the facility point to its nearest street.',
      ],
      caveats: [
        'OpenStreetMap is not an official register of schools or health facilities; coverage of names and kinds is incomplete.',
        'Overture places are business listings, not employment counts: no headcount or floor area, coverage is uneven, and low-confidence listings are dropped.',
      ],
    },
  )
  const decilesTable = table(
    'metro-coverage-deciles',
    'Metro Bus walking coverage by population density',
    'Residents within a 10-minute walk of a Colombo Metro Bus stop, by GN-division density decile in the study area.',
    'One row per density decile of the study-area GN divisions (1 = sparsest, 10 = densest).',
    ['density_decile'],
    [
      dim('density_decile', 'integer', 'Density decile (10 = densest)'),
      measure('density_min_per_km2', 'number', 'Lowest division density in decile', 'people per km²'),
      measure('density_max_per_km2', 'number', 'Highest division density in decile', 'people per km²'),
      measure('gnd_count', 'integer', 'GN divisions', 'divisions', 'sum'),
      measure('pop_2024', 'integer', 'Population', 'people', 'sum'),
      measure('served_pop_10min', 'integer', 'Residents within a 10-minute walk', 'people', 'sum'),
      measure('unserved_pop_10min', 'integer', 'Residents beyond a 10-minute walk', 'people', 'sum'),
      measure('share_10min_pct', 'number', 'Residents within a 10-minute walk', '%'),
    ],
    deciles,
    { notes: ['Deciles split the study-area GN divisions into ten equal-count groups by population density.'] },
  )

  const report = validate({ stops, lines, stopRows, lineRows, gndRows, facilityRows, deciles, walksheds, gndById, snapReport, studyPop, network })
  return {
    files: {
      'public/data/metro_walksheds.geojson': walksheds,
      'public/data/metro-coverage-stops.json': stopsTable,
      'public/data/metro-coverage-lines.json': linesTable,
      'public/data/metro-coverage-gnd.json': gndTable,
      'public/data/metro-coverage-facilities.json': facilitiesTable,
      'public/data/metro-coverage-deciles.json': decilesTable,
    },
    report,
  }
}

// ---------------------------------------------------------------------------
export function validate({ stops, stopRows, lineRows, gndRows, facilityRows, deciles, walksheds, gndById, snapReport, studyPop }) {
  const problems = []
  const exceptions = []
  const finite = (obj, path) => {
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'number' && !Number.isFinite(v)) problems.push(`${path}.${k} is not finite`)
    }
  }
  stopRows.forEach((r) => finite(r, `stop ${r.stop_id}`))
  lineRows.forEach((r) => finite(r, `line ${r.line_code}`))
  gndRows.forEach((r) => finite(r, `gnd ${r.gnd_id}`))
  facilityRows.forEach((r) => finite(r, `facility ${r.facility_id}`))
  deciles.forEach((r) => finite(r, `decile ${r.density_decile}`))
  walksheds.features.forEach((f, k) => finite(f.properties, `walkshed[${k}]`))

  if (stopRows.length !== stops.length) problems.push('stop row count mismatch')
  for (const r of stopRows) {
    if (!(r.walkshed_km2_10min > 0)) problems.push(`stop ${r.stop_id} has no 10-min walkshed`)
    if (!(r.walkshed_km2_5min > 0)) problems.push(`stop ${r.stop_id} has no 5-min walkshed`)
    if (r.pop_5min > r.pop_10min) problems.push(`stop ${r.stop_id}: 5-min > 10-min population`)
    if (r.pop_10min > r.pop_circle_800m) exceptions.push(`stop ${r.stop} (${r.stop_id}): 10-min walk ${r.pop_10min} > circle ${r.pop_circle_800m}`)
  }
  const all = lineRows.find((r) => r.line_code === 'ALL')
  if (!all) problems.push('missing ALL line row')
  else {
    const sumStops = stopRows.reduce((a, r) => a + r.pop_10min, 0)
    if (all.pop_10min > sumStops) problems.push(`network 10-min ${all.pop_10min} > sum of stops ${sumStops}`)
    for (const r of lineRows) {
      if (r.line_code === 'ALL') continue
      if (r.pop_10min > all.pop_10min) problems.push(`line ${r.line_code} 10-min > network`)
      const lineStops = stopRows.filter((s) => s.routes.split(', ').includes(r.line_code))
      const sum = lineStops.reduce((a, s) => a + s.pop_10min, 0)
      if (r.pop_10min > sum + 1) problems.push(`line ${r.line_code} 10-min ${r.pop_10min} > sum of its stops ${sum}`)
      if (r.pop_5min > r.pop_10min) problems.push(`line ${r.line_code} 5-min > 10-min`)
      if (r.pop_10min > r.pop_circle_800m) exceptions.push(`line ${r.line_code}: 10-min walk > circle`)
    }
    if (all.pop_5min > all.pop_10min) problems.push('network 5-min > 10-min')
    if (all.pop_10min > all.pop_circle_800m) exceptions.push('network: 10-min walk > circle')
    if (all.study_area_pop !== studyPop) problems.push('study_area_pop mismatch')
    // GND served totals must reconcile with the network row (rounding per GND).
    const served = gndRows.reduce((a, r) => a + r.served_pop_10min, 0)
    if (Math.abs(served - all.pop_10min) > gndRows.length / 2 + 1) {
      problems.push(`GND served 10-min ${served} does not reconcile with network ${all.pop_10min}`)
    }
    const served5 = gndRows.reduce((a, r) => a + r.served_pop_5min, 0)
    if (Math.abs(served5 - all.pop_5min) > gndRows.length / 2 + 1) problems.push('GND served 5-min does not reconcile')
    const decServed = deciles.reduce((a, r) => a + r.served_pop_10min, 0)
    if (Math.abs(decServed - all.pop_10min) > 10) problems.push(`decile served ${decServed} != network ${all.pop_10min}`)
    const facWithin = facilityRows.filter((f) => f.within_10min)
    if (facWithin.filter((f) => f.kind === 'school').length !== all.schools_10min) problems.push('school counts do not reconcile')
    if (facWithin.filter((f) => f.kind === 'hospital').length !== all.hospitals_10min) problems.push('hospital counts do not reconcile')
    if (facWithin.filter((f) => f.kind === 'office').length !== all.offices_10min) problems.push('office counts do not reconcile')
    if (gndRows.reduce((a, r) => a + r.offices_within_10min, 0) !== all.offices_10min) problems.push('GND office counts do not reconcile')
    if (gndRows.reduce((a, r) => a + r.offices, 0) !== all.study_area_offices) problems.push('study-area office total does not reconcile')
    if (all.offices_10min > stopRows.reduce((a, r) => a + r.offices_10min, 0)) problems.push('network offices > sum of stops')
    for (const r of stopRows) if (r.offices_5min > r.offices_10min) problems.push(`stop ${r.stop_id}: offices 5-min > 10-min`)
  }
  const gndPop = gndRows.reduce((a, r) => a + r.pop_2024, 0)
  if (gndPop !== studyPop) problems.push('study population mismatch')
  if (deciles.reduce((a, r) => a + r.pop_2024, 0) !== studyPop) problems.push('decile population mismatch')
  if (deciles.length !== 10 || deciles.some((d) => d.gnd_count === 0)) problems.push('deciles must be 10 non-empty groups')
  for (const r of gndRows) {
    if (!gndById.has(r.gnd_id)) problems.push(`gnd ${r.gnd_id} missing from gnd-index`)
    for (const k of ['share_5min', 'share_10min', 'share_circle_800m']) {
      if (r[k] < 0 || r[k] > 1) problems.push(`gnd ${r.gnd_id} ${k} out of range`)
    }
    if (r.share_5min > r.share_10min) problems.push(`gnd ${r.gnd_id} 5-min share > 10-min share`)
    if (r.walk_m_to_stop === null && r.nearest_stop !== null) problems.push(`gnd ${r.gnd_id} half-null nearest stop`)
  }
  for (const f of facilityRows) {
    if (f.within_10min && (f.walk_m === null || f.walk_m > 801)) problems.push(`facility ${f.facility_id} within 10 min but walk ${f.walk_m}`)
    if (!f.within_10min && f.walk_m !== null && f.walk_m < 799) problems.push(`facility ${f.facility_id} walk ${f.walk_m} but not within 10 min`)
  }
  const kinds = new Set(walksheds.features.map((f) => `${f.properties.kind}/${f.properties.id}/${f.properties.minutes}/${f.properties.method}`))
  if (kinds.size !== walksheds.features.length) problems.push('duplicate walkshed features')
  for (const s of stopRows) {
    for (const key of [`stop/${s.stop_id}/5/network`, `stop/${s.stop_id}/10/network`, `stop/${s.stop_id}/10/circle_800m`]) {
      if (!kinds.has(key)) problems.push(`missing walkshed ${key}`)
    }
  }
  for (const f of walksheds.features) {
    const t = f.geometry?.type
    if (t !== 'Polygon' && t !== 'MultiPolygon') problems.push(`walkshed ${f.properties.id} has ${t} geometry`)
    if (t === 'MultiPolygon' && f.geometry.coordinates.length === 0) problems.push(`walkshed ${f.properties.id} is empty`)
  }
  if (problems.length) throw new Error(`validation failed:\n  ${problems.join('\n  ')}`)
  return { exceptions, snapMax: snapReport[0] }
}

function serialize(path, value) {
  if (path.endsWith('.geojson')) return `${JSON.stringify(value)}\n`
  parseIndicatorTable(value) // self-validate the Indicator Table contract
  return `${JSON.stringify(value)}\n`
}

async function main() {
  const check = process.argv.includes('--check')
  const { files, report } = await build()
  let changed = 0
  for (const [rel, value] of Object.entries(files)) {
    const text = serialize(rel, value)
    const path = join(ROOT, rel)
    const previous = existsSync(path) ? readFileSync(path, 'utf8') : null
    const kb = (Buffer.byteLength(text) / 1024).toFixed(0)
    if (previous === text) {
      console.log(`  unchanged ${rel} (${kb} KB)`)
      continue
    }
    changed++
    if (check) {
      console.error(`  stale ${rel}`)
      continue
    }
    writeFileSync(path, text)
    console.log(`  wrote ${rel} (${kb} KB)`)
  }
  const walkshedBytes = Buffer.byteLength(serialize('x.geojson', files['public/data/metro_walksheds.geojson']))
  if (walkshedBytes > 3 * 1024 * 1024) console.warn(`warning: metro_walksheds.geojson is ${(walkshedBytes / 1048576).toFixed(2)} MB (> 3 MB target)`)
  if (report.exceptions.length) {
    console.log(`10-min walk population exceeds the 800 m circle (${report.exceptions.length}):`)
    for (const e of report.exceptions) console.log(`  ${e}`)
  }
  const lines = files['public/data/metro-coverage-lines.json'].rows
  console.log('\nline     pop_5    pop_10   circle   share10%  per_km  shared%')
  for (const r of lines) {
    console.log(
      `${r.line_code.padEnd(6)} ${String(r.pop_5min).padStart(8)} ${String(r.pop_10min).padStart(8)} ${String(r.pop_circle_800m).padStart(8)} ${String(r.share_10min_pct).padStart(8)} ${String(r.pop_per_route_km).padStart(7)} ${String(r.shared_with_other_lines_pct).padStart(7)}`,
    )
  }
  if (check && changed) process.exit(1)
  console.log(changed ? `\nbuild-metro-coverage: ${changed} file(s) updated` : '\nbuild-metro-coverage: unchanged (no-op)')
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
