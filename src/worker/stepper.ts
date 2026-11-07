// Live adapter for https://steppermap.com/ — @Stepper9210's curated spots.
//
// His page embeds the data inline as `const spots = [ … ]` using JS-object
// literal syntax (unquoted keys, double-quoted strings). Workers forbid eval /
// new Function, so we (1) bracket-match the array text out of the HTML, then
// (2) convert the JS-object-literal subset to JSON with a string-aware scanner,
// then JSON.parse it. On any failure the caller returns 503 — never a broken
// FeatureCollection.
//
// The page content is treated purely as data. We never execute it.

import type { Env } from './types'
import type { JsonObject } from '../shared/json'

const STEPPER_URL = 'https://steppermap.com/'
const CACHE_TTL_MS = 6 * 60 * 60 * 1000 // 6h
const FETCH_TIMEOUT_MS = 8000
const MAX_BYTES = 4 * 1024 * 1024 // 4MB guard

export const STEPPER_ATTRIBUTION = {
  source: 'steppermap.com by @Stepper9210',
  licence: 'shared with permission — © @Stepper9210, all rights reserved',
  source_url: 'https://steppermap.com/',
}

interface StepperSpot {
  id?: number
  name?: string
  region?: string
  cat?: string
  emoji?: string
  lat?: number
  lng?: number
  desc?: string
  ytId?: string
  igUrl?: string
  isShort?: boolean
}

interface StepperResult {
  type: 'FeatureCollection'
  attribution: typeof STEPPER_ATTRIBUTION
  fetched_at: string
  features: Array<{
    type: 'Feature'
    geometry: { type: 'Point'; coordinates: [number, number] }
    properties: JsonObject
  }>
}

let memo: { at: number; value: StepperResult } | null = null

/**
 * Extract the balanced `[ … ]` that follows `const spots =`, respecting string
 * literals so brackets inside strings don't confuse the matcher.
 */
function extractSpotsArray(html: string): string | null {
  const marker = /const\s+spots\s*=\s*\[/.exec(html)
  if (!marker) return null
  const start = marker.index + marker[0].length - 1 // index of the opening '['
  let depth = 0
  let inStr = false
  let quote = ''
  for (let i = start; i < html.length; i++) {
    const c = html[i]
    if (inStr) {
      if (c === '\\') {
        i++ // skip escaped char
        continue
      }
      if (c === quote) inStr = false
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      inStr = true
      quote = c
      continue
    }
    if (c === '[') depth++
    else if (c === ']') {
      depth--
      if (depth === 0) return html.slice(start, i + 1)
    }
  }
  return null
}

/**
 * Convert a JS-object-literal subset to JSON: quote identifier keys, drop
 * trailing commas, normalise single-quoted / backtick strings to double quotes.
 * String contents are copied verbatim (a `key:` inside prose won't be touched).
 */
function jsObjectLiteralToJson(src: string): string {
  let out = ''
  let i = 0
  const n = src.length
  const isIdentStart = (c: string) => /[A-Za-z_$]/.test(c)
  const isIdentPart = (c: string) => /[A-Za-z0-9_$]/.test(c)

  while (i < n) {
    const c = src[i]

    // String literal — re-emit as a double-quoted JSON string.
    if (c === '"' || c === "'" || c === '`') {
      const quote = c
      let s = ''
      i++
      while (i < n) {
        const ch = src[i]
        if (ch === '\\') {
          const next = src[i + 1]
          // Keep valid JSON escapes; unescape an escaped single quote/backtick.
          if (next === quote && (quote === "'" || quote === '`')) {
            s += next
          } else {
            s += ch + (next ?? '')
          }
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
      let ident = ''
      while (j < n && isIdentPart(src[j])) {
        ident += src[j]
        j++
      }
      let k = j
      while (k < n && /\s/.test(src[k])) k++
      if (src[k] === ':') {
        out += `"${ident}"`
      } else {
        // value keyword (true/false/null) — leave as-is
        out += ident
      }
      i = j
      continue
    }

    // Trailing comma before } or ]
    if (c === ',') {
      let k = i + 1
      while (k < n && /\s/.test(src[k])) k++
      if (src[k] === '}' || src[k] === ']') {
        i++ // skip the comma
        continue
      }
    }

    out += c
    i++
  }
  return out
}

function toResult(spots: StepperSpot[]): StepperResult {
  const features = spots
    .filter(hasCoordinates)
    .map((s): StepperResult['features'][number] => ({
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
      },
    }))
  return {
    type: 'FeatureCollection',
    attribution: STEPPER_ATTRIBUTION,
    fetched_at: new Date().toISOString(),
    features,
  }
}

function hasCoordinates(
  spot: StepperSpot,
): spot is StepperSpot & { lat: number; lng: number } {
  return spot.lat !== undefined && spot.lng !== undefined
}

/** Returns the parsed Stepper layer, or throws on fetch/parse failure. */
export async function getStepper(_env: Env, force = false): Promise<StepperResult> {
  if (!force && memo && Date.now() - memo.at < CACHE_TTL_MS) return memo.value

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

  const arrayText = extractSpotsArray(html)
  if (!arrayText) throw new Error('could not locate `const spots = [ … ]` in steppermap.com')

  const json = jsObjectLiteralToJson(arrayText)
  let spots: StepperSpot[]
  try {
    spots = JSON.parse(json)
  } catch (e) {
    throw new Error(
      `failed to parse Stepper spots array: ${e instanceof Error ? e.message : String(e)}`,
    )
  }
  if (!Array.isArray(spots) || spots.length === 0) throw new Error('Stepper spots array was empty')

  const result = toResult(spots)
  if (result.features.length === 0) throw new Error('Stepper spots array had no geolocated spots')

  memo = { at: Date.now(), value: result }
  return result
}
