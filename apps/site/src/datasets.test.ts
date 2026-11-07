import { describe, expect, test } from 'bun:test'
import { INDICATOR_DATASETS, indicatorPresetPath } from '@developing-country/datasets'
import { readFileSync } from 'node:fs'
import { parseDatasetCatalog } from './lib/datasetCatalog'
import {
  DATASET_PUBLISHER_IDS,
  PUBLISHER_TYPES,
  datasetLicenceSignal,
  datasetExploreUrl,
  datasetMeta,
  datasetNotes,
  formatRefreshDate,
  isDatasetPreviewUrl,
  publicDataTheme,
  resolveDatasetPreviewUrl,
} from './lib/datasets'

const catalog = parseDatasetCatalog(
  JSON.parse(readFileSync(new URL('../data/dataset-catalog.json', import.meta.url), 'utf8')) as unknown,
  datasetNotes.map((dataset) => dataset.id),
)

describe('public data classification', () => {
  test('classifies every dataset with registered DCAT themes', () => {
    for (const dataset of datasetNotes) {
      expect(dataset.themeIds.length).toBeGreaterThan(0)
      expect(new Set(dataset.themeIds).size).toBe(dataset.themeIds.length)
      for (const id of dataset.themeIds) {
        expect(publicDataTheme(id).uri).toStartWith('http://publications.europa.eu/resource/authority/data-theme/')
      }
    }
  })

  test('assigns every dataset one controlled Publisher Type and exact Publisher', () => {
    const typeIds = new Set(PUBLISHER_TYPES.map((type) => type.id))
    expect(Object.keys(DATASET_PUBLISHER_IDS).sort()).toEqual(datasetNotes.map((dataset) => dataset.id).sort())
    for (const dataset of datasetNotes) {
      const publisher = datasetMeta(catalog, dataset.id).publisher
      expect(typeIds.has(publisher.type.id)).toBe(true)
      expect(publisher.name.length).toBeGreaterThan(0)
    }
    expect(new Set(datasetNotes.map((dataset) => datasetMeta(catalog, dataset.id).publisher.type.id)))
      .toEqual(new Set(['government', 'international', 'community', 'platform']))
  })

  test('publishes computed walking access as DevelopingCountry.org while preserving upstream Sources', () => {
    const dataset = datasetMeta(catalog, 'metro_catchment')
    expect(dataset.publisher).toEqual({
      id: 'developing-country-org',
      name: 'DevelopingCountry.org',
      type: { id: 'platform', label: 'Platform' },
    })
    expect(dataset.sources.map((source) => source.id)).toEqual(['lk-metro', 'osm-walk-colombo'])
  })

  test('gives every DevelopingCountry.org dataset a licence and no other publisher one', () => {
    for (const dataset of datasetNotes) {
      const meta = datasetMeta(catalog, dataset.id)
      if (meta.publisher.id === 'developing-country-org') expect(meta.licence, dataset.id).not.toBeNull()
      else expect(meta.licence, dataset.id).toBeNull()
    }
    expect(datasetMeta(catalog, 'lk-initiative-events').licence?.name).toBe('CC BY 4.0')
    expect(datasetMeta(catalog, 'metro_catchment').licence?.name).toBe('ODbL 1.0')
  })

  test('records a licence status for every source, so none shows as not recorded', () => {
    for (const source of catalog.sources) expect(source.licence_status, source.id).toBeDefined()
  })

  test('supports multiple themes where the public-data subject crosses domains', () => {
    expect(datasetNotes.find((dataset) => dataset.id === 'labour-force')?.themeIds)
      .toEqual(['SOCI', 'ECON'])
    expect(datasetNotes.find((dataset) => dataset.id === 'government-revenue-annual')?.themeIds)
      .toEqual(['ECON', 'GOVE'])
  })

  test('formats source-date precision without inventing a day', () => {
    expect(formatRefreshDate('2026-08-31')).toBe('31 Aug 2026')
    expect(formatRefreshDate('2026-08')).toBe('Aug 2026')
    expect(formatRefreshDate('2026')).toBe('2026')
  })
})

describe('dataset map embeds', () => {
  test('every visual dataset gets one selection and an explicit camera', () => {
    for (const dataset of datasetNotes) {
      if (dataset.preview?.kind !== 'map') continue

      const url = new URL(datasetExploreUrl(dataset.id, true, 'http://127.0.0.1:5173'))
      const layers = url.searchParams.get('layers')
      const population = url.searchParams.get('pop')

      expect(url.searchParams.get('embed')).toBe('dataset')
      expect(Number.isFinite(Number(url.searchParams.get('lng')))).toBe(true)
      expect(Number.isFinite(Number(url.searchParams.get('lat')))).toBe(true)
      expect(Number.isFinite(Number(url.searchParams.get('zoom')))).toBe(true)
      expect(Boolean(layers) !== Boolean(population)).toBe(true)
      expect(layers?.includes(',') ?? false).toBe(false)
    }
  })

  test('walking access does not silently enable the Metro layer', () => {
    const url = new URL(datasetExploreUrl('metro_catchment', true))
    expect(url.searchParams.get('layers')).toBe('metro_catchment')
  })

  test('the full explorer link stays free of embed-only camera state', () => {
    const url = new URL(datasetExploreUrl('metro'))
    expect(url.searchParams.get('layers')).toBe('metro')
    expect(url.searchParams.has('embed')).toBe(false)
    expect(url.searchParams.has('zoom')).toBe(false)
  })

  test('preserves every existing map preview URL', () => {
    expect(datasetExploreUrl('demographics', true))
      .toBe('https://explore.developing-country.org/?embed=dataset&pop=gnd&lng=80.72&lat=7.85&zoom=6.8')
    expect(datasetExploreUrl('metro', true))
      .toBe('https://explore.developing-country.org/?embed=dataset&layers=metro&lng=79.923&lat=6.907&zoom=9.8')
  })

  test('gives the land-cover grid an island camera and only its registered layer', () => {
    expect(datasetExploreUrl('land-cover-grid', true)).toBe(
      'https://explore.developing-country.org/?embed=dataset&layers=land-cover-grid&lng=80.72&lat=7.85&zoom=6.8',
    )
    expect(datasetExploreUrl('land-cover-grid')).toBe(
      'https://explore.developing-country.org/?layers=land-cover-grid',
    )
  })

  test('gives population change an island camera and only its registered layer', () => {
    expect(datasetExploreUrl('population-change', true)).toBe(
      'https://explore.developing-country.org/?embed=dataset&layers=population-change&lng=80.72&lat=7.85&zoom=6.8',
    )
    expect(datasetExploreUrl('population-change-district', true)).toContain(
      '/datasets/population-change-district/fastest-growing-districts',
    )
  })

  test('resolves only the registered CMS preview and can swap its local origin', () => {
    const canonical = datasetExploreUrl('demographics', true)
    expect(isDatasetPreviewUrl('demographics', canonical)).toBe(true)
    expect(isDatasetPreviewUrl('demographics', datasetExploreUrl('metro', true))).toBe(false)
    expect(resolveDatasetPreviewUrl('demographics', canonical, 'http://127.0.0.1:5173'))
      .toBe('http://127.0.0.1:5173/?embed=dataset&pop=gnd&lng=80.72&lat=7.85&zoom=6.8')
  })
})

