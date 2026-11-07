import { describe, expect, test } from 'bun:test'
import {
  buildFiscalOperationsTable,
  buildGovernmentDebtTable,
  buildGovernmentRevenueTable,
  buildRemittancesTable,
  buildTradeAnnualCategories,
  buildTradeMonthlyTotals,
  buildTradeTable,
  parseMonthlyHeader,
} from './build-cbsl-indicators.mjs'
import {
  LVI_H1_2025,
  LVI_H2_2025,
  buildEffectiveExchangeRateTable,
  buildExchangeRatesTable,
  buildLandValuationTable,
  buildTourismEarningsTable,
  parseFlexibleMonth,
} from './cbsl-market-indicators.mjs'

describe('CBSL monthly source normalization', () => {
  test('normalizes Excel serials, inconsistent month spellings, and provisional markers', () => {
    expect(parseMonthlyHeader(39083)).toEqual({ period: '2007-01', provisional: false })
    expect(parseMonthlyHeader('Oct -22')).toEqual({ period: '2022-10', provisional: false })
    expect(parseMonthlyHeader('June-22')).toEqual({ period: '2022-06', provisional: false })
    expect(parseMonthlyHeader('Jan-24 (b)')).toEqual({ period: '2024-01', provisional: true })
    expect(() => parseMonthlyHeader('Q1 2026')).toThrow('unrecognized monthly header')
  })

  test('builds a deterministic hierarchy and retains negligible values explicitly', () => {
    const definitions = [
      { id: 'alpha', label: 'Alpha', source: '1. Alpha', parent: null, kind: 'subtotal' },
      { id: 'alpha-detail', label: 'Alpha detail', source: 'Alpha detail', parent: 'alpha', kind: 'component' },
      { id: 'beta', label: 'Beta', source: '2. Beta', parent: null, kind: 'subtotal' },
      { id: 'total', label: 'Total', source: 'Total', parent: null, kind: 'total' },
    ]
    const rows = [
      ['Category', 39083, 39114],
      ['1.   Alpha', 10, 12],
      ['Alpha detail', 10, '…'],
      ['2. Beta', 5, 8],
      ['Total', 15, 20],
    ]
    const first = buildTradeTable(rows, 'exports', definitions)
    const second = buildTradeTable(rows, 'exports', definitions)
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
    expect(first.rows).toHaveLength(8)
    expect(first.rows[5]).toMatchObject({
      period: '2007-02',
      category_id: 'alpha-detail',
      value_status: 'negligible',
      value_usd_million: null,
    })
    expect(() => buildTradeTable(rows.map((row) => row[0] === 'Total' ? ['Total', 14, 20] : row), 'exports', definitions)).toThrow('category total')
  })

  test('turns a year-by-month remittance matrix into contiguous monthly rows', () => {
    const rows = [
      [null, null, 2025],
      ...['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
        .map((month, index) => [null, month, index + 0.04]),
      [null, 'Total', 66],
    ]
    const table = buildRemittancesTable(rows)
    expect(table.vintage).toBe('2025-01–2025-12')
    expect(table.rows).toHaveLength(12)
    expect(table.rows[0]).toEqual({ period: '2025-01', value_usd_million: 0 })
    expect(table.rows[11]).toEqual({ period: '2025-12', value_usd_million: 11 })
  })

  test('publishes compact totals and annual categories from monthly trade rows', () => {
    const definitions = [
      { id: 'alpha', label: 'Alpha', source: '1. Alpha', parent: null, kind: 'subtotal' },
      { id: 'total', label: 'Total', source: 'Total', parent: null, kind: 'total' },
    ]
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const header = ['Category', ...months.map((month) => `${month}-07`)]
    const exports = buildTradeTable([header, ['1. Alpha', ...Array(12).fill(10)], ['Total', ...Array(12).fill(10)]], 'exports', definitions)
    const imports = buildTradeTable([header, ['1. Alpha', ...Array(12).fill(20)], ['Total', ...Array(12).fill(20)]], 'imports', definitions)

    const totals = buildTradeMonthlyTotals(exports, imports)
    expect(totals.rows).toHaveLength(24)
    expect(totals.rows[0]).toMatchObject({ period: '2007-01', flow: 'exports', value_usd_million: 10 })

    const annual = buildTradeAnnualCategories(exports, imports)
    expect(annual.rows).toHaveLength(4)
    expect(annual.rows.find((row) => row.flow === 'exports' && row.category_id === 'total')).toMatchObject({
      months_observed: 12,
      months_reported: 12,
      partial_year: false,
      value_usd_million: 120,
    })
  })
})

describe('CBSL annual source normalization', () => {
  test('preserves provisional labels, blanks, and accounting identities', () => {
    const fiscal = buildFiscalOperationsTable([
      [null, '2025(b)', 80, 100, 5, 105, 90, 30, 120, 10, 3, -15, 6, 9, null, 15, 10, 12, -1.5],
    ])
    expect(fiscal.rows[0]).toMatchObject({
      year: 2025,
      source_year_label: '2025(b)',
      provisional: true,
      privatisation_financing_rs_million: null,
      overall_budget_balance_rs_million: -15,
    })

    const revenue = buildGovernmentRevenueTable([
      [null, '2025 (a)', 30, 50, 80, 20, 100, 37.5, 62.5, 80, 20],
    ])
    expect(revenue.rows[0]).toMatchObject({
      provisional: true,
      reported_total_less_components_rs_million: 0,
      direct_tax_share_of_tax_pct: 37.5,
    })
  })

  test('does not turn the debt workbook dash into an invented zero', () => {
    const debt = buildGovernmentDebtTable([
      [null, '2025(i)(j)', 20, 40, '-', 10, 70, 30, 100, 70, 30, 100],
    ])
    expect(debt.rows[0]).toMatchObject({
      year: 2025,
      provisional: true,
      excludes_overdue_debt_service: true,
      external_restructuring_effect: true,
      rupee_loans_rs_million: null,
      rupee_loans_value_status: 'dash_in_source',
      total_debt_rs_million: 100,
    })
  })
})

describe('CBSL market indicators', () => {
  test('parses Excel serials that are not the first of the month', () => {
    expect(parseFlexibleMonth(41305)).toEqual({ period: '2013-01', provisional: false })
    expect(parseMonthlyHeader('Jun-26 (d)')).toEqual({ period: '2026-06', provisional: true })
  })

  test('turns a year-by-month tourism matrix into contiguous monthly rows', () => {
    const header = [null, null, 2009]
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
    const rows = [header, ...months.map((month, index) => [null, month, index + 1])]
    const table = buildTourismEarningsTable(rows)
    expect(table.rows).toHaveLength(12)
    expect(table.rows[0]).toMatchObject({ period: '2009-01', provisional: false, methodology_revised: false, value_usd_million: 1 })
    expect(table.rows.at(-1)).toMatchObject({ period: '2009-12', value_usd_million: 12 })

    const revised = buildTourismEarningsTable([
      [null, null, '2026 (b)(c) '],
      ...months.map((month) => [null, month, 50]),
    ])
    expect(revised.rows).toHaveLength(12)
    expect(revised.rows[0]).toMatchObject({ period: '2026-01', provisional: true, methodology_revised: true, value_usd_million: 50 })
  })

  test('keeps monthly-average and month-end USD rates as distinct series', () => {
    const header = [null, 'Year', 'Month', 'SDR', 'USD', 'GBP', 'INR', 'JPY', 'EUR', 'CHF', 'AUD', 'CAD', 'SGD', 'DKK', 'HKD', 'NZD', 'NOK', 'SEK']
    const average = [
      header,
      [null, 1986, 'January', 1, 27.5052, 39.2, 2.2, 0.137568, '-', '-', '-', '-', '-', '-', '-', '-', '-'],
    ]
    const monthEnd = [
      header,
      [null, '1995', 'January', 1, 50.13, 80, 1.6, 0.5, '-', '-', '-', '-', '-', '-', '-', '-', '-'],
    ]
    const table = buildExchangeRatesTable(average, monthEnd)
    expect(table.rows.map((row) => `${row.period}:${row.rate_kind}:${row.currency}`)).toEqual([
      '1986-01:monthly_average:gbp',
      '1986-01:monthly_average:inr',
      '1986-01:monthly_average:jpy',
      '1986-01:monthly_average:sdr',
      '1986-01:monthly_average:usd',
      '1995-01:month_end:gbp',
      '1995-01:month_end:inr',
      '1995-01:month_end:jpy',
      '1995-01:month_end:sdr',
      '1995-01:month_end:usd',
    ])
    expect(table.rows.find((row) => row.currency === 'usd' && row.rate_kind === 'monthly_average')?.lkr_per_unit).toBe(27.5052)
    expect(table.rows.find((row) => row.currency === 'usd' && row.rate_kind === 'month_end')?.lkr_per_unit).toBe(50.13)
  })

  test('reads NEER/REER labels and marks footnote (d) as provisional', () => {
    const table = buildEffectiveExchangeRateTable([
      [null, 'Month', 'NEER 2017=100 (a)', 'REER 2017=100 (a) (b)'],
      [null, 'Dec-25', 56.78, 71.19],
      [null, 'Jun-26 (d)', 52.94, 71.36],
    ])
    expect(table.rows).toEqual([
      { period: '2025-12', index_id: 'neer', index_label: 'NEER (2017=100)', provisional: false, value: 56.78 },
      { period: '2025-12', index_id: 'reer', index_label: 'REER (2017=100)', provisional: false, value: 71.19 },
      { period: '2026-06', index_id: 'neer', index_label: 'NEER (2017=100)', provisional: true, value: 52.94 },
      { period: '2026-06', index_id: 'reer', index_label: 'REER (2017=100)', provisional: true, value: 71.36 },
    ])
  })

  test('validates 2025 H1 against the official table and fills 2025 H2 from the press release', () => {
    const series = {}
    let year = 2017
    let firstHalf = true
    for (let index = 0; index < 17; index += 1) {
      const iso = `${year}-${firstHalf ? '06' : '12'}-01`
      series[iso] = iso === '2025-06-01' ? LVI_H1_2025.overall : 100 + index
      if (firstHalf) firstHalf = false
      else {
        firstHalf = true
        year += 1
      }
    }
    const table = buildLandValuationTable({
      overall: series,
      residential: { ...series, '2025-06-01': LVI_H1_2025.residential },
      commercial: { ...series, '2025-06-01': LVI_H1_2025.commercial },
      industrial: { ...series, '2025-06-01': LVI_H1_2025.industrial },
    })
    expect(table.rows.filter((row) => row.segment === 'overall')).toHaveLength(18)
    expect(table.rows.find((row) => row.period === '2025-12' && row.segment === 'overall')).toMatchObject({
      half: 'H2',
      index_value: LVI_H2_2025.overall,
    })
  })
})
