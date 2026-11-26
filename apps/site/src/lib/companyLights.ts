/**
 * How each of a company's figures compares: a fixed rule per figure that marks it good, watch or weak,
 * or leaves it unmarked (typical, or not judged), always with the reason in words.
 *
 * Three kinds of rule, and only the first two can mark a figure weak:
 *  - a line that means the same for every company (a loss, interest cover under 1.5 times, debt larger
 *    than equity);
 *  - a regulator's minimum (CBSL capital ratios for banks and finance companies, IRCSL for insurers);
 *  - listed peers of the same kind: the best quarter is good, the weakest quarter is watch, never weak.
 * Valuation (price to earnings, price to book, dividend yield) is never marked. A trend against the
 * year before is reported beside the mark, never folded into it.
 *
 * Pure functions over the published rows of lk-companies and lk-company-financials.
 */
import type { Pair } from './companyFigures'

export type Light = 'good' | 'watch' | 'weak' | 'typical' | 'none'
export type Better = 'higher' | 'lower'
export interface PeerView { label: string; n: number; p25: number; median: number; p75: number; rank: number; values: number[]; fallback: boolean }
export interface Judgement {
  light: Light
  /** what the mark rests on */
  basis: 'line' | 'regulatory' | 'peers' | 'none'
  why: string
  peers: PeerView | null
  trend: 'improved' | 'worsened' | 'flat' | null
}
type Row = Record<string, unknown>

export const LIGHT_LABEL: Record<Light, string> = { good: 'Good', watch: 'Watch', weak: 'Weak', typical: 'Typical', none: 'Not judged' }
/** Fewest peers reporting a figure before a company is ranked among them. */
export const MIN_PEERS = 10
const LENDER_KINDS = new Set(['bank', 'finance_company', 'insurer'])
const KIND_PLURAL: Record<string, string> = { bank: 'banks', finance_company: 'finance companies', insurer: 'insurers' }

const num = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) ? v : null
const kindOf = (r: Row) => String(r.industry_kind ?? 'other')
const isNonFinancial = (r: Row) => !LENDER_KINDS.has(kindOf(r))
const pct = (v: number, d = 1) => `${v.toFixed(d)}%`
const times = (v: number) => v >= 100 ? 'over 100×' : `${v.toFixed(1)}×`

/* ---------------- capital minimums ---------------- */

/**
 * Regulatory capital minimums, in percent of risk-weighted assets, checked against the directions and
 * the companies' own reports in November 2026.
 * Banks: CBSL Banking Act Directions No. 11 of 2019 (Tier 1 8.5%, total 12.5%, buffer included; no
 * asset-size split any more). Systemically important banks add a surcharge (Banking Act Directions No. 2
 * of 2025, buckets of 1.0, 1.5 and 2.0 points); the three listed ones are keyed by CSE symbol, each as
 * its own 2025 annual report states it. Other listed banks state no surcharge.
 * Finance companies: Finance Business Act Directions No. 3 of 2018, by asset size (LKR 100bn).
 * Insurers: IRCSL risk-based capital rules, minimum capital adequacy ratio 120%.
 */
export const CAPITAL = {
  bank: { tier1: 8.5, total: 12.5, watchWithin: 2, dsib: { 'COMB.N0000': 1.5, 'HNB.N0000': 1.0, 'SAMP.N0000': 1.0 } as Record<string, number> },
  finance_company: { bigAssetsLkr: 100e9, small: { tier1: 8.5, total: 12.5 }, big: { tier1: 10, total: 14 }, watchWithin: 2 },
  insurer: { weak: 120, watch: 160 },
  source: {
    bank: 'CBSL Banking Act Directions No. 11 of 2019',
    dsib: 'CBSL Banking Act Directions No. 2 of 2025',
    finance_company: 'CBSL Finance Business Act Directions No. 3 of 2018',
    insurer: 'IRCSL risk-based capital rules',
  },
}

