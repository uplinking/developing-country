// Client for the flagship /api/analyze composite. Given a lat/lng it asks the
// Worker to do every spatial join server-side and returns one provenance-tagged
// readout. The shapes mirror src/worker/analyze.ts; extensible rows use the
// shared JSON owner contract because the Worker may add provenance fields.

import type { LngLat } from '../types'
import { withBase } from '../base'
import type { JsonObject, JsonValue } from '../shared/json'
import { isJsonObject, isJsonString } from '../shared/json'

export interface AnalyzeResult {
  location: { lat: number; lng: number; radius_km: number }
  generated_at: string
  /** Short server-built one-liner of the readout (also stored with the logged run). */
  summary?: string
  /** Present when the run was saved to the caller's account: id + a map deep-link. */
  saved?: { id: string; url: string } | null
  district_demographics: JsonObject | null
  /** Nearest GND by centroid distance — not point-in-polygon. */
  nearest_gnd?: JsonObject | null
  nearest_expressway: JsonObject | null
  planned_developments_nearby: JsonObject[]
  attractions_nearby: JsonObject[]
  waterfalls_nearby: JsonObject[]
  trails_nearby: JsonObject[]
  cycling_nearby: JsonObject[]
  parks_containing_or_near: JsonObject[]
  open_issues_nearby: JsonObject[]
  prospects_nearby: JsonObject[]
}

/** Call GET /api/analyze. Throws on network / non-200 so the caller can show an error state. */
export async function analyzeLocation(point: LngLat, radiusKm = 10): Promise<AnalyzeResult> {
  const qs = new URLSearchParams({
    lat: String(point.lat),
    lng: String(point.lng),
    radius_km: String(radiusKm),
  })
  const res = await fetch(withBase(`/api/analyze?${qs.toString()}`), {
    headers: { Accept: 'application/json' },
    // MCP Apps sandbox has no cookies (and credentialed CORS fails on `*`).
    // GET /api/analyze is a public lure either way.
    credentials: window.location.origin === 'null' ? 'omit' : 'include',
  })
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const body: JsonValue = await res.json()
      if (isJsonObject(body) && isJsonString(body.error)) msg = body.error
    } catch {
      /* keep the status message */
    }
    throw new Error(msg)
  }
  // SAFETY: This same-origin endpoint is owned by analyzeLocation and returns its AnalyzeResult contract.
  return (await res.json()) as AnalyzeResult
}
