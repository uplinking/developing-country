import { describe, expect, test } from 'bun:test'
import { additive, capitalHeadroom, debtAtRisk, formFor, growthSpread, lendersOnly, profitPool, roeSpread, sizeView } from './lib/companyDistributions'

type Row = Record<string, unknown> & { company_id: string; name: string; group_id: string; is_group_head: boolean }
const co = (id: string, o: Record<string, unknown> = {}): Row => ({ company_id: id, name: id, group_id: id, is_group_head: true, industry_kind: 'other', ...o })

describe('company distributions', () => {
  test('a subsidiary is added once, inside its group when the group is in view', () => {
    const rows = [co('g', { revenue_lkr: 100e9 }), co('s', { group_id: 'g', is_group_head: false, revenue_lkr: 40e9 }), co('o', { revenue_lkr: 5e9 })]
    expect(additive(rows).map(r => r.company_id)).toEqual(['g', 'o'])
    expect(additive(rows.slice(1)).map(r => r.company_id)).toEqual(['s', 'o'])
    expect(sizeView(rows).total).toBe(105e9)
  })

  test('the form follows how many report: columns, dots, a list, or nothing', () => {
    expect([formFor(30), formFor(29), formFor(8), formFor(7), formFor(3), formFor(2)]).toEqual(['bins', 'dots', 'dots', 'list', 'list', 'none'])
  })

  test('size bands share out companies and revenue; the top-k shrinks with the count', () => {
    const rows = Array.from({ length: 40 }, (_, i) => co(`c${i}`, { revenue_lkr: (i + 1) * 1e9 }))
    const v = sizeView(rows)
    expect(v.top?.k).toBe(10)
    expect(v.bands.reduce((s, b) => s + b.n, 0)).toBe(40)
    expect(Math.round(v.bands.reduce((s, b) => s + b.valuePct, 0))).toBe(100)
    expect(sizeView(rows.slice(0, 20)).top?.k).toBe(5)
    expect(sizeView(rows.slice(0, 5)).top).toBeNull()
    // incomparable revenue is left out of the sums
    expect(sizeView([co('a', { revenue_lkr: 9e9, revenue_comparable: false }), co('b', { revenue_lkr: 1e9 })]).total).toBe(1e9)
  })

  test('a view of lenders measures size by assets', () => {
    const rows = [co('a', { industry_kind: 'bank', profit_after_tax_lkr: 1, total_assets_lkr: 2e12 }), co('b', { industry_kind: 'finance_company', profit_after_tax_lkr: 1, total_assets_lkr: 5e10 })]
    expect(lendersOnly(rows)).toBe(true)
    expect(sizeView(rows).measure).toBe('assets')
    expect(lendersOnly([...rows, co('c', { profit_after_tax_lkr: 1 })])).toBe(false)
  })

  test('the profit pool sums additive rows but names every loss-maker', () => {
    const rows = [co('g', { profit_after_tax_lkr: 50 }), co('s', { group_id: 'g', is_group_head: false, profit_after_tax_lkr: -20 }), co('o', { profit_after_tax_lkr: -5 })]
    const p = profitPool(rows)
    expect([p.profitsLkr, p.lossesLkr, p.profitable, p.lossMaking]).toEqual([50, -5, 1, 2])
    expect(p.biggestLosses.map(x => x.id)).toEqual(['s', 'o'])
  })

  test('spreads leave out negative equity, lenders and incomparable years', () => {
    const rows = [co('a', { return_on_equity_pct: 10 }), co('b', { return_on_equity_pct: 300, total_equity_lkr: -5 }),
      co('c', { industry_kind: 'bank', revenue_growth_real_pct: 30 }), co('d', { revenue_growth_real_pct: 4 }), co('e', { revenue_growth_real_pct: 90, revenue_growth_note: 'x' })]
    expect(roeSpread(rows).points.map(p => p.id)).toEqual(['a'])
    expect(growthSpread(rows).points.map(p => p.id)).toEqual(['d'])
  })

  test('debt at risk weights borrowing by interest cover, counting an operating loss with debt as the lowest band', () => {
    const rows = [co('a', { interest_cover: 0.5, borrowings_lkr: 10 }), co('b', { interest_cover: 2, borrowings_lkr: 60 }), co('c', { interest_cover: 8, borrowings_lkr: 30 }),
      co('d', { borrowings_lkr: 100, operating_margin_pct: -4 }), co('e', { industry_kind: 'bank', interest_cover: 0.1, borrowings_lkr: 999 })]
    const d = debtAtRisk(rows)
    expect([d.base, d.n, d.borrowingsLkr]).toEqual([4, 4, 200])
    expect(d.bands.map(b => b.n)).toEqual([2, 0, 1, 1])
    expect(d.bands[0]!.borrowingsPct).toBeCloseTo(55)
  })

  test('capital headroom is the total capital ratio less the minimum that applies', () => {
    const rows = [co('a', { industry_kind: 'bank', total_capital_ratio_pct: 16, cse_symbol: 'COMB.N0000' }), co('b', { industry_kind: 'finance_company', total_capital_ratio_pct: 11.86, total_assets_lkr: 50e9 })]
    expect(capitalHeadroom(rows).points.map(p => [p.id, +p.value.toFixed(2)])).toEqual([['a', 2], ['b', -0.64]])
  })
})
