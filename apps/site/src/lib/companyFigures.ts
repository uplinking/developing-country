/**
 * The arithmetic behind a company's Figures tab: its statements for two years, its multi-year history,
 * and where it sits among listed companies in the same broad sector. Pure functions over the published
 * rows of lk-companies and lk-company-financials, so the dashboard only draws.
 */

/** One row of lk-company-financials. */
export interface FinRow {
  company_id: string
  basis: 'group' | 'company' | string
  year_end: string
  fiscal_year: number | null
  source: 'statements' | 'multi_year_summary' | string
  metric: string
  region: string | null
  value: number | null
  /** History rows only: the value in rupees of the company's latest financial year. */
  value_real?: number | null
  unit: string
  page: number | null
  source_url: string | null
}

export interface Pair { current: number | null; prior: number | null; currentEnd: string | null; priorEnd: string | null; source: string | null }

/** The statements basis to show: the consolidated group figures when the report has them. */
export function basisOf(rows: FinRow[]): 'group' | 'company' | null {
  if (rows.some(r => r.source === 'statements' && r.basis === 'group')) return 'group'
  if (rows.some(r => r.source === 'statements' && r.basis === 'company')) return 'company'
  return null
}

/** Latest and prior year for every statement line of one basis (regions excluded). */
export function statementPairs(rows: FinRow[], basis: string): Map<string, Pair> {
  const lines = rows.filter(r => r.source === 'statements' && r.basis === basis && !r.region && r.value !== null)
  const ends = [...new Set(lines.map(r => r.year_end))].sort().reverse()
  const [cur, prev] = ends
  const out = new Map<string, Pair>()
  for (const r of lines) {
    const p = out.get(r.metric) ?? { current: null, prior: null, currentEnd: cur ?? null, priorEnd: prev ?? null, source: null }
    if (r.year_end === cur) { p.current = r.value; p.source = r.source_url } else if (r.year_end === prev) p.prior = r.value
    out.set(r.metric, p)
  }
  return out
}

export interface Point { year: number; yearEnd: string; value: number }

/**
 * A metric year by year, oldest first: the multi-year summary, with the statements filling the years it
 * lacks (the latest and prior year are always taken from the statements when they have them).
 * real: every year in rupees of the latest financial year. Only the summary carries real values, so the
 * statements then fill in just the latest year, where real and nominal are the same.
 */
export function series(rows: FinRow[], metric: string, basis: string, { real = false } = {}): Point[] {
  const byYear = new Map<number, Point>()
  for (const r of rows) {
    if (r.metric !== metric || r.region || !r.fiscal_year || r.source !== 'multi_year_summary') continue
    const v = real ? r.value_real : r.value
    if (v !== null && v !== undefined && !byYear.has(r.fiscal_year)) byYear.set(r.fiscal_year, { year: r.fiscal_year, yearEnd: r.year_end, value: v })
  }
  const ends = rows.filter(r => r.source === 'statements' && r.basis === basis).map(r => r.year_end).sort()
  const latest = ends[ends.length - 1]
  for (const r of rows) {
    if (r.metric !== metric || r.value === null || r.region || !r.fiscal_year || r.source !== 'statements' || r.basis !== basis) continue
    if (real && r.year_end !== latest) continue
    byYear.set(r.fiscal_year, { year: r.fiscal_year, yearEnd: r.year_end, value: r.value })
  }
  return [...byYear.values()].sort((a, b) => a.year - b.year)
}

/** Revenue by region for the latest year, largest first. */
export function regions(rows: FinRow[], basis: string): Array<{ region: string; value: number }> {
  const rs = rows.filter(r => r.metric === 'revenue_by_region' && r.basis === basis && r.region && r.value !== null)
  const latest = [...new Set(rs.map(r => r.year_end))].sort().reverse()[0]
  return rs.filter(r => r.year_end === latest).map(r => ({ region: r.region as string, value: r.value as number }))
    .filter(r => r.value > 0 && !/^total\b/i.test(r.region)).sort((a, b) => b.value - a.value)
}

export interface PeerStats { n: number; median: number; rank: number; values: number[]; better: 'higher' | 'lower' }

type Row = Record<string, unknown>
const LENDERS = new Set(['bank', 'finance_company'])

/** The listed companies a company is compared with: same broad sector, and lenders only with lenders. */
export function peersOf(all: Row[], r: Row): Row[] {
  const lender = LENDERS.has(String(r.industry_kind ?? ''))
  return all.filter(x => x.listed === true && x.sector_family === r.sector_family && LENDERS.has(String(x.industry_kind ?? '')) === lender)
}

