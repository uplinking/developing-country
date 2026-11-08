// One selection rule for `query_data {op:"bbox", include_geometry:true}`,
// shared by the Worker (which answers the query) and the MCP App (which
// re-selects the same features from the public GeoJSON asset when the shapes
// were too large to ship inside the tool result). Same asset + same query =
// same features, so the map the widget draws is the answer the model read.

import type { JsonObject, JsonValue } from './json'
import { isJsonNumber, isJsonObject, isJsonString } from './json'
import type { JsonFeature, JsonGeometry } from './stage'

export type Bbox = [number, number, number, number]
export type PropertyFilter = [string, string | number | boolean]

export interface BboxGeometryQuery {
  bbox: Bbox
  /** Property equality filters, all of which must hold. */
  where: PropertyFilter[]
  /** Features returned; `matched` still counts every match. */
  limit: number
  /** Exclude features whose `kind` property is set to another value (metro stops vs lines share one file). */
  kind?: string
  /** Property that carries the feature id; falls back to Feature.id, then the name. */
  idField: string
}

export interface GeometrySourceFeature {
  id?: string | number
  properties: JsonObject | null
  geometry: { type: string; coordinates?: JsonValue } | null
}

/**
 * What the widget needs to rebuild omitted shapes: the public asset path plus
 * the exact query. Carried in structuredContent when the geometry itself is
 * over the inline budget.
 */
export interface GeometryRef extends BboxGeometryQuery {
  entity: string
  /** App-absolute path of the public GeoJSON asset, e.g. /data/metro_walksheds.geojson. */
  path: string
  /** Shapes the full result holds. */
  features: number
  /** Compact JSON bytes of the omitted FeatureCollection. */
  bytes: number
}

export function featureName(props: JsonObject | null): string {
  if (!props) return 'unnamed'
  return String(props.name ?? props.title ?? props.ref ?? props.code ?? 'unnamed')
}

export function featureId(f: GeometrySourceFeature, field: string): string {
  const p = f.properties ?? {}
  if (p[field] != null) return String(p[field])
  if (f.id != null) return String(f.id)
  return featureName(p)
}

/** [west, south, east, north] of every position under `coords`, folded into `acc`. */
export function geometryBbox(coords: JsonValue | undefined, acc: Bbox = [Infinity, Infinity, -Infinity, -Infinity]): Bbox {
  if (!Array.isArray(coords)) return acc
  const [x, y] = coords
  if (coords.length >= 2 && isJsonNumber(x) && isJsonNumber(y)) {
    acc[0] = Math.min(acc[0], x)
    acc[1] = Math.min(acc[1], y)
    acc[2] = Math.max(acc[2], x)
    acc[3] = Math.max(acc[3], y)
    return acc
  }
  for (const c of coords) geometryBbox(c, acc)
  return acc
}

export function bboxesIntersect(a: Bbox, b: Bbox): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]
}

/** Features a bbox geometry query picked (asset order) and how many matched before the limit. */
export interface BboxGeometrySelection<F> {
  picked: Array<{ feature: F; id: string }>
  matched: number
}

/** The features a bbox geometry query returns, in asset order, plus the full match count. */
export function selectBboxGeometry<F extends GeometrySourceFeature>(
  features: readonly F[],
  q: BboxGeometryQuery,
): BboxGeometrySelection<F> {
  const picked: BboxGeometrySelection<F>['picked'] = []
  let matched = 0
  for (const f of features) {
    if (!f.geometry) continue
    const props = f.properties ?? {}
    if (q.kind !== undefined && props.kind && props.kind !== q.kind) continue
    if (!q.where.every(([key, value]) => props[key] === value)) continue
    if (!bboxesIntersect(geometryBbox(f.geometry.coordinates), q.bbox)) continue
    matched += 1
    if (picked.length >= q.limit) continue
    picked.push({ feature: f, id: featureId(f, q.idField) })
  }
  return { picked, matched }
}

/** The drawn shape for one picked feature: its own geometry, properties plus a resolved id. */
export function drawnFeature(f: GeometrySourceFeature, id: string): JsonFeature {
  // SAFETY: Platform GeoJSON assets hold RFC 7946 geometries; the Worker has served them this way since bbox geometry shipped.
  const geometry = f.geometry as JsonGeometry
  return { type: 'Feature', id, properties: { ...(f.properties ?? {}), id }, geometry }
}

/** Parse a geometry_ref from a tool result; null unless every field is well-formed. */
export function parseGeometryRef(value: JsonValue | undefined): GeometryRef | null {
  if (!isJsonObject(value)) return null
  const { entity, path, bbox, where, limit, kind, idField, features, bytes } = value
  if (!isJsonString(entity) || !isJsonString(path) || !isJsonString(idField)) return null
  if (!/^\/data\/[A-Za-z0-9_.-]+\.geojson$/.test(path)) return null
  if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(isJsonNumber)) return null
  if (!Array.isArray(where)) return null
  const filters: PropertyFilter[] = []
  for (const pair of where) {
    if (!Array.isArray(pair) || pair.length !== 2 || !isJsonString(pair[0])) return null
    const v = pair[1]
    if (!isJsonString(v) && !isJsonNumber(v) && v !== true && v !== false) return null
    filters.push([pair[0], v])
  }
  if (!isJsonNumber(limit) || !isJsonNumber(features) || !isJsonNumber(bytes)) return null
  if (kind !== undefined && !isJsonString(kind)) return null
  const ref: GeometryRef = {
    entity,
    path,
    bbox: [bbox[0], bbox[1], bbox[2], bbox[3]],
    where: filters,
    limit,
    idField,
    features,
    bytes,
  }
  if (kind !== undefined) ref.kind = kind
  return ref
}