describe('dataset source licence disclosure', () => {
  test('surfaces the registered open licence without adding a caveat', () => {
    const source = datasetMeta(catalog, 'land-cover-grid').sources[0]
    expect(source?.licenceDisclosure).toEqual({
      status: 'open',
      label: 'Open licence',
      text: 'CC BY 4.0',
      caveat: null,
    })
  })

  test('does not turn public availability into inferred reuse permission', () => {
    const source = datasetMeta(catalog, 'labour-force').sources[0]
    expect(source?.licenceDisclosure.status).toBe('permission_unclear')
    expect(source?.licenceDisclosure.label).toBe('Reuse permission unclear')
    expect(source?.licenceDisclosure.text).toContain('reuse permission is not explicitly stated')
    expect(source?.licenceDisclosure.caveat).toBe(
      'A public source URL or download does not by itself grant permission to reuse the material.',
    )
  })

  test('labels legacy records with no assessed status conservatively', () => {
    // Every real source now records a status, so strip one to exercise the fallback.
    const legacy = { ...catalog, sources: catalog.sources.map(({ licence_status: _status, ...rest }) => rest) }
    const source = datasetMeta(legacy, 'attractions').sources[0]
    expect(source?.licenceDisclosure.status).toBe('not_recorded')
    expect(source?.licenceDisclosure.label).toBe('Licence status not recorded')
  })

  test('reduces source licences to a conservative three-colour card signal', () => {
    const open = datasetMeta(catalog, 'land-cover-grid').sources[0]?.licenceDisclosure
    const unclear = datasetMeta(catalog, 'labour-force').sources[0]?.licenceDisclosure
    if (!open || !unclear) throw new Error('Expected licence fixtures')

    expect(datasetLicenceSignal([open])).toEqual({ status: 'permissible', label: 'Reuse permitted' })
    expect(datasetLicenceSignal([open, unclear])).toEqual({ status: 'questionable', label: 'Check reuse terms' })
    expect(datasetLicenceSignal([{ ...open, status: 'restricted' }])).toEqual({
      status: 'restricted',
      label: 'Reuse restricted',
    })
  })
})

describe('dataset chart embeds', () => {
  test('keeps the lightweight registry in parity with the full Explorer presets', () => {
    expect(datasetNotes.filter((dataset) => dataset.preview?.kind === 'chart')).toHaveLength(INDICATOR_DATASETS.length)
  })

  test('registers every shared indicator dataset with its first chart preset', () => {
    for (const indicator of INDICATOR_DATASETS) {
      const dataset = datasetNotes.find((candidate) => candidate.id === indicator.id)
      const preset = indicator.presets[0]
      expect(dataset?.preview).toEqual({ kind: 'chart', presetId: preset?.id })
      expect(dataset?.title).toBe(indicator.title)
      expect(dataset?.label).toBe(indicator.label)
    }
  })

  test('uses the shared preset path with embed state only in the preview URL', () => {
    const preset = INDICATOR_DATASETS.find((dataset) => dataset.id === 'labour-force')?.presets[0]
    if (!preset) throw new Error('labour-force preset missing')
    const path = indicatorPresetPath('labour-force', preset.id)
    expect(datasetExploreUrl('labour-force', true)).toBe(
      `https://explore.developing-country.org${path}?embed=dataset`,
    )
    expect(datasetExploreUrl('labour-force')).toBe(`https://explore.developing-country.org${path}`)
  })

  test('rejects another preset and preserves the chart path when swapping to a local origin', () => {
    const canonical = datasetExploreUrl('gdp-by-industry', true)
    expect(isDatasetPreviewUrl('gdp-by-industry', canonical)).toBe(true)
    expect(isDatasetPreviewUrl(
      'gdp-by-industry',
      'https://explore.developing-country.org/datasets/gdp-by-industry/not-registered?embed=dataset',
    )).toBe(false)
    expect(resolveDatasetPreviewUrl('gdp-by-industry', canonical, 'http://127.0.0.1:5173'))
      .toBe('http://127.0.0.1:5173/datasets/gdp-by-industry/real-gdp?embed=dataset')
  })
})
