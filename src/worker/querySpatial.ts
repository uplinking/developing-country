// Closed spatial operators — one intent, not a tool per dataset.

import type { Env, Identity } from './types'
import type { JsonFc, StageEvent } from '../shared/stage'
import type { JsonObject, JsonValue } from '../shared/json'
import {
  isJsonNumber,
  isJsonObject,
  jsonObjectFromSerializable,
  parseJsonObject,
} from '../shared/json'
import { ApiError } from './errors'
import { haversineKm, pointInGeometry } from './geo'
import { loadFc, loadJson, type AssetFeature, type AssetFc } from './assets'
import { dijkstraWalk, loadWalkGraph, originOnGraph } from './graph'
import { webUrl } from './analyze'
import {
  getEntity,
  knownAbsentResponse,
  ONTOLOGY,
  type Completeness,
  type EntityType,
  type OperatorId,
  type Provenance,
} from './ontology'

export interface QuerySpatialResult {
  dataset_versions?: import('@developing-country/domain').DatasetVersionRef[]
  op: OperatorId | string
  entities: string[]
  method: string
  generated_at: string
  provenance: Provenance[]
  completeness: Completeness[]
  summary: string
  count: number
  truncated: boolean
  features: JsonObject[]
  aggregates?: {
    population?: number
    area_km2?: number
    entity_counts?: Record<string, number>
    inside?: Record<string, number>
    reached_edges?: number
    gnds_unserved?: number
    population_unserved?: number
    population_total_in_within?: number
    share_unserved?: number
    threshold_m?: number
  }
  hull?: { type: 'Polygon'; coordinates: number[][][] }
  hull_method?: 'convex_reached_nodes'
  geometry?: JsonFc
  geometry_omitted?: 'storage_limit'
  web_url: string
  stage: StageEvent[]
  saved?: { id: string; url: string } | null
  error?: string
}

interface Origin {
  lat: number
  lng: number
}

type Within =
  | { district: string }
  | { dsd_id: string }
  | { gnd_id: string }
  | { region_id: string }
  | { polygon: { type: 'Polygon' | 'MultiPolygon'; coordinates: JsonValue } }

interface AdminRow {
  id: string
  name: string
  pop: number
  pop_2012?: number
  pop_vintage?: number
  dens?: number
  area?: number
  parent?: string
  district: string
  dsd_id?: string
  lat: number
  lng: number
  served_10min?: boolean | null
  source?: string
  vintage?: string
}

interface GndIndexFile {
  type?: string
  source?: string
  vintage?: string
  licence?: string
  features?: AdminRow[]
  rows?: AdminRow[]
}

const COLOMBO = { lat: 6.9271, lng: 79.8612, zoom: 12 }
const MAX_LIMIT = 200
const MAX_POLY_VERTS = 5000

function nowIso() {
  return new Date().toISOString()
}

function typed(status: number, body: JsonObject): never {
  throw new ApiError(status, JSON.stringify(body))
}

function requireKeys(obj: JsonObject, allowed: string[], required: string[]) {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) typed(400, { error: 'unknown_key', key: k })
  }
  for (const k of required) {
    if (obj[k] === undefined) typed(400, { error: 'missing_key', key: k })
  }
}

function asNum(v: JsonValue | undefined, key: string): number {
  const n = Number(v)
  if (!Number.isFinite(n)) typed(400, { error: 'invalid_number', key })
  return n
}

function asOrigin(v: JsonValue | undefined): Origin {
  if (!isJsonObject(v)) typed(400, { error: 'invalid_origin' })
  const o = v
  requireKeys(o, ['lat', 'lng'], ['lat', 'lng'])
  const lat = asNum(o.lat, 'lat')
  const lng = asNum(o.lng, 'lng')
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) typed(400, { error: 'origin_out_of_range' })
  return { lat, lng }
}

function countVerts(coords: JsonValue | undefined): number {
  if (!Array.isArray(coords)) return 0
  if (coords.length >= 2 && isJsonNumber(coords[0])) return 1
  let n = 0
  for (const c of coords) n += countVerts(c)
  return n
}

