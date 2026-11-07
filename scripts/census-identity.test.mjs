import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseIndicatorTable } from '../packages/datasets/src/table.ts'

const DATA = resolve(import.meta.dir, '../public/data')

describe('census identity artifacts', () => {
  test('ethnicity covers 2012 and 2024 for every district and published group', () => {
    const table = parseIndicatorTable(JSON.parse(readFileSync(resolve(DATA, 'census-ethnicity-district.json'), 'utf8')))
    expect(table.rows).toHaveLength(26 * 2 * 7)
    const national = table.rows.find((row) => row.geography_id === 'LK' && row.year === 2024 && row.category === 'sinhalese')
    expect(national.population).toBe(16_144_037)
    expect(national.share_pct).toBe(74.12)
    expect(national.total_population).toBe(21_781_800)
  })

  test('religion parts close to the published geography total', () => {
    const table = parseIndicatorTable(JSON.parse(readFileSync(resolve(DATA, 'census-religion-district.json'), 'utf8')))
    expect(table.rows).toHaveLength(26 * 2 * 6)
    const national = table.rows.find((row) => row.geography_id === 'LK' && row.year === 2024 && row.category === 'buddhist')
    expect(national.population).toBe(15_199_093)
    expect(national.total_population).toBe(21_781_800)
    const jaffna = table.rows.find((row) => row.geography_id === 'LK-41' && row.year === 2024 && row.category === 'hindu')
    expect(jaffna.population).toBe(489_521)
  })
})
