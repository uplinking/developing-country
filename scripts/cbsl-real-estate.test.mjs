import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseIndicatorTable } from '../packages/datasets/src/table.ts'
import {
  buildAskingPriceTable,
  parseAskingPriceTable,
  stitchAskingPriceReports,
} from './build-cbsl-real-estate.mjs'

const FIXTURE_2024_Q1 = `
Table 1: Asking Price Indices
                October            122.0           155.4            158.9
     2022
                November           121.2           157.4            163.4
       Q4
                December           121.7           157.4            167.1
                January            118.2           157.1            170.4
     2023
                February           114.2           157.4            169.9
                March              110.4           158.4            171.0
5
    Asking price indices for lands, houses and condominiums are compiled following the hedonic regression based rolling window time dummy method. (Base period: 2019 = 100)
`

const FIXTURE_2026_Q1 = `
Table 1: Asking Price Indices
                                       Colombo District (2019=100)
                                                                                                                208.2          Quarter         Month
        200                                                                                                                                                            Lands               Houses      Condominiums
                                                                                                                                2025       October                     162.2               181.0                  200.7
                                                                                                                                           November                    164.0               181.0                  202.1
                                                                                                                                 Q4        December                    169.8               182.4                  202.8
                                                                                                                                2026       January                     171.6               182.6                  202.8
                                                                                                                                           February                    175.6               185.5                  206.2
                                                                                                                                 Q1        March                       176.9               187.0                  208.2
 4 Asking price indices for lands, houses and condominiums are compiled using the hedonic regression based rolling window time dummy method. (Base period: 2019 = 100)
`

describe('asking-price PDF tables', () => {
  test('assigns the year that follows the first month of a 2024-style block', () => {
    const rows = parseAskingPriceTable(FIXTURE_2024_Q1)
    expect(rows.map((row) => row.period)).toEqual([
      '2022-10', '2022-11', '2022-12', '2023-01', '2023-02', '2023-03',
    ])
    expect(rows[0]).toMatchObject({ land: 122, house: 155.4, condominium: 158.9 })
    expect(rows[3]).toMatchObject({ period: '2023-01', land: 118.2 })
  })

  test('reads year-on-the-month-line 2026-style blocks', () => {
    const rows = parseAskingPriceTable(FIXTURE_2026_Q1)
    expect(rows.map((row) => row.period)).toEqual([
      '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03',
    ])
    expect(rows.at(-1)).toMatchObject({ land: 176.9, house: 187, condominium: 208.2 })
  })

  test('ignores year-on-year rate tables', () => {
    expect(parseAskingPriceTable(`
Table 1: Asking Price Indices
                                               Y-o-Y % Change
                January              9.1            17.0              10.5
      2022
    Asking price indices are compiled following the hedonic regression based rolling window time dummy method.
`)).toEqual([])
  })

  test('later reports overwrite overlapping months', () => {
    const earlier = `
Table 1: Asking Price Indices
                                                                                                2025      October            160.0            180.0             199.0
                                                                                                          November           161.0            180.5             199.5
                                                                                                 Q4       December           162.0            181.0             200.0
 4 Asking price indices are compiled using the hedonic regression based rolling window time dummy method.
`
    const stitched = stitchAskingPriceReports([
      { id: '2025_q4', rows: parseAskingPriceTable(earlier) },
      { id: '2026_q1', rows: parseAskingPriceTable(FIXTURE_2026_Q1) },
    ])
    expect(stitched.map((row) => row.period)).toEqual([
      '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03',
    ])
    expect(stitched[0]).toMatchObject({ land: 162.2, report_id: '2026_q1' })
  })
})

describe('colombo-asking-price-indices artifact', () => {
  const table = parseIndicatorTable(JSON.parse(
    readFileSync(resolve(import.meta.dir, '../public/data/colombo-asking-price-indices.json'), 'utf8'),
  ))

  test('keeps three property types for every published month', () => {
    expect(table.dataset_id).toBe('colombo-asking-price-indices')
    expect(table.rows[0].period).toBe('2022-10')
    expect(table.rows.at(-1).period).toBe('2026-03')
    const months = [...new Set(table.rows.map((row) => row.period))]
    expect(months).toHaveLength(42)
    expect(table.rows).toHaveLength(126)
    expect(new Set(table.rows.map((row) => row.property_type))).toEqual(new Set(['land', 'house', 'condominium']))
  })

  test('matches the latest Q1 2026 press table and a 2025 Q2 revision', () => {
    const at = (period, type) => table.rows.find((row) => row.period === period && row.property_type === type)
    expect(at('2026-03', 'land').index_value).toBe(176.9)
    expect(at('2026-03', 'house').index_value).toBe(187)
    expect(at('2026-03', 'condominium').index_value).toBe(208.2)
    expect(at('2025-01', 'house').index_value).toBe(167.6)
    expect(at('2025-01', 'condominium').index_value).toBe(182.6)
  })
})
