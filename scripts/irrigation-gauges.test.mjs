import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { EXPECTED_STATIONS, buildGaugeCollection } from './fetch-irrigation-gauges.mjs'

const DATA = resolve(import.meta.dir, '../public/data/irrigation-gauges.geojson')

const FIXTURE = [
  {
    name: 'Nagalagam Street',
    river_name: 'Kelani Ganga',
    district_id: 'LK-11;LK-12',
    lat_lng: [6.96027242132317, 79.87858326530204],
    alert_level_m: 1.2192,
    minor_flood_level_m: 1.524,
    major_flood_level_m: 2.1336,
  },
  {
    name: 'Ampara',
    river_name: 'Gal Oya',
    district_id: 'LK-53',
    lat_lng: [7.291174902374124, 81.67240963860993],
    alert_level_m: 0,
    minor_flood_level_m: 0,
    major_flood_level_m: 0,
  },
]

describe('irrigation gauge builder', () => {
  test('swaps lat_lng into GeoJSON order and keeps unpublished thresholds as zero', () => {
    expect(() => buildGaugeCollection(FIXTURE)).toThrow('Expected 40 hydrology stations')
    const padded = Array.from({ length: EXPECTED_STATIONS }, (_, index) => {
      if (index < FIXTURE.length) return FIXTURE[index]
      return {
        name: `Station ${index}`,
        river_name: 'Test Ganga',
        district_id: 'LK-11',
        lat_lng: [7 + index * 0.01, 80 + index * 0.01],
        alert_level_m: 1,
        minor_flood_level_m: 2,
        major_flood_level_m: 3,
      }
    })
    const collection = buildGaugeCollection(padded)
    const nagalagam = collection.features.find((feature) => feature.properties.id === 'nagalagam-street')
    const ampara = collection.features.find((feature) => feature.properties.id === 'ampara')
    expect(nagalagam.geometry.coordinates[0]).toBeCloseTo(79.87858, 4)
    expect(nagalagam.geometry.coordinates[1]).toBeCloseTo(6.96027, 4)
    expect(ampara.properties.alert_level_m).toBe(0)
    expect(collection.features.some((feature) => 'water_level_m' in feature.properties)).toBe(false)
  })

  test('rejects a live water-level field so this extract cannot pretend to be a flood bulletin', () => {
    const live = Array.from({ length: EXPECTED_STATIONS }, (_, index) => ({
      name: `Station ${index}`,
      river_name: 'Test Ganga',
      district_id: 'LK-11',
      lat_lng: [7, 80],
      alert_level_m: 1,
      minor_flood_level_m: 2,
      major_flood_level_m: 3,
      ...(index === 0 ? { water_level_m: 4.2 } : {}),
    }))
    expect(() => buildGaugeCollection(live)).toThrow('live water level')
  })
})

describe('irrigation-gauges artifact', () => {
  test('ships 40 static stations with published flood thresholds', () => {
    const collection = JSON.parse(readFileSync(DATA, 'utf8'))
    expect(collection.features).toHaveLength(EXPECTED_STATIONS)
    const nagalagam = collection.features.find((feature) => feature.properties.id === 'nagalagam-street')
    expect(nagalagam.properties.river_name).toBe('Kelani Ganga')
    expect(nagalagam.properties.major_flood_level_m).toBe(2.1336)
    expect(collection.features.every((feature) => feature.properties.water_level_m == null)).toBe(true)
  })
})