function parseWithin(v: JsonValue | undefined): Within {
  if (!isJsonObject(v)) typed(400, { error: 'invalid_within' })
  const o = v
  const keys = Object.keys(o)
  if (keys.length !== 1) typed(400, { error: 'mixed_within_arms', keys })
  const k = keys[0]
  if (k === 'district') {
    const name = String(o.district ?? '')
    if (!name) typed(400, { error: 'invalid_within' })
    if (/^LK-/i.test(name)) {
      typed(400, {
        error: 'invalid_district',
        message: 'within.district is the English name (e.g. "Colombo"), not an LK-* code. Use dsd_id / gnd_id for codes.',
      })
    }
    return { district: name }
  }
  if (k === 'dsd_id') {
    const id = String(o.dsd_id ?? '')
    if (!id.startsWith('LK-')) typed(400, { error: 'invalid_dsd_id' })
    return { dsd_id: id }
  }
  if (k === 'gnd_id') {
    const id = String(o.gnd_id ?? '')
    if (!id.startsWith('LK-')) typed(400, { error: 'invalid_gnd_id' })
    return { gnd_id: id }
  }
  if (k === 'region_id') {
    typed(400, { error: 'operator_unavailable', op: 'within.region_id', eta: 'phase_b' })
  }
  if (k === 'polygon') {
    const p = isJsonObject(o.polygon) ? o.polygon : null
    if (!p || (p.type !== 'Polygon' && p.type !== 'MultiPolygon') || !p.coordinates) {
      typed(400, { error: 'invalid_polygon' })
    }
    if (countVerts(p.coordinates) > MAX_POLY_VERTS) typed(400, { error: 'polygon_too_large', max: MAX_POLY_VERTS })
    return { polygon: { type: p.type, coordinates: p.coordinates } }
  }
  typed(400, { error: 'unknown_within_arm', key: k })
}

function entityOrThrow(id: string): EntityType {
  const e = getEntity(id)
  if (!e) typed(400, { error: 'unknown_entity', entity: id })
  if (e.completeness.status === 'known_absent') {
    const miss = knownAbsentResponse(id)
    typed(400, jsonObjectFromSerializable(miss) ?? { error: 'known_absent', entity: id })
  }
  return e
}

function provenanceOf(e: EntityType): Provenance {
  return e.provenance
}

function completenessOf(e: EntityType): Completeness {
  return e.completeness
}

function limitOf(v: JsonValue | undefined, fallback = 50): number {
  if (v === undefined) return fallback
  return Math.min(Math.max(Math.trunc(asNum(v, 'limit')), 1), MAX_LIMIT)
}

function inBbox(lng: number, lat: number, bbox: number[]): boolean {
  const [w, s, e, n] = bbox
  return lng >= w && lng <= e && lat >= s && lat <= n
}

function featurePoint(f: AssetFeature): { lat: number; lng: number } | null {
  if (!f.geometry) return null
  const c = f.geometry.coordinates
  const walk = (x: JsonValue | undefined): number[] | null => {
    if (!Array.isArray(x)) return null
    if (isJsonNumber(x[0]) && isJsonNumber(x[1])) return [x[0], x[1]]
    return walk(x[0])
  }
  const p = walk(c)
  if (!p) return null
  return { lng: p[0], lat: p[1] }
}

function nameOf(props: AssetFeature['properties']): string {
  if (!props) return 'unnamed'
  return String(props.name ?? props.title ?? props.ref ?? props.code ?? 'unnamed')
}

function matchesEntity(e: EntityType, f: AssetFeature): boolean {
  const kind = f.properties?.kind
  if (e.id === 'metro_stop') return !kind || kind === 'stop'
  if (e.id === 'metro_line') return !kind || kind === 'line'
  return true
}

function popVintageOf(r: Pick<AdminRow, 'pop' | 'pop_2012' | 'pop_vintage'>): number {
  return r.pop_vintage ?? (r.pop === r.pop_2012 ? 2012 : 2024)
}

function adminFeature(
  r: AdminRow,
  idx: { source: string; vintage: string },
  extra: JsonObject = {},
): JsonObject {
  return {
    id: r.id,
    name: r.name,
    pop: r.pop,
    pop_2012: r.pop_2012 ?? null,
    pop_vintage: popVintageOf(r),
    dens: r.dens ?? null,
    area: r.area ?? null,
    district: r.district,
    lat: r.lat,
    lng: r.lng,
    source: idx.source,
    vintage: idx.vintage,
    ...extra,
  }
}

async function loadDistrictGeometry(
  env: Env,
  name: string,
): Promise<{ type: string; coordinates: JsonValue } | null> {
  const fc = await loadFc(env, '/data/demographics.geojson')
  if (!fc) return null
  const want = name.toLowerCase()
  for (const f of fc.features) {
    const n = String(f.properties?.name ?? '')
    if (n.toLowerCase() === want && f.geometry) return f.geometry
  }
  return null
}

function idOf(f: AssetFeature, field: string): string {
  const p = f.properties ?? {}
  if (p[field] != null) return String(p[field])
  if (f.id != null) return String(f.id)
  return nameOf(p)
}

async function loadEntityFc(env: Env, e: EntityType): Promise<AssetFc | null> {
  if (e.storage.kind !== 'geojson') return null
  return loadFc(env, e.storage.path)
}

async function loadAdminIndex(env: Env): Promise<{ rows: AdminRow[]; source: string; vintage: string } | null> {
  const raw = await loadJson<GndIndexFile | AdminRow[]>(env, '/data/gnd-index.json')
  if (!raw) return null
  const list = Array.isArray(raw) ? raw : (raw.features ?? raw.rows ?? [])
  const rows = list.map((r) => ({
    ...r,
    dsd_id: r.dsd_id ?? (r.id.length >= 10 ? r.id.slice(0, 7) : undefined),
    pop_vintage: r.pop_vintage ?? (r.pop === r.pop_2012 ? 2012 : 2024),
  }))
  if (rows.length === 0) return null
  const meta = Array.isArray(raw) ? {} : raw
  return { rows, source: meta.source ?? 'gig-data + census', vintage: meta.vintage ?? 'mixed' }
}

