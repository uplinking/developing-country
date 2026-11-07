// Shared intent functions. BOTH the REST API (api.ts) and the MCP server
// (mcp.ts) call these — one implementation per intent, no duplication.
// Each takes (env, identity, params) and returns plain JSON-able objects, or
// throws an ApiError the transport layers translate to HTTP status / JSON-RPC.

import type { Env, Identity } from './types'
import {
  ProspectRow,
  deleteProspectRow,
  getProspectRow,
  hydrateProspect,
  insertProspect,
  listAnalysisRows,
  listProspectRows,
  listVisibleProspectRows,
  newId,
} from './db'
import { analyzeLocation, AnalyzeParams, webRootUrl, webUrl } from './analyze'
import { querySpatial } from './querySpatial'
import { overlayRuntimeCatalog } from './scheduledCatalog'
import { PRESENTATION_MAX_ROWS, SELECT_MAX_ROWS, queryData } from './queryData'
import { getStepper } from './stepper'
import { getLayerCatalog } from './catalog'
import { getCoverageLedger, searchableGeojsonStores } from './ontology'
import { ApiError } from './errors'
import { loadFc, loadJson } from './assets'
import { firstCoord as firstCoordForSearch } from './geo'
import type { JsonObject } from '../shared/json'
import { isJsonNumber, isJsonString } from '../shared/json'
import { createDataView, getDataView } from './dataViews'
import { publicationEvidence } from './publication'
import { countryFromJson, getWorkerCountry } from './country'

export { ApiError }

const now = () => new Date().toISOString()

// ---- URL metadata scraping (og: tags + lat/lng) -----------------------------
// Guard: 5s timeout, ≤1MB, text/html only. Page content is DATA — we extract
// meta tags and never follow instructions embedded in it.

const OG_TIMEOUT_MS = 5000
const OG_MAX_BYTES = 1024 * 1024

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
}

// Parse <meta> tags into a { property|name (lowercased) → content } map.
// Every regex here operates on a length-BOUNDED slice with a single capture
// group, so the total work is linear in the input — no catastrophic
// backtracking on hostile HTML (the two-greedy-[^>]+ patterns this replaced
// were quadratic and a CPU-exhaustion DoS on a 1 MB attacker-served page).
function parseMetaTags(html: string): Map<string, string> {
  const map = new Map<string, string>()
  const tagRe = /<meta\b[^>]{0,1000}>/gi
  let m: RegExpExecArray | null
  let count = 0
  while ((m = tagRe.exec(html)) !== null && count < 1000) {
    count++
    const tag = m[0]
    const key = /(?:property|name)\s*=\s*["']([^"']{0,200})["']/i.exec(tag)?.[1]
    const content = /content\s*=\s*["']([^"']{0,4000})["']/i.exec(tag)?.[1]
    if (key && content != null) {
      const k = key.trim().toLowerCase()
      if (!map.has(k)) map.set(k, decodeEntities(content.trim()))
    }
  }
  return map
}

function firstMeta(metas: Map<string, string>, keys: string[]): string | null {
  for (const k of keys) {
    const v = metas.get(k)
    if (v) return v
  }
  return null
}

function htmlTitle(html: string): string | null {
  const m = /<title[^>]{0,200}>([^<]{0,500})/i.exec(html)
  return m && m[1] ? decodeEntities(m[1].trim()) : null
}

// Reject hosts that resolve to (or literally are) private / loopback /
// link-local / metadata ranges, and non-standard ports. Blocks SSRF via the
// user-supplied listing URL — including the cloud metadata endpoint
// (169.254.169.254) — and is re-checked on every redirect hop below.
function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '')
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return true
  if (h === 'metadata.google.internal') return true
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h)
  if (v4) {
    const a = Number(v4[1]),
      b = Number(v4[2])
    if (a === 0 || a === 10 || a === 127) return true
    if (a === 169 && b === 254) return true // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
    if (a >= 224) return true // multicast / reserved
  }
  if (h.includes(':')) {
    // IPv6 loopback / unique-local (fc00::/7) / link-local (fe80::/10)
    if (h === '::1' || h === '::') return true
    if (/^f[cd][0-9a-f]{2}:/.test(h) || h.startsWith('fe8') || h.startsWith('fe9') || h.startsWith('fea') || h.startsWith('feb')) return true
  }
  return false
}

