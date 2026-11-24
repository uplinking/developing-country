// Filtering for the /companies dashboard: one state object, its URL form, the row predicate,
// the summary figures and the equivalent query_data call. The page keeps rows in memory, so
// everything here is pure and synchronous.

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
  revenue_growth_pct: number | null
  revenue_scope: string | null
  profit_after_tax_lkr: number | null
  profit_growth_pct: number | null
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
  exports: 'Exporters',
  foreign_subsidiaries: 'Has overseas subsidiaries',
  operates_abroad: 'Exports or operates overseas',
  foreign_owned: 'Has a foreign parent',
}

export type SortKey = 'revenue' | 'growth' | 'employees' | 'name' | 'profit_growth'
export interface CompanyFilter {
  q: string
  scope: 'groups' | 'all'
  group: string
  families: string[]
  sectors: string[]
  ownership: string[]
  listed: '' | 'yes' | 'no'
  isic: string[]
  growthMin: number | null
  growthMax: number | null
  revenueMinBn: number | null
  employeesMin: number | null
  abroad: AbroadKey[]
  sort: SortKey
  desc: boolean
}

export const EMPTY_FILTER: CompanyFilter = {
  q: '', scope: 'groups', group: '', families: [], sectors: [], ownership: [], listed: '', isic: [],
  growthMin: null, growthMax: null, revenueMinBn: null, employeesMin: null, abroad: [], sort: 'revenue', desc: true,
}

const list = (v: string | null) => (v ? v.split(',').map(s => s.trim()).filter(Boolean) : [])
const numOrNull = (v: string | null) => {
  if (v === null || v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const SORTS: SortKey[] = ['revenue', 'growth', 'employees', 'name', 'profit_growth']

export function parseFilter(params: URLSearchParams): CompanyFilter {
  const sort = params.get('sort') as SortKey | null
  const group = (params.get('group') ?? '').trim()
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
    growthMin: numOrNull(params.get('growth_min')),
    growthMax: numOrNull(params.get('growth_max')),
    revenueMinBn: numOrNull(params.get('revenue_min_bn')),
    employeesMin: numOrNull(params.get('employees_min')),
    abroad: list(params.get('abroad')).filter((k): k is AbroadKey => (ABROAD_KEYS as readonly string[]).includes(k)),
    sort: sort && SORTS.includes(sort) ? sort : 'revenue',
    desc: params.get('asc') === null,
  }
}

export function filterToParams(f: CompanyFilter): URLSearchParams {
  const p = new URLSearchParams()
  if (f.q) p.set('q', f.q)
  if (f.group) p.set('group', f.group)
  else if (f.scope === 'all') p.set('scope', 'all')
  if (f.families.length) p.set('family', f.families.join(','))
  if (f.sectors.length) p.set('sector', f.sectors.join(','))
  if (f.ownership.length) p.set('ownership', f.ownership.join(','))
  if (f.listed) p.set('listed', f.listed)
  if (f.isic.length) p.set('isic', f.isic.join(','))
  if (f.growthMin !== null) p.set('growth_min', String(f.growthMin))
  if (f.growthMax !== null) p.set('growth_max', String(f.growthMax))
  if (f.revenueMinBn !== null) p.set('revenue_min_bn', String(f.revenueMinBn))
  if (f.employeesMin !== null) p.set('employees_min', String(f.employeesMin))
  if (f.abroad.length) p.set('abroad', f.abroad.join(','))
  if (f.sort !== 'revenue') p.set('sort', f.sort)
  if (!f.desc) p.set('asc', '1')
  return p
}

/** Ownership as shown: a company inside a group with no ownership of its own is owned by that group. */
export const ownershipOf = (r: CompanyRow): string =>
  r.ownership === 'private' ? 'private_local' : r.ownership ?? (r.is_group_head ? 'unknown' : 'in_group')

export const tagsOf = (r: CompanyRow): string[] => (r.sector_tags ? r.sector_tags.split(';').map(s => s.trim()).filter(Boolean) : [])

/** Lower-cased text a search matches against: names, group, activity and sector tags. */
export function searchText(r: CompanyRow): string {
  return [r.name, r.group_name, r.cse_symbol, r.what_it_does, r.sector_tags?.replaceAll('-', ' ')].filter(Boolean).join(' ').toLowerCase()
}

export function isAbroad(r: CompanyRow, k: AbroadKey): boolean {
  return k === 'foreign_subsidiaries' ? (r.foreign_subsidiaries ?? 0) > 0 : r[k] === true
}

/** Every filter must hold. Within one multi-choice filter any chosen value may match. */
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
  if (f.growthMin !== null && (r.revenue_growth_pct === null || r.revenue_growth_pct < f.growthMin)) return false
  if (f.growthMax !== null && (r.revenue_growth_pct === null || r.revenue_growth_pct > f.growthMax)) return false
  if (f.revenueMinBn !== null && (r.revenue_lkr === null || r.revenue_lkr < f.revenueMinBn * 1e9)) return false
  if (f.employeesMin !== null && (r.employees === null || r.employees < f.employeesMin)) return false
  if (f.abroad.some(k => !isAbroad(r, k))) return false
  return true
}

