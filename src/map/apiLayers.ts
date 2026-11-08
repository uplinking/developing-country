// Runtime-fetched map layers (Stepper / prospects / analyses). Each is backed by
// a same-origin API endpoint; this module fetches the endpoint and adapts the
// response into a MapLibre-ready GeoJSON FeatureCollection. Failure is never
// fatal: on any error we resolve to an empty collection and a not-ok status, so
// the layer just renders nothing and its panel card shows an "unavailable"
// state (see LayerPanel). The API response is DATA — we never execute it.

import type { Feature, FeatureCollection } from 'geojson'
import { withBase } from '../base'
import type { JsonObject, JsonValue } from '../shared/json'
import { isJsonNumber, isJsonObject, isJsonString } from '../shared/json'
import type { ApiLayerFailure } from '../types'

export interface ApiLayerResult {
  data: FeatureCollection
  ok: boolean
  count: number
  /** Why ok is false: 401/403 mean sign in; anything else is an outage. */
  reason?: ApiLayerFailure
  /** The endpoint served its last good copy because the live source failed. */
  stale?: boolean
  /** Human-readable reason when ok === false (dev only). */
  error?: string
}

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }

function fail(error: string, reason: ApiLayerFailure = 'unavailable'): ApiLayerResult {
  return { data: EMPTY, ok: false, count: 0, reason, error }
}

function ok(features: Feature[]): ApiLayerResult {
  return { data: { type: 'FeatureCollection', features }, ok: true, count: features.length }
}

/** Fetch + adapt one API-backed layer by its group id. */
export async function fetchApiLayer(groupId: string, endpoint: string): Promise<ApiLayerResult> {
  let json: JsonValue
  try {
    // credentials:'include' sends the Better Auth session cookie so the Worker
    // resolves identity; without it prospects/analyses would always 401.
    // withBase() prefixes the app's base path (e.g. /app) in production.
    const res = await fetch(withBase(endpoint), {
      headers: { Accept: 'application/json' },
      credentials: window.location.origin === 'null' ? 'omit' : 'include',
    })
    if (!res.ok) return fail(`HTTP ${res.status}`, res.status === 401 || res.status === 403 ? 'sign-in' : 'unavailable')
    json = await res.json()
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e) || 'fetch failed')
  }

  try {
    switch (groupId) {
      case 'stepper':
        return adaptFeatureCollection(json)
      case 'prospects':
        return adaptProspects(json)
      case 'analyses':
        return adaptAnalyses(json)
      default:
        return adaptFeatureCollection(json)
    }
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e) || 'adapt failed')
  }
}

/**
 * /api/stepper already returns a GeoJSON FeatureCollection, with
 * `stale: true` when it is the last good copy of a source that is down.
 */
function adaptFeatureCollection(json: JsonValue): ApiLayerResult {
  if (!isJsonObject(json) || json.type !== 'FeatureCollection' || !Array.isArray(json.features)) {
    return fail('not a FeatureCollection')
  }
  const features = json.features.filter(isJsonObject).map((value) => {
    const feature: Feature = JSON.parse(JSON.stringify(value))
    return feature
  })
  return json.stale === true ? { ...ok(features), stale: true } : ok(features)
}

function objectList(json: JsonValue, key: string): JsonObject[] | null {
  if (!isJsonObject(json) || !Array.isArray(json[key])) return null
  return json[key].filter(isJsonObject)
}

function adaptProspects(json: JsonValue): ApiLayerResult {
  const list = objectList(json, 'prospects')
  if (!list) return fail('no prospects array')
  const features: Feature[] = []
  for (const p of list) {
    if (!isJsonNumber(p.lat) || !isJsonNumber(p.lng)) continue
    const meta = isJsonObject(p.metadata) ? p.metadata : {}
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      properties: {
        id: String(p.id ?? ''),
        title: isJsonString(p.title) ? p.title : 'Untitled prospect',
        url: isJsonString(p.url) ? p.url : null,
        notes: isJsonString(p.notes) ? p.notes : null,
        verdict: isJsonString(p.verdict) ? p.verdict : null,
        visibility: String(p.visibility ?? ''),
        og_image: isJsonString(meta.og_image) ? meta.og_image : null,
        og_description: isJsonString(meta.og_description) ? meta.og_description : null,
        created_at: String(p.created_at ?? ''),
      },
    })
  }
  return ok(features)
}


function adaptAnalyses(json: JsonValue): ApiLayerResult {
  const list = objectList(json, 'analyses')
  if (!list) return fail('no analyses array')
  const features: Feature[] = []
  for (const a of list) {
    if (!isJsonNumber(a.lat) || !isJsonNumber(a.lng)) continue
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [a.lng, a.lat] },
      properties: {
        id: String(a.id ?? ''),
        title: isJsonString(a.title)
          ? a.title
          : isJsonString(a.summary)
            ? a.summary
            : 'Analysis',
        summary: isJsonString(a.summary) ? a.summary : null,
        source: String(a.source ?? ''),
        source_url: isJsonString(a.source_url) ? a.source_url : null,
        radius_km: isJsonNumber(a.radius_km) ? a.radius_km : 0,
        created_at: String(a.created_at ?? ''),
      },
    })
  }
  return ok(features)
}
