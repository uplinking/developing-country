import { describe, expect, test } from 'bun:test'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parseIndicatorTable } from '@developing-country/datasets'
import {
  CONFIG,
  ROOT,
  SOURCE_IDS,
  buildGraph,
  dijkstra,
  edgeIndex,
  makeGrid,
  maskCells,
  maskFromCircles,
  maskFromSegments,
  project,
  reachedSegments,
  slug,
  snap,
  unproject,
  vectorize,
  walkFrom,
} from './build-metro-coverage.mjs'

const read = (rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'))

function ringArea(ring) {
  let a = 0
  for (let k = 0, l = ring.length - 1; k < ring.length; l = k++) a += ring[l][0] * ring[k][1] - ring[k][0] * ring[l][1]
  return a / 2
}

/** A straight 1 km east-west street of 4 × 250 m edges, plus a disconnected stub. */
function toyGraph() {
  const nodes = []
  const lat = 6.9
  for (let k = 0; k <= 4; k++) nodes.push(unproject(k * 250, project(79.92, lat)[1]))
  const edges = [0, 1, 250, 1, 2, 250, 2, 3, 250, 3, 4, 250]
  return buildGraph({ packed: true, nodes: nodes.flat(), edges, bbox: [79, 6, 81, 8] })
}

describe('metro coverage geometry', () => {
  test('projection round-trips to well under a metre', () => {
    const [x, y] = project(79.861, 6.927)
    const [lng, lat] = unproject(x, y)
    expect(Math.abs(lng - 79.861)).toBeLessThan(1e-9)
    expect(Math.abs(lat - 6.927)).toBeLessThan(1e-9)
  })

  test('slugs are stable ids', () => {
    expect(slug('Pannipitiya R.way')).toBe('pannipitiya-r-way')
    expect(slug('Wijerama Junc.')).toBe('wijerama-junc')
  })

  test('walking budget cuts edges part-way and counts the snap offset', () => {
    const g = toyGraph()
    // main-component threshold is 200 nodes; lower it for the toy graph by
    // snapping manually: a stop 10 m north of the middle of edge 1-2.
    const source = { edge: 1, t: 0.5, perp: 10, x: 375, y: 10, label: 0 }
    const run = dijkstra(g, [source], CONFIG.band5m)
    // node 1 and 2 are 125 m along + 10 m offset away
    expect(Math.round(run.dist[1])).toBe(135)
    expect(Math.round(run.dist[2])).toBe(135)
    expect(Math.round(run.dist[0])).toBe(385)
    expect(run.dist[4]).toBe(Infinity)
    const segs = reachedSegments(g, run, CONFIG.band5m)
    // reach along the street = 2 × (400 − 10) = 780 m (the source interval plus
    // the edges beyond its endpoints), x from 375 − 390 to 375 + 390
    let minX = Infinity
    let maxX = -Infinity
    for (const [ax, , bx] of segs) {
      const x0 = ax - g.x[0]
      const x1 = bx - g.x[0]
      minX = Math.min(minX, x0, x1)
      maxX = Math.max(maxX, x0, x1)
    }
    expect(minX).toBeCloseTo(0, 0) // node 0 reached at 385 m, cut 15 m beyond it is off-graph
    expect(maxX).toBeCloseTo(375 + 390, 0)
    const walk = walkFrom(g, run, { edge: 3, t: 0.2, perp: 5 })
    expect(Math.round(walk.d)).toBe(Math.round(10 + 125 + 250 + 50 + 5))
  })

  test('edge snapping ignores tiny disconnected components', () => {
    const g = toyGraph()
    expect(snap(g, edgeIndex(g), 375, 10, 100)).toBeNull() // 5-node toy is below the main-network floor
  })

  test('raster circles and buffers have the right area', () => {
    const grid = makeGrid(-2000, -2000, 2000, 2000)
    const circle = maskFromCircles(grid, [[0, 0]], 800)
    const area = maskCells(circle) * grid.cell ** 2
    expect(Math.abs(area / (Math.PI * 800 ** 2) - 1)).toBeLessThan(0.005)
    const capsule = maskFromSegments(grid, [[-500, 0, 500, 0]], 50)
    const expected = 1000 * 100 + Math.PI * 50 ** 2
    expect(Math.abs((maskCells(capsule) * grid.cell ** 2) / expected - 1)).toBeLessThan(0.01)
  })

  test('vectorised masks preserve area, including holes', () => {
    const grid = makeGrid(-2000, -2000, 2000, 2000)
    const ring = maskFromCircles(grid, [[0, 0]], 600)
    // copy another mask's cells into `ring` by global cell position (windows differ)
    const paint = (src, value) => {
      for (let j = 0; j < src.h; j++) {
        for (let i = 0; i < src.w; i++) {
          if (!src.data[j * src.w + i]) continue
          const ri = src.i0 + i - ring.i0
          const rj = src.j0 + j - ring.j0
          ring.data[rj * ring.w + ri] = value
        }
      }
    }
    paint(maskFromCircles(grid, [[0, 0]], 300), 0)
    paint(maskFromCircles(grid, [[0, 0]], 100), 1) // a separate island inside the hole
    const polys = vectorize(grid, ring, 0.01)
    expect(polys.length).toBe(2)
    const total = polys.reduce((a, [outer, ...holes]) => a + ringArea(outer) + holes.reduce((b, h) => b + ringArea(h), 0), 0)
    expect(total).toBeCloseTo(maskCells(ring) * grid.cell ** 2, 0)
    expect(polys.some((p) => p.length === 2)).toBe(true)
  })
})

describe('metro coverage artifacts', () => {
  const tables = ['stops', 'lines', 'gnd', 'facilities', 'deciles'].map((name) =>
    parseIndicatorTable(read(`public/data/metro-coverage-${name}.json`)),
  )
  const [stops, lines, gnd, facilities, deciles] = tables

  test('tables carry the derived source chain', () => {
    for (const t of tables) expect(t.source_ids).toEqual(SOURCE_IDS)
  })

  test('network totals reconcile across tables', () => {
    const all = lines.rows.find((r) => r.line_code === 'ALL')
    expect(all).toBeDefined()
    expect(stops.rows.length).toBe(110)
    expect(lines.rows.length).toBe(8)
    expect(all.pop_5min).toBeLessThanOrEqual(all.pop_10min)
    expect(all.pop_10min).toBeLessThanOrEqual(stops.rows.reduce((a, r) => a + r.pop_10min, 0))
    const studyPop = gnd.rows.reduce((a, r) => a + r.pop_2024, 0)
    expect(all.study_area_pop).toBe(studyPop)
    const served = gnd.rows.reduce((a, r) => a + r.served_pop_10min, 0)
    expect(Math.abs(served - all.pop_10min)).toBeLessThanOrEqual(gnd.rows.length / 2 + 1)
    expect(deciles.rows.reduce((a, r) => a + r.pop_2024, 0)).toBe(studyPop)
    expect(all.share_10min_pct).toBeCloseTo((all.pop_10min / studyPop) * 100, 1)
    const within = facilities.rows.filter((r) => r.within_10min)
    expect(within.filter((r) => r.kind === 'school').length).toBe(all.schools_10min)
    expect(within.filter((r) => r.kind === 'hospital').length).toBe(all.hospitals_10min)
    expect(within.filter((r) => r.kind === 'office').length).toBe(all.offices_10min)
    expect(gnd.rows.reduce((a, r) => a + r.offices, 0)).toBe(all.study_area_offices)
    expect(all.offices_share_10min_pct).toBeCloseTo((all.offices_10min / all.study_area_offices) * 100, 1)
    for (const r of stops.rows) expect(r.offices_5min).toBeLessThanOrEqual(r.offices_10min)
    for (const r of gnd.rows) expect(r.share_10min_pct).toBeCloseTo(r.share_10min * 100, 0)
  })

  test('every GN id joins the demographics index', () => {
    const ids = new Set(read('public/data/gnd-index.json').features.map((r) => r.id))
    for (const r of gnd.rows) expect(ids.has(r.gnd_id)).toBe(true)
  })

  test('walksheds cover every stop, line and the network and stay small', () => {
    const fc = read('public/data/metro_walksheds.geojson')
    expect(fc.features.length).toBe((110 + 7 + 1) * 3)
    for (const s of stops.rows) {
      const own = fc.features.filter((f) => f.properties.kind === 'stop' && f.properties.id === s.stop_id)
      expect(own.map((f) => `${f.properties.minutes}/${f.properties.method}`).sort()).toEqual(['10/circle_800m', '10/network', '5/network'])
      expect(own.every((f) => f.properties.area_km2 > 0)).toBe(true)
    }
    expect(statSync(join(ROOT, 'public/data/metro_walksheds.geojson')).size).toBeLessThan(3 * 1024 * 1024)
  })
})
