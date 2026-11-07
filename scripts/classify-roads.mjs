// Streams a GeoJSONSeq of OSM highways (from `osmium export -f geojsonseq`) and
// classifies each into a Sri Lanka road tier, adding an estimated width where
// OSM has no surveyed one. Reads stdin, writes GeoJSONSeq to stdout.
//
//   osmium export roads.osm.pbf -f geojsonseq | bun scripts/classify-roads.mjs > roads.classified.geojsonseq
//
// Output properties: tier, width_est, width (if surveyed), lanes, surface, ref, name.

import { createInterface } from 'node:readline'

// Fallback carriageway widths (metres) by tier when lanes are unknown.
const DEFAULT_WIDTH = { expressway: 14, A: 7, B: 6, C: 4, other: 3 }
const LANE_WIDTH = 3.5

function tierOf(ref, highway) {
  const r = (ref || '').toUpperCase()
  if (/^E0?\d/.test(r) || highway === 'motorway' || highway === 'motorway_link') return 'expressway'
  if (/^A\d/.test(r)) return 'A'
  if (/^B\d/.test(r)) return 'B'
  switch (highway) {
    case 'trunk':
    case 'trunk_link':
    case 'primary':
    case 'primary_link':
      return 'A'
    case 'secondary':
    case 'secondary_link':
      return 'B'
    case 'tertiary':
    case 'tertiary_link':
      return 'C'
    default:
      return 'other'
  }
}

function numeric(v) {
  if (v === undefined || v === null) return null
  const n = parseFloat(String(v))
  return Number.isFinite(n) ? n : null
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
const out = process.stdout
const RECORD_SEPARATOR = String.fromCharCode(0x1e)

for await (const line of rl) {
  // GeoJSONSeq (RFC 8142) prefixes each record with a record-separator (0x1e).
  const trimmed = (line.startsWith(RECORD_SEPARATOR) ? line.slice(1) : line).trim()
  if (!trimmed) continue
  let f
  try {
    f = JSON.parse(trimmed)
  } catch {
    continue
  }
  const p = f.properties || {}
  if (!p.highway) continue
  // Roads are lines; skip highway nodes (bus stops, crossings, signals).
  const gt = f.geometry?.type
  if (gt !== 'LineString' && gt !== 'MultiLineString') continue

  const tier = tierOf(p.ref, p.highway)
  const lanes = numeric(p.lanes)
  const surveyedWidth = numeric(p.width)
  const widthEst = surveyedWidth
    ? null
    : lanes
      ? Math.round(lanes * LANE_WIDTH * 10) / 10
      : DEFAULT_WIDTH[tier]

  f.properties = {
    tier,
    ref: p.ref ?? null,
    name: p.name ?? null,
    lanes: lanes ?? null,
    surface: p.surface ?? null,
    width: surveyedWidth ?? null,
    width_est: widthEst,
  }
  out.write(JSON.stringify(f) + '\n')
}
