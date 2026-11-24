import { describe, expect, test } from 'bun:test'
import { basisOf, cagr, peerStats, peersOf, regions, series, statementPairs, type FinRow } from './lib/companyFigures'

const fin = (o: Partial<FinRow>): FinRow => ({
  company_id: 'c', basis: 'group', year_end: '2026-03-31', fiscal_year: 2026, source: 'statements', metric: 'revenue',
  region: null, value: 1, unit: 'LKR', page: 1, source_url: 'u#page=1', ...o,
})

describe('company figures', () => {
  test('group statements are preferred, company statements used when there are no group ones', () => {
    expect(basisOf([fin({ basis: 'company' }), fin({ basis: 'group' })])).toBe('group')
    expect(basisOf([fin({ basis: 'company' })])).toBe('company')
    expect(basisOf([fin({ source: 'multi_year_summary' })])).toBeNull()
  })

  test('statement pairs put the newer year end in current', () => {
    const p = statementPairs([
      fin({ value: 120 }), fin({ year_end: '2025-03-31', fiscal_year: 2025, value: 100 }),
      fin({ basis: 'company', value: 5 }), fin({ metric: 'revenue_by_region', region: 'Europe', value: 9 }),
    ], 'group')
    expect(p.get('revenue')).toMatchObject({ current: 120, prior: 100, currentEnd: '2026-03-31', priorEnd: '2025-03-31' })
    expect(p.has('revenue_by_region')).toBe(false)
  })

  test('a series takes the summary for old years and the statements for the years they cover', () => {
    const s = series([
      fin({ source: 'multi_year_summary', fiscal_year: 2024, year_end: '2024-03-31', value: 80 }),
      fin({ source: 'multi_year_summary', fiscal_year: 2026, value: 119 }),
      fin({ value: 120 }),
    ], 'revenue', 'group')
    expect(s.map(p => [p.year, p.value])).toEqual([[2024, 80], [2026, 120]])
    expect(cagr(s)).toBeCloseTo(22.47, 1)
    expect(cagr([{ year: 2020, yearEnd: '', value: -1 }, { year: 2025, yearEnd: '', value: 5 }])).toBeNull()
  })

  test('a real series uses the summary\'s real values and the statements only for the latest year', () => {
    const rows = [
      fin({ source: 'multi_year_summary', fiscal_year: 2017, year_end: '2017-03-31', value: 50, value_real: 110 }),
      fin({ source: 'multi_year_summary', fiscal_year: 2025, year_end: '2025-03-31', value: 100, value_real: 104 }),
      fin({ value: 120 }), fin({ fiscal_year: 2025, year_end: '2025-03-31', value: 101 }),
    ]
    expect(series(rows, 'revenue', 'group', { real: true }).map(p => [p.year, p.value])).toEqual([[2017, 110], [2025, 104], [2026, 120]])
    expect(series(rows, 'revenue', 'group').map(p => [p.year, p.value])).toEqual([[2017, 50], [2025, 101], [2026, 120]])
  })

  test('regions come from the latest year, largest first, without totals', () => {
    const r = regions([
      fin({ metric: 'revenue_by_region', region: 'Asia', value: 10 }), fin({ metric: 'revenue_by_region', region: 'Europe', value: 30 }),
      fin({ metric: 'revenue_by_region', region: 'Total', value: 40 }), fin({ metric: 'revenue_by_region', region: 'Asia', year_end: '2025-03-31', value: 99 }),
    ], 'group')
    expect(r).toEqual([{ region: 'Europe', value: 30 }, { region: 'Asia', value: 10 }])
  })

  test('peers share the broad sector, and lenders are compared only with lenders', () => {
    const all = [
      { company_id: 'a', listed: true, sector_family: 'finance', industry_kind: 'bank', m: 10 },
      { company_id: 'b', listed: true, sector_family: 'finance', industry_kind: 'insurer', m: 1 },
      { company_id: 'c', listed: false, sector_family: 'finance', industry_kind: 'bank', m: 3 },
      { company_id: 'd', listed: true, sector_family: 'finance', industry_kind: 'finance_company', m: 5 },
    ]
    expect(peersOf(all, all[0]!).map(x => x.company_id)).toEqual(['a', 'd'])
  })

  test('peer rank counts better values; fewer than five values gives no comparison', () => {
    const peers = [1, 2, 3, 4, 5, 6].map(m => ({ m }))
    expect(peerStats(peers, { m: 5 }, 'm')).toMatchObject({ n: 6, median: 3.5, rank: 2 })
    expect(peerStats(peers, { m: 5 }, 'm', 'lower')).toMatchObject({ rank: 5 })
    expect(peerStats(peers.slice(0, 4), { m: 5 }, 'm')).toBeNull()
    expect(peerStats(peers, { m: null }, 'm')).toBeNull()
  })
})
