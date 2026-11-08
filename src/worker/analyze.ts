// analyze_location — the flagship composite. Given lat/lng (+ radius) it does
// the spatial joins server-side and returns a provenance-tagged readout so the
// client agent spends tokens on judgement, not data assembly.
//
// GeoJSONs are loaded through the ASSETS binding (public/data/*). Files that a
// parallel agent hasn't shipped yet 404 — we skip them defensively.

import type { Env, Identity } from './types'
import { distanceToLineKm, firstCoord, haversineKm, pointInGeometry } from './geo'
import { CATALOG } from './catalog'
import { loadFc, loadJson, type AssetFc, type AssetFeature } from './assets'
import type { JsonObject } from '../shared/json'
import { isJsonObject } from '../shared/json'
import { DEFAULT_DATA_VIEW_ORIGIN } from '@developing-country/views'
import {
  AnalysisRow,
  listVisibleProspectRows,
  prospectForViewer,
  insertAnalysis,
  newId,
  type ProspectRow,
} from './db'

type NearbyFeature = JsonObject & { distance_km: number }
type CompleteFeature = AssetFeature & {
  properties: JsonObject
  geometry: NonNullable<AssetFeature['geometry']>
}

async function loadGeojson(env: Env, path: string): Promise<AssetFc | null> {
  return loadFc(env, path)
}

function catInfo(id: string) {
  const e = CATALOG.find((c) => c.id === id)
  return e ? { source: e.source, vintage: e.vintage } : { source: 'unknown', vintage: 'unknown' }
}

function gndIndexRows(raw: JsonObject | JsonObject[] | null): JsonObject[] {
  if (Array.isArray(raw)) return raw
  if (isJsonObject(raw) && Array.isArray(raw.features)) return raw.features.filter(isJsonObject)
  return []
}

function nameOf(props: JsonObject): string {
  return String(props.name ?? props.title ?? props.ref ?? 'unnamed')
}

export interface AnalyzeParams {
  country?: string
  lat: number
  lng: number
  radius_km?: number
  /** Where the run came from — 'web' (Analyze mode) or 'mcp' (the tool). */
  source?: 'web' | 'mcp'
  /** The property-listing URL, when the caller analysed a link. */
  source_url?: string
  /** Human label for the point (listing title / place name). */
  title?: string
}

/** Stable explorer origin. Authentication may still live on a legacy mount,
 * but public result links must never inherit that deployment URL. */
export function webRootUrl(env: Env): string {
  const configured = env.PUBLIC_VIEW_ORIGIN?.trim() || DEFAULT_DATA_VIEW_ORIGIN
  const url = new URL(configured)
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('PUBLIC_VIEW_ORIGIN must be an origin')
  }
  return url.origin
}

/** Canonical public web URL that recentres the explorer on a point. */
export function webUrl(env: Env, lat: number, lng: number): string {
  const qs = new URLSearchParams({ lat: String(Number(lat.toFixed(5))), lng: String(Number(lng.toFixed(5))) })
  return `${webRootUrl(env)}/?${qs.toString()}`
}

/** Cheap one-line human summary of a readout, e.g.
 *  "Kandy District · 3 developments nearby · nearest expressway E01 4.2 km". */
function buildSummary(
  demo: JsonObject | null,
  developments: JsonObject[],
  expressway: JsonObject | null,
  gnd?: JsonObject | null,
): string {
  const parts: string[] = []
  const district = demo && demo.name ? `${String(demo.name)} District` : null
  if (district) parts.push(district)
  if (gnd?.name) parts.push(`${String(gnd.name)} GND`)
  parts.push(`${developments.length} development${developments.length === 1 ? '' : 's'} nearby`)
  if (expressway) {
    const label = [expressway.ref, expressway.name].filter(Boolean).join(' ') || 'expressway'
    const d = expressway.distance_km
    parts.push(`nearest expressway ${label}${d != null ? ` ${d} km` : ''}`)
  }
  return parts.join(' · ')
}