export function capitalMinimum(r: Row, which: 'tier1' | 'total'): { min: number; src: string } | null {
  const kind = kindOf(r)
  if (kind === 'bank') {
    const extra = CAPITAL.bank.dsib[String(r.cse_symbol ?? '')] ?? 0
    return { min: CAPITAL.bank[which] + extra, src: extra ? `${CAPITAL.bank[which]}% plus ${extra.toFixed(1)} as a systemically important bank` : 'CBSL minimum for banks' }
  }
  if (kind === 'finance_company') {
    const assets = num(r.total_assets_lkr)
    if (assets === null) return null
    const band = assets >= CAPITAL.finance_company.bigAssetsLkr ? CAPITAL.finance_company.big : CAPITAL.finance_company.small
    return { min: band[which], src: `CBSL minimum for finance companies with assets ${band === CAPITAL.finance_company.big ? 'of LKR 100bn or more' : 'under LKR 100bn'}` }
  }
  return null
}

/* ---------------- peers ---------------- */

/**
 * The listed companies a company is ranked among for one figure: banks with banks, finance companies
 * with finance companies, insurers with insurers, everyone else with its broad sector. When fewer than
 * MIN_PEERS of those report the figure, a non-financial company is ranked among all listed non-financial
 * companies instead; a bank, finance company or insurer is not ranked.
 */
export function peerView(all: Row[], r: Row, field: string, better: Better, families: Record<string, string> = {}): PeerView | null {
  const v = num(r[field])
  if (v === null) return null
  const kind = kindOf(r)
  const listed = all.filter(x => x.listed === true && num(x[field]) !== null)
  let label: string, set: Row[], fallback = false
  if (LENDER_KINDS.has(kind)) {
    set = listed.filter(x => kindOf(x) === kind)
    label = `listed ${KIND_PLURAL[kind]}`
  } else {
    set = listed.filter(x => isNonFinancial(x) && x.sector_family === r.sector_family)
    const fam = families[String(r.sector_family)]
    label = fam ? `listed ${fam.toLowerCase()} companies` : 'listed companies in the same sector'
    if (set.length < MIN_PEERS) { set = listed.filter(isNonFinancial); label = 'listed companies outside finance'; fallback = true }
  }
  if (!set.some(x => x.company_id === r.company_id)) set = [...set, r]
  const values = set.map(x => num(x[field]) as number).sort((a, b) => a - b)
  if (values.length < 5) return null
  const rank = 1 + values.filter(x => better === 'higher' ? x > v : x < v).length
  return { label, n: values.length, p25: quantile(values, 0.25), median: quantile(values, 0.5), p75: quantile(values, 0.75), rank, values, fallback }
}

/** Linear-interpolated quantile of sorted values. */
export function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN
  const i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i)
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (i - lo)
}

function byPeers(v: number, p: PeerView | null, better: Better): Pick<Judgement, 'light' | 'basis' | 'why'> {
  if (!p || p.n < MIN_PEERS) return { light: 'none', basis: 'none', why: `fewer than ${MIN_PEERS} similar listed companies report it` }
  if (p.p75 - p.p25 < Math.max(0.3, Math.abs(p.median) * 0.05)) return { light: 'none', basis: 'none', why: `${p.label} are too close together to rank` }
  const top = better === 'higher' ? v >= p.p75 : v <= p.p25
  const bottom = better === 'higher' ? v <= p.p25 : v >= p.p75
  const where = `${p.n} ${p.label}`
  if (top) return { light: 'good', basis: 'peers', why: `best quarter of ${where}` }
  if (bottom) return { light: 'watch', basis: 'peers', why: `weakest quarter of ${where}` }
  return { light: 'typical', basis: 'peers', why: `middle half of ${where}` }
}

/* ---------------- trend against the year before ---------------- */

