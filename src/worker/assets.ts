// Shared ASSETS JSON cache. One isolate Map — analyze, search, and query_spatial
// must not each parse demographics.geojson.

import type { Env } from './types'
import type { JsonAsset, JsonObject, JsonValue } from '../shared/json'

export interface AssetFeature {
  type: 'Feature'
  id?: string | number
  properties: JsonObject | null
  geometry: { type: string; coordinates: JsonValue } | null
}

export interface AssetFc {
  type: 'FeatureCollection'
  features: AssetFeature[]
  source?: string
  vintage?: string
  licence?: string
}

const cache = new Map<string, JsonAsset | null>()

export async function loadJson<T extends JsonAsset>(env: Env, path: string): Promise<T | null> {
  if (cache.has(path)) {
    // SAFETY: Each asset path has one owner-selected T, and cached values originate from that path's JSON response.
    return (cache.get(path) as T | null) ?? null
  }
  try {
    const res = await env.ASSETS.fetch(new Request(`https://assets.local${path}`))
    if (!res.ok) {
      cache.set(path, null)
      return null
    }
    // SAFETY: Callers bind T to the checked schema for this repository-owned static asset path.
    const json = (await res.json()) as T
    cache.set(path, json)
    return json
  } catch {
    cache.set(path, null)
    return null
  }
}

export async function loadFc(env: Env, path: string): Promise<AssetFc | null> {
  const json = await loadJson<AssetFc>(env, path)
  if (!json || json.type !== 'FeatureCollection' || !Array.isArray(json.features)) return null
  return json
}
