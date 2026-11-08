// Live adapter for https://steppermap.com/ — @Stepper9210's curated spots.
//
// His page embeds the data inline as a JS array literal of spot objects
// (unquoted keys, double-quoted strings). The variable has been renamed before
// (`const spots` became `const SPOTS` in November 2026), so the parser does not
// depend on a name: it collects every `const|let|var|window.X = [ … ]` and
// every `<script type="application/json">` body, and takes the first array
// whose objects carry numeric lat/lng. A candidate named like "spots" is tried
// first.
//
// Workers forbid eval / new Function, so we (1) bracket-match the array text
// out of the HTML, then (2) convert the JS-object-literal subset to JSON with a
// string-aware scanner, then JSON.parse it. The page content is treated purely
// as data. We never execute it.
//
// When the live page cannot be fetched or parsed, the last good copy is served
// (marked `stale: true`) from this isolate's memory or the colo's Cache API.
// Only when neither exists does the caller answer 503.

import type { Env } from './types'
import type { JsonObject, JsonValue } from '../shared/json'
import { isJsonNumber, isJsonObject, isJsonString } from '../shared/json'

const STEPPER_URL = 'https://steppermap.com/'
const CACHE_TTL_MS = 6 * 60 * 60 * 1000 // 6h
/** After a failed refresh, serve the stale copy without re-fetching for this long. */
const FAILURE_BACKOFF_MS = 5 * 60 * 1000
const FETCH_TIMEOUT_MS = 8000
const MAX_BYTES = 4 * 1024 * 1024 // 4MB guard
/** How long the colo keeps the last good copy for when the live page breaks. */
const LAST_GOOD_TTL_S = 30 * 24 * 60 * 60
const LAST_GOOD_CACHE = 'dc-stepper'
const LAST_GOOD_KEY = 'https://stepper.internal/last-good'

export const STEPPER_ATTRIBUTION = {
  source: 'steppermap.com by @Stepper9210',
  licence: 'shared with permission — © @Stepper9210, all rights reserved',
  source_url: 'https://steppermap.com/',
}

export interface StepperSpot {
  id?: number
  name?: string
  region?: string
  cat?: string
  emoji?: string
  lat: number
  lng: number
  desc?: string
  ytId?: string
  igUrl?: string
  isShort?: boolean
  community?: boolean
}

export interface StepperResult {
  type: 'FeatureCollection'
  attribution: typeof STEPPER_ATTRIBUTION
  fetched_at: string
  /** True when the live page failed and this is the last good copy. */
  stale?: boolean
  /** Why the live page could not be used (only with `stale`). */
  stale_reason?: string
  features: Array<{
    type: 'Feature'
    geometry: { type: 'Point'; coordinates: [number, number] }
    properties: JsonObject
  }>
}

let memo: { at: number; value: StepperResult } | null = null
let lastFailureAt = 0

/** Test hook: forget the in-isolate copy and failure backoff. */
export function resetStepperCache(): void {
  memo = null
  lastFailureAt = 0
}

// ---- Locating candidate arrays ----------------------------------------------

/**
 * Index just past the end of a string literal or comment that starts at `i`,
 * or -1 when `i` does not start one. Lets the bracket matcher skip `]` or a
 * stray quote inside prose ("don't") and comments.
 */
function skipLiteral(src: string, i: number): number {
  const c = src[i]
  if (c === '"' || c === "'" || c === '`') {
    for (let j = i + 1; j < src.length; j++) {
      if (src[j] === '\\') j++
      else if (src[j] === c) return j + 1
    }
    return src.length
  }
  if (c === '/' && src[i + 1] === '/') {
    const end = src.indexOf('\n', i)
    return end === -1 ? src.length : end
  }
  if (c === '/' && src[i + 1] === '*') {
    const end = src.indexOf('*/', i + 2)
    return end === -1 ? src.length : end + 2
  }
  return -1
}

/** The balanced `[ … ]` starting at `start` (which must be '['), or null. */
function extractBalancedArray(src: string, start: number): string | null {
  let depth = 0
  for (let i = start; i < src.length; i++) {
    const skip = skipLiteral(src, i)
    if (skip !== -1) {
      i = skip - 1
      continue
    }
    const c = src[i]
    if (c === '[') depth++
    else if (c === ']') {
      depth--
      if (depth === 0) return src.slice(start, i + 1)
    }
  }
  return null
}

interface Candidate {
  name: string
  text: string
  kind: 'js' | 'json'
}