function filterAdmin(rows: AdminRow[], within?: Within, minPop?: number): AdminRow[] {
  let out = rows
  if (within && 'district' in within) {
    const want = within.district.toLowerCase()
    out = out.filter((r) => r.district.toLowerCase() === want)
  } else if (within && 'dsd_id' in within) {
    const id = within.dsd_id
    out = out.filter((r) => r.id === id || r.dsd_id === id || r.id.startsWith(`${id}`))
  } else if (within && 'gnd_id' in within) {
    out = out.filter((r) => r.id === within.gnd_id)
  } else if (within && 'polygon' in within) {
    const geom = { type: within.polygon.type, coordinates: within.polygon.coordinates }
    out = out.filter((r) => pointInGeometry(r.lng, r.lat, geom))
  }
  if (minPop != null) out = out.filter((r) => r.pop >= minPop)
  return out
}

function result(
  partial: Omit<QuerySpatialResult, 'generated_at' | 'web_url' | 'saved'> & {
    web_url?: string
    env: Env
    origin?: Origin
  },
): QuerySpatialResult {
  const { env, origin, web_url, ...rest } = partial
  const o = origin ?? COLOMBO
  return {
    ...rest,
    generated_at: nowIso(),
    web_url: web_url ?? webUrl(env, o.lat, o.lng),
    saved: null,
  }
}

async function metroStops(env: Env): Promise<Array<{ name: string; lat: number; lng: number }>> {
  const e = getEntity('metro_stop')
  if (!e || e.storage.kind !== 'geojson') return []
  const fc = await loadFc(env, e.storage.path)
  if (!fc) return []
  const out: Array<{ name: string; lat: number; lng: number }> = []
  for (const f of fc.features) {
    if (f.properties?.kind && f.properties.kind !== 'stop') continue
    const pt = featurePoint(f)
    if (!pt) continue
    if (f.geometry?.type === 'LineString' || f.geometry?.type === 'MultiLineString') continue
    out.push({ name: nameOf(f.properties), lat: pt.lat, lng: pt.lng })
  }
  return out
}

function gapStage(ids: string[], summary: string): StageEvent[] {
  return [
    { t: 'seq', i: 1, of: 4 },
    { t: 'flyTo', lng: COLOMBO.lng, lat: COLOMBO.lat, zoom: COLOMBO.zoom, duration_ms: 900 },
    { t: 'setPopulation', level: 'gnd' },
    { t: 'highlight', source: 'gnd', ids, style: 'gap' },
    { t: 'narrate', title: 'Metro coverage gap', body: summary, kind: 'gap' },
    { t: 'openSheet', mode: 'narrate' },
  ]
}

function asBbox(value: JsonValue | undefined): [number, number, number, number] {
  if (!Array.isArray(value) || value.length !== 4 || !value.every(isJsonNumber)) {
    typed(400, { error: 'invalid_bbox' })
  }
  return [value[0], value[1], value[2], value[3]]
}

/** Equality filters on feature properties, e.g. { kind: 'network', minutes: 10 }. */
function asPropertyWhere(value: JsonValue | undefined): Array<[string, string | number | boolean]> {
  if (value === undefined) return []
  if (!isJsonObject(value)) typed(400, { error: 'invalid_where', note: 'where is an object of property equality filters' })
  const entries = Object.entries(value)
  if (entries.length > 8) typed(400, { error: 'invalid_where', note: 'at most 8 property filters' })
  return entries.map(([key, v]) => {
    if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') {
      typed(400, { error: 'invalid_where', key, note: 'filter values must be scalars' })
    }
    return [key, v]
  })
}

function geometryBbox(coords: JsonValue | undefined, acc = [Infinity, Infinity, -Infinity, -Infinity]): number[] {
  if (!Array.isArray(coords)) return acc
  if (coords.length >= 2 && isJsonNumber(coords[0]) && isJsonNumber(coords[1])) {
    acc[0] = Math.min(acc[0] as number, coords[0])
    acc[1] = Math.min(acc[1] as number, coords[1])
    acc[2] = Math.max(acc[2] as number, coords[0])
    acc[3] = Math.max(acc[3] as number, coords[1])
    return acc
  }
  for (const c of coords) geometryBbox(c, acc)
  return acc
}

function bboxesIntersect(a: number[], b: number[]): boolean {
  return (a[0] as number) <= (b[2] as number) && (a[2] as number) >= (b[0] as number)
    && (a[1] as number) <= (b[3] as number) && (a[3] as number) >= (b[1] as number)
}

const MAX_GEOMETRY_FEATURES = 500

/**
 * bbox with include_geometry returns the matching features' own geometry (any
 * GeoJSON entity, not only light searchable ones) so a saved map can draw real
 * polygons such as walksheds. The snapshot byte cap still bounds the result.
 */
