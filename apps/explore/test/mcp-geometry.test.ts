import { describe, expect, test } from 'bun:test'

// src/base.ts reads BASE_URL when first loaded, and bun shares that module across
// test files, so set it before importing anything that pulls it in.
process.env.BASE_URL = process.env.BASE_URL ?? '/'
const { bodyFromResult } = await import('../src/mcpResult')
const { cameraForDrawing, fetchGeometry } = await import('../src/mcpGeometry')

const asset = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { id: 'fort', kind: 'stop', minutes: 10 }, geometry: { type: 'Polygon', coordinates: [[[79.84, 6.93], [79.86, 6.93], [79.86, 6.95], [79.84, 6.93]]] } },
    { type: 'Feature', properties: { id: 'fort', kind: 'stop', minutes: 5 }, geometry: { type: 'Polygon', coordinates: [[[79.845, 6.935], [79.85, 6.935], [79.85, 6.94], [79.845, 6.935]]] } },
    { type: 'Feature', properties: { id: 'kandy', kind: 'stop', minutes: 10 }, geometry: { type: 'Polygon', coordinates: [[[80.6, 7.29], [80.65, 7.29], [80.65, 7.3], [80.6, 7.29]]] } },
  ],
}

const ref = {
  entity: 'metro_walkshed',
  path: '/data/metro_walksheds.geojson',
  bbox: [79.8, 6.8, 80, 7],
  where: [['minutes', 10]],
  limit: 500,
  idField: 'id',
  features: 1,
  bytes: 1234,
}

describe('MCP App geometry by reference', () => {
  test('the parser keeps a well-formed geometry_ref and rejects one outside /data', () => {
    const body = bodyFromResult({ structuredContent: { op: 'bbox', geometry_omitted: 'size_limit', geometry_ref: ref } })
    expect(body.geometry_omitted).toBe('size_limit')
    expect(body.geometry_ref?.path).toBe('/data/metro_walksheds.geojson')
    const hostile = bodyFromResult({ structuredContent: { op: 'bbox', geometry_ref: { ...ref, path: 'https://evil.example/x.geojson' } } })
    expect(hostile.geometry_ref).toBeUndefined()
  })

  test('rebuilds exactly the features the Worker selected', async () => {
    const urls: string[] = []
    const fc = await fetchGeometry(bodyFromResult({ structuredContent: { geometry_ref: ref } }).geometry_ref!, async (url) => {
      urls.push(url)
      return { ok: true, json: async () => asset }
    })
    expect(urls).toEqual(['/data/metro_walksheds.geojson'])
    expect(fc?.features.map((f) => [f.id, f.properties?.minutes])).toEqual([['fort', 10]])
  })

  test('a failed asset read draws nothing instead of throwing', async () => {
    const parsed = bodyFromResult({ structuredContent: { geometry_ref: ref } }).geometry_ref!
    expect(await fetchGeometry(parsed, async () => ({ ok: false, json: async () => null }))).toBeNull()
    expect(await fetchGeometry(parsed, async () => { throw new Error('offline') })).toBeNull()
  })

  test('frames the drawn shapes', () => {
    const camera = cameraForDrawing({ type: 'FeatureCollection', features: [asset.features[0]!] } as never)
    expect(camera?.lng).toBeCloseTo(79.85, 2)
    expect(camera?.lat).toBeCloseTo(6.94, 2)
    expect(camera!.zoom).toBeGreaterThan(10)
    expect(cameraForDrawing({ type: 'FeatureCollection', features: [] })).toBeNull()
  })
})
