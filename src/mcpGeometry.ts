// Shapes the MCP App draws for a bbox include_geometry answer. When the Worker
// kept the geometry out of the tool result (too large for a host to carry
// reliably), the widget re-runs the same selection on the public asset.

import type { JsonFc } from './shared/stage'
import type { Bbox, GeometryRef, GeometrySourceFeature } from './shared/bboxGeometry'
import { drawnFeature, geometryBbox, selectBboxGeometry } from './shared/bboxGeometry'
import { isJsonObject, isJsonString, type JsonObject, type JsonValue } from './shared/json'
import { withBase } from './base'

type Fetch = (input: string) => Promise<Pick<Response, 'ok' | 'json'>>

function isSourceFeature(value: JsonValue): value is JsonObject & GeometrySourceFeature {
  if (!isJsonObject(value)) return false
  const { properties, geometry } = value
  // Missing properties are read as {} on both sides (featureId, the Worker's selection).
  return (properties === undefined || properties === null || isJsonObject(properties))
    && isJsonObject(geometry) && isJsonString(geometry.type)
}

/** The omitted shapes, rebuilt from `ref.path`; null when the asset cannot be read. */
export async function fetchGeometry(ref: GeometryRef, fetcher: Fetch = (url) => fetch(url)): Promise<JsonFc | null> {
  try {
    const res = await fetcher(withBase(ref.path))
    if (!res.ok) return null
    const fc: JsonValue = await res.json()
    if (!isJsonObject(fc) || !Array.isArray(fc.features)) return null
    const { picked } = selectBboxGeometry(fc.features.filter(isSourceFeature), ref)
    return { type: 'FeatureCollection', features: picked.map(({ feature, id }) => drawnFeature(feature, id)) }
  } catch {
    return null
  }
}

/** Centre and a zoom that frames every shape (the handle only exposes flyTo). */
export function cameraForDrawing(fc: JsonFc): { lng: number; lat: number; zoom: number } | null {
  const acc: Bbox = [Infinity, Infinity, -Infinity, -Infinity]
  for (const f of fc.features) {
    const g = f.geometry
    if (!g) continue
    if (g.type === 'GeometryCollection') {
      for (const part of g.geometries) if ('coordinates' in part) geometryBbox(part.coordinates, acc)
    } else {
      geometryBbox(g.coordinates, acc)
    }
  }
  const [w, s, e, n] = acc
  if (!Number.isFinite(w) || !Number.isFinite(s) || !Number.isFinite(e) || !Number.isFinite(n)) return null
  const span = Math.max(e - w, (n - s) * 1.3, 0.002)
  const zoom = Math.min(15, Math.max(6, Math.log2(360 / span) - 0.6))
  return { lng: (w + e) / 2, lat: (s + n) / 2, zoom: Math.round(zoom * 10) / 10 }
}