/** This year's and last year's value of each judged ratio, worked out from the two years of statements. */
export function ratioPairs(pairs: Map<string, Pair>): Map<string, { current: number | null; prior: number | null }> {
  const get = (m: string, y: 'current' | 'prior') => pairs.get(m)?.[y] ?? null
  const div = (a: number | null, b: number | null, k = 100) => a === null || b === null || b === 0 ? null : a / b * k
  const debt = (y: 'current' | 'prior') => {
    const parts = ['borrowings_current', 'borrowings_non_current', 'lease_liabilities'].map(m => get(m, y))
    return parts.every(x => x === null) ? null : parts.reduce<number>((s, x) => s + (x ?? 0), 0)
  }
  const out = new Map<string, { current: number | null; prior: number | null }>()
  const put = (field: string, f: (y: 'current' | 'prior') => number | null) => out.set(field, { current: f('current'), prior: f('prior') })
  put('profit_after_tax_lkr', y => get('profit_after_tax', y))
  put('net_profit_margin_pct', y => div(get('profit_after_tax', y), get('revenue', y)))
  put('operating_margin_pct', y => div(get('operating_profit', y), get('revenue', y)))
  put('return_on_equity_pct', y => { const e = get('total_equity', y); return e !== null && e > 0 ? div(get('profit_after_tax', y), e) : null })
  put('return_on_assets_pct', y => div(get('profit_after_tax', y), get('total_assets', y)))
  put('debt_to_equity_pct', y => { const e = get('total_equity', y); return e !== null && e > 0 ? div(debt(y), e) : null })
  put('interest_cover', y => { const c = get('finance_costs', y); return c ? div(get('operating_profit', y), Math.abs(c), 1) : null })
  put('current_ratio', y => div(get('current_assets', y), get('current_liabilities', y), 1))
  put('total_capital_ratio_pct', y => get('total_capital_ratio_pct', y))
  put('tier_1_capital_ratio_pct', y => get('tier_1_capital_ratio_pct', y))
  put('npl_ratio_pct', y => get('stage_3_or_npl_ratio_pct', y))
  put('cost_to_income_pct', y => get('cost_to_income_ratio_pct', y))
  return out
}

/** How much a figure must move before it counts as a change, by figure: points, or a share of last year. */
const DEAD_BAND: Record<string, { points?: number; share?: number }> = {
  profit_after_tax_lkr: { share: 0.05 }, net_profit_margin_pct: { points: 1 }, operating_margin_pct: { points: 1 },
  return_on_equity_pct: { points: 1 }, return_on_assets_pct: { points: 0.5 }, debt_to_equity_pct: { points: 5 },
  interest_cover: { share: 0.15 }, current_ratio: { share: 0.1 }, total_capital_ratio_pct: { points: 0.5 },
  tier_1_capital_ratio_pct: { points: 0.5 }, npl_ratio_pct: { points: 0.5 }, cost_to_income_pct: { points: 1 },
}

export function trendOf(field: string, pair: { current: number | null; prior: number | null } | undefined, better: Better): Judgement['trend'] {
  const band = DEAD_BAND[field]
  if (!band || !pair || pair.current === null || pair.prior === null) return null
  const d = pair.current - pair.prior
  const limit = band.points ?? Math.abs(pair.prior) * (band.share ?? 0)
  if (Math.abs(d) <= limit) return 'flat'
  return (d > 0) === (better === 'higher') ? 'improved' : 'worsened'
}

/* ---------------- the rules ---------------- */

export interface FigureSpec { field: string; label: string; better: Better | null; fmt: (v: number) => string }

const NONE = (why: string): Pick<Judgement, 'light' | 'basis' | 'why'> => ({ light: 'none', basis: 'none', why })
const LINE = (light: Light, why: string): Pick<Judgement, 'light' | 'basis' | 'why'> => ({ light, basis: 'line', why })
const REG = (light: Light, why: string): Pick<Judgement, 'light' | 'basis' | 'why'> => ({ light, basis: 'regulatory', why })

