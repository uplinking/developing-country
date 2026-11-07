import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseIndicatorTable } from '../packages/datasets/src/table.ts'
import { buildHousingStructureFromSheet, HOUSING_STRUCTURE_CATEGORIES } from './build-census-housing.mjs'
import { readXlsxSheet } from './lib/xlsx.mjs'

const DATA = resolve(import.meta.dir, '../public/data')

describe('housing-structure builder', () => {
  test('rejects a sheet that is missing geographies', () => {
    expect(() => buildHousingStructureFromSheet([])).toThrow('Expected 26 geography rows')
  })
})

describe('census-housing-structure-district artifact', () => {
  const table = parseIndicatorTable(JSON.parse(readFileSync(resolve(DATA, 'census-housing-structure-district.json'), 'utf8')))

  test('covers the national row and 25 districts across every published structure class', () => {
    expect(table.dataset_id).toBe('census-housing-structure-district')
    expect(table.rows).toHaveLength(26 * HOUSING_STRUCTURE_CATEGORIES.length)
    expect(table.rows.filter((row) => row.geography_id === 'LK')).toHaveLength(10)
    const national = table.rows.find((row) => row.geography_id === 'LK' && row.category === 'single_house_single_storey')
    expect(national.total_housing_units).toBe(6_030_541)
    expect(national.housing_units).toBe(4_958_009)
  })

  test('keeps category shares on 100% and Colombo as the high-rise district', () => {
    const groups = new Map()
    for (const row of table.rows) {
      groups.set(row.geography_id, (groups.get(row.geography_id) ?? 0) + row.share_pct)
      expect(row.housing_units + 0).toBeGreaterThanOrEqual(0)
    }
    for (const total of groups.values()) expect(total).toBeCloseTo(100, 3)
    const highRise = table.rows.find((row) => row.geography_id === 'LK-11' && row.category === 'attached_20_plus_floors')
    expect(highRise.housing_units).toBe(1756)
    expect(table.rows.filter((row) => row.category === 'attached_20_plus_floors' && row.housing_units > 0).map((row) => row.geography_id)).toEqual(['LK', 'LK-11'])
  })
})