export async function analyzeLocation(env: Env, identity: Identity | null, params: AnalyzeParams) {
  const { lat, lng } = params
  const radius = Math.min(Math.max(params.radius_km ?? 10, 0.1), 100)

  // --- district demographics (point-in-polygon) ---
  let district_demographics: JsonObject | null = null
  const demo = await loadGeojson(env, '/data/demographics.geojson')
  if (demo) {
    for (const f of demo.features) {
      if (!f.geometry || !f.properties) continue
      if (pointInGeometry(lng, lat, f.geometry)) {
        district_demographics = { ...f.properties, ...catInfo('demographics') }
        break
      }
    }
  }

  // --- nearest GND by centroid (not PIP — the index has no rings) ---
  let nearest_gnd: JsonObject | null = null
  const gndIdx = await loadJson<JsonObject | JsonObject[]>(env, '/data/gnd-index.json')
  {
    let best = Infinity
    let bestRow: JsonObject | null = null
    for (const r of gndIndexRows(gndIdx)) {
      const glat = Number(r.lat)
      const glng = Number(r.lng)
      if (!Number.isFinite(glat) || !Number.isFinite(glng)) continue
      const d = haversineKm(lat, lng, glat, glng)
      if (d < best) {
        best = d
        bestRow = r
      }
    }
    const GND_NEAR_CAP_KM = 15
    if (bestRow && best <= GND_NEAR_CAP_KM) {
      const pop = Number(bestRow.pop)
      const pop2012 = Number(bestRow.pop_2012)
      nearest_gnd = {
        id: bestRow.id,
        name: bestRow.name,
        pop: bestRow.pop,
        pop_2012: bestRow.pop_2012,
        pop_vintage: Number(bestRow.pop_vintage) || (pop === pop2012 ? 2012 : 2024),
        dens: bestRow.dens,
        area: bestRow.area,
        parent: bestRow.parent,
        district: bestRow.district,
        lat: bestRow.lat,
        lng: bestRow.lng,
        distance_km: round(best),
        method: 'nearest_gnd_centroid',
        ...catInfo('gnd'),
      }
    }
  }

  // --- nearest expressway ---
  let nearest_expressway: JsonObject | null = null
  const exp = await loadGeojson(env, '/data/expressways.geojson')
  if (exp) {
    let best = Infinity
    let bestF: CompleteFeature | null = null
    for (const f of exp.features) {
      if (!f.geometry || !f.properties) continue
      const d = distanceToLineKm(lat, lng, f.geometry)
      if (d < best) {
        best = d
        bestF = { ...f, properties: f.properties, geometry: f.geometry }
      }
    }
    if (bestF) {
      nearest_expressway = {
        name: nameOf(bestF.properties),
        ref: bestF.properties.ref ?? null,
        status: bestF.properties.status ?? 'unknown',
        distance_km: round(best),
        ...catInfo('expressways'),
      }
    }
  }

  // --- point features within radius (developments, attractions, waterfalls, trails, cycling) ---
  const planned_developments_nearby = await nearbyPoints(env, '/data/developments.geojson', 'developments', lat, lng, radius)
  const attractions_nearby = await nearbyPoints(env, '/data/attractions.geojson', 'attractions', lat, lng, radius)
  const waterfalls_nearby = await nearbyPoints(env, '/data/waterfalls.geojson', 'waterfalls', lat, lng, radius)
  const trails_nearby = await nearbyAny(env, '/data/trails.geojson', 'trails', lat, lng, radius)
  const cycling_nearby = await nearbyAny(env, '/data/cycling.geojson', 'cycling', lat, lng, radius)

  // --- parks: containing polygon or nearby ---
  const parks_containing_or_near = await parksNear(env, lat, lng, radius)

  // --- user's own (and public) prospects nearby ---
  // Push a bbox into SQL so we only pull candidate rows inside the radius, not
  // every public prospect across all users.
  const dLat = radius / 111
  const dLng = radius / (111 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01))
  // Anonymous callers ('' email) match only public prospects — never a
  // signed-in user's private rows.
  const prospectRows = await listVisibleProspectRows(env, identity?.email ?? '', {
    bbox: [lng - dLng, lat - dLat, lng + dLng, lat + dLat],
  })
  const prospects_nearby = prospectRows
    .filter(hasProspectCoordinates)
    .map((r) => ({ r, d: haversineKm(lat, lng, r.lat, r.lng) }))
    .filter((x) => x.d <= radius)
    .sort((a, b) => a.d - b.d)
    .slice(0, 50)
    .map((x) => ({ ...prospectForViewer(x.r, identity?.email), distance_km: round(x.d), ...catInfo('prospects') }))

  // --- log this run against the caller's account (both web + MCP funnel here) ---
  // Anonymous callers (Analyze works signed-out) have no account to trace to, so
  // we only record when an identity is present. Logging must never break the
  // readout — swallow any insert failure.
  const summary = buildSummary(district_demographics, planned_developments_nearby, nearest_expressway, nearest_gnd)
  let saved: { id: string; url: string } | null = null
  if (identity?.email) {
    const row: AnalysisRow = {
      id: newId('anl'),
      user_email: identity.email,
      lat,
      lng,
      radius_km: radius,
      source: params.source === 'mcp' ? 'mcp' : 'web',
      source_url: params.source_url ?? null,
      title: params.title ?? null,
      summary,
      created_at: new Date().toISOString(),
    }
    try {
      await insertAnalysis(env, row)
      saved = { id: row.id, url: webUrl(env, lat, lng) }
    } catch {
      /* keep serving the readout even if the trace write fails */
    }
  }

  return {
    location: { lat, lng, radius_km: radius },
    generated_at: new Date().toISOString(),
    summary,
    saved,
    district_demographics,
    nearest_gnd,
    nearest_expressway,
    planned_developments_nearby,
    attractions_nearby,
    waterfalls_nearby,
    trails_nearby,
    cycling_nearby,
    parks_containing_or_near,
    prospects_nearby,
  }
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000
}

