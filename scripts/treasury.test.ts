import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { extractCells, sha256, publicationLinks, assertReviewedLinks } from './treasury/extract.mjs'
import { parseIndicatorTable, selectRows } from '../packages/datasets/src/table'
import { TREASURY_DATASETS, TREASURY_TABLES } from '../packages/datasets/src/treasury'

function recipe(line: string, count = 3) {
  return { dataset: 'test', document: 'fixture', page: 1, line: 1, line_sha256: sha256(line), label: 'Example', columns: Array(count).fill({}) }
}
describe('Treasury extraction guards', () => {
  test('keeps missing cells separate from zero and parentheses negative', () => {
    const line = 'Example     0   (1,200.5)   ND'
    expect(extractCells(recipe(line), [line]).map((c: {value: number | null}) => c.value)).toEqual([0, -1200.5, null])
    const dash = 'Example     -   1   2'
    expect(extractCells(recipe(dash), [dash])[0].value_status).toBe('source dash')
  })
  test('rejects shifted columns and changed text before values can be imported', () => {
    const line = 'Example     1   2   3'
    expect(() => extractCells(recipe(line), [line.replace('2', '200')])).toThrow('Unreviewed text layout')
    expect(() => extractCells(recipe(line, 2), [line])).toThrow('Column count changed')
  })
  test('discovers year navigation as well as document links and rejects new editions', () => {
    const html = '<div class="page-template--body"><div class="page-template--body__nav"><a href="/web/annual-reports/section/2027">2027</a></div><div class="page-template--body__content"><a href="/api/file/new">English</a></div><footer><a href="/web/irrelevant">Footer</a>'
    const links = publicationLinks(html, 'https://www.treasury.gov.lk/web/annual-reports')
    expect(links).toHaveLength(2)
    expect(() => assertReviewedLinks(links, [], 'fixture')).toThrow('needs review')
    expect(() => publicationLinks('<html>Maintenance</html>', 'fixture')).toThrow('layout changed')
  })
})
describe('Treasury public artifacts', () => {
  test('keeps reviewed extraction metadata aligned with the public definitions', () => {
    const manifest = JSON.parse(readFileSync('scripts/treasury/recipes.json', 'utf8'))
    expect(manifest.datasets).toEqual([...TREASURY_TABLES])
  })
  const tables = new Map(TREASURY_TABLES.map(d => [d.id, parseIndicatorTable(JSON.parse(readFileSync(`public/data/${d.id}.json`, 'utf8')))]))
  test('every preset returns data with one unit and no duplicate display labels', () => {
    for (const d of TREASURY_DATASETS) {
      const table = tables.get(d.id as typeof TREASURY_TABLES[number]['id'])!
      for (const preset of d.presets) {
        const result = selectRows(table, preset.query)
        expect(result.rows.length, d.id).toBeGreaterThan(0)
        expect(new Set(result.rows.map(r => r[preset.chart.dimension.field])).size, d.id).toBe(result.rows.length)
      }
    }
  })
  test('reconciles headline debt totals in LKR, allowing printed rounding', () => {
    const rows = tables.get('treasury-public-debt')!.rows.filter(r => r.period === '2026-06-30' && r.unit === 'LKR billion')
    const value = (subject: string) => Number(rows.find(r => r.subject === subject)!.value)
    expect(value('Total Debt of the Government')).toBe(31999)
    expect(value('Domestic Debt') + value('External Debt')).toBe(value('Total Debt of the Government'))
    expect(value('Total Debt of the Government') + value('Total Debt of SOEs') + value('Total PC and LG Debt')).toBe(value('Total Public Debt (Gross)'))
  })
  test('preserves the published CEB loss, not a sign-stripped profit', () => {
    const r = tables.get('treasury-soe-finances')!.rows.find(r => r.subject === 'Ceylon Electricity Board' && r.metric === 'Total Comprehensive Income/ (Loss) for the period' && r.period === '2025')
    expect(r?.value).toBe(-36074)
  })
})

