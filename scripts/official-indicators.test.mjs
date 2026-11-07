import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseIndicatorTable } from '../packages/datasets/src/table.ts'
import { buildCcpiFromText } from './build-official-indicators.mjs'

const DATA = resolve(import.meta.dir, '../public/data')
const EXPECTED_ROWS = {
  'census-age-sex-dsd': 340,
  'census-households-dsd': 340,
  'census-basic-services-district': 962,
  'population-estimates-district': 390,
  'labour-force': 9,
  'employment-by-industry': 119,
  'poverty-headcount-district': 182,
  'gdp-by-industry': 180,
  'inpatient-morbidity-mortality': 276,
  'ccpi-monthly': 56,
}

function load(datasetId) {
  return parseIndicatorTable(JSON.parse(readFileSync(resolve(DATA, `${datasetId}.json`), 'utf8')))
}

describe('official indicator artifacts', () => {
  test('all generated tables satisfy the strict contract and expected grain', () => {
    for (const [datasetId, expectedRows] of Object.entries(EXPECTED_ROWS)) {
      const table = load(datasetId)
      expect(table.dataset_id).toBe(datasetId)
      expect(table.country).toBe('LK')
      expect(table.rows).toHaveLength(expectedRows)
    }
  })

  test('does not label the Colombo urban CCPI as a national row', () => {
    const table = load('ccpi-monthly')
    expect(table.grain).toContain('Colombo urban')
    expect(table.grain).not.toMatch(/one national row/i)
    expect(table.caveats.some((caveat) => /Colombo urban index/i.test(caveat))).toBe(true)
  })

  test('Census population components reconcile', () => {
    const table = load('census-age-sex-dsd')
    for (const row of table.rows) {
      expect(row.male + row.female).toBe(row.population)
      expect(row.age_0_14 + row.age_15_59 + row.age_60_64 + row.age_65_plus).toBe(row.population)
    }
  })

  test('household-service shares are bounded and published categories close to 100%', () => {
    const table = load('census-basic-services-district')
    const groups = new Map()
    for (const row of table.rows) {
      expect(row.share_pct).toBeGreaterThanOrEqual(0)
      expect(row.share_pct).toBeLessThanOrEqual(100)
      const key = `${row.geography_id}:${row.service}`
      groups.set(key, (groups.get(key) ?? 0) + row.share_pct)
    }
    for (const total of groups.values()) expect(total).toBeCloseTo(100, 5)
  })

  test('derived totals preserve source arithmetic and period distinctions', () => {
    for (const row of load('inpatient-morbidity-mortality').rows) {
      expect(row.live_discharges_total).toBe(row.live_discharges_male + row.live_discharges_female)
      expect(row.deaths_total).toBe(row.deaths_male + row.deaths_female)
      expect(row.live_discharges_year).toBe(2024)
      expect(row.deaths_year).toBe(2023)
    }
    const excluded = load('poverty-headcount-district').rows.filter((row) => row.coverage_note !== null)
    expect(excluded).toHaveLength(32)
    expect(excluded.every((row) => row.poverty_headcount_ratio_pct === null)).toBe(true)
  })

  test('GDP rows preserve hierarchy and are explicitly non-additive', () => {
    const table = load('gdp-by-industry')
    const valueField = table.fields.find((field) => field.id === 'value_rs_million')
    expect(valueField?.aggregation).toBe('none')

    const expectedKinds = new Set([
      'gva_component', 'nested_component', 'subtotal', 'adjustment_add', 'adjustment_subtract', 'total',
    ])
    expect(new Set(table.rows.map((row) => row.series_kind))).toEqual(expectedKinds)
    expect(table.rows.every((row) => Object.hasOwn(row, 'parent_series_id'))).toBe(true)

    const topLevelComponentIds = new Set([
      'agriculture', 'industry', 'construction', 'trade_transport_hospitality',
      'information_communication', 'finance_insurance', 'real_estate',
      'professional_admin_support', 'public_social_services', 'other_services',
    ])
    for (const priceBasis of ['current', 'constant_2015']) {
      for (const year of [2019, 2020, 2021, 2022, 2023, 2024]) {
        const rows = table.rows.filter((row) => row.price_basis === priceBasis && row.year === year)
        const byId = new Map(rows.map((row) => [row.activity_id, row]))
        const componentTotal = rows
          .filter((row) => topLevelComponentIds.has(row.activity_id))
          .reduce((total, row) => total + row.value_rs_million, 0)
        expect(Math.abs(componentTotal - byId.get('gva').value_rs_million)).toBeLessThanOrEqual(2)
        expect(Math.abs(
          byId.get('gva').value_rs_million
          + byId.get('taxes').value_rs_million
          - byId.get('subsidies').value_rs_million
          - byId.get('gdp').value_rs_million,
        )).toBeLessThanOrEqual(1)
        expect(byId.get('manufacturing').parent_series_id).toBe('industry')
        expect(byId.get('gdp').parent_series_id).toBeNull()
      }
    }
  })
})

describe('CCPI source normalization', () => {
  test('reads year carry-forward and leaves unpublished rates null', () => {
    const table = buildCcpiFromText(`
Index Number
2022   January               124.3          118.4
       February              125.8          120.0       1.2%             1.4%
2023   February              189.5          172.3       0.5%          -0.1%           50.6%        43.6%
`)
    expect(table.rows).toHaveLength(3)
    expect(table.rows[0]).toMatchObject({
      period: '2022-01',
      headline_index: 124.3,
      headline_year_on_year_pct: null,
    })
    expect(table.rows[2]).toMatchObject({
      period: '2023-02',
      headline_year_on_year_pct: 50.6,
      core_year_on_year_pct: 43.6,
    })
  })
})
