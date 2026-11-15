#!/usr/bin/env node
// Golden fixture for question (1): GND centroid-distance gap vs CM stops in Colombo.
// Does not boot the Worker — same haversine the handler uses.

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const idx = JSON.parse(readFileSync(join(root, 'public/data/gnd-index.json'), 'utf8'))
const metro = JSON.parse(readFileSync(join(root, 'public/data/metro.geojson'), 'utf8'))
const fixture = JSON.parse(readFileSync(join(root, 'src/worker/fixtures/query-gap-colombo.json'), 'utf8'))

const R = 6371000
const toRad = (d) => (d * Math.PI) / 180
function haversineM(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

const rows = idx.features ?? idx.rows ?? []
const byId = new Map(rows.map((r) => [r.id, r]))
let failed = 0
const fail = (m) => {
  console.error(`check-gap-colombo: ${m}`)
  failed++
}

for (const id of fixture.expect.index_ids_must_exist) {
  if (!byId.has(id)) fail(`index missing ${id}`)
}

const stops = metro.features.filter((f) => f.properties?.kind === 'stop' && f.geometry?.type === 'Point')
if (stops.length !== 110) fail(`expected 110 metro stops, got ${stops.length}`)

const req = fixture.request
const pool = rows.filter((r) => r.district === req.within.district)
const gap = []
for (const r of pool) {
  if (r.pop < req.min_population) continue
  let best = Infinity
  for (const s of stops) {
    const [lng, lat] = s.geometry.coordinates
    const d = haversineM(r.lat, r.lng, lat, lng)
    if (d < best) best = d
  }
  if (best > req.threshold_m) gap.push({ ...r, distance_m: Math.round(best) })
}
gap.sort((a, b) => b.pop - a.pop)

for (const id of ['LK-1103010', 'LK-1103045']) {
  const hit = gap.find((r) => r.id === id)
  if (!hit) fail(`${id} should be in the 800 m / min_population 4000 Colombo gap`)
  else console.log(`  ${id} ${hit.name} pop=${hit.pop} distance_m=${hit.distance_m}`)
}

if (failed) {
  console.error('check-gap-colombo: FAILED')
  process.exit(1)
}
console.log(`check-gap-colombo: ok — ${gap.length} Colombo GNDs unserved at ${req.threshold_m} m (pop ≥ ${req.min_population})`)
