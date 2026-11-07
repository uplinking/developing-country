// Colombo walk graph + Dijkstra. Load from R2 (or ASSETS fallback), clip, run,
// then drop — never hold the graph and the GND index at once.

import type { Env } from './types'
import type { JsonFc } from '../shared/stage'
import type { JsonValue } from '../shared/json'
import { isJsonNumber, isJsonObject } from '../shared/json'
import { haversineKm } from './geo'

export interface WalkGraph {
  nodes: Array<[number, number]> // [lng, lat]
  edges: Array<[number, number, number]> // [a, b, metres]
  bbox?: [number, number, number, number] // west, south, east, north
}

interface DijkstraResult {
  streets: JsonFc
  hull: { type: 'Polygon'; coordinates: number[][][] }
  reached_edges: number
  deadline: boolean
}

let loaded: WalkGraph | null = null

const DEADLINE_MS = 5000
const WALK_M_PER_MIN = 80

function numberTuple(value: JsonValue | undefined, size: number): number[] | null {
  return Array.isArray(value) && value.length === size && value.every(isJsonNumber)
    ? value
    : null
}

function unpack(raw: JsonValue): WalkGraph | null {
  if (!isJsonObject(raw)) return null
  const bboxValues = numberTuple(raw.bbox, 4)
  const bbox: WalkGraph['bbox'] = bboxValues
    ? [bboxValues[0], bboxValues[1], bboxValues[2], bboxValues[3]]
    : undefined
  if (
    Array.isArray(raw.nodes) &&
    raw.nodes.every(isJsonNumber) &&
    Array.isArray(raw.edges) &&
    raw.edges.every(isJsonNumber)
  ) {
    const flat = raw.nodes
    const nodes: WalkGraph['nodes'] = []
    for (let i = 0; i + 1 < flat.length; i += 2) nodes.push([flat[i], flat[i + 1]])
    const eflat = raw.edges
    const edges: WalkGraph['edges'] = []
    for (let i = 0; i + 2 < eflat.length; i += 3) edges.push([eflat[i], eflat[i + 1], eflat[i + 2]])
    return { nodes, edges, bbox }
  }
  if (Array.isArray(raw.nodes) && Array.isArray(raw.edges)) {
    const nodes = raw.nodes
      .map((value) => numberTuple(value, 2))
      .filter((value): value is number[] => value !== null)
      .map((value): [number, number] => [value[0], value[1]])
    const edges = raw.edges
      .map((value) => numberTuple(value, 3))
      .filter((value): value is number[] => value !== null)
      .map((value): [number, number, number] => [value[0], value[1], value[2]])
    if (nodes.length === raw.nodes.length && edges.length === raw.edges.length) {
      return { nodes, edges, bbox }
    }
  }
  return null
}

/** False when origin is outside the Colombo walk envelope (or > 1.5 km from any node). */
export function originOnGraph(graph: WalkGraph, origin: { lat: number; lng: number }): boolean {
  if (graph.bbox) {
    const [w, s, e, n] = graph.bbox
    const pad = 0.01
    if (origin.lng < w - pad || origin.lng > e + pad || origin.lat < s - pad || origin.lat > n + pad) return false
  }
  if (!graph.nodes.length) return false
  const i = nearestNode(graph, origin.lng, origin.lat)
  const [lng, lat] = graph.nodes[i]
  return haversineKm(origin.lat, origin.lng, lat, lng) * 1000 <= 1500
}

export async function loadWalkGraph(env: Env): Promise<WalkGraph | null> {
  if (loaded) return loaded
  const key = 'graphs/walk/colombo.json'
  try {
    const obj = await env.TILES.get(key)
    if (obj) {
      const raw: JsonValue = await obj.json()
      loaded = unpack(raw)
      return loaded
    }
  } catch {
    /* fall through to assets */
  }
  try {
    const res = await env.ASSETS.fetch(new Request('https://assets.local/data/walk-colombo.json'))
    if (res.ok) {
      const raw: JsonValue = await res.json()
      loaded = unpack(raw)
      return loaded
    }
  } catch {
    /* missing */
  }
  return null
}

export function dropWalkGraph() {
  loaded = null
}

