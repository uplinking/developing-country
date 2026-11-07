import { describe, expect, test } from 'bun:test'
import { readFileSync, statSync } from 'node:fs'
import { parseIndicatorTable } from '../packages/datasets/src/table.ts'
import {
  WORLD_COVER_CLASSES,
  buildDistrictTable,
  gridFeaturesFromRaster,
  worldCoverClass,
} from './build-land-cover.mjs'

describe('WorldCover class model', () => {
  test('maps every official class and treats vegetated as a categorical grouping', () => {
    expect(WORLD_COVER_CLASSES.map((entry) => entry.code)).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100])
    expect(worldCoverClass(10)).toEqual({ code: 10, label: 'Tree cover', vegetated: true })
    expect(worldCoverClass(50)?.vegetated).toBe(false)
    expect(worldCoverClass(80)?.vegetated).toBe(false)
    expect(worldCoverClass(95)?.vegetated).toBe(true)
    expect(worldCoverClass(0)).toBeUndefined()
  })

  test('aggregates samples with deterministic dominant-class tie-breaking', () => {
    const samples = new Uint8Array([
      40, 10, 0, 0,
      10, 40, 0, 50,
    ])
    const features = gridFeaturesFromRaster(samples, 4, 2, [80, 0.025, 0, 7.1, 0, -0.025], 0.05)
    expect(features.map((feature) => feature.properties.grid_id)).toEqual(['141:1600', '141:1601'])
    expect(features[0].properties).toEqual({
      grid_id: '141:1600', class_code: 10, class_label: 'Tree cover', vegetated: true, year: 2021,
    })
    expect(features[0].geometry.coordinates[0][0]).toEqual([80, 7.05])
  })

  test('rejects codes outside the documented WorldCover legend', () => {
    expect(() => gridFeaturesFromRaster(new Uint8Array([55]), 1, 1, [80, 1, 0, 7, 0, -1]))
      .toThrow('Unknown WorldCover class code')
  })
})

describe('WorldCover district indicator table', () => {
  test('builds stable area/share rows that satisfy IndicatorTableV1', () => {
    const districts = [
      { index: 2, id: 'LK-12', name: 'Gampaha' },
      { index: 1, id: 'LK-11', name: 'Colombo' },
    ]
    const counts = new Map([
      [1, new Map([[10, 1], [50, 3]])],
      [2, new Map([[40, 2], [80, 2]])],
    ])
    const table = buildDistrictTable(districts, counts, 0.01)
    expect(() => parseIndicatorTable(table)).not.toThrow()
    expect(table.rows).toEqual([
      { geography_id: 'LK-11', geography_name: 'Colombo', year: 2021, class_code: 10, class_label: 'Tree cover', area_km2: 0.01, share_pct: 25 },
      { geography_id: 'LK-11', geography_name: 'Colombo', year: 2021, class_code: 50, class_label: 'Built-up', area_km2: 0.03, share_pct: 75 },
      { geography_id: 'LK-12', geography_name: 'Gampaha', year: 2021, class_code: 40, class_label: 'Cropland', area_km2: 0.02, share_pct: 50 },
      { geography_id: 'LK-12', geography_name: 'Gampaha', year: 2021, class_code: 80, class_label: 'Permanent water bodies', area_km2: 0.02, share_pct: 50 },
    ])
  })
})

describe('committed WorldCover artifacts', () => {
  test('grid is compact, class-safe, and explicit about method limitations', () => {
    const path = new URL('../public/data/land-cover-grid.geojson', import.meta.url)
    const grid = JSON.parse(readFileSync(path, 'utf8'))
    expect(grid.type).toBe('FeatureCollection')
    expect(grid.features.length).toBeGreaterThan(500)
    expect(grid.features.length).toBeLessThan(5_000)
    expect(statSync(path).size).toBeLessThan(3 * 1_048_576)
    expect(grid.source.license).toBe('CC BY 4.0')
    expect(grid.caveats.join(' ')).toContain('not NDVI')
    for (const feature of grid.features) {
      const entry = worldCoverClass(feature.properties.class_code)
      expect(entry).toBeDefined()
      expect(feature.properties.class_label).toBe(entry.label)
      expect(feature.properties.vegetated).toBe(entry.vegetated)
      expect(feature.properties.year).toBe(2021)
      expect(feature.geometry).not.toBeNull()
    }
  })

  test('district table is compact, contract-valid, complete, and internally coherent', () => {
    const path = new URL('../public/data/land-cover-district.json', import.meta.url)
    const table = parseIndicatorTable(JSON.parse(readFileSync(path, 'utf8')))
    expect(table.dataset_id).toBe('land-cover-district')
    expect(table.source_ids).toEqual(['esa-worldcover-2021'])
    expect(statSync(path).size).toBeLessThan(256 * 1024)
    const districts = new Set(table.rows.map((row) => row.geography_id))
    expect(districts.size).toBe(25)
    for (const district of districts) {
      const rows = table.rows.filter((row) => row.geography_id === district)
      const share = rows.reduce((sum, row) => sum + row.share_pct, 0)
      expect(share).toBeGreaterThanOrEqual(99.99)
      expect(share).toBeLessThanOrEqual(100.01)
      expect(rows.every((row) => worldCoverClass(row.class_code)?.label === row.class_label)).toBe(true)
      expect(rows.every((row) => row.area_km2 > 0)).toBe(true)
    }
  })

  test('tree-cover ranking covers every district and puts Kegalle first', () => {
    const path = new URL('../public/data/land-cover-district.json', import.meta.url)
    const table = parseIndicatorTable(JSON.parse(readFileSync(path, 'utf8')))
    const ranked = table.rows
      .filter((row) => row.class_code === 10)
      .sort((left, right) => right.share_pct - left.share_pct)
    expect(ranked).toHaveLength(25)
    expect(ranked[0]).toMatchObject({ geography_name: 'Kegalle', share_pct: 98.506 })
    expect(ranked.at(-1).geography_name).toBe('Jaffna')
  })
})