async function opBboxGeometry(env: Env, e: EntityType, args: JsonObject): Promise<QuerySpatialResult> {
  if (e.storage.kind !== 'geojson') typed(400, { error: 'store_unavailable', entity: e.id })
  const bbox = asBbox(args.bbox)
  const where = asPropertyWhere(args.where)
  const limit = args.limit === undefined
    ? MAX_GEOMETRY_FEATURES
    : Math.min(Math.max(Math.trunc(asNum(args.limit, 'limit')), 1), MAX_GEOMETRY_FEATURES)
  const fc = await loadEntityFc(env, e)
  if (!fc) typed(400, { error: 'store_unavailable', entity: e.id })
  const features: JsonObject[] = []
  const shapes: JsonFc['features'] = []
  let matched = 0
  for (const f of fc.features) {
    if (!matchesEntity(e, f) || !f.geometry) continue
    const props = f.properties ?? {}
    if (!where.every(([key, value]) => props[key] === value)) continue
    if (!bboxesIntersect(geometryBbox(f.geometry.coordinates), bbox)) continue
    matched += 1
    if (features.length >= limit) continue
    const id = idOf(f, e.id_field)
    const row: JsonObject = {
      ...props,
      id,
      name: nameOf(props),
      source: e.provenance.source,
      vintage: e.provenance.vintage,
    }
    features.push(row)
    shapes.push({ type: 'Feature', id, properties: { ...props, id }, geometry: f.geometry } as JsonFc['features'][number])
  }
  const filters = where.map(([key, value]) => `${key}=${value}`).join(', ')
  return result({
    env,
    op: 'bbox',
    entities: [e.id],
    method: 'bbox_geometry',
    provenance: [provenanceOf(e)],
    completeness: [completenessOf(e)],
    summary: `${features.length} ${e.title}${filters ? ` (${filters})` : ''} in bbox`,
    count: features.length,
    truncated: matched > features.length,
    features,
    geometry: { type: 'FeatureCollection', features: shapes },
    stage: [],
    origin: { lat: (bbox[1] + bbox[3]) / 2, lng: (bbox[0] + bbox[2]) / 2 },
  })
}

async function opBbox(env: Env, args: JsonObject): Promise<QuerySpatialResult> {
  requireKeys(args, ['op', 'entities', 'bbox', 'limit', 'where', 'include_geometry'], ['op', 'entities', 'bbox'])
  const e = entityOrThrow(String(args.entities))
  if (args.include_geometry === true) return opBboxGeometry(env, e, args)
  if (args.where !== undefined) typed(400, { error: 'where_requires_include_geometry' })
  if (!e.searchable || e.storage.kind !== 'geojson') {
    typed(400, {
      error: 'entity_not_searchable',
      entity: e.id,
      note: 'bbox scans searchable light geojson; pass include_geometry: true to return any GeoJSON entity with its geometry',
    })
  }
  const bbox = asBbox(args.bbox)
  const limit = limitOf(args.limit, 50)
  const fc = await loadEntityFc(env, e)
  if (!fc) typed(400, { error: 'store_unavailable', entity: e.id })
  const features: JsonObject[] = []
  for (const f of fc.features) {
    if (!matchesEntity(e, f)) continue
    const pt = featurePoint(f)
    if (!pt || !inBbox(pt.lng, pt.lat, bbox)) continue
    features.push({
      id: idOf(f, e.id_field),
      name: nameOf(f.properties),
      lat: pt.lat,
      lng: pt.lng,
      source: e.provenance.source,
      vintage: e.provenance.vintage,
    })
    if (features.length >= limit) break
  }
  return result({
    env,
    op: 'bbox',
    entities: [e.id],
    method: 'bbox',
    provenance: [provenanceOf(e)],
    completeness: [completenessOf(e)],
    summary: `${features.length} ${e.title} in bbox`,
    count: features.length,
    truncated: features.length >= limit,
    features,
    stage: [],
    origin: { lat: bbox[1], lng: bbox[0] },
  })
}

