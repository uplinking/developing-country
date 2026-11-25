/**
 * The second row of the Enterprises dashboard: how the figures are spread across whatever companies the
 * filters leave, not just their totals. Size and concentration, the profit pool, return on equity,
 * growth after inflation and debt at risk; for a view of lenders only, capital headroom and bad loans in
 * place of the last two.
 *
 * Sums use the same additive rows as summarize() (a subsidiary is counted once, inside its group when
 * its group is in view); counts and spreads use every row, so a listed subsidiary is never hidden.
 * Pure functions over lk-companies rows.
 */
import { capitalMinimum, quantile } from './companyLights'

type Row = Record<string, unknown> & { company_id: string; name: string; group_id: string; is_group_head: boolean }
const num = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) ? v : null
const LENDERS = new Set(['bank', 'finance_company'])
const isLender = (r: Row) => LENDERS.has(String(r.industry_kind ?? ''))
const isFinancial = (r: Row) => isLender(r) || r.industry_kind === 'insurer'

/** Rows whose amounts can be added: a group head, or a company whose group head is not in view. */
export function additive<T extends Row>(rows: T[]): T[] {
  const heads = new Set(rows.filter(r => r.is_group_head).map(r => r.company_id))
  return rows.filter(r => r.is_group_head || !heads.has(r.group_id))
}

/** How to draw a spread of n values: bars when there are many, a dot per company, a list, or nothing. */
export type Form = 'bins' | 'dots' | 'list' | 'none'
export const formFor = (n: number): Form => n >= 30 ? 'bins' : n >= 8 ? 'dots' : n >= 3 ? 'list' : 'none'

export interface Point { id: string; name: string; value: number }
export interface Bin { label: string; min: number | null; max: number | null; n: number }
export interface Spread { field: string; base: number; n: number; form: Form; p25: number | null; median: number | null; p75: number | null; bins: Bin[]; points: Point[] }

function bin(values: number[], edges: Array<[string, number | null, number | null]>): Bin[] {
  return edges.map(([label, min, max]) => ({ label, min, max, n: values.filter(v => (min === null || v >= min) && (max === null || v < max)).length }))
}

export function spread(rows: Row[], field: string, edges: Array<[string, number | null, number | null]>, base = rows.length): Spread {
  const points = rows.flatMap(r => { const v = num(r[field]); return v === null ? [] : [{ id: r.company_id, name: r.name, value: v }] })
    .sort((a, b) => b.value - a.value)
  const sorted = points.map(p => p.value).sort((a, b) => a - b)
  const q = (x: number) => sorted.length ? quantile(sorted, x) : null
  return { field, base, n: points.length, form: formFor(points.length), p25: q(0.25), median: q(0.5), p75: q(0.75), bins: bin(sorted, edges), points }
}

export const ROE_BINS: Array<[string, number | null, number | null]> = [['Negative', null, 0], ['0–5%', 0, 5], ['5–10%', 5, 10], ['10–15%', 10, 15], ['15–20%', 15, 20], ['20% or more', 20, null]]
export const GROWTH_BINS: Array<[string, number | null, number | null]> = [['Fell more than 10%', null, -10], ['Fell up to 10%', -10, 0], ['Grew up to 10%', 0, 10], ['Grew 10–25%', 10, 25], ['Grew more than 25%', 25, null]]
export const STAGE3_BINS: Array<[string, number | null, number | null]> = [['Under 2%', null, 2], ['2–5%', 2, 5], ['5–10%', 5, 10], ['10% or more', 10, null]]
export const HEADROOM_BINS: Array<[string, number | null, number | null]> = [['Below the minimum', null, 0], ['Within 2 points', 0, 2], ['2–5 points', 2, 5], ['More than 5 points', 5, null]]

/* ---------------- 1. where the revenue (or, for lenders, the assets) sits ---------------- */

