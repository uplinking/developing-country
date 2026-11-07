import { describe, expect, test } from 'bun:test'
import { moneyTotals, type CountableEvent } from './money'

const ev = (o: Partial<CountableEvent> & Pick<CountableEvent, 'id'>): CountableEvent =>
  ({ line_id: 'l1', date: '2026-10-01', stage: 'funder_approved', amount: 100, currency: 'USD', basis: 'total', ...o })

describe('moneyTotals', () => {
  test('lender approval then Cabinet clearance of the same money is one approved amount', () => {
    const r = moneyTotals([ev({ id: 'a' }), ev({ id: 'b', stage: 'govt_authorised', date: '2026-10-12' })])
    expect(r.totals.approved.USD).toEqual({ amount: 100, ids: ['b'] })
  })

  test('two lines approved the same day both count (ADB 50m + 50m)', () => {
    const r = moneyTotals([ev({ id: 'p', line_id: 'policy', amount: 50 }), ev({ id: 'q', line_id: 'project', amount: 50 })])
    expect(r.totals.approved.USD.amount).toBe(100)
  })

  test('stages and currencies are never added together', () => {
    const r = moneyTotals([
      ev({ id: 'a' }),
      ev({ id: 'b', stage: 'agreement_signed' }),
      ev({ id: 'c', line_id: 'l2', currency: 'SDR', amount: 254 }),
    ])
    expect(r.totals.approved).toEqual({ USD: { amount: 100, ids: ['a'] }, SDR: { amount: 254, ids: ['c'] } })
    expect(r.totals.contracted.USD.amount).toBe(100)
  })

  test('a revised cost estimate replaces the earlier one', () => {
    const r = moneyTotals([
      ev({ id: 'old', stage: 'cost_estimate', currency: 'LKR', amount: 100e6 }),
      ev({ id: 'new', stage: 'cost_estimate', currency: 'LKR', amount: 120e6, date: '2026-11-01' }),
    ])
    expect(r.totals.announced.LKR).toEqual({ amount: 120e6, ids: ['new'] })
  })

  test('tranches add up and cumulative positions never add to them', () => {
    const r = moneyTotals([
      ev({ id: 't1', stage: 'disbursed', basis: 'tranche', currency: 'SDR', amount: 254 }),
      ev({ id: 't2', stage: 'disbursed', basis: 'tranche', currency: 'SDR', amount: 254, date: '2026-12-01' }),
      ev({ id: 'cum', stage: 'disbursed', basis: 'cumulative', currency: 'SDR', amount: 508, date: '2026-12-01' }),
    ])
    expect(r.totals.paid.SDR).toEqual({ amount: 508, ids: ['t1', 't2'] })
  })

  test('successive cumulative positions use the latest, not the sum', () => {
    const r = moneyTotals([
      ev({ id: 'c30', stage: 'spent', basis: 'cumulative', currency: 'LKR', amount: 30 }),
      ev({ id: 'c45', stage: 'spent', basis: 'cumulative', currency: 'LKR', amount: 45, date: '2026-12-01' }),
    ])
    expect(r.totals.paid.LKR.amount).toBe(45)
  })

  test('missing amounts are listed, never zero; delivery stages and retractions are ignored', () => {
    const r = moneyTotals([
      ev({ id: 'm', amount: null, currency: null }),
      ev({ id: 'launch', stage: 'launched', amount: null, currency: null }),
      ev({ id: 'gone', line_id: 'l9', evidence: 'retracted' }),
    ])
    expect(r.missing.approved).toEqual(['m'])
    expect(r.totals.approved).toEqual({})
  })

  test('a per-unit rate is never a total: listed as missing, not added', () => {
    const r = moneyTotals([
      ev({ id: 'meal', stage: 'govt_authorised', amount: 110, currency: 'LKR', basis: 'rate' }),
      ev({ id: 'pay', line_id: 'l2', stage: 'disbursed', amount: 6000, currency: 'LKR', basis: 'rate' }),
    ])
    expect(r.totals.approved).toEqual({})
    expect(r.totals.paid).toEqual({})
    expect(r.missing.approved).toEqual(['meal'])
    expect(r.missing.paid).toEqual(['pay'])
  })

  test('a disputed amount is kept on the record but never added', () => {
    const r = moneyTotals([
      ev({ id: 'typo', stage: 'pledged', amount: 85_000_000_000, currency: 'USD', evidence: 'disputed' }),
      ev({ id: 'real', line_id: 'l2', stage: 'pledged', amount: 5_000_000, currency: 'USD' }),
    ])
    expect(r.totals.announced.USD).toEqual({ amount: 5_000_000, ids: ['real'] })
    expect(r.missing.announced).toEqual(['typo'])
  })
})