function nearestNode(graph: WalkGraph, lng: number, lat: number): number {
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < graph.nodes.length; i++) {
    const [x, y] = graph.nodes[i]
    const d = (x - lng) ** 2 + (y - lat) ** 2
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

export function dijkstraWalk(
  graph: WalkGraph,
  origin: { lat: number; lng: number },
  minutes: 5 | 10,
  t0 = Date.now(),
): DijkstraResult {
  const cap = minutes * WALK_M_PER_MIN
  const clipM = cap * 1.2
  const dlat = clipM / 111_000
  const clat = Math.cos((origin.lat * Math.PI) / 180)
  const dlng = clipM / (111_000 * Math.max(clat, 0.2))
  const near = (i: number) => {
    const [x, y] = graph.nodes[i]
    return Math.abs(x - origin.lng) <= dlng && Math.abs(y - origin.lat) <= dlat
  }
  const start = nearestNode(graph, origin.lng, origin.lat)
  const adj = new Map<number, Array<{ to: number; w: number }>>()
  const add = (a: number, b: number, w: number) => {
    let list = adj.get(a)
    if (!list) {
      list = []
      adj.set(a, list)
    }
    list.push({ to: b, w })
  }
  for (const [a, b, w] of graph.edges) {
    if (!near(a) && !near(b)) continue
    add(a, b, w)
    add(b, a, w)
  }
  const dist = new Float64Array(graph.nodes.length).fill(Infinity)
  dist[start] = 0
  const heap: Array<{ i: number; d: number }> = [{ i: start, d: 0 }]
  const push = (i: number, d: number) => {
    heap.push({ i, d })
    let k = heap.length - 1
    while (k > 0) {
      const p = (k - 1) >> 1
      if (heap[p].d <= heap[k].d) break
      const t = heap[p]
      heap[p] = heap[k]
      heap[k] = t
      k = p
    }
  }
  const pop = () => {
    const out = heap[0]
    const last = heap.pop()!
    if (!heap.length) return out
    heap[0] = last
    let k = 0
    for (;;) {
      let m = k
      const l = k * 2 + 1
      const r = l + 1
      if (l < heap.length && heap[l].d < heap[m].d) m = l
      if (r < heap.length && heap[r].d < heap[m].d) m = r
      if (m === k) break
      const t = heap[k]
      heap[k] = heap[m]
      heap[m] = t
      k = m
    }
    return out
  }

  let deadline = false
  while (heap.length) {
    if (Date.now() - t0 > DEADLINE_MS) {
      deadline = true
      break
    }
    const { i, d } = pop()
    if (d !== dist[i] || d > cap) continue
    for (const e of adj.get(i) ?? []) {
      const nd = d + e.w
      if (nd < dist[e.to] && nd <= cap) {
        dist[e.to] = nd
        push(e.to, nd)
      }
    }
  }

  const features: JsonFc['features'] = []
  const reached: Array<[number, number]> = []
  for (const [a, b, w] of graph.edges) {
    if (!(dist[a] <= cap || dist[b] <= cap)) continue
    const da = dist[a]
    const db = dist[b]
    const d = Math.min(da, db)
    if (!Number.isFinite(d)) continue
    const na = graph.nodes[a]
    const nb = graph.nodes[b]
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [na, nb] },
      properties: { d: Math.round(d), w },
    })
    if (Number.isFinite(da)) reached.push(na)
    if (Number.isFinite(db)) reached.push(nb)
  }

  const hull = convexHull(reached.length ? reached : [[origin.lng, origin.lat]])
  return {
    streets: { type: 'FeatureCollection', features },
    hull: { type: 'Polygon', coordinates: [hull] },
    reached_edges: features.length,
    deadline,
  }
}

/** Monotone-chain hull, closed ring, capped at 256 verts. */
function convexHull(pts: Array<[number, number]>): Array<[number, number]> {
  const u = new Map<string, [number, number]>()
  for (const p of pts) u.set(`${p[0]},${p[1]}`, p)
  const points = [...u.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (points.length < 3) {
    const c = points[0] ?? [0, 0]
    const e = 0.0008
    return [
      [c[0] - e, c[1] - e],
      [c[0] + e, c[1] - e],
      [c[0] + e, c[1] + e],
      [c[0] - e, c[1] + e],
      [c[0] - e, c[1] - e],
    ]
  }
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: Array<[number, number]> = []
  for (const p of points) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: Array<[number, number]> = []
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  lower.pop()
  upper.pop()
  let ring = [...lower, ...upper]
  if (ring.length > 255) {
    const step = Math.ceil(ring.length / 255)
    ring = ring.filter((_, i) => i % step === 0)
  }
  ring.push(ring[0])
  return ring
}