async function opNearest(env: Env, args: JsonObject): Promise<QuerySpatialResult> {
  requireKeys(args, ['op', 'entities', 'origin', 'n', 'radius_km'], ['op', 'entities', 'origin'])
  const e = entityOrThrow(String(args.entities))
  const origin = asOrigin(args.origin)
  const n = args.n === undefined ? 10 : Math.min(Math.max(Math.trunc(asNum(args.n, 'n')), 1), 50)
  const radiusKm = args.radius_km === undefined ? 100 : Math.min(Math.max(asNum(args.radius_km, 'radius_km'), 0), 100)
  if (e.storage.kind !== 'geojson') typed(400, { error: 'store_unavailable', entity: e.id })
  const fc = await loadEntityFc(env, e)
  if (!fc) typed(400, { error: 'store_unavailable', entity: e.id })
  const scored: Array<JsonObject & { _d: number }> = []
  for (const f of fc.features) {
    if (!matchesEntity(e, f)) continue
    const pt = featurePoint(f)
    if (!pt) continue
    const d = haversineKm(origin.lat, origin.lng, pt.lat, pt.lng)
    if (d > radiusKm) continue
    scored.push({
      id: idOf(f, e.id_field),
      name: nameOf(f.properties),
      lat: pt.lat,
      lng: pt.lng,
      distance_km: Math.round(d * 1000) / 1000,
      source: e.provenance.source,
      vintage: e.provenance.vintage,
      _d: d,
    })
  }
  scored.sort((a, b) => a._d - b._d)
  const features = scored.slice(0, n).map(({ _d: _drop, ...rest }) => rest)
  return result({
    env,
    origin,
    op: 'nearest',
    entities: [e.id],
    method: 'haversine',
    provenance: [provenanceOf(e)],
    completeness: [completenessOf(e)],
    summary: `${features.length} nearest ${e.title}`,
    count: features.length,
    truncated: scored.length > n,
    features,
    stage: [
      { t: 'flyTo', lng: origin.lng, lat: origin.lat, zoom: 13, duration_ms: 600 },
      { t: 'pulse', lng: origin.lng, lat: origin.lat },
    ],
  })
}

async function opPip(env: Env, args: JsonObject): Promise<QuerySpatialResult> {
  requireKeys(args, ['op', 'entities', 'origin'], ['op', 'entities', 'origin'])
  const e = entityOrThrow(String(args.entities))
  const origin = asOrigin(args.origin)
  if (e.id === 'gnd' || e.id === 'dsd') {
    const idx = await loadAdminIndex(env)
    if (!idx) typed(400, { error: 'store_unavailable', entity: e.id, note: 'gnd-index.json not shipped yet' })
    let best: AdminRow | null = null
    let bestD = Infinity
    for (const r of idx.rows) {
      if (e.id === 'dsd' && r.id.length > 7) continue
      const d = haversineKm(origin.lat, origin.lng, r.lat, r.lng)
      if (d < bestD) {
        bestD = d
        best = r
      }
    }
    const features = best ? [adminFeature(best, idx, { distance_m: Math.round(bestD * 1000) })] : []
    return result({
      env,
      origin: { lat: origin.lat, lng: origin.lng },
      op: 'point_in_polygon',
      entities: [e.id],
      method: 'nearest_gnd_centroid',
      provenance: [provenanceOf(e)],
      completeness: [completenessOf(e)],
      summary: best ? `${best.name} (${best.id}) — nearest centroid, not PIP` : 'no admin unit',
      count: features.length,
      truncated: false,
      features,
      stage: [{ t: 'flyTo', lng: origin.lng, lat: origin.lat, zoom: 14, duration_ms: 500 }, { t: 'pulse', lng: origin.lng, lat: origin.lat }],
    })
  }
  if (e.storage.kind !== 'geojson') typed(400, { error: 'store_unavailable', entity: e.id })
  const fc = await loadEntityFc(env, e)
  if (!fc) typed(400, { error: 'store_unavailable', entity: e.id })
  const features: JsonObject[] = []
  for (const f of fc.features) {
    if (!f.geometry) continue
    if (pointInGeometry(origin.lng, origin.lat, f.geometry)) {
      features.push({
        id: idOf(f, e.id_field),
        name: nameOf(f.properties),
        ...(f.properties ?? {}),
        source: e.provenance.source,
        vintage: e.provenance.vintage,
      })
      break
    }
  }
  return result({
    env,
    origin,
    op: 'point_in_polygon',
    entities: [e.id],
    method: 'point_in_polygon',
    provenance: [provenanceOf(e)],
    completeness: [completenessOf(e)],
    summary: features[0] ? String(features[0].name) : `not inside any ${e.title}`,
    count: features.length,
    truncated: false,
    features,
    stage: [{ t: 'flyTo', lng: origin.lng, lat: origin.lat, zoom: 12, duration_ms: 500 }],
  })
}

