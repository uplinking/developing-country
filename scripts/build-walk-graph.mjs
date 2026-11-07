#!/usr/bin/env node
// Colombo foot graph for request-time walk isochrone.
// Output: compact { nodes: [lng,lat][], edges: [a,b,metres][] }
// Upload the JSON to R2 as graphs/walk/colombo.json (or drop in public/data/walk-colombo.json).
// Target < 8 MB. Envelope: CM stops bbox + 3 km.

import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(ROOT, 'public/data/walk-colombo.json')
const UA = 'developing-country.org/1.0'
const PAD_DEG = 1.5 / 111 // ~1.5 km around CM stops; packed JSON must stay < 8 MB
const MIN_EDGE_M = 1
const DEC = 2e4 // ~5 m — merge unnoded junctions; keeps packed JSON smaller
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]

const R = 6371000
const rad = (x) => (x * Math.PI) / 180
function haversine([lo1, la1], [lo2, la2]) {
  const h =
    Math.sin(rad(la2 - la1) / 2) ** 2 +
    Math.cos(rad(la1)) * Math.cos(rad(la2)) * Math.sin(rad(lo2 - lo1) / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
const nodeKey = ([lon, lat]) => `${Math.round(lon * DEC)},${Math.round(lat * DEC)}`

const metro = JSON.parse(await readFile(resolve(ROOT, 'public/data/metro.geojson'), 'utf8'))
const stops = metro.features.filter((f) => f.properties?.kind === 'stop')
let minLat = 90,
  maxLat = -90,
  minLng = 180,
  maxLng = -180
for (const s of stops) {
  const [lng, lat] = s.geometry.coordinates
  if (lat < minLat) minLat = lat
  if (lat > maxLat) maxLat = lat
  if (lng < minLng) minLng = lng
  if (lng > maxLng) maxLng = lng
}
minLat -= PAD_DEG
maxLat += PAD_DEG
minLng -= PAD_DEG
maxLng += PAD_DEG

const excl = '^(motorway|motorway_link|construction|proposed|raceway|bus_guideway|escape)$'
const query = `[out:json][timeout:180];
way["highway"]["highway"!~"${excl}"]["area"!="yes"](${minLat},${minLng},${maxLat},${maxLng});
out geom;`

let json
let lastErr
for (const endpoint of OVERPASS) {
  try {
    console.log(`Querying ${endpoint} …`)
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        'User-Agent': UA,
      },
      body: 'data=' + encodeURIComponent(query),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    json = await res.json()
    break
  } catch (e) {
    lastErr = e
  }
}
if (!json) throw lastErr ?? new Error('overpass failed')

const nodes = []
const index = new Map()
function nid(coord) {
  const k = nodeKey(coord)
  if (index.has(k)) return index.get(k)
  const i = nodes.length
  nodes.push([coord[0], coord[1]])
  index.set(k, i)
  return i
}
const edgeSet = new Set()
const edges = []
for (const el of json.elements ?? []) {
  const geom = el.geometry
  if (!geom || geom.length < 2) continue
  for (let i = 1; i < geom.length; i++) {
    const a = [geom[i - 1].lon, geom[i - 1].lat]
    const b = [geom[i].lon, geom[i].lat]
    const w = Math.round(haversine(a, b))
    if (w < MIN_EDGE_M) continue
    const ia = nid(a)
    const ib = nid(b)
    if (ia === ib) continue
    const key = ia < ib ? `${ia}-${ib}` : `${ib}-${ia}`
    if (edgeSet.has(key)) continue
    edgeSet.add(key)
    edges.push([ia, ib, w])
  }
}

if (nodes.length < 1000 || edges.length < 1000) {
  throw new Error(`graph too small: ${nodes.length} nodes / ${edges.length} edges`)
}

const packedNodes = []
for (const [lng, lat] of nodes) packedNodes.push(Math.round(lng * DEC) / DEC, Math.round(lat * DEC) / DEC)
const packedEdges = []
for (const [a, b, w] of edges) packedEdges.push(a, b, w)
const out = {
  nodes: packedNodes,
  edges: packedEdges,
  packed: true,
  source: 'OpenStreetMap',
  licence: 'ODbL',
  vintage: '2026-10',
  bbox: [minLng, minLat, maxLng, maxLat],
}
const buf = Buffer.from(JSON.stringify(out))
await writeFile(OUT, buf)
if (buf.length > 10 * 1024 * 1024) {
  throw new Error(`graph ${buf.length} bytes exceeds 10 MB — split to z12 tiles before shipping`)
}
if (buf.length > 8 * 1024 * 1024) {
  console.warn(`warning: ${(buf.length / 1024 / 1024).toFixed(2)} MB > 8 MB target; still shipping packed`)
}
console.log(`wrote ${OUT} — ${nodes.length} nodes, ${edges.length} edges, ${(buf.length / 1024 / 1024).toFixed(2)} MB`)
console.log('Upload to R2 key graphs/walk/colombo.json (or leave in public/data for ASSETS fallback).')
