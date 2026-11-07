import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseIndicatorTable } from '../packages/datasets/src/table.ts'
import { buildPopulationChangeFromCollection, DISTRICT_IDS } from './build-population-change.mjs'

const DATA = resolve(import.meta.dir, '../public/data')

describe('population-change builder', () => {
  test('requires 25 joined 2024 district features', () => {
    expect(() => buildPopulationChangeFromCollection({ type: 'FeatureCollection', features: [] }))
      .toThrow('Expected 25 district features')
    expect(() => buildPopulationChangeFromCollection({
      type: 'FeatureCollection',
      features: DISTRICT_IDS.map((id) => ({
        properties: { id, name: id, province: 'Western', pop: 10, pop_2012: 8, vintage: '2012', area: 1 },
      })),
    })).toThrow('expected 2024')
  })

  test('computes arithmetic change from a short fixture', () => {
    const table = buildPopulationChangeFromCollection({
      type: 'FeatureCollection',
      features: DISTRICT_IDS.map((id, i) => ({
        properties: {
          id,
          name: `District ${i + 1}`,
          province: 'Western',
          pop: 110,
          pop_2012: 100,
          vintage: '2024',
          area: 12.5,
        },
      })),
    })
    expect(table.rows).toHaveLength(25)
    expect(table.rows[0]).toMatchObject({ pop_2012: 100, pop_2024: 110, change: 10, change_pct: 10 })
  })
})

describe('population-change-district artifact', () => {
  const table = parseIndicatorTable(JSON.parse(readFileSync(resolve(DATA, 'population-change-district.json'), 'utf8')))

  test('covers every district with a 100% 2024 join', () => {
    expect(table.dataset_id).toBe('population-change-district')
    expect(table.rows).toHaveLength(25)
    expect(new Set(table.rows.map((row) => row.geography_id))).toEqual(new Set(DISTRICT_IDS))
    expect(table.rows.every((row) => row.pop_2012 > 0 && row.pop_2024 > 0)).toBe(true)
    expect(table.rows.every((row) => row.change === row.pop_2024 - row.pop_2012)).toBe(true)
  })

  test('matches the joined district GeoJSON totals and known ends of the ranking', () => {
    const byId = new Map(table.rows.map((row) => [row.geography_id, row]))
    expect(table.rows.reduce((sum, row) => sum + row.pop_2012, 0)).toBe(20_357_776)
    expect(table.rows.reduce((sum, row) => sum + row.pop_2024, 0)).toBe(21_781_800)
    expect(byId.get('LK-44')).toMatchObject({ geography_name: 'Mullaitivu', change_pct: 33 })
    expect(byId.get('LK-43')).toMatchObject({ geography_name: 'Vavuniya', change_pct: 0.15 })
    expect(table.rows.every((row) => row.change_pct >= 0)).toBe(true)
  })

  test('keeps gig-data 2012 totals even where Final Report Table 6.1.11 differs', () => {
    const ethnicity = parseIndicatorTable(JSON.parse(readFileSync(resolve(DATA, 'census-ethnicity-district.json'), 'utf8')))
    const report2012 = new Map(
      ethnicity.rows
        .filter((row) => row.year === 2012 && row.category === 'sinhalese')
        .map((row) => [row.geography_id, row.total_population]),
    )
    const report2024 = new Map(
      ethnicity.rows
        .filter((row) => row.year === 2024 && row.category === 'sinhalese')
        .map((row) => [row.geography_id, row.total_population]),
    )
    expect(table.rows.every((row) => row.pop_2024 === report2024.get(row.geography_id))).toBe(true)
    const mismatched = table.rows.filter((row) => row.pop_2012 !== report2012.get(row.geography_id))
    expect(mismatched.map((row) => row.geography_id).sort()).toEqual(['LK-11', 'LK-43', 'LK-44', 'LK-61'])
    expect(table.caveats.some((caveat) => caveat.includes('Table 6.1.11'))).toBe(true)
  })
})
