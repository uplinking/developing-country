import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseIndicatorTable } from '@developing-country/datasets'
import { GAP, adjacent, placeStops, roadGraph, roadPath } from './build-metro-alternatives.mjs'
import { ROOT, SOURCE_IDS, edgeIndex, project, snap, unproject } from './build-metro-coverage.mjs'

const read = (rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'))

describe('metro alternatives helpers', () => {
  test('stops are placed every step along a path, plus the end', () => {
    const pts = placeStops([[0, 0], [1000, 0], [1000, 1600]], 1000)
    expect(pts.map(([x, y]) => [Math.round(x), Math.round(y)])).toEqual([[1000, 0], [1000, 1000], [1000, 1600]])
    // a remainder under half a step merges into the final stop
    expect(placeStops([[0, 0], [2300, 0]], 1000).map(([x]) => Math.round(x))).toEqual([1000, 2300])
  })

  test('polygon adjacency needs a shared boundary, not just nearby boxes', () => {
    const sq = (x0, y0, s) => ({ rings: [[[x0, y0], [x0 + s, y0], [x0 + s, y0 + s], [x0, y0 + s]]], bbox: [x0, y0, x0 + s, y0 + s] })
    expect(adjacent(sq(0, 0, 100), sq(110, 0, 100))).toBe(true) // 10 m sliver
    expect(adjacent(sq(0, 0, 100), sq(200, 0, 100))).toBe(false)
    expect(adjacent(sq(0, 0, 100), sq(120, 120, 100))).toBe(false) // corner gap > 25 m
  })

  test('road routing follows the graph', () => {
    // an L of two 1 km ways (the lat/lng are only used to build metric coordinates)
    const a = [79.9, 6.9]
    const [ax, ay] = project(...a)
    const toLL = (x, y) => unproject(x, y)
    const coords = []
    for (let k = 0; k <= 200; k++) coords.push(toLL(ax + k * 5, ay))
    for (let k = 1; k <= 200; k++) coords.push(toLL(ax + 1000, ay + k * 5))
    const rg = roadGraph([{ id: 1, highway: 'primary', coords }])
    const idx = edgeIndex(rg)
    const from = snap(rg, idx, ax, ay + 3, 50)
    const to = snap(rg, idx, ax + 1004, ay + 1000, 50)
    const p = roadPath(rg, from, to)
    expect(p.metres).toBeGreaterThan(1990)
    expect(p.metres).toBeLessThan(2030)
  })
})

describe('metro alternatives artifacts', () => {
  const clusters = parseIndicatorTable(read('public/data/metro-gap-clusters.json'))
  const unique = parseIndicatorTable(read('public/data/metro-stop-uniqueness.json'))
  const candidates = parseIndicatorTable(read('public/data/metro-route-candidates.json'))
  const scenarios = parseIndicatorTable(read('public/data/metro-route-scenarios.json'))
  const lines = parseIndicatorTable(read('public/data/metro-coverage-lines.json'))
  const all = lines.rows.find((r) => r.line_code === 'ALL')

  test('tables share the coverage source chain', () => {
    for (const t of [clusters, unique, candidates, scenarios]) expect(t.source_ids).toEqual([...SOURCE_IDS])
  })

  test('gap clusters meet the floor and match their outlines', () => {
    const fc = read('public/data/metro-gap-clusters.geojson')
    expect(clusters.rows.length).toBeGreaterThanOrEqual(3)
    expect(fc.features.map((f) => f.properties.cluster_id)).toEqual(clusters.rows.map((r) => r.cluster_id))
    for (const r of clusters.rows) {
      expect(r.unserved_residents).toBeGreaterThanOrEqual(GAP.minUnserved)
      expect(r.unserved_residents).toBeLessThanOrEqual(r.residents)
    }
    const ids = clusters.rows.flatMap((r) => r.gnd_ids.split(','))
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('unique reach never exceeds a stop’s reach or the network', () => {
    expect(unique.rows.length).toBe(110)
    for (const r of unique.rows) expect(r.unique_pop_10min).toBeLessThanOrEqual(r.pop_10min)
    expect(unique.rows.reduce((a, r) => a + r.unique_pop_10min, 0)).toBeLessThanOrEqual(all.pop_10min + 110)
  })

  test('scenarios reconcile with the coverage network and the best candidates', () => {
    const [current, best] = scenarios.rows
    expect(current.residents_10min).toBe(all.pop_10min)
    expect(current.share_10min_pct).toBe(all.share_10min_pct)
    const picked = candidates.rows.filter((r) => r.in_best_3)
    expect(picked.length).toBe(3)
    expect(best.candidate_ids.split(',')).toEqual(picked.map((r) => r.candidate_id).sort())
    expect(best.residents_added_10min).toBeGreaterThan(0)
    expect(best.residents_added_10min).toBeLessThanOrEqual(picked.reduce((a, r) => a + r.new_pop_10min, 0) + 3)
    const byRate = [...candidates.rows].sort((a, b) => b.new_pop_per_km - a.new_pop_per_km)
    expect(byRate.slice(0, 3).every((r) => r.in_best_3)).toBe(true)
  })

  test('every candidate has a route line and its stops', () => {
    const fc = read('public/data/metro-route-candidates.geojson')
    for (const r of candidates.rows) {
      const route = fc.features.filter((f) => f.properties.part === 'route' && f.properties.candidate_id === r.candidate_id)
      expect(route.length).toBe(1)
      expect(route[0].geometry.type).toBe('LineString')
      const stops = fc.features.filter((f) => f.properties.part === 'stop' && f.properties.candidate_id === r.candidate_id)
      expect(stops.length).toBe(r.stop_count)
    }
  })
})
