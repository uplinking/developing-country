import { describe, expect, test } from 'bun:test'
import {
  EMPTY_FILTER, applyLens, coverage, effectiveFilter, emptyFilter, filterToParams, inBucket, LENSES, listedOnlyActive, matches,
  parseFilter, rangeBounds, sortRows, summarize, toQuery, type CompanyFilter, type CompanyRow,
} from './lib/companyFilter'

const row = (o: Partial<CompanyRow>): CompanyRow => ({
  company_id: 'c', name: 'C', group_id: 'c', group_name: 'C', relation_to_group: 'ultimate_parent', is_group_head: true, group_companies: 1,
  listed: false, cse_symbol: null, ownership: 'private_local', country: 'Sri Lanka', what_it_does: null, primary_sector: null, sector_family: null,
  sector_tags: null, isic_section: null, isic_section_label: null, revenue_lkr: null, revenue_prior_lkr: null, revenue_growth_nominal_pct: null, revenue_growth_real_pct: null, revenue_comparable: true, revenue_additive_lkr: null, net_profit_margin_pct: null, performance: null, controller_type: null, employees_additive: null,
  revenue_scope: null, profit_after_tax_lkr: null, profit_after_tax_growth_pct: null, employees: null, operates_abroad: false, exports: false,
  foreign_subsidiaries: 0, foreign_owned: false, ...o,
})
const FAM = new Map([['solar', 'energy'], ['hydro', 'energy'], ['tea', 'agriculture']])
const f = (o: Partial<CompanyFilter>): CompanyFilter => ({ ...emptyFilter(), ...o })

