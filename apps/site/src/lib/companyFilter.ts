// Filtering for the /dashboard/enterprise page: one state object, its URL form, the row
// predicate, the summary figures and the equivalent query_data call. The page keeps rows in memory,
// so everything here is pure and synchronous.
//
// Range filters are declared once in RANGES (field, buckets, whether only listed companies have the
// figure); ready-made views are declared once in LENSES. The URL, matching, chips, coverage notes and
// the query_data translation all read those two lists.

export interface CompanyRow {
  company_id: string
  name: string
  group_id: string
  group_name: string | null
  relation_to_group: string | null
  is_group_head: boolean | null
  group_companies: number | null
  listed: boolean | null
  cse_symbol: string | null
  ownership: string | null
  country: string | null
  what_it_does: string | null
  primary_sector: string | null
  sector_family: string | null
  sector_tags: string | null
  isic_section: string | null
  isic_section_label: string | null
  revenue_lkr: number | null
  revenue_prior_lkr: number | null
  revenue_growth_nominal_pct: number | null
  revenue_growth_real_pct: number | null
  revenue_comparable: boolean | null
  revenue_additive_lkr: number | null
  net_profit_margin_pct: number | null
  performance: string | null
  controller_type: string | null
  employees_additive: number | null
  revenue_scope: string | null
  profit_after_tax_lkr: number | null
  profit_after_tax_growth_pct: number | null
  employees: number | null
  operates_abroad: boolean | null
  exports: boolean | null
  foreign_subsidiaries: number | null
  foreign_owned: boolean | null
  [key: string]: unknown
}

export const ABROAD_KEYS = ['exports', 'foreign_subsidiaries', 'operates_abroad', 'foreign_owned'] as const
export type AbroadKey = typeof ABROAD_KEYS[number]
export const ABROAD_LABEL: Record<AbroadKey, string> = {
  exports: 'Known exporters',
  foreign_subsidiaries: 'Has overseas subsidiaries',
  operates_abroad: 'Exports or operates overseas',
  foreign_owned: 'Has a foreign parent',
}

/* ---------- range filters ---------- */

export interface Bucket { id: string; label: string; min: number | null; max: number | null }
export interface RangeDef {
  key: string
  /** the lk-companies column; growth reads the basis the reader chose */
  field: string
  label: string
  section: 'size' | 'growth' | 'debt' | 'price' | 'control' | 'banks'
  /** only listed companies publish this figure */
  listedOnly: boolean
  /** bucket edges are in these units: 1e9 for LKR billions */
  scale?: number
  buckets: Bucket[]
  note?: string
}

const b = (id: string, label: string, min: number | null, max: number | null): Bucket => ({ id, label, min, max })