function assertSafeUrl(u: URL): void {
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new ApiError(400, 'url must be http(s)')
  }
  if (u.port && u.port !== '80' && u.port !== '443') {
    throw new ApiError(400, 'unsupported port')
  }
  if (isBlockedHost(u.hostname)) {
    throw new ApiError(400, 'url host is not allowed')
  }
}

async function scrapeUrlMetadata(url: string): Promise<JsonObject> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new ApiError(400, 'invalid url')
  }
  assertSafeUrl(parsed)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), OG_TIMEOUT_MS)
  try {
    // Follow redirects manually so each hop's host is re-validated (a public
    // URL can 30x to an internal address otherwise).
    let current = parsed.toString()
    let res: Response
    for (let hop = 0; ; hop++) {
      assertSafeUrl(new URL(current))
      res = await fetch(current, {
        signal: controller.signal,
        headers: { 'User-Agent': 'developing-country.org/1.0 (+https://developing-country.org) listing-metadata' },
        redirect: 'manual',
      })
      const loc = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null
      if (!loc || hop >= 5) break
      current = new URL(loc, current).toString()
    }
    const ctype = res.headers.get('content-type') ?? ''
    if (!res.ok) return { source: 'url', fetch_error: `HTTP ${res.status}`, fetched_at: now() }
    if (!/text\/html/i.test(ctype)) {
      return { source: 'url', fetch_error: `not text/html (${ctype})`, fetched_at: now() }
    }
    // Read at most OG_MAX_BYTES.
    const reader = res.body?.getReader()
    let received = 0
    const chunks: Uint8Array[] = []
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) {
          chunks.push(value)
          received += value.length
          if (received >= OG_MAX_BYTES) {
            await reader.cancel()
            break
          }
        }
      }
    }
    const merged = new Uint8Array(received)
    let off = 0
    for (const c of chunks) {
      merged.set(c.subarray(0, Math.min(c.length, OG_MAX_BYTES - off)), off)
      off += c.length
      if (off >= OG_MAX_BYTES) break
    }
    const html = new TextDecoder().decode(merged)

    const metas = parseMetaTags(html)
    const title = firstMeta(metas, ['og:title', 'twitter:title']) ?? htmlTitle(html)
    const description = firstMeta(metas, ['og:description', 'twitter:description', 'description'])
    const image = firstMeta(metas, ['og:image', 'twitter:image'])

    // Try to find a lat/lng from common meta tags / patterns.
    const geo = extractLatLng(metas, html)

    return {
      source: 'url',
      fetched_at: now(),
      og_title: title,
      og_description: description,
      og_image: image,
      lat: geo?.lat ?? null,
      lng: geo?.lng ?? null,
    }
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      return { source: 'url', fetch_error: 'timeout', fetched_at: now() }
    }
    return {
      source: 'url',
      fetch_error: e instanceof Error ? e.message : String(e),
      fetched_at: now(),
    }
  } finally {
    clearTimeout(timer)
  }
}

