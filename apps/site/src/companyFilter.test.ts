import { describe, expect, test } from 'bun:test'
import { EMPTY_FILTER, filterToParams, matches, parseFilter, sortRows, summarize, toQuery, type CompanyRow } from './lib/companyFilter'

const row = (o: Partial<CompanyRow>): CompanyRow => ({
  company_id: 'c', name: 'C', group_id: 'c', group_name: 'C', relation_to_group: 'ultimate_parent', is_group_head: true, group_companies: 1,
  listed: false, cse_symbol: null, ownership: 'private_local', country: 'Sri Lanka', what_it_does: null, primary_sector: null, sector_family: null,
  sector_tags: null, isic_section: null, isic_section_label: null, revenue_lkr: null, revenue_prior_lkr: null, revenue_growth_nominal_pct: null, revenue_growth_real_pct: null, revenue_comparable: true, revenue_additive_lkr: null, net_profit_margin_pct: null, performance: null, controller_type: null, employees_additive: null,
  revenue_scope: null, profit_after_tax_lkr: null, profit_after_tax_growth_pct: null, employees: null, operates_abroad: false, exports: false,
  foreign_subsidiaries: 0, foreign_owned: false, ...o,
})
const FAM = new Map([['solar', 'energy'], ['hydro', 'energy'], ['tea', 'agriculture']])

describe('company filter', () => {
  test('URL round trip keeps every filter', () => {
    const f = { ...EMPTY_FILTER, q: 'power', families: ['energy'], sectors: ['solar'], growthBasis: 'nominal' as const, performance: ['loss_both_years'], growthMin: 10, employeesMin: 1000, abroad: ['exports' as const], sort: 'growth' as const, desc: false, listed: 'yes' as const }
    expect(parseFilter(filterToParams(f))).toEqual(f)
  })

  test('a group view lists all companies of the group', () => {
    const f = parseFilter(new URLSearchParams('group=g1'))
    expect(f.scope).toBe('all')
    expect(matches(row({ company_id: 's', group_id: 'g1', is_group_head: false }), f, FAM)).toBe(true)
    expect(matches(row({ company_id: 'x', group_id: 'g2' }), f, FAM)).toBe(false)
  })

  test('sector, growth, employees and abroad filters combine', () => {
    const f = { ...EMPTY_FILTER, sectors: ['solar'], growthMin: 10, employeesMin: 1000, abroad: ['exports' as const] }
    const ok = row({ sector_tags: 'hydro; solar', revenue_growth_real_pct: 12.5, revenue_growth_nominal_pct: 13, employees: 1200, exports: true })
    expect(matches(ok, f, FAM)).toBe(true)
    expect(matches({ ...ok, revenue_growth_real_pct: null }, f, FAM)).toBe(false)
    expect(matches({ ...ok, employees: 900 }, f, FAM)).toBe(false)
    expect(matches({ ...ok, exports: false }, f, FAM)).toBe(false)
    expect(matches({ ...ok, sector_tags: 'tea' }, f, FAM)).toBe(false)
    expect(matches({ ...ok, sector_tags: 'tea' }, { ...f, sectors: [], families: ['agriculture'] }, FAM)).toBe(true)
  })

  test('groups scope hides subsidiaries', () => {
    expect(matches(row({ is_group_head: false }), EMPTY_FILTER, FAM)).toBe(false)
    expect(matches(row({ is_group_head: false }), { ...EMPTY_FILTER, scope: 'all' }, FAM)).toBe(true)
  })

  test('nominal and real growth filter separately; incomparable revenue never ranks', () => {
    const r = row({ revenue_growth_real_pct: 4, revenue_growth_nominal_pct: 12 })
    expect(matches(r, { ...EMPTY_FILTER, growthMin: 10 }, FAM)).toBe(false)
    expect(matches(r, { ...EMPTY_FILTER, growthBasis: 'nominal', growthMin: 10 }, FAM)).toBe(true)
    const rows = [row({ name: 'w', revenue_lkr: 99, revenue_comparable: false }), row({ name: 'x', revenue_lkr: 5 })]
    expect(sortRows(rows, 'revenue', true).map(x => x.name)).toEqual(['x', 'w'])
    expect(summarize(rows).revenueLkr).toBe(5)
  })

  test('rows without a value sink whatever the direction', () => {
    const rows = [row({ name: 'a', revenue_lkr: null }), row({ name: 'b', revenue_lkr: 5 }), row({ name: 'c', revenue_lkr: 9 })]
    expect(sortRows(rows, 'revenue', true).map(r => r.name)).toEqual(['c', 'b', 'a'])
    expect(sortRows(rows, 'revenue', false).map(r => r.name)).toEqual(['b', 'c', 'a'])
  })

  test('a group is never added to its own subsidiaries', () => {
    const s = summarize([
      row({ company_id: 'g', group_id: 'g', revenue_lkr: 100, employees: 50 }),
      row({ company_id: 's', group_id: 'g', is_group_head: false, revenue_lkr: 40, employees: 20 }),
      row({ company_id: 'o', group_id: 'o', revenue_lkr: 10 }),
    ])
    expect(s.revenueLkr).toBe(110)
    expect(s.employees).toBe(50)
    expect(s.groups).toBe(2)
  })

  test('query uses only eq/gte/lte/in and the sector table for sectors', () => {
    const q = toQuery({ ...EMPTY_FILTER, sectors: ['solar'], growthMin: 10, abroad: ['operates_abroad'] })
    expect(q.dataset_id).toBe('lk-company-sectors')
    expect(q.where.every(w => ['eq', 'gte', 'lte', 'in'].includes(w.op))).toBe(true)
    expect(q.where).toContainEqual({ field: 'revenue_growth_real_pct', op: 'gte', value: 10 })
    expect(toQuery({ ...EMPTY_FILTER, growthBasis: 'nominal', growthMin: 5 }).where).toContainEqual({ field: 'revenue_growth_nominal_pct', op: 'gte', value: 5 })
    expect(toQuery({ ...EMPTY_FILTER, employeesMin: 1000 }).dataset_id).toBe('lk-companies')
  })
})