export const RANGES: RangeDef[] = [
  { key: 'revenue', field: 'revenue_lkr', label: 'Revenue', section: 'size', listedOnly: false, scale: 1e9, buckets: [
    b('lt1', 'Under LKR 1bn', null, 1), b('1-10', 'LKR 1–10bn', 1, 10), b('10-50', 'LKR 10–50bn', 10, 50), b('50-100', 'LKR 50–100bn', 50, 100), b('100up', 'LKR 100bn or more', 100, null)] },
  { key: 'employees', field: 'employees', label: 'Employees', section: 'size', listedOnly: false, buckets: [
    b('lt100', 'Under 100', null, 100), b('100-500', '100–499', 100, 500), b('500-1000', '500–999', 500, 1000), b('1000-5000', '1,000–4,999', 1000, 5000), b('5000up', '5,000 or more', 5000, null)] },
  { key: 'mcap', field: 'market_cap_lkr', label: 'Market value', section: 'size', listedOnly: true, scale: 1e9, buckets: [
    b('lt1', 'Under LKR 1bn', null, 1), b('1-5', 'LKR 1–5bn', 1, 5), b('5-25', 'LKR 5–25bn', 5, 25), b('25-100', 'LKR 25–100bn', 25, 100), b('100up', 'LKR 100bn or more', 100, null)] },
  { key: 'growth', field: 'revenue_growth_real_pct', label: 'Growth this year', section: 'growth', listedOnly: true, buckets: [
    b('fell10', 'Fell more than 10%', null, -10), b('fell', 'Fell up to 10%', -10, 0), b('up', 'Up to 10%', 0, 10), b('10-25', 'Up 10–25%', 10, 25), b('25up', 'Up more than 25%', 25, null)],
    note: 'Revenue in the latest year against the year before, from the same annual report.' },
  { key: 'growth5', field: 'revenue_cagr_5y_real_pct', label: 'Growth over five years, after inflation', section: 'growth', listedOnly: true, buckets: [
    b('shrank', 'Shrank', null, 0), b('0-5', 'Up to 5% a year', 0, 5), b('5-10', '5–10% a year', 5, 10), b('10up', '10% a year or more', 10, null)],
    note: 'From the five or ten-year summary in the annual report, after consumer price inflation.' },
  { key: 'roe', field: 'return_on_equity_pct', label: 'Return on equity', section: 'growth', listedOnly: true, buckets: [
    b('neg', 'Negative', null, 0), b('0-5', '0–5%', 0, 5), b('5-10', '5–10%', 5, 10), b('10-15', '10–15%', 10, 15), b('15-20', '15–20%', 15, 20), b('20up', '20% or more', 20, null)],
    note: 'Profit after tax ÷ the owners’ equity at the year end.' },
  { key: 'lossyears', field: 'loss_years_in_history', label: 'Loss years in the record', section: 'growth', listedOnly: true, buckets: [
    b('0', 'None', 0, 0), b('1', 'One', 1, 1), b('2', 'Two', 2, 2), b('3up', 'Three or more', 3, null)],
    note: 'Years with a loss in the five or ten-year summary.' },
  { key: 'debt', field: 'debt_to_equity_pct', label: 'Debt compared with equity', section: 'debt', listedOnly: true, buckets: [
    b('lt25', 'Under 25%', null, 25), b('25-50', '25–50%', 25, 50), b('50-100', '50–100%', 50, 100), b('100up', 'More than equity', 100, null)],
    note: 'Borrowings and leases ÷ equity. Not given for banks and finance companies.' },
  { key: 'cover', field: 'interest_cover', label: 'Can it cover its interest?', section: 'debt', listedOnly: true, buckets: [
    b('lt1', 'No: under 1×', null, 1), b('1-2', 'Barely: 1–2×', 1, 2), b('2-5', '2–5×', 2, 5), b('5up', 'Easily: 5× or more', 5, null)],
    note: 'Operating profit ÷ finance costs.' },
  { key: 'eqa', field: 'equity_to_assets_pct', label: 'Owners’ share of assets', section: 'debt', listedOnly: true, buckets: [
    b('neg', 'Negative (owes more than it owns)', null, 0), b('lt20', 'Under 20%', 0, 20), b('20-40', '20–40%', 20, 40), b('40-60', '40–60%', 40, 60), b('60up', '60% or more', 60, null)],
    note: 'Equity ÷ total assets. Banks are always low: they lend deposits.' },
  { key: 'yield', field: 'dividend_yield_pct', label: 'Dividend yield', section: 'price', listedOnly: true, buckets: [
    b('0', 'No dividend', 0, 0), b('lt2', 'Up to 2%', 0.0001, 2), b('2-4', '2–4%', 2, 4), b('4-6', '4–6%', 4, 6), b('6up', '6% or more', 6, null)],
    note: 'Dividend per share for the year ÷ the share price in November 2026.' },
  { key: 'pb', field: 'pb_ratio', label: 'Price to book', section: 'price', listedOnly: true, buckets: [
    b('lt1', 'Below its net assets (under 1×)', null, 1), b('1-2', '1–2×', 1, 2), b('2up', '2× or more', 2, null)] },
  { key: 'pe', field: 'pe_ratio', label: 'Price to earnings', section: 'price', listedOnly: true, buckets: [
    b('lt8', 'Under 8×', null, 8), b('8-15', '8–15×', 8, 15), b('15up', '15× or more', 15, null)] },
  { key: 'stake', field: 'controller_pct', label: 'Largest shareholder’s stake', section: 'control', listedOnly: true, buckets: [
    b('lt25', 'Under 25%', null, 25), b('25-50', '25–50%', 25, 50), b('50-75', '50–75%: controls it', 50, 75), b('75up', '75% or more', 75, null)] },
  { key: 'state', field: 'state_holding_pct', label: 'State stake', section: 'control', listedOnly: true, buckets: [
    b('any', 'Any', 0.0001, null), b('5up', '5% or more', 5, null), b('20up', '20% or more', 20, null), b('50up', 'Majority', 50, null)],
    note: 'The state and state enterprises among the largest shareholders.' },
  { key: 'npl', field: 'npl_ratio_pct', label: 'Bad loans (stage 3)', section: 'banks', listedOnly: true, buckets: [
    b('lt3', 'Under 3%', null, 3), b('3-5', '3–5%', 3, 5), b('5-8', '5–8%', 5, 8), b('8up', '8% or more', 8, null)] },
  { key: 'car', field: 'total_capital_ratio_pct', label: 'Total capital ratio', section: 'banks', listedOnly: true, buckets: [
    b('lt15', 'Under 15%', null, 15), b('15-20', '15–20%', 15, 20), b('20up', '20% or more', 20, null)] },
]
export const RANGE_BY_KEY = new Map(RANGES.map(r => [r.key, r]))