async function opOverlay(env: Env, args: JsonObject): Promise<QuerySpatialResult> {
  requireKeys(args, ['op', 'entities', 'within', 'method', 'min_population', 'limit'], ['op', 'entities', 'within', 'method'])
  const e = entityOrThrow(String(args.entities))
  const method = String(args.method)
  if (method !== 'centroid_in_polygon' && method !== 'point_in_polygon') {
    typed(400, { error: 'invalid_method', method })
  }
  const within = parseWithin(args.within)
  const minPop = args.min_population === undefined ? undefined : asNum(args.min_population, 'min_population')
  const limit = limitOf(args.limit, 200)

  if (e.id === 'gnd' || e.id === 'dsd' || e.id === 'district' || e.id === 'province') {
    if (method !== 'centroid_in_polygon') {
      typed(400, { error: 'invalid_method', note: 'admin overlay is centroid_in_polygon (no full rings in the isolate)' })
    }
    const idx = await loadAdminIndex(env)
    if (!idx) typed(400, { error: 'store_unavailable', entity: e.id })
    const rows = filterAdmin(idx.rows, within, minPop)
    const truncated = rows.length > limit
    const slice = rows.slice(0, limit)
    const pop = rows.reduce((a, r) => a + (r.pop || 0), 0)
    const features = slice.map((r) => adminFeature(r, idx))
    return result({
      env,
      origin: slice[0] ? { lat: slice[0].lat, lng: slice[0].lng } : COLOMBO,
      op: 'overlay',
      entities: [e.id],
      method,
      provenance: [provenanceOf(e)],
      completeness: [completenessOf(e)],
      summary: `${rows.length} ${e.title} (pop ${pop.toLocaleString('en-LK')})${truncated ? `, showing ${features.length}` : ''}`,
      count: features.length,
      truncated,
      features,
      aggregates: { population: pop, entity_counts: { [e.id]: rows.length } },
      stage: [
        { t: 'setPopulation', level: e.id === 'gnd' || e.id === 'dsd' || e.id === 'district' || e.id === 'province' ? e.id : 'gnd' },
        { t: 'highlight', source: e.id === 'gnd' || e.id === 'dsd' || e.id === 'district' ? e.id : 'gnd', ids: slice.map((r) => r.id), style: 'outline' },
      ],
    })
  }

  if (e.storage.kind !== 'geojson') typed(400, { error: 'store_unavailable', entity: e.id })
  const fc = await loadEntityFc(env, e)
  if (!fc) typed(400, { error: 'store_unavailable', entity: e.id })

  let clip: { type: string; coordinates: JsonValue } | null = null
  if ('polygon' in within) {
    clip = { type: within.polygon.type, coordinates: within.polygon.coordinates }
  } else if ('district' in within) {
    clip = await loadDistrictGeometry(env, within.district)
    if (!clip) typed(400, { error: 'unknown_district', district: within.district })
  } else if ('dsd_id' in within || 'gnd_id' in within) {
    typed(400, {
      error: 'operator_unavailable',
      op: 'overlay',
      within: 'dsd_id' in within ? 'dsd_id' : 'gnd_id',
      note: 'DSD/GND rings are not in the isolate. Overlay points with within.district or within.polygon.',
      eta: 'simplified_rings',
    })
  }

  const usedMethod = clip ? 'point_in_polygon' : method
  const features: JsonObject[] = []
  let scanned = 0
  for (const f of fc.features) {
    if (!matchesEntity(e, f)) continue
    const pt = featurePoint(f)
    if (!pt) continue
    if (clip && !pointInGeometry(pt.lng, pt.lat, clip)) continue
    scanned++
    if (features.length >= limit) continue
    features.push({
      id: idOf(f, e.id_field),
      name: nameOf(f.properties),
      lat: pt.lat,
      lng: pt.lng,
      source: e.provenance.source,
      vintage: e.provenance.vintage,
    })
  }
  return result({
    env,
    op: 'overlay',
    entities: [e.id],
    method: usedMethod,
    provenance: [provenanceOf(e)],
    completeness: [completenessOf(e)],
    summary: `${scanned} ${e.title} inside overlay${scanned > features.length ? `, showing ${features.length}` : ''}`,
    count: features.length,
    truncated: scanned > features.length,
    features,
    aggregates: { entity_counts: { [e.id]: scanned } },
    stage: [],
  })
}

