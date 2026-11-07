import { describe, expect, test } from 'bun:test'
import { initialGeoJsonData, loadLazyGeoJson } from '../src/map/lazyGeoJson'

// Vite defines BASE_URL in production; Bun's direct module loader does not.
// Set the same root-path default before dynamically loading config-dependent
// map modules.
process.env.BASE_URL = process.env.BASE_URL ?? '/'
const { formatFeature } = await import('../src/map/featureFormat')
const { LAND_COVER_CLASSES, LAYER_GROUPS, groupUnits } = await import('../src/map/layers')

describe('Explorer land-cover layer', () => {
  test('is default-off, lazy, interactive, and uses every observed official class', () => {
    const group = LAYER_GROUPS.find((candidate) => candidate.id === 'land-cover-grid')
    expect(group).toBeDefined()
    expect(group?.category).toBe('environment')
    expect(group?.defaultVisible).toBe(false)
    expect(group?.interactive).toBe(true)
    expect(group?.source).toEqual({
      type: 'geojson',
      url: '/data/land-cover-grid.geojson',
      lazy: true,
    })
    expect(groupUnits(group!)[0].defaultVisible).toBe(false)
    expect(group?.legend.map((item) => [item.label, item.swatch])).toEqual(
      LAND_COVER_CLASSES.map((entry) => [entry.label, entry.color]),
    )
    const paint = JSON.stringify(group?.render[0].paint)
    for (const entry of LAND_COVER_CLASSES) {
      expect(paint).toContain(String(entry.code))
      expect(paint).toContain(entry.color)
    }
  })

  test('formats an honest clicked-cell readout', () => {
    const info = formatFeature(
      'land-cover-grid',
      'Land cover',
      { class_code: 10, class_label: 'Tree cover', year: 2021, vegetated: true },
      { lng: 80.5, lat: 7.5 },
    )
    expect(info.title).toBe('Tree cover')
    expect(info.blurb).toContain('does not measure current greenness')
    expect(info.rows).toContainEqual({ label: 'Class', value: 'Tree cover' })
    expect(info.rows).toContainEqual({ label: 'Reference year', value: '2021' })
    expect(info.rows).toContainEqual({ label: 'Vegetation grouping', value: 'Vegetated land-cover class' })
    expect(info.rows).toContainEqual({ label: 'Map reading', value: 'Dominant modeled class in a ~5 km cell' })
  })
})

describe('lazy GeoJSON materialization', () => {
  test('starts empty and shares one validated request across callers', async () => {
    expect(initialGeoJsonData('/data/large.geojson', true)).toEqual({
      type: 'FeatureCollection',
      features: [],
    })
    expect(initialGeoJsonData('/data/small.geojson', false)).toBe('/data/small.geojson')

    let requests = 0
    const fetcher = async () => {
      requests++
      return new Response(JSON.stringify({ type: 'FeatureCollection', features: [] }), {
        headers: { 'content-type': 'application/json' },
      })
    }
    const [first, second] = await Promise.all([
      loadLazyGeoJson('/test/land-cover-shared.geojson', fetcher),
      loadLazyGeoJson('/test/land-cover-shared.geojson', fetcher),
    ])
    expect(requests).toBe(1)
    expect(first).toEqual(second)
  })

  test('rejects malformed data and evicts failures so the next toggle can retry', async () => {
    let requests = 0
    const fetcher = async () => {
      requests++
      const body = requests === 1
        ? { type: 'Feature', geometry: null, properties: {} }
        : { type: 'FeatureCollection', features: [] }
      return new Response(JSON.stringify(body))
    }
    await expect(loadLazyGeoJson('/test/land-cover-retry.geojson', fetcher)).rejects.toThrow('not a FeatureCollection')
    await expect(loadLazyGeoJson('/test/land-cover-retry.geojson', fetcher)).resolves.toEqual({
      type: 'FeatureCollection',
      features: [],
    })
    expect(requests).toBe(2)
  })
})