/** Inside a bucket: min inclusive, max exclusive; min = max means exactly that value. */
export function inBucket(v: number | null, min: number | null, max: number | null): boolean {
  if (v === null || v === undefined || Number.isNaN(v)) return false
  if (min !== null && max !== null && min === max) return v === min
  if (min !== null && v < min) return false
  if (max !== null && v >= max) return false
  return true
}

/* ---------- ready-made views ---------- */

export const COLSETS = ['overview', 'debt', 'price', 'longrun', 'banks', 'ownership'] as const
export type ColSet = typeof COLSETS[number]

export interface Lens {
  id: string
  label: string
  /** filters the view sets (anything not named is cleared) */
  set: Partial<Pick<CompanyFilter, 'ownership' | 'performance' | 'abroad' | 'kinds' | 'listed' | 'scope'>> & { ranges?: Record<string, string> }
  cols: ColSet
  sort: SortKey
  desc: boolean
}

export const LENSES: Lens[] = [
  { id: 'employers', label: 'Biggest employers', set: { ranges: { employees: '1000-5000,5000up' } }, cols: 'overview', sort: 'employees', desc: true },
  { id: 'state', label: 'State-owned enterprises', set: { ownership: ['state_owned'], scope: 'all' }, cols: 'overview', sort: 'revenue', desc: true },
  { id: 'foreign', label: 'Foreign-owned', set: { abroad: ['foreign_owned'], scope: 'all' }, cols: 'ownership', sort: 'revenue', desc: true },
  { id: 'exporters', label: 'Growing exporters', set: { abroad: ['exports'], ranges: { growth: '10-25,25up' }, scope: 'all' }, cols: 'overview', sort: 'growth', desc: true },
  { id: 'steady', label: 'Steady growers', set: { ranges: { growth5: '5-10,10up', lossyears: '0' } }, cols: 'longrun', sort: 'cagr5', desc: true },
  { id: 'losses', label: 'Loss-makers', set: { performance: ['loss_both_years', 'fell_into_loss', 'negative_equity'], scope: 'all' }, cols: 'overview', sort: 'profit', desc: false },
  { id: 'debt', label: 'Heavily indebted', set: { ranges: { debt: '100up' } }, cols: 'debt', sort: 'debt', desc: true },
  { id: 'dividends', label: 'High dividend payers', set: { ranges: { yield: '4-6,6up' } }, cols: 'price', sort: 'yield', desc: true },
  { id: 'banks', label: 'Banks and lenders', set: { kinds: ['bank', 'finance_company'] }, cols: 'banks', sort: 'revenue', desc: true },
  { id: 'cheap', label: 'Valued below net assets', set: { ranges: { pb: 'lt1' } }, cols: 'price', sort: 'pb', desc: false },
]
export const LENS_BY_ID = new Map(LENSES.map(l => [l.id, l]))

/* ---------- the filter state ---------- */

export type SortKey = 'revenue' | 'growth' | 'nominal' | 'margin' | 'employees' | 'name' | 'profit' | 'roe' | 'mcap' | 'cagr5'
  | 'debt' | 'cover' | 'netdebt' | 'eqa' | 'yield' | 'payout' | 'pe' | 'pb' | 'npl' | 'car' | 'cti' | 'stake' | 'state' | 'lossyears' | 'groupsize'