async function opGap(env: Env, args: JsonObject): Promise<QuerySpatialResult> {
  requireKeys(
    args,
    ['op', 'entities', 'covered_by', 'method', 'threshold_m', 'within', 'min_population', 'limit'],
    ['op', 'entities', 'covered_by', 'method', 'threshold_m'],
  )
  const uncovered = entityOrThrow(String(args.entities))
  const coveringId = String(args.covered_by)
  const covering = entityOrThrow(coveringId)
  const method = String(args.method)
  if (method !== 'centroid_distance' && method !== 'street_intersect') {
    typed(400, { error: 'invalid_method', method, available: ['centroid_distance', 'street_intersect'] })
  }
  if (method === 'centroid_distance' && env.ENABLE_HEAVY_SPATIAL !== '1') {
    typed(503, {
      error: 'operator_unavailable',
      op: 'gap',
      method,
      note: 'Request-time all-pairs distance is disabled on the cost-capped deployment. Use street_intersect or publish a precomputed distance index.',
    })
  }
  if (uncovered.id !== 'gnd') typed(400, { error: 'gap_entities', note: 'gap is gnd not covered_by metro_stop' })
  if (covering.id !== 'metro_stop') typed(400, { error: 'gap_covered_by', note: 'covering type is metro_stop' })
  const threshold = asNum(args.threshold_m, 'threshold_m')
  const within = args.within ? parseWithin(args.within) : undefined
  const minPop = args.min_population === undefined ? 0 : asNum(args.min_population, 'min_population')
  const limit = limitOf(args.limit, 50)

  const idx = await loadAdminIndex(env)
  if (!idx) typed(400, { error: 'store_unavailable', entity: 'gnd', note: 'gnd-index.json required for gap' })
  const pool = filterAdmin(idx.rows, within)
  const scored: Array<AdminRow & { distance_m: number | null }> = []
  let stopCount = 0
  let stampedMethod = method
  let totalPop = pool.reduce((a, r) => a + (r.pop || 0), 0)

  if (method === 'street_intersect') {
    if (threshold !== 200) {
      typed(400, {
        error: 'invalid_threshold',
        method,
        allowed: 200,
        note: 'served_10min is a 200 m centroid-to-catchment-vertex flag, not a walk-time threshold. Use centroid_distance for 800 m.',
      })
    }
    const flagged = pool.filter((r) => r.served_10min === true || r.served_10min === false)
    if (flagged.length === 0) {
      typed(400, { error: 'operator_unavailable', method, note: 'served_10min not stamped; run bun run flag:served' })
    }
    totalPop = flagged.reduce((a, r) => a + (r.pop || 0), 0)
    stampedMethod = 'centroid_near_catchment_vertex'
    for (const r of flagged) {
      if (r.served_10min !== false) continue
      if (r.pop < minPop) continue
      scored.push({ ...r, distance_m: null })
    }
  } else {
    const stops = await metroStops(env)
    if (stops.length === 0) typed(400, { error: 'store_unavailable', entity: 'metro_stop' })
    stopCount = stops.length
    for (const r of pool) {
      if (r.pop < minPop) continue
      let best = Infinity
      for (const s of stops) {
        const d = haversineKm(r.lat, r.lng, s.lat, s.lng) * 1000
        if (d < best) best = d
      }
      if (best > threshold) scored.push({ ...r, distance_m: Math.round(best) })
    }
  }
  scored.sort((a, b) => b.pop - a.pop)
  const truncated = scored.length > limit
  const slice = scored.slice(0, limit)
  const unservedPop = scored.reduce((a, r) => a + (r.pop || 0), 0)
  const features = slice.map((r) =>
    adminFeature(r, idx, { distance_m: r.distance_m, served_10min: r.served_10min ?? null }),
  )
  const share = totalPop > 0 ? Math.round((unservedPop / totalPop) * 1000) / 1000 : 0
  const where = within && 'district' in within ? ` in ${within.district}` : ''
  const summary =
    stampedMethod === 'centroid_near_catchment_vertex'
      ? `${scored.length} GNDs, ~${unservedPop.toLocaleString('en-LK')} people${where} whose centroid is > 200 m from a 10-min metro walk street (${idx.vintage}, centroid_near_catchment_vertex).`
      : `${scored.length} GNDs, ~${unservedPop.toLocaleString('en-LK')} people${where} whose centroid is > ${threshold} m from a CM stop (${idx.vintage}, centroid_distance).`
  return result({
    env,
    origin: COLOMBO,
    web_url: `${webUrl(env, COLOMBO.lat, COLOMBO.lng)}&layers=metro,metro_catchment&pop=gnd`,
    op: 'gap',
    entities: [uncovered.id, covering.id],
    method: stampedMethod,
    provenance: [provenanceOf(uncovered), provenanceOf(covering)],
    completeness: [completenessOf(uncovered), completenessOf(covering)],
    summary,
    count: features.length,
    truncated,
    features,
    aggregates: {
      gnds_unserved: scored.length,
      population_unserved: unservedPop,
      population_total_in_within: totalPop,
      share_unserved: share,
      threshold_m: threshold,
      entity_counts: { gnd: scored.length, metro_stop: stopCount },
    },
    stage: gapStage(slice.map((r) => r.id), summary),
  })
}

async function opChoropleth(env: Env, args: JsonObject): Promise<QuerySpatialResult> {
  requireKeys(args, ['op', 'entities', 'origin', 'within'], ['op', 'entities'])
  const hasO = args.origin !== undefined
  const hasW = args.within !== undefined
  if (hasO === hasW) typed(400, { error: 'choropleth_join_requires_origin_xor_within' })
  if (hasO) return opPip(env, { op: 'point_in_polygon', entities: args.entities, origin: args.origin })
  return opOverlay(env, {
    op: 'overlay',
    entities: args.entities,
    within: args.within,
    method: 'centroid_in_polygon',
  })
}