export interface Band { label: string; n: number; companiesPct: number; value: number; valuePct: number }
export interface SizeView {
  measure: 'revenue' | 'assets'; base: number; n: number; total: number
  bands: Band[]
  /** the k largest and their share of the total; k shrinks with the number reporting, null under six */
  top: { k: number; pct: number } | null
  /** companies per half-decade of the measure, for the distribution view (log scale) */
  hist: Array<{ lo: number; hi: number; n: number }>
  largest: Point[]
}
const REV_BANDS: Array<[string, number, number | null]> = [['Under LKR 1bn', 0, 1e9], ['LKR 1–10bn', 1e9, 10e9], ['LKR 10–50bn', 10e9, 50e9], ['LKR 50–100bn', 50e9, 100e9], ['LKR 100bn or more', 100e9, null]]
const ASSET_BANDS: Array<[string, number, number | null]> = [['Under LKR 10bn', 0, 10e9], ['LKR 10–100bn', 10e9, 100e9], ['LKR 100bn–1tn', 100e9, 1e12], ['LKR 1tn or more', 1e12, null]]

/** A view is of lenders when every company in it that publishes accounts is a bank or finance company. */
export function lendersOnly(rows: Row[]): boolean {
  const withAccounts = rows.filter(r => num(r.profit_after_tax_lkr) !== null)
  return withAccounts.length > 0 && withAccounts.every(isLender)
}

export function sizeView(rows: Row[]): SizeView {
  const assets = lendersOnly(rows)
  const field = assets ? 'total_assets_lkr' : 'revenue_lkr'
  const pts = additive(rows).flatMap(r => {
    const v = num(r[field])
    return v === null || v <= 0 || (!assets && r.revenue_comparable === false) ? [] : [{ id: r.company_id, name: r.name, value: v }]
  }).sort((a, b) => b.value - a.value)
  const total = pts.reduce((s, p) => s + p.value, 0)
  const bands = (assets ? ASSET_BANDS : REV_BANDS).map(([label, lo, hi]) => {
    const inBand = pts.filter(p => p.value >= lo && (hi === null || p.value < hi))
    const value = inBand.reduce((s, p) => s + p.value, 0)
    return { label, n: inBand.length, companiesPct: pts.length ? inBand.length / pts.length * 100 : 0, value, valuePct: total ? value / total * 100 : 0 }
  })
  const n = pts.length
  const k = n >= 40 ? 10 : n >= 15 ? 5 : n >= 6 ? 3 : 0
  const top = k ? { k, pct: pts.slice(0, k).reduce((s, p) => s + p.value, 0) / total * 100 } : null
  const logs = pts.map(p => Math.log10(p.value))
  const hist: SizeView['hist'] = []
  if (logs.length) {
    for (let lo = Math.floor(Math.min(...logs) * 2) / 2; lo <= Math.max(...logs); lo += 0.5) {
      hist.push({ lo: 10 ** lo, hi: 10 ** (lo + 0.5), n: logs.filter(x => x >= lo && x < lo + 0.5).length })
    }
  }
  return { measure: assets ? 'assets' : 'revenue', base: rows.length, n, total, bands, top, hist, largest: pts.slice(0, 5) }
}

/* ---------------- 2. the profit pool ---------------- */

export interface ProfitPool {
  base: number; n: number; profitable: number; lossMaking: number
  profitsLkr: number; lossesLkr: number
  /** the five largest earners' share of the profits, from five additive earners up */
  top5Pct: number | null
  /** the largest losses, by every row, so a subsidiary's loss inside a profitable group still shows */
  biggestLosses: Point[]
}
export function profitPool(rows: Row[]): ProfitPool {
  const all = rows.flatMap(r => { const v = num(r.profit_after_tax_lkr); return v === null ? [] : [{ id: r.company_id, name: r.name, value: v }] })
  const add = new Set(additive(rows).map(r => r.company_id))
  const summed = all.filter(p => add.has(p.id))
  const gains = summed.filter(p => p.value > 0).sort((a, b) => b.value - a.value)
  const profitsLkr = gains.reduce((s, p) => s + p.value, 0)
  return {
    base: rows.length, n: all.length,
    profitable: all.filter(p => p.value >= 0).length, lossMaking: all.filter(p => p.value < 0).length,
    profitsLkr, lossesLkr: summed.filter(p => p.value < 0).reduce((s, p) => s + p.value, 0),
    top5Pct: gains.length >= 5 && profitsLkr > 0 ? gains.slice(0, 5).reduce((s, p) => s + p.value, 0) / profitsLkr * 100 : null,
    biggestLosses: all.filter(p => p.value < 0).sort((a, b) => a.value - b.value).slice(0, 3),
  }
}