describe('company filter', () => {
  test('URL round trip keeps every filter', () => {
    const x = f({ q: 'power', families: ['energy'], sectors: ['solar'], growthBasis: 'nominal', performance: ['loss_both_years'], abroad: ['exports'],
      kinds: ['bank'], ranges: { growth: '10-25,25up', employees: '1000-5000', roe: 'neg' }, lens: 'debt', cols: 'debt', sort: 'roe', desc: false, listed: 'yes' })
    expect(parseFilter(filterToParams(x))).toEqual(x)
  })

  test('old links with min-only fields still work', () => {
    const x = parseFilter(new URLSearchParams('growth_min=10&employees_min=1000&revenue_min_bn=50'))
    expect(rangeBounds('growth', x.ranges.growth!)).toEqual({ min: 10, max: null })
    expect(rangeBounds('employees', x.ranges.employees!)).toEqual({ min: 1000, max: null })
    expect(rangeBounds('revenue', x.ranges.revenue!)).toEqual({ min: 50, max: null })
  })

  test('buckets include their lower edge, exclude their upper one, and an exact bucket is one value', () => {
    expect(inBucket(10, 10, 25)).toBe(true)
    expect(inBucket(25, 10, 25)).toBe(false)
    expect(inBucket(-12, null, -10)).toBe(true)
    expect(inBucket(0, 0, 0)).toBe(true)
    expect(inBucket(0.5, 0, 0)).toBe(false)
    expect(inBucket(null, null, 5)).toBe(false)
    expect(rangeBounds('yield', '4-6,6up')).toEqual({ min: 4, max: null })
    expect(rangeBounds('yield', 'nope')).toBeNull()
  })

  test('a group view lists all companies of the group', () => {
    const x = parseFilter(new URLSearchParams('group=g1'))
    expect(x.scope).toBe('all')
    expect(matches(row({ company_id: 's', group_id: 'g1', is_group_head: false }), x, FAM)).toBe(true)
    expect(matches(row({ company_id: 'x', group_id: 'g2' }), x, FAM)).toBe(false)
  })

  test('sector, range and abroad filters combine; revenue buckets are in LKR billions', () => {
    const x = f({ scope: 'all', sectors: ['solar'], ranges: { growth: '10-25', revenue: '1-10' }, abroad: ['exports'] })
    const ok = row({ sector_tags: 'hydro; solar', revenue_growth_real_pct: 12.5, revenue_growth_nominal_pct: 13, revenue_lkr: 5e9, exports: true })
    expect(matches(ok, x, FAM)).toBe(true)
    expect(matches({ ...ok, revenue_growth_real_pct: null }, x, FAM)).toBe(false)
    expect(matches({ ...ok, revenue_lkr: 20e9 }, x, FAM)).toBe(false)
    expect(matches({ ...ok, exports: false }, x, FAM)).toBe(false)
    expect(matches({ ...ok, sector_tags: 'tea' }, { ...x, sectors: [], families: ['agriculture'] }, FAM)).toBe(true)
  })

  test('nominal and real growth filter separately', () => {
    const r = row({ revenue_growth_real_pct: 4, revenue_growth_nominal_pct: 12 })
    expect(matches(r, f({ ranges: { growth: '10-25' } }), FAM)).toBe(false)
    expect(matches(r, f({ growthBasis: 'nominal', ranges: { growth: '10-25' } }), FAM)).toBe(true)
  })

  test('a listed-only filter switches to listed companies across every company, and says why', () => {
    const x = f({ ranges: { debt: '100up' } })
    expect(listedOnlyActive(x)).toEqual(['Debt compared with equity'])
    expect(effectiveFilter(x)).toMatchObject({ listed: 'yes', scope: 'all' })
    expect(effectiveFilter(f({ ranges: { revenue: '1-10' } }))).toMatchObject({ listed: '', scope: 'groups' })
    // a listed subsidiary is found, which the By group view would have hidden
    const sub = row({ is_group_head: false, listed: true, debt_to_equity_pct: 140 })
    expect(matches(sub, effectiveFilter(x), FAM)).toBe(true)
    expect(matches(sub, x, FAM)).toBe(false)
  })

  test('every view parses back from its URL and names real filters', () => {
    for (const l of LENSES) {
      const x = applyLens(l.id)
      expect(parseFilter(filterToParams(x))).toEqual(x)
      for (const [k, ids] of Object.entries(x.ranges)) expect(rangeBounds(k, ids)).not.toBeNull()
    }
    expect(applyLens('debt')).toMatchObject({ cols: 'debt', sort: 'debt', lens: 'debt' })
  })

  test('coverage counts who reports the figure among the companies the other filters leave', () => {
    const rows = [row({ company_id: 'a', listed: true, debt_to_equity_pct: 150 }), row({ company_id: 'b', listed: true, debt_to_equity_pct: 20 }),
      row({ company_id: 'c', listed: true }), row({ company_id: 'd', listed: false })]
    expect(coverage(rows, effectiveFilter(f({ ranges: { debt: '100up' } })), FAM)).toEqual([{ key: 'debt', label: 'Debt compared with equity', base: 3, reporting: 2 }])
  })

  test('groups scope hides subsidiaries', () => {
    expect(matches(row({ is_group_head: false }), EMPTY_FILTER, FAM)).toBe(false)
    expect(matches(row({ is_group_head: false }), f({ scope: 'all' }), FAM)).toBe(true)
  })

  test('incomparable revenue never ranks, rows without a value sink, new sort keys work', () => {
    const rows = [row({ name: 'w', revenue_lkr: 99, revenue_comparable: false }), row({ name: 'x', revenue_lkr: 5 })]
    expect(sortRows(rows, 'revenue', true).map(x => x.name)).toEqual(['x', 'w'])
    expect(summarize(rows).revenueLkr).toBe(5)
    const r2 = [row({ name: 'a' }), row({ name: 'b', return_on_equity_pct: 5 }), row({ name: 'c', return_on_equity_pct: 9 })]
    expect(sortRows(r2, 'roe', true).map(r => r.name)).toEqual(['c', 'b', 'a'])
    expect(sortRows(r2, 'roe', false).map(r => r.name)).toEqual(['b', 'c', 'a'])
  })

  test('a group is never added to its own subsidiaries; profit and growth tallies count reporters only', () => {
    const s = summarize([
      row({ company_id: 'g', group_id: 'g', revenue_lkr: 100, employees: 50, performance: 'profitable_growing', revenue_growth_real_pct: 3 }),
      row({ company_id: 's', group_id: 'g', is_group_head: false, revenue_lkr: 40, employees: 20, performance: 'fell_into_loss', revenue_growth_real_pct: -2 }),
      row({ company_id: 'o', group_id: 'o', revenue_lkr: 10 }),
    ])
    expect(s.revenueLkr).toBe(110)
    expect(s.employees).toBe(50)
    expect([s.profitable, s.loss, s.performanceCount]).toEqual([1, 1, 2])
    expect([s.grewReal, s.growthCount]).toEqual([1, 2])
  })

  test('query uses only eq/gte/lte/in, the sector table for sectors, and lists what it cannot ask', () => {
    const q = toQuery(f({ sectors: ['solar'], ranges: { growth: '10-25' }, abroad: ['operates_abroad'] }))
    expect(q.dataset_id).toBe('lk-company-sectors')
    expect(q.where.every(w => ['eq', 'gte', 'lte', 'in'].includes(w.op))).toBe(true)
    expect(q.where).toContainEqual({ field: 'revenue_growth_real_pct', op: 'gte', value: 10 })
    expect(q.where).toContainEqual({ field: 'listed', op: 'eq', value: true })
    expect(toQuery(f({ growthBasis: 'nominal', ranges: { growth: '25up' } })).where).toContainEqual({ field: 'revenue_growth_nominal_pct', op: 'gte', value: 25 })
    expect(toQuery(f({ ranges: { revenue: '10-50' } })).where).toContainEqual({ field: 'revenue_lkr', op: 'lte', value: 50e9 })
    // the sector table has no interest cover: said in words, not dropped
    expect(toQuery(f({ sectors: ['solar'], ranges: { cover: 'lt1' } })).unsupported.some(u => u.includes('cover its interest'))).toBe(true)
    // more than eight conditions: the rest are named, never silently dropped
    const big = toQuery(f({ ranges: { revenue: '1-10', employees: '100-500', growth: '10-25', roe: '10-15', debt: 'lt25' } }))
    expect(big.where.length).toBe(8)
    expect(big.unsupported.filter(u => u.includes('more than eight')).length).toBeGreaterThan(0)
  })
})