const ASSIGNMENT = /(?:\b(?:const|let|var)\s+|\bwindow\s*\.\s*)([A-Za-z_$][\w$]*)\s*=\s*\[/g
const JSON_SCRIPT = /<script\b[^>]*\btype\s*=\s*["']?application\/json["']?[^>]*>([\s\S]*?)<\/script>/gi

function candidates(html: string): Candidate[] {
  const out: Candidate[] = []
  for (const m of html.matchAll(ASSIGNMENT)) {
    const open = (m.index ?? 0) + m[0].length - 1
    const text = extractBalancedArray(html, open)
    if (text) out.push({ name: m[1], text, kind: 'js' })
  }
  for (const m of html.matchAll(JSON_SCRIPT)) out.push({ name: 'application/json', text: m[1], kind: 'json' })
  // Prefer anything named like the data ("spots", "SPOTS", "stepperSpots").
  const named = (c: Candidate) => (/spot/i.test(c.name) ? 0 : 1)
  return out.sort((a, b) => named(a) - named(b))
}

// ---- JS object literal → JSON -----------------------------------------------

/**
 * Convert a JS-object-literal subset to JSON: quote identifier keys, drop
 * trailing commas and comments, normalise single-quoted / backtick strings to
 * double quotes, and map `undefined` to null. String contents are copied
 * verbatim (a `key:` inside prose won't be touched).
 */
export function jsObjectLiteralToJson(src: string): string {
  let out = ''
  let i = 0
  const n = src.length
  const isIdentStart = (c: string) => /[A-Za-z_$]/.test(c)
  const isIdentPart = (c: string) => /[A-Za-z0-9_$]/.test(c)

  while (i < n) {
    const c = src[i]

    // Comments are dropped.
    if (c === '/' && (src[i + 1] === '/' || src[i + 1] === '*')) {
      i = skipLiteral(src, i)
      continue
    }

    // String literal — re-emit as a double-quoted JSON string.
    if (c === '"' || c === "'" || c === '`') {
      const quote = c
      let s = ''
      i++
      while (i < n) {
        const ch = src[i]
        if (ch === '\\') {
          const next = src[i + 1] ?? ''
          if (next === quote && quote !== '"') s += next // \' or \` → plain char
          else if (next === "'") s += "'" // \' inside "…" is legal JS, not JSON
          else if (next === 'x') s += '\\u00' // \x41 → A
          else if (next === '\n') s += '' // line continuation
          else s += ch + next
          i += 2
          continue
        }
        if (ch === quote) {
          i++
          break
        }
        if (ch === '"') s += '\\"'
        else if (ch === '\n') s += '\\n'
        else if (ch === '\r') s += '\\r'
        else if (ch === '\t') s += '\\t'
        else s += ch
        i++
      }
      out += `"${s}"`
      continue
    }

    // Identifier — a key if the next non-ws char is ':', else a keyword value.
    if (isIdentStart(c)) {
      let j = i
      while (j < n && isIdentPart(src[j])) j++
      const ident = src.slice(i, j)
      let k = j
      while (k < n && /\s/.test(src[k])) k++
      if (src[k] === ':') out += `"${ident}"`
      else if (ident === 'undefined') out += 'null'
      else out += ident // true / false / null; anything else fails JSON.parse
      i = j
      continue
    }

    // Trailing comma before } or ] (comments in between are allowed).
    if (c === ',') {
      let k = i + 1
      for (;;) {
        while (k < n && /\s/.test(src[k])) k++
        if (src[k] === '/' && (src[k + 1] === '/' || src[k + 1] === '*')) k = skipLiteral(src, k)
        else break
      }
      if (src[k] === '}' || src[k] === ']') {
        i++
        continue
      }
    }

    out += c
    i++
  }
  return out
}

// ---- Spot validation ----------------------------------------------------------

/** A finite number, or a numeric string such as "6.9" (pages have used both). */
function num(value: JsonValue | undefined): number | null {
  if (isJsonNumber(value)) return value
  if (!isJsonString(value) || value.trim() === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function str(value: JsonValue | undefined): string | undefined {
  return isJsonString(value) ? value : undefined
}

function toSpot(value: JsonValue): StepperSpot | null {
  if (!isJsonObject(value)) return null
  const lat = num(value.lat ?? value.latitude)
  const lng = num(value.lng ?? value.lon ?? value.longitude)
  if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  return {
    id: num(value.id) ?? undefined,
    name: str(value.name),
    region: str(value.region),
    cat: str(value.cat),
    emoji: str(value.emoji),
    lat,
    lng,
    desc: str(value.desc),
    ytId: str(value.ytId),
    igUrl: str(value.igUrl),
    isShort: value.isShort === true,
    community: value.community === true,
  }
}

/** The spots in an already-parsed value: an array of spots, or an object holding one. */
function spotsIn(value: JsonValue): StepperSpot[] {
  const lists = Array.isArray(value)
    ? [value]
    : isJsonObject(value)
      ? Object.values(value).filter((v): v is JsonValue[] => Array.isArray(v))
      : []
  for (const list of lists) {
    const spots = list.map(toSpot).filter((s): s is StepperSpot => s !== null)
    if (spots.length > 0) return spots
  }
  return []
}

/**
 * Pull the spots out of a steppermap.com page. Throws with a description of
 * what was tried when no candidate array holds geolocated spots.
 */
export function parseStepperHtml(html: string): StepperSpot[] {
  const found = candidates(html)
  const tried: string[] = []
  for (const c of found) {
    let parsed: JsonValue
    try {
      parsed = JSON.parse(c.kind === 'js' ? jsObjectLiteralToJson(c.text) : c.text)
    } catch {
      tried.push(`${c.name} (unparseable)`)
      continue
    }
    const spots = spotsIn(parsed)
    if (spots.length > 0) return spots
    tried.push(`${c.name} (no lat/lng objects)`)
  }
  throw new Error(
    found.length === 0
      ? 'no array literal or JSON data block found in steppermap.com'
      : `no array of spots with lat/lng found in steppermap.com (tried ${tried.slice(0, 8).join(', ')})`,
  )
}

function toResult(spots: StepperSpot[]): StepperResult {
  const features = spots.map((s): StepperResult['features'][number] => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
    properties: {
      id: s.id,
      name: s.name ?? null,
      region: s.region ?? null,
      cat: s.cat ?? null,
      emoji: s.emoji ?? null,
      desc: s.desc ?? null,
      ytId: s.ytId ?? null,
      ytUrl: s.ytId ? `https://www.youtube.com/watch?v=${s.ytId}` : null,
      igUrl: s.igUrl ?? null,
      isShort: s.isShort ?? false,
      community: s.community ?? false,
    },
  }))
  return {
    type: 'FeatureCollection',
    attribution: STEPPER_ATTRIBUTION,
    fetched_at: new Date().toISOString(),
    features,
  }
}

// ---- Last good copy (Cache API) -----------------------------------------------

async function saveLastGood(value: StepperResult): Promise<void> {
  try {
    const cache = await caches.open(LAST_GOOD_CACHE)
    await cache.put(
      LAST_GOOD_KEY,
      new Response(JSON.stringify(value), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${LAST_GOOD_TTL_S}` },
      }),
    )
  } catch {
    /* Cache API unavailable (tests, local tooling) — the in-isolate copy still works */
  }
}

async function loadLastGood(): Promise<StepperResult | null> {
  try {
    const cache = await caches.open(LAST_GOOD_CACHE)
    const res = await cache.match(LAST_GOOD_KEY)
    if (!res) return null
    const value: StepperResult = await res.json()
    return value.type === 'FeatureCollection' && Array.isArray(value.features) && value.features.length > 0 ? value : null
  } catch {
    return null
  }
}

// ---- Fetch ---------------------------------------------------------------------

async function fetchLive(): Promise<StepperResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  let html: string
  try {
    const res = await fetch(STEPPER_URL, {
      signal: controller.signal,
      headers: { 'User-Agent': 'developing-country.org/1.0 (+https://developing-country.org)' },
      cf: { cacheTtl: 21600, cacheEverything: true },
    })
    if (!res.ok) throw new Error(`steppermap.com returned ${res.status}`)
    const buf = await res.arrayBuffer()
    if (buf.byteLength > MAX_BYTES) throw new Error('steppermap.com response too large')
    html = new TextDecoder().decode(buf)
  } finally {
    clearTimeout(timer)
  }
  return toResult(parseStepperHtml(html))
}

function stale(value: StepperResult, reason: string): StepperResult {
  return { ...value, stale: true, stale_reason: reason }
}

/**
 * Returns the Stepper layer. When the live page fails, returns the last good
 * copy marked `stale`; throws only when there is no good copy at all.
 */
export async function getStepper(_env: Env, force = false): Promise<StepperResult> {
  const now = Date.now()
  if (!force && memo && now - memo.at < CACHE_TTL_MS) return memo.value
  if (!force && memo?.value.stale && now - lastFailureAt < FAILURE_BACKOFF_MS) return memo.value

  try {
    const value = await fetchLive()
    memo = { at: now, value }
    lastFailureAt = 0
    await saveLastGood(value)
    return value
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e)
    lastFailureAt = now
    const previous = memo?.value ?? (await loadLastGood())
    console.log(JSON.stringify({ op: 'stepper_refresh_failed', err: reason, serving: previous ? 'last_good' : 'none' }))
    if (!previous) throw e
    const value = stale(previous, reason)
    // Keep the original fetch time so a fresh fetch is retried after the backoff.
    memo = { at: memo?.at ?? 0, value }
    return value
  }
}