const SORT_FIELD: Record<SortKey, string> = {
  revenue: 'revenue_lkr', growth: 'revenue_growth_real_pct', nominal: 'revenue_growth_nominal_pct', margin: 'net_profit_margin_pct',
  employees: 'employees', name: 'name', profit: 'profit_after_tax_lkr', roe: 'return_on_equity_pct', mcap: 'market_cap_lkr',
  cagr5: 'revenue_cagr_5y_real_pct', debt: 'debt_to_equity_pct', cover: 'interest_cover', netdebt: 'net_debt_lkr', eqa: 'equity_to_assets_pct',
  yield: 'dividend_yield_pct', payout: 'dividend_payout_pct', pe: 'pe_ratio', pb: 'pb_ratio', npl: 'npl_ratio_pct', car: 'total_capital_ratio_pct',
  cti: 'cost_to_income_pct', stake: 'controller_pct', state: 'state_holding_pct', lossyears: 'loss_years_in_history', groupsize: 'group_companies',
}
const SORTS = Object.keys(SORT_FIELD) as SortKey[]

export interface CompanyFilter {
  q: string
  scope: 'groups' | 'all'
  group: string
  families: string[]
  sectors: string[]
  ownership: string[]
  /** All, Listed or Unlisted */
  listed: '' | 'yes' | 'no'
  /** kept only so old links keep working; no longer offered */
  isic: string[]
  growthBasis: 'real' | 'nominal'
  performance: string[]
  abroad: AbroadKey[]
  /** industry_kind: bank, finance_company, insurer, other (set by the Banks view) */
  kinds: string[]
  /** range filters by RANGES key: one or more bucket ids joined by ',' (adjacent buckets make one range) */
  ranges: Record<string, string>
  lens: string
  cols: ColSet
  sort: SortKey
  desc: boolean
}

export const EMPTY_FILTER: CompanyFilter = {
  q: '', scope: 'groups', group: '', families: [], sectors: [], ownership: [], listed: '', isic: [],
  growthBasis: 'real', performance: [], abroad: [], kinds: [], ranges: {}, lens: '', cols: 'overview', sort: 'revenue', desc: true,
}
export const emptyFilter = (): CompanyFilter => structuredClone(EMPTY_FILTER)