async function opIsochrone(env: Env, identity: Identity | null, args: JsonObject): Promise<QuerySpatialResult> {
  requireKeys(args, ['op', 'origin', 'mode', 'minutes', 'include_geometry', 'inside'], ['op', 'origin', 'mode', 'minutes'])
  if (env.ENABLE_HEAVY_SPATIAL !== '1') {
    typed(503, {
      error: 'operator_unavailable',
      op: 'isochrone',
      note: 'Request-time graph traversal is disabled on the cost-capped deployment.',
    })
  }
  if (!identity) typed(401, { error: 'unauthorized', op: 'isochrone' })
  const mode = String(args.mode)
  if (mode !== 'walk') {
    typed(400, { error: 'operator_unavailable', available: ['walk'], eta: 'phase_c_container' })
  }
  const minutes = asNum(args.minutes, 'minutes')
  if (minutes !== 5 && minutes !== 10) typed(400, { error: 'invalid_minutes', allowed: [5, 10] })
  const origin = asOrigin(args.origin)
  const t0 = Date.now()
  const graph = await loadWalkGraph(env)
  if (!graph || !graph.nodes?.length) {
    typed(400, {
      error: 'operator_unavailable',
      op: 'isochrone',
      eta: 'upload graphs/walk/colombo.json to R2',
      note: 'Walk graph is not bound on this isolate yet.',
    })
  }
  if (!originOnGraph(graph, origin)) {
    typed(400, {
      error: 'origin_outside_graph',
      op: 'isochrone',
      origin: { lat: origin.lat, lng: origin.lng },
      envelope: 'Colombo CM + 3 km',
      note: 'Walk graph is Colombo-only. Origins more than 1.5 km from a graph node are refused.',
    })
  }
  const run = dijkstraWalk(graph, origin, minutes, t0)
  if (run.deadline) typed(400, { error: 'operator_expensive', op: 'isochrone', ms: Date.now() - t0 })

  const insideIds = Array.isArray(args.inside) ? args.inside.map(String).slice(0, 3) : []
  const inside: Record<string, number> = {}
  const insideFeatures: JsonObject[] = []
  const hullGeom = { type: 'Polygon' as const, coordinates: run.hull.coordinates }
  for (const id of insideIds) {
    const e = getEntity(id)
    if (!e || !e.searchable || e.storage.kind !== 'geojson') {
      typed(400, { error: 'inside_not_searchable', entity: id })
    }
    const fc = await loadEntityFc(env, e)
    let n = 0
    if (fc) {
      for (const f of fc.features) {
        if (!matchesEntity(e, f)) continue
        const pt = featurePoint(f)
        if (!pt) continue
        if (!pointInGeometry(pt.lng, pt.lat, hullGeom)) continue
        n++
        insideFeatures.push({
          entity: e.id,
          id: idOf(f, e.id_field),
          name: nameOf(f.properties),
          lat: pt.lat,
          lng: pt.lng,
          source: e.provenance.source,
          vintage: e.provenance.vintage,
        })
      }
    }
    inside[e.id] = n
  }

  const eGraph = getEntity('osm_foot_graph')
  return result({
    env,
    origin,
    op: 'isochrone',
    entities: ['osm_foot_graph'],
    method: 'dijkstra_walk_streets',
    provenance: eGraph ? [eGraph.provenance] : [],
    completeness: eGraph ? [eGraph.completeness] : [],
    summary: `Walk ${minutes} min from ${origin.lat.toFixed(4)},${origin.lng.toFixed(4)} — ${run.reached_edges} streets`,
    count: run.reached_edges,
    truncated: false,
    features: insideFeatures,
    aggregates: { reached_edges: run.reached_edges, inside: Object.keys(inside).length ? inside : undefined },
    hull: run.hull,
    hull_method: 'convex_reached_nodes',
    geometry: run.streets,
    stage: [
      { t: 'flyTo', lng: origin.lng, lat: origin.lat, zoom: 15, duration_ms: 700 },
      { t: 'pulse', lng: origin.lng, lat: origin.lat },
      { t: 'isochrone', origin, minutes, mode: 'walk' },
      { t: 'narrate', title: `${minutes}-min walk`, body: `${run.reached_edges} reachable streets.`, kind: 'info' },
    ],
  })
}

export async function querySpatial(env: Env, identity: Identity | null, args: JsonObject): Promise<QuerySpatialResult> {
  const t0 = Date.now()
  const op = String(args.op ?? '')
  try {
    if (op === 'bbox') return await opBbox(env, args)
    if (op === 'nearest') return await opNearest(env, args)
    if (op === 'point_in_polygon') return await opPip(env, args)
    if (op === 'overlay') return await opOverlay(env, args)
    if (op === 'gap') return await opGap(env, args)
    if (op === 'choropleth_join') return await opChoropleth(env, args)
    if (op === 'isochrone') return await opIsochrone(env, identity, args)
    if (op === 'region.upsert') typed(400, { error: 'operator_unavailable', op, eta: 'phase_b' })
    typed(400, { error: 'unknown_op', op, known: ONTOLOGY.operators.map((o) => o.id) })
  } finally {
    console.log(
      JSON.stringify({
        op: 'query_spatial',
        query_op: op,
        entities: args.entities ?? null,
        ms_wall: Date.now() - t0,
      }),
    )
  }
  throw new Error('unreachable')
}

/** Parse ApiError messages that carry JSON bodies back into objects for MCP. */
export function queryErrorBody(err: ApiError): JsonObject {
  const parsed = parseJsonObject(err.message)
  if (parsed) return parsed
  const out: JsonObject = { error: err.message }
  if (err.status === 401) out.error = 'unauthorized'
  return out
}
