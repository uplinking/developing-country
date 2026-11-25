import { describe, expect, test } from 'bun:test'
import { judge, peerView, quantile, ratioPairs, trendOf } from './lib/companyLights'
import type { Pair } from './lib/companyFigures'

type Row = Record<string, unknown>
const co = (o: Row): Row => ({ company_id: 'x', name: 'X', listed: true, industry_kind: 'other', sector_family: 'manufacturing', total_equity_lkr: 100, ...o })
const markOf = (all: Row[], r: Row, field: string) => judge(all, r).find(j => j.field === field)
/** Eleven listed manufacturers with return on equity 0, 2, 4, … 20. */
const makers = Array.from({ length: 11 }, (_, i) => co({ company_id: `m${i}`, return_on_equity_pct: i * 2 }))

describe('company lights', () => {
  test('quantiles interpolate between values', () => {
    expect(quantile([0, 10], 0.25)).toBe(2.5)
    expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3)
  })

  test('peers: best quarter is good, weakest quarter is watch, never weak', () => {
    expect(markOf(makers, makers[10]!, 'return_on_equity_pct')).toMatchObject({ light: 'good', basis: 'peers' })
    expect(markOf(makers, makers[5]!, 'return_on_equity_pct')).toMatchObject({ light: 'typical' })
    expect(markOf(makers, makers[0]!, 'return_on_equity_pct')).toMatchObject({ light: 'watch', basis: 'peers' })
  })

  test('a negative return is weak by the line, not by the peers', () => {
    expect(markOf(makers, co({ company_id: 'n', return_on_equity_pct: -3 }), 'return_on_equity_pct')).toMatchObject({ light: 'weak', basis: 'line' })
  })

  test('too few peers in a sector falls back to every listed company outside finance; lenders are not ranked', () => {
    const small = co({ company_id: 's', sector_family: 'health', return_on_equity_pct: 5 })
    const p = peerView([...makers, small], small, 'return_on_equity_pct', 'higher')
    expect(p).toMatchObject({ fallback: true, label: 'listed companies outside finance', n: 12 })
    const banks = Array.from({ length: 6 }, (_, i) => co({ company_id: `b${i}`, industry_kind: 'bank', return_on_equity_pct: i }))
    expect(markOf(banks, banks[5]!, 'return_on_equity_pct')).toMatchObject({ light: 'none' })
  })

  test('banks are compared with banks, not with finance companies', () => {
    const all = [
      ...Array.from({ length: 10 }, (_, i) => co({ company_id: `b${i}`, industry_kind: 'bank', return_on_assets_pct: 1 + i / 10 })),
      ...Array.from({ length: 10 }, (_, i) => co({ company_id: `f${i}`, industry_kind: 'finance_company', return_on_assets_pct: 5 + i })),
    ]
    expect(peerView(all, all[0]!, 'return_on_assets_pct', 'higher')).toMatchObject({ n: 10, label: 'listed banks' })
  })

  test('profit and loss record', () => {
    expect(markOf([], co({ profit_after_tax_lkr: -5, profit_after_tax_prior_lkr: 3 }), 'profit_after_tax_lkr')).toMatchObject({ light: 'weak' })
    expect(markOf([], co({ profit_after_tax_lkr: 5, profit_after_tax_prior_lkr: -3 }), 'profit_after_tax_lkr')).toMatchObject({ light: 'watch' })
    expect(markOf([], co({ profit_after_tax_lkr: 5, profit_after_tax_prior_lkr: 3 }), 'profit_after_tax_lkr')).toMatchObject({ light: 'good' })
    expect(markOf([], co({ loss_years_in_history: 0, history_years: 10 }), 'loss_years_in_history')).toMatchObject({ light: 'good' })
    expect(markOf([], co({ loss_years_in_history: 2, history_years: 10 }), 'loss_years_in_history')).toMatchObject({ light: 'watch' })
    expect(markOf([], co({ loss_years_in_history: 3, history_years: 10 }), 'loss_years_in_history')).toMatchObject({ light: 'weak' })
    expect(markOf([], co({ loss_years_in_history: 0, history_years: 4 }), 'loss_years_in_history')).toMatchObject({ light: 'none' })
  })

  test('debt lines, and negative equity', () => {
    expect(markOf([], co({ debt_to_equity_pct: 40 }), 'debt_to_equity_pct')).toMatchObject({ light: 'good' })
    expect(markOf([], co({ debt_to_equity_pct: 80 }), 'debt_to_equity_pct')).toMatchObject({ light: 'watch' })
    expect(markOf([], co({ debt_to_equity_pct: 120 }), 'debt_to_equity_pct')).toMatchObject({ light: 'weak' })
    expect(markOf([], co({ total_equity_lkr: -1, debt_to_equity_pct: null }), 'debt_to_equity_pct')).toMatchObject({ light: 'weak' })
    expect(markOf([], co({ interest_cover: 1.2 }), 'interest_cover')).toMatchObject({ light: 'weak' })
    expect(markOf([], co({ interest_cover: 2 }), 'interest_cover')).toMatchObject({ light: 'watch' })
    expect(markOf([], co({ interest_cover: 4 }), 'interest_cover')).toMatchObject({ light: 'good' })
    expect(markOf([], co({ interest_cover: null, borrowings_lkr: 10, operating_margin_pct: -2 }), 'interest_cover')).toMatchObject({ light: 'weak' })
    expect(markOf([], co({ current_ratio: 0.8, operating_cash_flow_lkr: -1 }), 'current_ratio')).toMatchObject({ light: 'weak' })
    expect(markOf([], co({ current_ratio: 0.8, operating_cash_flow_lkr: 1 }), 'current_ratio')).toMatchObject({ light: 'watch' })
  })

  test('growth is judged after inflation, and not when the years are not comparable', () => {
    expect(markOf([], co({ revenue_growth_real_pct: 6 }), 'revenue_growth_real_pct')).toMatchObject({ light: 'good' })
    expect(markOf([], co({ revenue_growth_real_pct: -6 }), 'revenue_growth_real_pct')).toMatchObject({ light: 'weak' })
    expect(markOf([], co({ revenue_growth_real_pct: 1 }), 'revenue_growth_real_pct')).toMatchObject({ light: 'watch' })
    expect(markOf([], co({ revenue_growth_real_pct: 80, revenue_growth_note: 'imports reopened' }), 'revenue_growth_real_pct')).toMatchObject({ light: 'none' })
    // a lender's gross income is not judged as growth
    expect(markOf([], co({ industry_kind: 'bank', revenue_growth_real_pct: 30 }), 'revenue_growth_real_pct')).toBeUndefined()
  })

  test('capital against the regulatory minimum, with the surcharge for a systemically important bank', () => {
    const bank = (o: Row) => co({ industry_kind: 'bank', ...o })
    expect(markOf([], bank({ total_capital_ratio_pct: 12 }), 'total_capital_ratio_pct')).toMatchObject({ light: 'weak', basis: 'regulatory' })
    expect(markOf([], bank({ total_capital_ratio_pct: 13.5 }), 'total_capital_ratio_pct')).toMatchObject({ light: 'watch' })
    expect(markOf([], bank({ total_capital_ratio_pct: 15 }), 'total_capital_ratio_pct')).toMatchObject({ light: 'good' })
    // the same 15% is within 2 points of Commercial Bank's 14% minimum
    expect(markOf([], bank({ cse_symbol: 'COMB.N0000', total_capital_ratio_pct: 15 }), 'total_capital_ratio_pct')).toMatchObject({ light: 'watch' })
    const fin = (o: Row) => co({ industry_kind: 'finance_company', ...o })
    expect(markOf([], fin({ total_assets_lkr: 50e9, total_capital_ratio_pct: 11.86 }), 'total_capital_ratio_pct')?.why).toContain('below the 12.5% minimum')
    expect(markOf([], fin({ total_assets_lkr: 500e9, total_capital_ratio_pct: 13 }), 'total_capital_ratio_pct')).toMatchObject({ light: 'weak' })
    // Tier 1 above total is legitimate when Tier 2 after deductions is negative
    expect(markOf([], fin({ total_assets_lkr: 500e9, tier_1_capital_ratio_pct: 36, total_capital_ratio_pct: 34 }), 'tier_1_capital_ratio_pct')).toMatchObject({ light: 'good' })
    expect(markOf([], co({ industry_kind: 'insurer', insurance_capital_adequacy_pct: 110 }), 'insurance_capital_adequacy_pct')).toMatchObject({ light: 'weak' })
    expect(markOf([], co({ industry_kind: 'insurer', insurance_capital_adequacy_pct: 150 }), 'insurance_capital_adequacy_pct')).toMatchObject({ light: 'watch' })
  })

  test('share valuation and payout choices are never marked', () => {
    for (const field of ['pe_ratio', 'dividend_yield_pct']) expect(markOf(makers, co({ [field]: 5 }), field)).toMatchObject({ light: 'none' })
    expect(markOf([], co({ dividend_payout_pct: 40 }), 'dividend_payout_pct')).toMatchObject({ light: 'none' })
    expect(markOf([], co({ dividend_payout_pct: 140 }), 'dividend_payout_pct')).toMatchObject({ light: 'watch' })
  })

  test('the trend works each ratio out from both years, and ignores small moves', () => {
    const pair = (current: number, prior: number): Pair => ({ current, prior, currentEnd: '2026-03-31', priorEnd: '2025-03-31', source: null })
    const pairs = new Map<string, Pair>([['profit_after_tax', pair(12, 10)], ['revenue', pair(100, 100)], ['total_equity', pair(100, 100)],
      ['borrowings_current', pair(30, 20)], ['lease_liabilities', pair(10, 10)]])
    const r = ratioPairs(pairs)
    expect(r.get('net_profit_margin_pct')).toEqual({ current: 12, prior: 10 })
    expect(r.get('debt_to_equity_pct')).toEqual({ current: 40, prior: 30 })
    expect(trendOf('net_profit_margin_pct', r.get('net_profit_margin_pct'), 'higher')).toBe('improved')
    expect(trendOf('debt_to_equity_pct', r.get('debt_to_equity_pct'), 'lower')).toBe('worsened')
    expect(trendOf('return_on_equity_pct', { current: 10.5, prior: 10 }, 'higher')).toBe('flat')
    expect(trendOf('return_on_equity_pct', { current: 10, prior: null }, 'higher')).toBeNull()
  })
})
