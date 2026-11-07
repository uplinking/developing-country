#!/usr/bin/env node
// Offline: stamp served_10min on GND centroids near a 10-min metro walk street.
// Does not scan catchment at request time. Null = outside the catchment envelope.

import { readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const INDEX = resolve(ROOT, 'public/data/gnd-index.json')
const CATCHMENT = resolve(ROOT, 'public/data/metro_catchment.geojson')
const NEAR_M = 200
const CELL = 0.004 // ~440 m

const R = 6371000
const toRad = (d) => (d * Math.PI) / 180
function haversineM(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}
const cellKey = (lng, lat) => `${Math.floor(lng / CELL)},${Math.floor(lat / CELL)}`

function walkCoords(geom, out) {
  if (!geom) return
  if (geom.type === 'LineString') {
    for (const c of geom.coordinates) if (Number.isFinite(c[0])) out.push(c)
    return
  }
  if (geom.type === 'MultiLineString') {
    for (const line of geom.coordinates) for (const c of line) if (Number.isFinite(c[0])) out.push(c)
  }
}

console.log('loading catchment …')
const catchment = JSON.parse(await readFile(CATCHMENT, 'utf8'))
const grid = new Map()
let verts = 0
let minLng = 180,
  maxLng = -180,
  minLat = 90,
  maxLat = -90
for (const f of catchment.features) {
  if (f.properties?.kind !== 'stop') continue
  if ((f.properties.d ?? 9999) > 800) continue
  const pts = []
  walkCoords(f.geometry, pts)
  for (const [lng, lat] of pts) {
    const k = cellKey(lng, lat)
    let bucket = grid.get(k)
    if (!bucket) {
      bucket = []
      grid.set(k, bucket)
    }
    bucket.push([lng, lat])
    verts++
    if (lng < minLng) minLng = lng
    if (lng > maxLng) maxLng = lng
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
  }
}
if (verts < 1000) throw new Error(`too few 10-min vertices: ${verts}`)

const pad = 0.02
const inEnvelope = (lat, lng) => lng >= minLng - pad && lng <= maxLng + pad && lat >= minLat - pad && lat <= maxLat + pad

console.log(`grid ${grid.size} cells, ${verts} vertices, envelope ${minLng.toFixed(3)},${minLat.toFixed(3)} → ${maxLng.toFixed(3)},${maxLat.toFixed(3)}`)

const idx = JSON.parse(await readFile(INDEX, 'utf8'))
const rows = idx.features
if (!Array.isArray(rows)) throw new Error('gnd-index missing features')

let served = 0
let unserved = 0
let outside = 0
for (const r of rows) {
  if (!inEnvelope(r.lat, r.lng)) {
    r.served_10min = null
    outside++
    continue
  }
  const cx = Math.floor(r.lng / CELL)
  const cy = Math.floor(r.lat / CELL)
  let best = Infinity
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const bucket = grid.get(`${cx + dx},${cy + dy}`)
      if (!bucket) continue
      for (const [lng, lat] of bucket) {
        const d = haversineM(r.lat, r.lng, lat, lng)
        if (d < best) best = d
      }
    }
  }
  r.served_10min = best <= NEAR_M
  if (r.served_10min) served++
  else unserved++
}

const tmp = INDEX + '.tmp'
const out = {
  ...idx,
  served_10min: {
    method: 'centroid_near_catchment_vertex',
    near_m: NEAR_M,
    band_m: 800,
    served,
    unserved,
    outside,
  },
}
await writeFile(tmp, JSON.stringify(out))
await rename(tmp, INDEX)
console.log(`served_10min: served=${served} unserved=${unserved} outside=${outside} (near ${NEAR_M} m)`)
for (const id of ['LK-1103010', 'LK-1103045']) {
  const r = rows.find((x) => x.id === id)
  console.log(`  ${id} ${r?.name} served_10min=${r?.served_10min}`)
}
if (served < 10) throw new Error('flagged almost nothing — catchment join failed')