function capitalRule(r: Row, v: number, which: 'tier1' | 'total'): Pick<Judgement, 'light' | 'basis' | 'why'> {
  const m = capitalMinimum(r, which)
  if (!m) return NONE('no capital minimum applies')
  const room = v - m.min
  if (room < 0) return REG('weak', `below the ${pct(m.min)} minimum (${m.src})`)
  const within = kindOf(r) === 'bank' ? CAPITAL.bank.watchWithin : CAPITAL.finance_company.watchWithin
  if (room < within) return REG('watch', `${room.toFixed(1)} points above the ${pct(m.min)} minimum (${m.src})`)
  return REG('good', `${room.toFixed(1)} points above the ${pct(m.min)} minimum (${m.src})`)
}

/**
 * The rule for one figure. Returns null when the figure does not apply to this kind of company or the
 * company does not report it.
 */
function rule(field: string, r: Row, p: PeerView | null, spec: FigureSpec): Pick<Judgement, 'light' | 'basis' | 'why'> | null {
  const v = num(r[field])
  const nf = isNonFinancial(r), kind = kindOf(r)
  const equity = num(r.total_equity_lkr)
  switch (field) {
    case 'profit_after_tax_lkr': {
      if (v === null) return null
      const prior = num(r.profit_after_tax_prior_lkr)
      if (v < 0) return LINE('weak', prior !== null && prior < 0 ? 'a loss, as the year before' : 'a loss')
      if (prior !== null && prior < 0) return LINE('watch', 'a profit after a loss the year before')
      return LINE('good', prior === null ? 'a profit' : 'a profit this year and the year before')
    }
    case 'loss_years_in_history': {
      const years = num(r.history_years)
      if (v === null || years === null) return null
      if (years < 5) return NONE('fewer than five years in the record')
      if (v === 0) return LINE('good', `no loss in ${years} years`)
      const why = `${v} loss ${v === 1 ? 'year' : 'years'} in ${years}`
      return LINE(v / years <= 0.2 ? 'watch' : 'weak', why)
    }
    case 'net_profit_margin_pct': case 'operating_margin_pct': {
      if (v === null || !nf) return null
      if (v < 0) return LINE('weak', 'negative: costs were larger than revenue')
      return byPeers(v, p, 'higher')
    }
    case 'return_on_equity_pct': {
      if (v === null) return null
      if (equity !== null && equity < 0) return NONE('equity is negative, so the ratio means nothing')
      const eqa = num(r.equity_to_assets_pct)
      if (nf && eqa !== null && eqa < 5) return NONE('equity is under 5% of assets, too thin a base')
      if (v < 0) return LINE('weak', 'negative: a loss')
      return byPeers(v, p, 'higher')
    }
    case 'return_on_assets_pct': {
      if (v === null) return null
      if (v < 0) return LINE('weak', 'negative: a loss')
      return byPeers(v, p, 'higher')
    }
    case 'revenue_growth_real_pct': {
      if (v === null || !(nf || kind === 'insurer')) return null
      if (r.revenue_comparable === false || r.revenue_growth_note) return NONE('the two years are not comparable')
      if (v >= 5) return LINE('good', 'grew 5% or more after inflation')
      if (v <= -5) return LINE('weak', 'shrank 5% or more after inflation')
      return LINE('watch', 'within 5% of last year after inflation')
    }
    case 'revenue_cagr_5y_real_pct': {
      if (v === null || !(nf || kind === 'insurer')) return null
      const nominal = num(r.revenue_cagr_5y_pct)
      const rupees = nominal !== null ? `; ${pct(nominal)} a year in rupees` : ''
      if (v >= 5) return LINE('good', `5% a year or more after inflation${rupees}`)
      if (v < 0) return LINE('weak', `smaller than five years ago after inflation${rupees}`)
      return LINE('watch', `under 5% a year after inflation${rupees}`)
    }
    case 'debt_to_equity_pct': {
      if (!nf) return null
      if (equity !== null && equity < 0) return LINE('weak', 'owes more than it owns: equity is negative')
      if (v === null) return null
      if (v <= 40) return LINE('good', 'borrowing is 40% of equity or less')
      if (v <= 100) return LINE('watch', 'borrowing is between 40% and 100% of equity')
      return LINE('weak', 'borrowing is larger than equity')
    }
    case 'interest_cover': {
      if (!nf) return null
      if (v === null) {
        const debt = num(r.borrowings_lkr), op = num(r.operating_margin_pct)
        return debt !== null && debt > 0 && op !== null && op < 0 ? LINE('weak', 'an operating loss while carrying debt') : null
      }
      if (v < 1.5) return LINE('weak', 'operating profit covers interest less than 1.5 times')
      if (v < 3.5) return LINE('watch', 'operating profit covers interest 1.5 to 3.5 times')
      return LINE('good', 'operating profit covers interest 3.5 times or more')
    }
    case 'current_ratio': {
      if (v === null || !nf) return null
      if (v >= 1) return LINE('good', 'short-term assets cover short-term bills')
      const ocf = num(r.operating_cash_flow_lkr)
      if (ocf !== null && ocf < 0) return LINE('weak', 'short-term bills exceed short-term assets, and operations used cash')
      return LINE('watch', 'short-term bills exceed short-term assets')
    }
    case 'cash_conversion_pct': {
      const profit = num(r.profit_after_tax_lkr)
      if (v === null || !nf || profit === null || profit <= 0) return null
      if (v >= 80) return LINE('good', 'cash from operations is at least 80% of profit')
      if (v < 0) return LINE('weak', 'operations used cash despite a profit')
      return LINE('watch', 'cash from operations is under 80% of profit')
    }
    case 'dividend_payout_pct': {
      if (v === null) return null
      const profit = num(r.profit_after_tax_lkr), paid = num(r.dividends_paid_lkr)
      if (profit !== null && profit < 0 && paid !== null && paid > 0) return LINE('watch', 'paid a dividend in a loss year')
      if (v > 100) return LINE('watch', 'paid out more than it earned')
      return NONE('how much to pay out is a choice')
    }
    case 'total_capital_ratio_pct': case 'tier_1_capital_ratio_pct': {
      if (v === null || !(kind === 'bank' || kind === 'finance_company')) return null
      return capitalRule(r, v, field === 'total_capital_ratio_pct' ? 'total' : 'tier1')
    }
    case 'insurance_capital_adequacy_pct': {
      if (v === null || kind !== 'insurer') return null
      if (v < CAPITAL.insurer.weak) return REG('weak', `below the ${CAPITAL.insurer.weak}% minimum (${CAPITAL.source.insurer})`)
      if (v < CAPITAL.insurer.watch) return REG('watch', `under ${CAPITAL.insurer.watch}%, within reach of the ${CAPITAL.insurer.weak}% minimum (${CAPITAL.source.insurer})`)
      return REG('good', `${CAPITAL.insurer.watch}% or more, well above the ${CAPITAL.insurer.weak}% minimum (${CAPITAL.source.insurer})`)
    }
    case 'npl_ratio_pct': {
      if (v === null || !(kind === 'bank' || kind === 'finance_company')) return null
      if (v >= 10) return LINE('weak', 'a tenth or more of loans are in Stage 3')
      return byPeers(v, p, 'lower')
    }
    case 'cost_to_income_pct': {
      if (v === null || !(kind === 'bank' || kind === 'finance_company')) return null
      if (v >= 100) return LINE('weak', 'costs exceed income')
      return byPeers(v, p, 'lower')
    }
    case 'net_interest_margin_pct': case 'loans_to_deposits_pct': case 'loan_growth_pct':
      return v === null ? null : NONE('a wide margin or fast lending can also mean more risk')
    case 'dividend_yield_pct': case 'pe_ratio': case 'pb_ratio':
      return v === null ? null : NONE('share valuation is not judged')
    case 'gross_margin_pct':
      return v === null || !nf ? null : NONE('gross margins differ too much between businesses to judge')
    default:
      return v === null ? null : NONE('no rule for this figure')
  }
}

