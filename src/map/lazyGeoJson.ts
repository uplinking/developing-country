import type { Feature, FeatureCollection } from 'geojson'
import { isJsonObject, parseJsonObject } from '../shared/json'

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

const cache = new Map<string, Promise<FeatureCollection>>()

/** Initial MapLibre source data. Returning an empty collection is what keeps a
 * hidden lazy URL off the network until materialization is explicitly asked. */
export function initialGeoJsonData(url: string, lazy: boolean): string | FeatureCollection {
  return lazy ? { type: 'FeatureCollection', features: [] } : url
}

function parseFeatureCollection(text: string): FeatureCollection | null {
  const value = parseJsonObject(text)
  if (!value || value.type !== 'FeatureCollection' || !Array.isArray(value.features)) return null
  const features = value.features.filter(isJsonObject).map((entry) => {
    const feature: Feature = JSON.parse(JSON.stringify(entry))
    return feature
  })
  return { type: 'FeatureCollection', features }
}

/** Fetch and validate a large GeoJSON artifact on first demand. Concurrent map
 * views share one request; rejected requests are evicted so a later toggle can
 * retry instead of being permanently stuck on a cached failure. */
export function loadLazyGeoJson(url: string, fetcher: FetchLike = fetch): Promise<FeatureCollection> {
  const existing = cache.get(url)
  if (existing) return existing

  const request = (async () => {
    const response = await fetcher(url)
    if (!response.ok) throw new Error(`GeoJSON request failed (${response.status})`)
    const value = parseFeatureCollection(await response.text())
    if (!value) throw new Error('GeoJSON response is not a FeatureCollection')
    return value
  })()
  cache.set(url, request)
  void request.catch(() => {
    if (cache.get(url) === request) cache.delete(url)
  })
  return request
}