describe('Treasury historical and merged-cell coverage', () => {
  const read = (id: string) => parseIndicatorTable(JSON.parse(readFileSync(`public/data/${id}.json`, 'utf8')))
  const editions = ['2022-09-30', '2023-03-31', '2023-06-30', '2023-09-30', '2023-12-31', '2024-03-31', '2024-06-30', '2024-09-30', '2024-12-31', '2025-03-31', '2025-06-30', '2025-09-30', '2025-12-31', '2026-03-31', '2026-06-30']
  test('covers every listed quarterly edition in all three historical debt tables', () => {
    for (const id of ['treasury-public-debt', 'treasury-domestic-debt', 'treasury-external-creditors']) {
      expect([...new Set(read(id).rows.map(r => r.reporting_period))].sort()).toEqual(editions)
    }
  })
  test('reconciles domestic snapshots across independently published summary and instrument tables', () => {
    const summary = read('treasury-public-debt').rows
    const instruments = read('treasury-domestic-debt').rows
    for (const edition of editions) {
      const headline = summary.find(r => r.reporting_period === edition && r.period === edition && r.subject === 'Domestic Debt' && r.unit === 'USD million')!
      const total = instruments.find(r => r.reporting_period === edition && r.period === edition && r.subject === 'Total' && ['USD', 'USD million'].includes(String(r.unit)))!
      expect(headline, edition).toBeDefined()
      expect(total, edition).toBeDefined()
      const amount = Number(total.value) / (total.unit === 'USD' ? 1e6 : 1)
      expect(Math.abs(Number(headline.value) - amount), edition).toBeLessThan(1)
    }
  })
  test('retains revised comparison periods instead of overwriting the original edition', () => {
    const rows = read('treasury-public-debt').rows.filter(r => r.period === '2023-03-31' && r.subject === 'External Debt')
    expect(new Set(rows.map(r => r.reporting_period)).size).toBe(2)
    expect(new Set(rows.map(r => r.value)).size).toBe(2)
  })
  test('reads the scanned Q4 2025 tables and the wrapped Q1 2024 external-debt row', () => {
    const summary = read('treasury-public-debt').rows
    expect(summary.find(r => r.period === '2025-12-31' && r.reporting_period === '2025-12-31' && r.subject === 'Total Debt of the Government' && r.unit === 'USD million')?.value).toBe(100356)
    expect(summary.find(r => r.period === '2024-03-31' && r.reporting_period === '2024-03-31' && r.subject === 'External Debt')?.value).toBe(37041)
    expect(read('treasury-external-creditors').rows.find(r => r.reporting_period === '2025-12-31' && r.subject === 'Total' && r.metric === 'Outstanding debt')?.value).toBe(37663.2)
  })
  test('keeps 143 facility identities and records each of 16 merged balances once', () => {
    const rows = read('treasury-guarantees').rows
    const commitments = rows.filter(r => r.metric === 'Original commitment')
    expect(new Set(commitments.map(r => r.instrument_id)).size).toBe(143)
    const shared = rows.filter(r => r.instrument_id === '59,60,61,62' && r.unit === 'LKR million')
    expect(shared).toHaveLength(1)
    expect(shared[0].value).toBe(16666.66)
    expect(rows.filter(r => ['59', '60', '61', '62'].includes(String(r.instrument_id)) && r.metric === 'Outstanding principal').every(r => r.value === null)).toBe(true)
    expect(new Set(rows.filter(r => String(r.instrument_id).includes(',')).map(r => r.instrument_id)).size).toBe(16)
  })
  test('preserves the source currency-placement discrepancy and the three LC facilities', () => {
    const rows = read('treasury-guarantees').rows
    const cell = rows.find(r => r.instrument_id === '23' && r.metric === 'Outstanding principal' && r.unit === 'LKR million')!
    expect(cell.value).toBe(61.85)
    expect(cell.review_note).toContain('Printed placement is retained')
    const lc = read('treasury-letters-of-comfort').rows
    expect(new Set(lc.map(r => r.instrument_id)).size).toBe(3)
    expect(lc.filter(r => r.metric === 'Original commitment' && r.unit === 'LKR million').reduce((n, r) => n + Number(r.value), 0)).toBe(940)
    expect(lc.filter(r => r.metric === 'Outstanding principal' && r.unit === 'LKR million').reduce((n, r) => n + Number(r.value), 0)).toBeCloseTo(789.6, 2)
  })
})

test('backfills nine provinces in each of the seven published subnational tables', () => {
  const table = parseIndicatorTable(JSON.parse(readFileSync('public/data/treasury-province-debt.json', 'utf8')))
  expect([...new Set(table.rows.map(r => r.reporting_period))].sort()).toEqual(['2024-12-31', '2025-03-31', '2025-06-30', '2025-09-30', '2025-12-31', '2026-03-31', '2026-06-30'])
  for (const edition of new Set(table.rows.map(r => r.reporting_period))) {
    expect(table.rows.filter(r => r.reporting_period === edition)).toHaveLength(27)
  }
  const scanned = table.rows.filter(r => r.reporting_period === '2025-12-31' && r.metric === 'Authorities with liabilities')
  expect(scanned.reduce((n, r) => n + Number(r.value), 0)).toBe(98)
})
