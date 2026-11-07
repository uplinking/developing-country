import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { moneyTotals } from '../packages/datasets/src/money'

const ledger = JSON.parse(readFileSync('public/data/lk-initiatives.json', 'utf8'))
const totals = JSON.parse(readFileSync('public/data/lk-initiative-funding.json', 'utf8'))
const events = JSON.parse(readFileSync('public/data/lk-initiative-events.json', 'utf8'))
const lines = new Map<string, any>(ledger.lines.map((l: any) => [l.id, l]))

describe('money ledger', () => {
  test('published files match a fresh build', () => {
    const r = spawnSync('bun', ['scripts/initiatives/build.ts', '--check'], { encoding: 'utf8' })
    expect(r.stderr).toBe('')
    expect(r.status).toBe(0)
  })

  test('every event has a source, a known line and a known initiative', () => {
    const projects = new Set(ledger.projects.map((p: any) => p.id))
    for (const e of ledger.events) {
      expect(e.sources.length).toBeGreaterThan(0)
      expect(lines.has(e.line_id)).toBe(true)
      expect(projects.has(lines.get(e.line_id).project_id)).toBe(true)
    }
    expect(events.rows.length).toBe(ledger.events.length)
  })

  test('the totals table is the shared counting function, not a sum of rows', () => {
    const adb2026 = ledger.events.filter((e: any) => e.date.startsWith('2026') && lines.get(e.line_id).funder === 'adb')
    const expected = moneyTotals(adb2026).totals.approved.USD!
    const row = totals.rows.find((r: any) => r.id === '2026:funder:adb:approved:USD')
    expect(row.amount).toBe(expected.amount)
    const naive = adb2026.filter((e: any) => ['funder_approved', 'govt_authorised', 'allocated'].includes(e.stage) && e.currency === 'USD')
      .reduce((s: number, e: any) => s + e.amount, 0)
    // Lender approval + Cabinet clearance of the same loans must not double the figure.
    expect(row.amount).toBeLessThan(naive)
  })

  test('one ADB recovery package: two loans, approved and cleared, reported once each', () => {
    const recovery = ledger.events.filter((e: any) => lines.get(e.line_id).project_id === 'inclusive-recovery-program')
    expect(ledger.projects.some((p: any) => p.id === 'adb-inclusive-recovery-sdp')).toBe(false)
    const approved = recovery.filter((e: any) => e.stage === 'funder_approved' && e.date === '2026-10-21')
    expect(approved.map((e: any) => e.amount)).toEqual([50_000_000, 50_000_000])
    expect(approved.every((e: any) => e.reports.length >= 2)).toBe(true)
  })

  test('IMF approvals and payments are counted only in SDR, never again in USD equivalents', () => {
    // News reports IMF tranches in USD; those attach to the official SDR records instead of counting.
    const counted = ledger.events.filter((e: any) => lines.get(e.line_id).funder === 'imf' && e.amount != null
      && ['funder_approved', 'disbursed', 'released'].includes(e.stage))
    expect(counted.length).toBeGreaterThan(0)
    for (const e of counted) expect(e.currency).toBe('SDR')
    expect(totals.rows.some((r: any) => r.period === 'all' && r.group === 'imf' && r.bucket !== 'announced' && r.currency !== 'SDR')).toBe(false)
    const paid = totals.rows.find((r: any) => r.id === 'all:funder:imf:paid:SDR')
    expect(paid.amount).toBe(1_928_500_000)
  })

  test('amount is never an additive measure in the published tables', () => {
    for (const t of [events, totals]) {
      const amount = t.fields.find((f: any) => f.id === 'amount')
      expect(amount.role).toBe('dimension')
    }
  })
})