function extractLatLng(metas: Map<string, string>, html: string): { lat: number; lng: number } | null {
  const lat = firstMeta(metas, ['og:latitude', 'place:location:latitude'])
  const lng = firstMeta(metas, ['og:longitude', 'place:location:longitude'])
  if (lat && lng) {
    const la = Number(lat.split(/[,;]/)[0])
    const lo = Number(lng)
    if (isFinite(la) && isFinite(lo)) return { lat: la, lng: lo }
  }
  // geo.position "lat;lng"
  const gp = metas.get('geo.position')
  if (gp) {
    const [la, lo] = gp.split(/[;,]/).map((x) => Number(x.trim()))
    if (isFinite(la) && isFinite(lo)) return { lat: la, lng: lo }
  }
  // google maps q=lat,lng
  const gm = /[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/.exec(html) || /@(-?\d+\.\d+),(-?\d+\.\d+)/.exec(html)
  if (gm) {
    const la = Number(gm[1])
    const lo = Number(gm[2])
    if (isFinite(la) && isFinite(lo)) return { lat: la, lng: lo }
  }
  return null
}

// ---- Prospects --------------------------------------------------------------

const VISIBILITIES = new Set(['private', 'link', 'public'])

export interface AddProspectParams {
  url?: string
  title?: string
  lat?: number
  lng?: number
  notes?: string
  verdict?: string
  visibility?: string
}

export async function addProspect(env: Env, id: Identity, p: AddProspectParams) {
  let metadata: JsonObject | null = null
  let lat = p.lat ?? null
  let lng = p.lng ?? null
  let title = p.title ?? null

  if (p.url) {
    metadata = await scrapeUrlMetadata(p.url)
    if (lat === null && isJsonNumber(metadata.lat)) lat = metadata.lat
    if (lng === null && isJsonNumber(metadata.lng)) lng = metadata.lng
    if (!title && isJsonString(metadata.og_title)) title = metadata.og_title
  }

  if (!p.url && lat === null && lng === null && !title) {
    throw new ApiError(400, 'provide at least one of: url, title, or lat+lng')
  }
  const visibility = p.visibility && VISIBILITIES.has(p.visibility) ? p.visibility : 'private'

  const row: ProspectRow = {
    id: newId('prs'),
    user_email: id.email,
    title,
    url: p.url ?? null,
    lat,
    lng,
    notes: p.notes ?? null,
    verdict: p.verdict ?? null,
    visibility,
    metadata: metadata ? JSON.stringify(metadata) : null,
    created_at: now(),
    updated_at: now(),
  }
  await insertProspect(env, row)
  // Hand back where to see it. web_url recentres the map on the prospect; when it
  // has no coordinates we still point at the app so the agent can tell the user.
  const web_url =
    lat !== null && lng !== null ? webUrl(env, lat, lng) : `${webRootUrl(env)}/`
  return {
    ...hydrateProspect(row),
    web_url,
    saved_to: `Saved to your developing-country.org account — view at ${web_url}`,
  }
}

export async function listProspects(env: Env, id: Identity) {
  const rows = await listProspectRows(env, id.email)
  return { prospects: rows.map(hydrateProspect), count: rows.length }
}

export async function getProspect(env: Env, id: Identity, prospectId: string) {
  const row = await getProspectRow(env, prospectId)
  if (!row) throw new ApiError(404, 'prospect not found')
  // Owner can always read; others only if public/link.
  if (row.user_email !== id.email && row.visibility === 'private') {
    throw new ApiError(404, 'prospect not found')
  }
  return hydrateProspect(row)
}

export interface UpdateProspectParams {
  id: string
  title?: string
  notes?: string
  verdict?: string
  visibility?: string
  lat?: number
  lng?: number
}

export async function updateProspect(env: Env, id: Identity, p: UpdateProspectParams) {
  const row = await getProspectRow(env, p.id)
  if (!row || row.user_email !== id.email) throw new ApiError(404, 'prospect not found')

  const next: ProspectRow = {
    ...row,
    title: p.title !== undefined ? p.title : row.title,
    notes: p.notes !== undefined ? p.notes : row.notes,
    verdict: p.verdict !== undefined ? p.verdict : row.verdict,
    visibility:
      p.visibility !== undefined && VISIBILITIES.has(p.visibility) ? p.visibility : row.visibility,
    lat: p.lat ?? row.lat,
    lng: p.lng ?? row.lng,
    updated_at: now(),
  }
  await env.DB.prepare(
    `UPDATE prospects SET title=?1, notes=?2, verdict=?3, visibility=?4, lat=?5, lng=?6, updated_at=?7 WHERE id=?8`,
  )
    .bind(next.title, next.notes, next.verdict, next.visibility, next.lat, next.lng, next.updated_at, next.id)
    .run()
  return hydrateProspect(next)
}

export async function deleteProspect(env: Env, id: Identity, prospectId: string) {
  const row = await getProspectRow(env, prospectId)
  if (!row || row.user_email !== id.email) throw new ApiError(404, 'prospect not found')
  await deleteProspectRow(env, prospectId)
  return { deleted: true, id: prospectId }
}

// ---- Analyze / stepper / catalog (pass-through) -----------------------------

export async function analyze(env: Env, id: Identity | null, p: AnalyzeParams) {
  const pack = getWorkerCountry(p.country)
  if (!isFinite(p.lat) || !isFinite(p.lng)) {
    throw new ApiError(400, 'valid numeric lat and lng are required')
  }
  return { ...(await analyzeLocation(env, id, p)), country: pack.profile.code }
}

// ---- Analyses (the authenticated user's logged analyze runs) ----------------

export interface ListAnalysesParams {
  limit?: number
}

export async function listAnalyses(env: Env, id: Identity, p: ListAnalysesParams = {}) {
  const rows = await listAnalysisRows(env, id.email, p.limit ?? 20)
  return {
    // Envelope-level provenance (per the mandatory-provenance rule): this layer
    // is the user's own analysis history. Each row keeps its channel in `source`
    // ('web' | 'mcp'); the provenance below describes the layer as a whole.
    analyses: rows,
    count: rows.length,
    source: 'developing-country.org — your own analysis runs',
    vintage: 'live',
  }
}

export async function stepper(env: Env) {
  return getStepper(env)
}

export async function catalog(country?: string, env?: Pick<Env, 'ENABLE_HEAVY_SPATIAL' | 'DATASETS'>) {
  const catalog = getLayerCatalog(country, env?.ENABLE_HEAVY_SPATIAL === '1')
  return env?.DATASETS ? overlayRuntimeCatalog(catalog, env.DATASETS) : catalog
}

export function ontology(country?: string) {
  return getWorkerCountry(country).ontology
}

export function coverage(country?: string) {
  const pack = getWorkerCountry(country)
  const ledger = getCoverageLedger()
  if (ledger.country !== pack.profile.code) {
    throw new Error(`coverage ledger country does not match ${pack.profile.code}`)
  }
  return ledger
}

export async function query(env: Env, id: Identity | null, args: JsonObject) {
  const pack = getWorkerCountry(countryFromJson(args))
  const presentation = args.presentation
  const queryArgs = { ...args }
  delete queryArgs.presentation
  delete queryArgs.country
  // A select being saved as a Data View may carry more rows than an agent reads
  // back; the snapshot byte cap in createDataView still bounds it.
  const maxRows = presentation === undefined ? SELECT_MAX_ROWS : PRESENTATION_MAX_ROWS
  const result = {
    ...(queryArgs.op === 'select'
      ? await queryData(env, queryArgs, { maxRows })
      : await querySpatial(env, id, queryArgs)),
    country: pack.profile.code,
  }
  if (presentation === undefined) return result
  const document = await createDataView(env, id, presentation, queryArgs, result)
  return {
    ...document.result,
    view: document.view,
    view_url: document.view_url,
    result_url: document.result_url,
    publication: publicationEvidence(document.view, document.view_url),
    ...(document.warnings ? { warnings: document.warnings } : {}),
  }
}

/**
 * The CMS evidence blocks for an existing saved view, so an author can assemble
 * one evidence_bundle across many views without re-running their queries.
 */
export async function viewEvidence(env: Env, viewId: string) {
  if (!/^view_[a-z0-9]+$/.test(viewId)) return null
  const document = await getDataView(env, viewId)
  if (!document) return null
  if (document.revoked_at) {
    return {
      error: 'view_revoked',
      revoked_at: document.revoked_at,
      message: 'a revoked Data View must not be cited; save a new view',
    }
  }
  return publicationEvidence(document.view, document.view_url)
}

// ---- search_places ----------------------------------------------------------
// Substring search across every GeoJSON layer + prospects by name.

export interface SearchParams {
  q: string
  limit?: number
  country?: string
}

export async function searchPlaces(env: Env, id: Identity | null, p: SearchParams) {
  const pack = getWorkerCountry(p.country)
  const q = (p.q ?? '').trim().toLowerCase()
  if (!q) throw new ApiError(400, 'q is required')
  const limit = Math.min(Math.max(p.limit ?? 25, 1), 100)
  const results: JsonObject[] = []

  // Districts first so "Colombo" / "Kandy" hit the admin unit, not 50 GNDs.
  if (results.length < limit) {
    const demo = await loadFc(env, '/data/demographics.geojson')
    if (demo) {
      for (const f of demo.features) {
        const name = String(f.properties?.name ?? '')
        if (!name.toLowerCase().includes(q)) continue
        const c = f.geometry ? firstCoordForSearch(f.geometry) : null
        results.push({
          layer: 'district',
          id: f.properties?.id != null ? String(f.properties.id) : name,
          name,
          lat: c ? c[1] : null,
          lng: c ? c[0] : null,
          source: String(f.properties?.source ?? 'census'),
          vintage: String(f.properties?.vintage ?? '2024'),
        })
        if (results.length >= limit) return { query: p.q, country: pack.profile.code, results, count: results.length }
      }
    }
  }

  const raw = await loadJson<{ features?: JsonObject[] }>(env, '/data/gnd-index.json')
  const gndHits: Array<{ rank: number; pop: number; row: JsonObject; name: string }> = []
  for (const r of raw?.features ?? []) {
    const name = String(r.name ?? '')
    const low = name.toLowerCase()
    if (!low.includes(q)) continue
    const rank = low === q ? 0 : low.startsWith(q) ? 1 : 2
    gndHits.push({ rank, pop: Number(r.pop) || 0, row: r, name })
  }
  gndHits.sort((a, b) => a.rank - b.rank || b.pop - a.pop)
  for (const g of gndHits.slice(0, 3)) {
    if (results.length >= limit) break
    const r = g.row
    results.push({
      layer: 'gnd',
      id: r.id != null ? String(r.id) : g.name,
      name: g.name,
      lat: isJsonNumber(r.lat) ? r.lat : null,
      lng: isJsonNumber(r.lng) ? r.lng : null,
      district: r.district != null ? String(r.district) : null,
      source: 'census',
      vintage: '2024',
    })
  }
  if (results.length >= limit) return { query: p.q, country: pack.profile.code, results, count: results.length }

  // Only searchable geojson (ontology.searchable). Never load catchment / admin rings.
  // A named road or line is stored as MANY features (one per segment), so match
  // on name alone and "Colombo" returns the Katunayake expressway five times.
  // One row per (layer, name) — the first segment carries a usable coordinate.
  const seenNamed = new Set<string>()
  for (const layer of searchableGeojsonStores()) {
    const fc = await loadFc(env, layer.path)
    if (!fc) continue
    for (const f of fc.features) {
      const name = String(f.properties?.name ?? f.properties?.title ?? f.properties?.ref ?? f.properties?.code ?? '')
      if (name.toLowerCase().includes(q)) {
        const c = f.geometry ? firstCoordForSearch(f.geometry) : null
        const kind = f.properties?.kind
        const layerId =
          layer.path === '/data/metro.geojson'
            ? kind === 'stop'
              ? 'metro_stop'
              : kind === 'line'
                ? 'metro_line'
                : layer.id
            : layer.id
        const dedupeKey = `${layerId}\u0000${name.toLowerCase()}`
        if (seenNamed.has(dedupeKey)) continue
        seenNamed.add(dedupeKey)
        results.push({
          layer: layerId,
          name,
          lat: c ? c[1] : null,
          lng: c ? c[0] : null,
          source: layer.source,
          vintage: layer.vintage,
        })
        if (results.length >= limit) return { query: p.q, country: pack.profile.code, results, count: results.length }
      }
    }
  }

  // Prospects visible to the caller (public-only for anonymous callers, since
  // '' matches no user_email — never leaks a signed-in user's private rows).
  const prospects = await listVisibleProspectRows(env, id?.email ?? '')
  for (const r of prospects) {
    if ((r.title ?? '').toLowerCase().includes(q)) {
      results.push({ layer: 'prospects', id: r.id, name: r.title, lat: r.lat, lng: r.lng, visibility: r.visibility })
      if (results.length >= limit) return { query: p.q, country: pack.profile.code, results, count: results.length }
    }
  }

  return { query: p.q, country: pack.profile.code, results, count: results.length }
}