/* ---------------- 3 and 4. return on equity, growth after inflation ---------------- */

export const roeSpread = (rows: Row[]) => spread(rows.filter(r => !(num(r.total_equity_lkr) !== null && (r.total_equity_lkr as number) < 0)), 'return_on_equity_pct', ROE_BINS, rows.length)

/** Growth after inflation for companies whose revenue is sales: a lender's gross income moves with rates. */
export function growthSpread(rows: Row[], fiveYear = false): Spread {
  const eligible = rows.filter(r => !isLender(r) && r.revenue_comparable !== false && !r.revenue_growth_note)
  return spread(eligible, fiveYear ? 'revenue_cagr_5y_real_pct' : 'revenue_growth_real_pct', GROWTH_BINS, rows.filter(r => !isLender(r)).length)
}

/* ---------------- 5. debt at risk ---------------- */

export interface CoverBand { label: string; n: number; borrowingsLkr: number; borrowingsPct: number }
export interface DebtAtRisk { base: number; n: number; borrowingsLkr: number; median: number | null; bands: CoverBand[]; atRisk: Point[] }
const COVER_BANDS: Array<[string, number | null, number | null]> = [['Under 1×', null, 1], ['1–1.5×', 1, 1.5], ['1.5–3.5×', 1.5, 3.5], ['3.5× or more', 3.5, null]]

/**
 * Borrowing grouped by how many times operating profit covers interest. A company with an operating
 * loss, borrowings and no cover figure counts in the lowest band.
 */
export function debtAtRisk(rows: Row[]): DebtAtRisk {
  const nf = rows.filter(r => !isFinancial(r))
  const cover = (r: Row): number | null => {
    const c = num(r.interest_cover)
    if (c !== null) return c
    const debt = num(r.borrowings_lkr), op = num(r.operating_margin_pct)
    return debt !== null && debt > 0 && op !== null && op < 0 ? -1 : null
  }
  const counted = nf.filter(r => cover(r) !== null)
  const add = new Set(additive(rows).map(r => r.company_id))
  const debtOf = (r: Row) => add.has(r.company_id) ? Math.max(0, num(r.borrowings_lkr) ?? 0) : 0
  const totalDebt = counted.reduce((s, r) => s + debtOf(r), 0)
  const bands = COVER_BANDS.map(([label, lo, hi]) => {
    const inBand = counted.filter(r => { const c = cover(r) as number; return (lo === null || c >= lo) && (hi === null || c < hi) })
    const b = inBand.reduce((s, r) => s + debtOf(r), 0)
    return { label, n: inBand.length, borrowingsLkr: b, borrowingsPct: totalDebt ? b / totalDebt * 100 : 0 }
  })
  const covers = counted.map(r => num(r.interest_cover)).filter((x): x is number => x !== null).sort((a, b) => a - b)
  const atRisk = counted.filter(r => (cover(r) as number) < 1.5).map(r => ({ id: r.company_id, name: r.name, value: num(r.borrowings_lkr) ?? 0 })).sort((a, b) => b.value - a.value)
  return { base: nf.length, n: counted.length, borrowingsLkr: totalDebt, median: covers.length ? quantile(covers, 0.5) : null, bands, atRisk }
}

/* ---------------- lenders only: capital headroom and bad loans ---------------- */

/** Points above (or below) the regulatory total capital minimum that applies to each lender. */
export function capitalHeadroom(rows: Row[]): Spread {
  const lenders = rows.filter(isLender)
  const withRoom = lenders.flatMap(r => {
    const v = num(r.total_capital_ratio_pct), m = capitalMinimum(r, 'total')
    if (v === null || !m) return []
    return [{ ...r, capital_headroom_pts: v - m.min }]
  })
  return spread(withRoom as Row[], 'capital_headroom_pts', HEADROOM_BINS, lenders.length)
}

export const stage3Spread = (rows: Row[]) => spread(rows.filter(isLender), 'npl_ratio_pct', STAGE3_BINS, rows.filter(isLender).length)