/** The figures shown, in order, for each kind of company. */
export function figuresFor(r: Row): FigureSpec[] {
  const P = (d = 1) => (v: number) => pct(v, d)
  const kind = kindOf(r)
  const insurer = kind === 'insurer', lender = kind === 'bank' || kind === 'finance_company'
  const S = (field: string, label: string, better: Better | null, fmt: (v: number) => string): FigureSpec => ({ field, label, better, fmt })
  const common = [
    S('profit_after_tax_lkr', 'Profit or loss', 'higher', v => v.toString()),
    S('loss_years_in_history', 'Loss years in the record', 'lower', v => v.toFixed(0)),
  ]
  if (lender) return [...common,
    S('return_on_equity_pct', 'Return on equity', 'higher', P()), S('return_on_assets_pct', 'Return on assets', 'higher', P()),
    S('total_capital_ratio_pct', 'Total capital ratio', 'higher', P()), S('tier_1_capital_ratio_pct', 'Tier 1 capital ratio', 'higher', P()),
    S('npl_ratio_pct', 'Stage 3 (bad) loans', 'lower', P()), S('cost_to_income_pct', 'Cost to income', 'lower', P()),
    S('net_interest_margin_pct', 'Net interest margin', null, P()), S('loans_to_deposits_pct', 'Loans to deposits', null, P()),
    S('loan_growth_pct', 'Loan growth (nominal)', null, P()),
    S('dividend_payout_pct', 'Dividend payout', null, P(0)), S('dividend_yield_pct', 'Dividend yield', null, P()), S('pb_ratio', 'Price to book', null, v => `${v.toFixed(2)}×`),
  ]
  return [...common,
    S('revenue_growth_real_pct', `Growth in ${insurer ? 'premium' : 'revenue'}, after inflation`, 'higher', P()),
    S('revenue_cagr_5y_real_pct', 'Growth a year over five years, after inflation', 'higher', P()),
    ...(insurer ? [] : [S('gross_margin_pct', 'Gross margin', null, P()), S('operating_margin_pct', 'Operating margin', 'higher', P()), S('net_profit_margin_pct', 'Net profit margin', 'higher', P())]),
    S('return_on_equity_pct', 'Return on equity', 'higher', P()), S('return_on_assets_pct', 'Return on assets', 'higher', P()),
    ...(insurer ? [S('insurance_capital_adequacy_pct', 'Capital adequacy ratio', 'higher', P(0))] : [
      S('debt_to_equity_pct', 'Debt to equity', 'lower', P(0)), S('interest_cover', 'Interest cover', 'higher', times),
      S('current_ratio', 'Current ratio', 'higher', v => v.toFixed(2)), S('cash_conversion_pct', 'Cash from operations ÷ profit', 'higher', P(0)),
    ]),
    S('dividend_payout_pct', 'Dividend payout', null, P(0)), S('dividend_yield_pct', 'Dividend yield', null, P()), S('pe_ratio', 'Price to earnings', null, times),
  ]
}

/**
 * Every figure a company reports, with its mark, the reason, its peers and its trend.
 * pairs: the company's two years of statements (companyFigures.statementPairs), for the trend.
 */
export function judge(all: Row[], r: Row, pairs: Map<string, Pair> | null = null, families: Record<string, string> = {}): Array<FigureSpec & Judgement & { value: number | null }> {
  const ratios = pairs ? ratioPairs(pairs) : null
  const out: Array<FigureSpec & Judgement & { value: number | null }> = []
  for (const spec of figuresFor(r)) {
    const peers = spec.field === 'profit_after_tax_lkr' || spec.field === 'loss_years_in_history' ? null
      : peerView(all, r, spec.field, spec.better ?? 'higher', families)
    const j = rule(spec.field, r, peers, spec)
    if (!j) continue
    out.push({ ...spec, ...j, value: num(r[spec.field]), peers, trend: ratios ? trendOf(spec.field, ratios.get(spec.field), spec.better ?? 'higher') : null })
  }
  return out
}