/**
 * Where a company's value sits among its peers' values: rank 1 is the best (highest, or lowest when
 * lower is better). Null when the company has no value or fewer than five peers report one.
 */
export function peerStats(peers: Row[], r: Row, field: string, better: 'higher' | 'lower' = 'higher'): PeerStats | null {
  const v = r[field]
  if (typeof v !== 'number') return null
  const values = peers.map(x => x[field]).filter((x): x is number => typeof x === 'number')
  if (values.length < 5) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  const median = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
  const rank = 1 + values.filter(x => (better === 'higher' ? x > v : x < v)).length
  return { n: values.length, median, rank, values: sorted, better }
}

/** Growth a year between the first and last point, or null when either is not positive. */
export function cagr(points: Point[]): number | null {
  if (points.length < 2) return null
  const a = points[0]!, b = points[points.length - 1]!
  const years = b.year - a.year
  if (years < 1 || a.value <= 0 || b.value <= 0) return null
  return (Math.pow(b.value / a.value, 1 / years) - 1) * 100
}

/** Plain names for the lines in lk-company-financials and lk-company-history. */
export const METRIC_LABEL: Record<string, string> = {
  revenue: "Revenue",
  cost_of_sales: "Cost of sales",
  gross_profit: "Gross profit",
  other_operating_income: "Other operating income",
  distribution_and_selling_expenses: "Distribution and selling expenses",
  administrative_expenses: "Administrative expenses",
  operating_profit: "Operating profit",
  finance_income: "Finance income",
  finance_costs: "Finance costs",
  share_of_associates_and_jvs: "Share of associates and joint ventures",
  profit_before_tax: "Profit before tax",
  income_tax_expense: "Income tax",
  profit_after_tax: "Profit after tax",
  profit_attributable_to_owners: "Profit attributable to shareholders",
  profit_attributable_to_non_controlling_interests: "Profit attributable to minority shareholders",
  depreciation_and_amortisation: "Depreciation and amortisation",
  staff_costs: "Staff costs",
  total_assets: "Total assets",
  non_current_assets: "Non-current assets",
  property_plant_and_equipment: "Property, plant and equipment",
  investment_property: "Investment property",
  intangible_assets: "Intangible assets",
  current_assets: "Current assets",
  inventories: "Inventories",
  trade_and_other_receivables: "Trade and other receivables",
  cash_and_cash_equivalents: "Cash and cash equivalents",
  short_term_investments: "Short-term investments",
  total_liabilities: "Total liabilities",
  current_liabilities: "Current liabilities",
  trade_and_other_payables: "Trade and other payables",
  borrowings_current: "Borrowings due within a year",
  borrowings_non_current: "Borrowings due after a year",
  lease_liabilities: "Lease liabilities",
  total_equity: "Total equity",
  equity_attributable_to_owners: "Equity attributable to shareholders",
  non_controlling_interests: "Minority interests",
  stated_capital: "Stated capital",
  retained_earnings: "Retained earnings",
  cash_from_operating_activities: "Cash from operations",
  cash_from_investing_activities: "Cash from investing",
  cash_from_financing_activities: "Cash from financing",
  purchase_of_ppe_and_intangibles: "Capital spending",
  dividends_paid: "Dividends paid",
  interest_paid: "Interest paid",
  tax_paid: "Tax paid",
  interest_income: "Interest income",
  interest_expense: "Interest expense",
  net_interest_income: "Net interest income",
  net_fee_and_commission_income: "Net fee and commission income",
  impairment_charges: "Impairment charges",
  loans_and_advances: "Loans and advances",
  customer_deposits: "Customer deposits",
  gross_written_premium: "Gross written premium",
  net_earned_premium: "Net earned premium",
  net_benefits_and_claims: "Net benefits and claims",
  basic_eps: "Earnings per share",
  dividend_per_share: "Dividend per share",
  net_assets_per_share: "Net assets per share",
  market_price_year_end: "Share price at year end",
  shares_in_issue: "Shares in issue",
  market_capitalisation: "Market value at year end",
  stage_3_or_npl_ratio_pct: "Stage 3 or non-performing loan ratio",
  tier_1_capital_ratio_pct: "Tier 1 capital ratio",
  total_capital_ratio_pct: "Total capital ratio",
  cost_to_income_ratio_pct: "Cost to income ratio",
  net_interest_margin_pct: "Net interest margin",
  capital_adequacy_margin_pct: "Capital adequacy ratio (insurance)",
  employees: "Employees",
  revenue_outside_sri_lanka: "Revenue from outside Sri Lanka",
  revenue_by_region: "Revenue by region",
  borrowings: "Borrowings",
}