function hasProspectCoordinates(
  row: ProspectRow,
): row is ProspectRow & { lat: number; lng: number } {
  return row.lat !== null && row.lng !== null
}

async function nearbyPoints(
  env: Env,
  path: string,
  catId: string,
  lat: number,
  lng: number,
  radius: number,
) {
  const fc = await loadGeojson(env, path)
  if (!fc) return []
  const out: NearbyFeature[] = []
  for (const f of fc.features) {
    if (!f.geometry || !f.properties) continue
    const c = firstCoord(f.geometry)
    if (!c) continue
    const d = haversineKm(lat, lng, c[1], c[0])
    if (d <= radius) out.push({ name: nameOf(f.properties), ...f.properties, distance_km: round(d), ...catInfo(catId) })
  }
  return out.sort((a, b) => a.distance_km - b.distance_km).slice(0, 50)
}

/** Handles line or point geometries (trails/cycling routes). */
async function nearbyAny(
  env: Env,
  path: string,
  catId: string,
  lat: number,
  lng: number,
  radius: number,
) {
  const fc = await loadGeojson(env, path)
  if (!fc) return []
  const out: NearbyFeature[] = []
  for (const f of fc.features) {
    if (!f.geometry || !f.properties) continue
    let d: number
    if (f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString') {
      d = distanceToLineKm(lat, lng, f.geometry)
    } else {
      const c = firstCoord(f.geometry)
      if (!c) continue
      d = haversineKm(lat, lng, c[1], c[0])
    }
    if (d <= radius) out.push({ name: nameOf(f.properties), ...f.properties, distance_km: round(d), ...catInfo(catId) })
  }
  return out.sort((a, b) => a.distance_km - b.distance_km).slice(0, 50)
}

async function parksNear(env: Env, lat: number, lng: number, radius: number) {
  const fc = await loadGeojson(env, '/data/parks.geojson')
  if (!fc) return []
  const out: NearbyFeature[] = []
  for (const f of fc.features) {
    if (!f.geometry || !f.properties) continue
    const g = f.geometry
    if (g.type === 'Polygon' || g.type === 'MultiPolygon') {
      if (pointInGeometry(lng, lat, g)) {
        out.push({ name: nameOf(f.properties), ...f.properties, containing: true, distance_km: 0, ...catInfo('parks') })
        continue
      }
    }
    const c = firstCoord(g)
    if (!c) continue
    const d = haversineKm(lat, lng, c[1], c[0])
    if (d <= radius) out.push({ name: nameOf(f.properties), ...f.properties, containing: false, distance_km: round(d), ...catInfo('parks') })
  }
  return out.sort((a, b) => a.distance_km - b.distance_km).slice(0, 50)
}