const list = (v: string | null) => (v ? v.split(',').map(s => s.trim()).filter(Boolean) : [])
const numOrNull = (v: string | null) => {
  if (v === null || v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** The min and max a range key's chosen buckets cover (adjacent buckets join into one range). */
export function rangeBounds(key: string, ids: string): { min: number | null; max: number | null } | null {
  const def = RANGE_BY_KEY.get(key)
  if (!def) return null
  const bs = ids.split(',').map(id => def.buckets.find(x => x.id === id)).filter((x): x is Bucket => !!x)
  if (!bs.length) return null
  if (bs.length === 1) return { min: bs[0]!.min, max: bs[0]!.max }
  const mins = bs.map(x => x.min), maxs = bs.map(x => x.max)
  return { min: mins.includes(null) ? null : Math.min(...(mins as number[])), max: maxs.includes(null) ? null : Math.max(...(maxs as number[])) }
}

/** Old links used growth_min / revenue_min_bn / employees_min: map them onto the nearest buckets. */
function legacyRanges(params: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {}
  const g = numOrNull(params.get('growth_min'))
  if (g !== null) out.growth = g >= 25 ? '25up' : g >= 10 ? '10-25,25up' : 'up,10-25,25up'
  else if (numOrNull(params.get('growth_max')) !== null) out.growth = 'fell10,fell'
  const rv = numOrNull(params.get('revenue_min_bn'))
  if (rv !== null) out.revenue = rv >= 100 ? '100up' : rv >= 50 ? '50-100,100up' : rv >= 10 ? '10-50,50-100,100up' : '1-10,10-50,50-100,100up'
  const em = numOrNull(params.get('employees_min'))
  if (em !== null) out.employees = em >= 5000 ? '5000up' : em >= 1000 ? '1000-5000,5000up' : em >= 500 ? '500-1000,1000-5000,5000up' : '100-500,500-1000,1000-5000,5000up'
  return out
}

export function parseFilter(params: URLSearchParams): CompanyFilter {
  const sort = params.get('sort') as SortKey | null
  const group = (params.get('group') ?? '').trim()
  const ranges = legacyRanges(params)
  for (const def of RANGES) {
    const v = params.get(def.key)
    if (v && rangeBounds(def.key, v)) ranges[def.key] = v
  }
  const cols = params.get('cols') as ColSet | null
  const lens = params.get('lens') ?? ''
  return {
    q: (params.get('q') ?? '').slice(0, 200),
    // a group view always lists every company in the group
    scope: group ? 'all' : params.get('scope') === 'all' ? 'all' : 'groups',
    group,
    families: list(params.get('family')),
    sectors: list(params.get('sector')),
    ownership: list(params.get('ownership')),
    listed: params.get('listed') === 'yes' ? 'yes' : params.get('listed') === 'no' ? 'no' : '',
    isic: list(params.get('isic')),
    // basis=nominal; old links said growth=nominal
    growthBasis: params.get('basis') === 'nominal' || params.get('growth') === 'nominal' ? 'nominal' : 'real',
    performance: list(params.get('performance')),
    abroad: list(params.get('abroad')).filter((k): k is AbroadKey => (ABROAD_KEYS as readonly string[]).includes(k)),
    kinds: list(params.get('kind')),
    ranges,
    lens: LENS_BY_ID.has(lens) ? lens : '',
    cols: cols && (COLSETS as readonly string[]).includes(cols) ? cols : 'overview',
    sort: sort && SORTS.includes(sort) ? sort : 'revenue',
    desc: params.get('asc') === null,
  }
}

export function filterToParams(f: CompanyFilter): URLSearchParams {
  const p = new URLSearchParams()
  if (f.q) p.set('q', f.q)
  if (f.group) p.set('group', f.group)
  else if (f.scope === 'all') p.set('scope', 'all')
  if (f.lens) p.set('lens', f.lens)
  if (f.families.length) p.set('family', f.families.join(','))
  if (f.sectors.length) p.set('sector', f.sectors.join(','))
  if (f.ownership.length) p.set('ownership', f.ownership.join(','))
  if (f.listed) p.set('listed', f.listed)
  if (f.isic.length) p.set('isic', f.isic.join(','))
  if (f.growthBasis === 'nominal') p.set('basis', 'nominal')
  if (f.performance.length) p.set('performance', f.performance.join(','))
  if (f.abroad.length) p.set('abroad', f.abroad.join(','))
  if (f.kinds.length) p.set('kind', f.kinds.join(','))
  for (const def of RANGES) if (f.ranges[def.key]) p.set(def.key, f.ranges[def.key]!)
  if (f.cols !== 'overview') p.set('cols', f.cols)
  if (f.sort !== 'revenue') p.set('sort', f.sort)
  if (!f.desc) p.set('asc', '1')
  return p
}

/** A view's filters on top of an empty filter (search and group are cleared too). */
export function applyLens(id: string): CompanyFilter {
  const l = LENS_BY_ID.get(id)
  const f = emptyFilter()
  if (!l) return f
  return { ...f, ...l.set, ranges: { ...(l.set.ranges ?? {}) }, lens: id, cols: l.cols, sort: l.sort, desc: l.desc,
    scope: l.set.scope ?? f.scope } as CompanyFilter
}

/** Filters only listed companies can answer (they publish accounts). */
export function listedOnlyActive(f: CompanyFilter): string[] {
  const why = RANGES.filter(d => d.listedOnly && f.ranges[d.key]).map(d => d.label)
  if (f.performance.length) why.push('Profit')
  if (f.kinds.length) why.push('Banks and lenders')
  return why
}

/**
 * The filter actually applied: a listed-only filter switches to listed companies across every company,
 * because the By group view would otherwise hide listed subsidiaries without saying so.
 */
export function effectiveFilter(f: CompanyFilter): CompanyFilter {
  if (!listedOnlyActive(f).length) return f
  return { ...f, listed: 'yes', scope: f.group ? f.scope : 'all' }
}

/** Ownership as shown: a company inside a group with no ownership of its own is owned by that group. */
export const ownershipOf = (r: CompanyRow): string =>
  r.ownership === 'private' ? 'private_local' : r.ownership ?? (r.is_group_head ? 'unknown' : 'in_group')

export const growthOf = (r: CompanyRow, basis: 'real' | 'nominal'): number | null => basis === 'real' ? r.revenue_growth_real_pct : r.revenue_growth_nominal_pct

export const tagsOf = (r: CompanyRow): string[] => (r.sector_tags ? r.sector_tags.split(';').map(s => s.trim()).filter(Boolean) : [])

/** The value a range filter tests. */
export function rangeValue(r: CompanyRow, key: string, basis: 'real' | 'nominal' = 'real'): number | null {
  if (key === 'growth') return growthOf(r, basis)
  const def = RANGE_BY_KEY.get(key)
  const v = def ? r[def.field] : null
  return typeof v === 'number' ? v / (def?.scale ?? 1) : null
}

/** Lower-cased text a search matches against: names, group, activity and sector tags. */
export function searchText(r: CompanyRow): string {
  return [r.name, r.group_name, r.cse_symbol, r.what_it_does, r.sector_tags?.replaceAll('-', ' ')].filter(Boolean).join(' ').toLowerCase()
}

export function isAbroad(r: CompanyRow, k: AbroadKey): boolean {
  return k === 'foreign_subsidiaries' ? (r.foreign_subsidiaries ?? 0) > 0 : r[k] === true
}

/** Every filter must hold. Within one multi-choice filter any chosen value may match. Pass the effective filter. */
export function matches(r: CompanyRow, f: CompanyFilter, families: Map<string, string>, text?: string): boolean {
  if (f.group ? r.group_id !== f.group : f.scope === 'groups' && r.is_group_head !== true) return false
  if (f.q) {
    const t = text ?? searchText(r)
    if (!f.q.toLowerCase().split(/\s+/).filter(Boolean).every(w => t.includes(w))) return false
  }
  const tags = tagsOf(r)
  if (f.sectors.length && !tags.some(t => f.sectors.includes(t))) return false
  if (f.families.length && !tags.some(t => f.families.includes(families.get(t) ?? ''))) return false
  if (f.ownership.length && !f.ownership.includes(ownershipOf(r))) return false
  if (f.listed === 'yes' && r.listed !== true) return false
  if (f.listed === 'no' && r.listed === true) return false
  if (f.isic.length && !f.isic.includes(r.isic_section ?? '')) return false
  if (f.performance.length && !f.performance.includes(r.performance ?? '')) return false
  if (f.kinds.length && !f.kinds.includes(String(r.industry_kind ?? ''))) return false
  if (f.abroad.some(k => !isAbroad(r, k))) return false
  for (const [key, ids] of Object.entries(f.ranges)) {
    const bd = rangeBounds(key, ids)
    if (bd && !inBucket(rangeValue(r, key, f.growthBasis), bd.min, bd.max)) return false
  }
  return true
}

/** Sorted copy; rows without a value always sink to the bottom whatever the direction. */
export function sortRows(rows: CompanyRow[], key: SortKey, desc: boolean): CompanyRow[] {
  const field = SORT_FIELD[key]
  const get = (r: CompanyRow): number | string | null => {
    if (key === 'name') return r.name.toLowerCase()
    if (key === 'revenue' && r.revenue_comparable === false) return null
    const v = r[field]
    return typeof v === 'number' ? v : null
  }
  return [...rows].sort((a, b) => {
    const x = get(a), y = get(b)
    if (x === null && y === null) return a.name.localeCompare(b.name)
    if (x === null) return 1
    if (y === null) return -1
    const c = x < y ? -1 : x > y ? 1 : 0
    return desc ? -c : c
  })
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

export interface Summary {
  companies: number
  groups: number
  revenueLkr: number
  revenueCount: number
  medianRealGrowth: number | null
  medianNominalGrowth: number | null
  growthCount: number
  grewReal: number
  growth5Count: number
  grew5: number
  profitable: number
  loss: number
  performanceCount: number
  employees: number
  employeesCount: number
  exporters: number
  overseas: number
  marketCapLkr: number
  marketCapCount: number
  groups_with_members: number
}

const LOSS = new Set(['loss_both_years', 'fell_into_loss', 'negative_equity', 'loss'])

/**
 * Headline figures for the matched rows. Revenue and employees are summed only over rows that do
 * not sit inside another matched row's group, so a group and its own subsidiaries are never added
 * together (a group head's figures are consolidated).
 */
export function summarize(rows: CompanyRow[]): Summary {
  const heads = new Set(rows.filter(r => r.is_group_head).map(r => r.company_id))
  const additive = rows.filter(r => r.is_group_head || !heads.has(r.group_id))
  const withRev = additive.filter(r => r.revenue_lkr !== null && r.revenue_comparable !== false)
  const withEmp = additive.filter(r => r.employees !== null)
  const real = rows.map(r => r.revenue_growth_real_pct).filter((g): g is number => g !== null)
  const nominal = rows.map(r => r.revenue_growth_nominal_pct).filter((g): g is number => g !== null)
  const g5 = rows.map(r => r.revenue_cagr_5y_real_pct).filter((g): g is number => typeof g === 'number')
  const perf = rows.filter(r => r.performance)
  const mcap = rows.map(r => r.market_cap_lkr).filter((v): v is number => typeof v === 'number')
  return {
    companies: rows.length,
    groups: new Set(rows.map(r => r.group_id)).size,
    revenueLkr: withRev.reduce((s, r) => s + (r.revenue_lkr ?? 0), 0),
    revenueCount: withRev.length,
    medianRealGrowth: median(real),
    medianNominalGrowth: median(nominal),
    growthCount: real.length,
    grewReal: real.filter(g => g > 0).length,
    growth5Count: g5.length,
    grew5: g5.filter(g => g > 0).length,
    profitable: perf.filter(r => !LOSS.has(r.performance ?? '')).length,
    loss: perf.filter(r => LOSS.has(r.performance ?? '')).length,
    performanceCount: perf.length,
    employees: withEmp.reduce((s, r) => s + (r.employees ?? 0), 0),
    employeesCount: withEmp.length,
    exporters: rows.filter(r => r.exports === true).length,
    overseas: rows.filter(r => r.exports !== true && ((r.foreign_subsidiaries ?? 0) > 0 || r.operates_abroad === true)).length,
    marketCapLkr: mcap.reduce((s, v) => s + v, 0),
    marketCapCount: mcap.length,
    groups_with_members: rows.filter(r => r.is_group_head && (r.group_companies ?? 0) > 1).length,
  }
}

/**
 * For each active range filter: how many companies the other filters leave, and how many of those
 * report the figure at all. Companies without the figure are not counted, not ruled out.
 */
export function coverage(rows: CompanyRow[], f: CompanyFilter, families: Map<string, string>): Array<{ key: string; label: string; base: number; reporting: number }> {
  const out: Array<{ key: string; label: string; base: number; reporting: number }> = []
  for (const key of Object.keys(f.ranges)) {
    const def = RANGE_BY_KEY.get(key)
    if (!def) continue
    const rest = { ...f, ranges: { ...f.ranges } }
    delete rest.ranges[key]
    const base = rows.filter(r => matches(r, rest, families))
    out.push({ key, label: def.label, base: base.length, reporting: base.filter(r => rangeValue(r, key, f.growthBasis) !== null).length })
  }
  return out
}

/** Count of matched rows by a key (each row counted once per key value it carries). */
export function countBy(rows: CompanyRow[], keys: (r: CompanyRow) => string[]): [string, number][] {
  const m = new Map<string, number>()
  for (const r of rows) for (const k of new Set(keys(r))) if (k) m.set(k, (m.get(k) ?? 0) + 1)
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

type Where = { field: string; op: 'eq' | 'gte' | 'lte' | 'in'; value: unknown }
const MAX_PREDICATES = 8
// columns lk-company-sectors repeats from lk-companies, so a sector filter can still use them
const SECTOR_TABLE_FIELDS = new Set(['revenue_lkr', 'revenue_growth_real_pct', 'revenue_growth_nominal_pct', 'net_profit_margin_pct', 'performance',
  'employees', 'exports', 'operates_abroad', 'ownership', 'controller_type', 'listed', 'is_group_head', 'return_on_equity_pct', 'dividend_yield_pct',
  'debt_to_equity_pct', 'revenue_cagr_5y_real_pct', 'market_cap_lkr'])

/**
 * The same question as a query_data call an AI can run. query_data filters with eq / gte / lte / in
 * only, at most eight conditions; sector filters go to lk-company-sectors. Anything that cannot be
 * expressed is returned in `unsupported` so the copied question says so in words.
 */
export function toQuery(input: CompanyFilter): { dataset_id: string; where: Where[]; order_by: { field: string; direction: 'asc' | 'desc' }[]; unsupported: string[] } {
  const f = effectiveFilter(input)
  const sectorTable = f.sectors.length > 0 || f.families.length > 0
  const where: Where[] = []
  const unsupported: string[] = []
  const add = (w: Where, words: string) => {
    if (sectorTable && !SECTOR_TABLE_FIELDS.has(w.field) && w.field !== 'sector' && w.field !== 'sector_family') unsupported.push(words)
    else where.push(w)
  }
  if (sectorTable) {
    if (f.sectors.length) where.push({ field: 'sector', op: 'in', value: f.sectors })
    if (f.families.length) where.push({ field: 'sector_family', op: 'in', value: f.families })
  }
  if (f.group) {
    if (sectorTable) unsupported.push(`group ${f.group}`)
    else where.push({ field: 'group_id', op: 'eq', value: f.group })
  } else if (f.scope === 'groups') where.push({ field: 'is_group_head', op: 'eq', value: true })
  if (f.ownership.length) {
    if (f.ownership.includes('in_group')) unsupported.push('owned by a group (ownership is empty for group companies)')
    const own = f.ownership.filter(o => o !== 'in_group').flatMap(o => o === 'private_local' ? ['private_local', 'private'] : [o])
    if (own.length) add({ field: 'ownership', op: 'in', value: own }, `ownership ${own.join(' or ')}`)
  }
  if (f.listed) add({ field: 'listed', op: 'eq', value: f.listed === 'yes' }, f.listed === 'yes' ? 'listed companies only' : 'unlisted companies only')
  if (f.isic.length) add({ field: 'isic_section', op: 'in', value: f.isic }, `ISIC section ${f.isic.join(', ')}`)
  if (f.performance.length) add({ field: 'performance', op: 'in', value: f.performance }, `performance ${f.performance.join(' or ')}`)
  if (f.kinds.length) add({ field: 'industry_kind', op: 'in', value: f.kinds }, `kind of business ${f.kinds.join(' or ')}`)
  for (const k of f.abroad) {
    if (k === 'foreign_subsidiaries') add({ field: 'foreign_subsidiaries', op: 'gte', value: 1 }, 'has overseas subsidiaries')
    else add({ field: k, op: 'eq', value: true }, ABROAD_LABEL[k].toLowerCase())
  }
  for (const [key, ids] of Object.entries(f.ranges)) {
    const def = RANGE_BY_KEY.get(key), bd = rangeBounds(key, ids)
    if (!def || !bd) continue
    const field = key === 'growth' && f.growthBasis === 'nominal' ? 'revenue_growth_nominal_pct' : def.field
    const scale = def.scale ?? 1
    const words = `${def.label}: ${ids.split(',').map(id => def.buckets.find(x => x.id === id)?.label).join(' or ')}`
    // query_data has no "less than": an upper edge becomes lte, so a value exactly on the edge also matches
    if (bd.min !== null) add({ field, op: 'gte', value: bd.min * scale }, words)
    if (bd.max !== null) add({ field, op: 'lte', value: bd.max * scale }, `${words} (upper bound)`)
  }
  if (f.q) unsupported.push(`name or description contains "${f.q}"`)
  // the API takes at most eight conditions: say which ones were left out rather than drop them silently
  const kept = where.slice(0, MAX_PREDICATES)
  for (const w of where.slice(MAX_PREDICATES)) unsupported.push(`${w.field} ${w.op} ${JSON.stringify(w.value)} (more than eight conditions)`)
  const order = SORT_FIELD[f.sort]
  return { dataset_id: sectorTable ? 'lk-company-sectors' : 'lk-companies', where: kept, order_by: [{ field: order, direction: f.desc ? 'desc' : 'asc' }], unsupported }
}
