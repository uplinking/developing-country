import { describe, expect, test } from 'bun:test'
import { readFileSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseIndicatorTable, selectRows } from '../packages/datasets/src/table'
import { RECOVERY_DATASETS } from '../packages/datasets/src/recovery'
import { SLDU_RECIPES, buildSlduTables } from './build-sldu.mjs'
import { htmlTables } from './build-recovery-data.mjs'
import { canonical, readSource, sha256, writeTables } from './lib/reviewed-source.mjs'

const tables = new Map(RECOVERY_DATASETS.map(d => [d.id, parseIndicatorTable(JSON.parse(readFileSync(`public/data/${d.id}.json`, 'utf8')))]))
const rows = (id: string) => tables.get(id)!.rows

describe('reviewed historical-source imports', () => {
  test('every chart returns bounded observations without duplicate series-period pairs', () => {
    for (const dataset of RECOVERY_DATASETS) for (const preset of dataset.presets) {
      const result = selectRows(tables.get(dataset.id)!, preset.query)
      expect(result.rows.length, `${dataset.id}/${preset.id}`).toBeGreaterThan(0)
      expect(result.truncated, dataset.id).toBe(false)
      const keys = result.rows.map(r => JSON.stringify([r[preset.chart.dimension.field], preset.chart.series ? r[preset.chart.series.field] : null]))
      expect(new Set(keys).size, dataset.id).toBe(keys.length)
    }
  })
  test('all ten report vintages rebuild byte-identical normalized tables', () => {
    expect(SLDU_RECIPES.documents).toHaveLength(10)
    for (const table of buildSlduTables()) expect(canonical(parseIndicatorTable({schema_version: 1, country: 'LK', ...table}))).toEqual(canonical(tables.get(table.dataset_id)))
  })
  test('poverty thresholds and PPP bases are never spliced; survey benchmarks stay distinct', () => {
    const poverty = rows('worldbank-poverty-estimates')
    expect(new Set(poverty.map(r => r.ppp_year))).toEqual(new Set([2011, 2017, 2021]))
    expect(poverty.find(r => r.edition === '2026-10' && r.year === 2024 && r.poverty_line_usd_day === 4.2)?.value).toBe(18.4)
    expect(poverty.filter(r => r.edition === '2026-10').every(r => Number(r.year) >= 2022)).toBe(true)
    expect(poverty.find(r => r.edition === '2022-10' && r.year === 2019)?.observation_status).toBe('survey_benchmark')
    expect(poverty.find(r => r.edition === '2021-04' && r.year === 2019)?.observation_status).toBe('nowcast')
    expect(poverty.find(r => r.edition === '2026-10' && r.year === 2026)?.observation_status).toBe('forecast')
  })
  test('expenditure footnotes override unmarked columns and p markers remain visible', () => {
    const macro = rows('worldbank-economic-outlook')
    expect(macro.find(r => r.edition === '2026-05' && r.year === 2024 && r.metric === 'private_consumption_growth')?.observation_status).toBe('estimate')
    expect(macro.find(r => r.edition === '2024-04' && r.year === 2023 && r.metric === 'real_gdp_growth')?.source_column_marker).toBe('p')
    expect(macro.find(r => r.edition === '2025-10' && r.year === 2025 && r.metric === 'real_gdp_growth')?.value).toBe(4.6)
  })
  test('retains census revisions instead of replacing earlier labour estimates', () => {
    const labour = rows('labour-force-sex-history').filter(r => r.period === '2025-Q1' && r.sex === 'Both sexes')
    expect(new Set(labour.map(r => r.edition)).size).toBeGreaterThan(1)
    expect(new Set(labour.map(r => r.population)).size).toBeGreaterThan(1)
    expect(labour.filter(r => r.is_latest_revision)).toHaveLength(1)
    expect(labour.find(r => r.is_latest_revision)?.review_note).toContain('Census 2024')
  })
  test('reviewed quarter-heading corrections retain printed periods; ambiguity never wins a latest-series query', () => {
    const profile = rows('labour-employment-profile-history')
    const corrected = profile.find(r => r.edition === '2021-Q4' && r.sex === 'Both sexes' && r.population_group === 'Employed' && r.breakdown === 'Age' && r.period === '2021-Q4' && r.category === '15–19')!
    expect(corrected.source_period).toBe('2019-Q4')
    expect(corrected.value).toBe(1.3)
    expect(corrected.review_note).toContain('2022 Q4')
    expect(profile.filter(r => r.period_ambiguous)).toHaveLength(63)
    expect(profile.filter(r => r.period_ambiguous).every(r => !r.is_latest_revision)).toBe(true)
    expect(profile.find(r => r.edition === '2023-Q4' && r.period === '2023-Q4' && r.category === 'Employee' && r.sex === 'Both sexes')?.value).toBe(58.1)
    expect(profile.some(r => r.high_cv === null)).toBe(true)
  })
  test('national monthly prices keep unavailable inflation null and exclude annual summaries', () => {
    const prices = rows('ncpi-monthly')
    expect(prices).toHaveLength(168)
    expect(prices.find(r => r.period === '2022-01' && r.group === 'All items')?.year_on_year_pct).toBeNull()
    expect(new Set(prices.map(r => r.period)).size).toBe(56)
  })
  test('nutrition uses campaign history and never fills missing indicators', () => {
    const nutrition = rows('child-nutrition-annual')
    expect(nutrition.find(r => r.year === 2016 && r.indicator === 'Underweight')?.value).toBe(15.6)
    expect(nutrition.find(r => r.year === 2025 && r.indicator === 'Underweight')?.value).toBe(16.1)
    expect(nutrition.every(r => r.programme === 'Nutrition Month')).toBe(true)
  })
  test('paddy has national seasonal history, source blanks and annotated malformed headings', () => {
    const production = rows('paddy-production-history')
    expect(production.find(r => r.geography === 'SRI LANKA' && r.season === 'Maha' && r.year === 1979)).toBeDefined()
    expect(production.find(r => r.source_season_label === '198')?.year).toBe(1980)
    expect(rows('paddy-harvested-area-history').find(r => r.source_season_label === '2000/2021')?.year).toBe(2021)
    expect(production.some(r => r.value === null)).toBe(true)
    expect(production.some(r => r.geography_type === 'special area')).toBe(true)
  })
  test('commented-out agricultural cells cannot shift the visible years', () => {
    expect(htmlTables('<table><tr><td>Crop</td><!--<td>old</td>--><td>2014</td></tr></table>')).toEqual([[['Crop','2014']]])
  })
  test('a changed raw source is rejected before interpretation', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dc-source-test-'))
    try {
      writeFileSync(join(dir,'source'), 'changed')
      expect(() => readSource({ file:'source', sourceId:'fixture', sha256:sha256('reviewed') },dir)).toThrow('changed; review')
    } finally { rmSync(dir,{recursive:true,force:true}) }
  })
  test('a later invalid table prevents earlier output from being written', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dc-source-test-'))
    try {
      const valid = tables.get('ncpi-monthly')!
      expect(() => writeTables([valid,{...valid,dataset_id:'bad',rows:[valid.rows[0],valid.rows[0]]}],dir)).toThrow()
      expect(existsSync(join(dir,'ncpi-monthly.json'))).toBe(false)
    } finally { rmSync(dir,{recursive:true,force:true}) }
  })
})