const SORT_VALUE: Record<SortKey, (r: CompanyRow) => number | string | null> = {
  revenue: r => r.revenue_lkr,
  growth: r => r.revenue_growth_pct,
  profit_growth: r => r.profit_growth_pct,
  employees: r => r.employees,
  name: r => r.name.toLowerCase(),
}

/** Sorted copy; rows without a value always sink to the bottom whatever the direction. */
export function sortRows(rows: CompanyRow[], key: SortKey, desc: boolean): CompanyRow[] {
  const get = SORT_VALUE[key]
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
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export interface Summary {
  companies: number
  groups: number
  revenueLkr: number
  revenueCount: number
  medianGrowth: number | null
  growthCount: number
  employees: number
  employeesCount: number
  exporters: number
  overseas: number
  groups_with_members: number
}

/**
 * Headline figures for the matched rows. Revenue and employees are summed only over rows that do
 * not sit inside another matched row's group, so a group and its own subsidiaries are never added
 * together (a group head's figures are consolidated).
 */
export function summarize(rows: CompanyRow[]): Summary {
  const heads = new Set(rows.filter(r => r.is_group_head).map(r => r.company_id))
  const additive = rows.filter(r => r.is_group_head || !heads.has(r.group_id))
  const withRev = additive.filter(r => r.revenue_lkr !== null)
  const withEmp = additive.filter(r => r.employees !== null)
  const growth = rows.map(r => r.revenue_growth_pct).filter((g): g is number => g !== null)
  return {
    companies: rows.length,
    groups: new Set(rows.map(r => r.group_id)).size,
    revenueLkr: withRev.reduce((s, r) => s + (r.revenue_lkr ?? 0), 0),
    revenueCount: withRev.length,
    medianGrowth: median(growth),
    growthCount: growth.length,
    employees: withEmp.reduce((s, r) => s + (r.employees ?? 0), 0),
    employeesCount: withEmp.length,
    exporters: rows.filter(r => r.exports === true).length,
    overseas: rows.filter(r => r.exports !== true && ((r.foreign_subsidiaries ?? 0) > 0 || r.operates_abroad === true)).length,
    groups_with_members: rows.filter(r => r.is_group_head && (r.group_companies ?? 0) > 1).length,
  }
}

/** Count of matched rows by a key (each row counted once per key value it carries). */
export function countBy(rows: CompanyRow[], keys: (r: CompanyRow) => string[]): [string, number][] {
  const m = new Map<string, number>()
  for (const r of rows) for (const k of new Set(keys(r))) if (k) m.set(k, (m.get(k) ?? 0) + 1)
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

type Where = { field: string; op: 'eq' | 'gte' | 'lte' | 'in'; value: unknown }

/**
 * The same question as a query_data call an AI can run. query_data filters with eq / gte / lte / in
 * only; sector filters go to lk-company-sectors, which repeats the main measures per tag. Text
 * search has no equivalent and is described in words instead.
 */
export function toQuery(f: CompanyFilter): { dataset_id: string; where: Where[]; order_by: { field: string; direction: 'asc' | 'desc' }[]; unsupported: string[] } {
  const sectorTable = f.sectors.length > 0 || f.families.length > 0
  const where: Where[] = []
  const unsupported: string[] = []
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
    if (own.length) where.push({ field: 'ownership', op: 'in', value: own })
  }
  if (f.listed) where.push({ field: 'listed', op: 'eq', value: f.listed === 'yes' })
  if (f.isic.length) {
    if (sectorTable) unsupported.push(`ISIC section ${f.isic.join(', ')}`)
    else where.push({ field: 'isic_section', op: 'in', value: f.isic })
  }
  if (f.growthMin !== null) where.push({ field: 'revenue_growth_pct', op: 'gte', value: f.growthMin })
  if (f.growthMax !== null) where.push({ field: 'revenue_growth_pct', op: 'lte', value: f.growthMax })
  if (f.revenueMinBn !== null) where.push({ field: 'revenue_lkr', op: 'gte', value: f.revenueMinBn * 1e9 })
  if (f.employeesMin !== null) where.push({ field: 'employees', op: 'gte', value: f.employeesMin })
  for (const k of f.abroad) {
    if (k === 'foreign_subsidiaries') {
      if (sectorTable) unsupported.push('has overseas subsidiaries')
      else where.push({ field: 'foreign_subsidiaries', op: 'gte', value: 1 })
    } else if (k === 'foreign_owned' && sectorTable) unsupported.push('has a foreign parent')
    else where.push({ field: k, op: 'eq', value: true })
  }
  if (f.q) unsupported.push(`name or description contains "${f.q}"`)
  const sortField = { revenue: 'revenue_lkr', growth: 'revenue_growth_pct', employees: 'employees', name: 'name', profit_growth: 'profit_growth_pct' }[f.sort]
  const order = sectorTable && f.sort === 'profit_growth' ? 'revenue_growth_pct' : sortField
  return { dataset_id: sectorTable ? 'lk-company-sectors' : 'lk-companies', where: where.slice(0, 8), order_by: [{ field: order, direction: f.desc ? 'desc' : 'asc' }], unsupported }
}
