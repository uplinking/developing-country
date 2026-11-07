#!/usr/bin/env bun
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { dim, measure, evidenceFields, evidence, invariant, sha256, readSource, pdfPages, writeTables } from './lib/reviewed-source.mjs'

const ROOT = resolve(import.meta.dir, '..')
export const SLDU_RECIPES = JSON.parse(readFileSync(join(ROOT, 'scripts/sldu/recipes.json'), 'utf8'))

function macroIdentity(label, edition) {
  const l = label.toLowerCase()
  if (l.includes('poverty rate')) return null
  if (l.includes('factor prices')) return ['real_gdp_factor_growth', '% annual change']
  if (l.startsWith('real gdp') || l.startsWith('gdp (expenditure')) return ['real_gdp_growth', '% annual change']
  if (l.startsWith('private consumption')) return ['private_consumption_growth', '% annual change']
  if (l.startsWith('government consumption')) return ['government_consumption_growth', '% annual change']
  if (l.startsWith('gross fixed capital')) return ['fixed_investment_growth', '% annual change']
  if (['agriculture', 'industry', 'services'].includes(l)) return [`${l}_growth`, '% annual change']
  if (l.includes('consumer price') || l.startsWith('cpi')) return ['consumer_price_inflation', '% annual change']
  if (l.startsWith('gdp deflator')) return ['gdp_deflator_growth', '% annual change']
  if (l.startsWith('nominal gdp')) return ['nominal_gdp_lkr', 'LKR billion']
  if (l.startsWith('gdp (us$')) return ['nominal_gdp_usd', 'USD billion']
  if (l.startsWith('exports') || l.startsWith('imports')) {
    const flow = l.startsWith('exports') ? 'exports' : 'imports'
    const share = l.includes(' of goods') || (edition === '2026-10' && l.includes('goods and services'))
    return [`${flow}_${share ? 'share' : 'growth'}`, share ? '% of GDP' : '% annual change']
  }
  if (l.includes('current account')) return ['current_account_balance', '% of GDP']
  if (l.includes('foreign direct investment')) return ['net_fdi', '% of GDP']
  if (l.includes('reserves')) return [l.includes('months') ? 'reserve_import_cover' : 'usable_reserves_usd', l.includes('months') ? 'months of imports' : 'USD million']
  if (l.includes('primary balance')) return ['primary_balance', '% of GDP']
  if (l.includes('fiscal balance')) return ['fiscal_balance', '% of GDP']
  if (l.includes('debt')) return [l.includes('public and publicly') ? 'public_guaranteed_debt' : l.includes('central government') || edition >= '2025-10' ? 'central_government_debt' : 'reported_debt_unspecified', '% of GDP']
  if (l.includes('tax revenue')) return ['tax_revenue', '% of GDP']
  if (l.includes('revenue')) return [l.includes('grants') ? 'revenue_and_grants' : 'reported_revenue', '% of GDP']
  if (l.includes('expenditure')) return ['government_expenditure', '% of GDP']
  if (l.startsWith('remittances')) return ['remittances_share', '% of GDP']
  if (l.startsWith('employment rate')) return ['employment_population_ratio', '% working-age population']
  if (l.startsWith('energy related')) return ['energy_ghg_share', '% total emissions']
  if (/^gh[ge] emissions/.test(l)) return ['ghg_emissions_growth', '% annual change']
  throw new Error(`Unreviewed macro row: ${label}`)
}

function status(document, year, poverty) {
  if (poverty) {
    if(year===2019 && document.edition!=='2021-04')return 'survey_benchmark'
    const nowcastEnd = document.edition === '2023-10' ? 2022 : document.edition === '2025-10' ? 2024 : Number(document.edition.slice(0, 4)) - (document.edition.endsWith('-10') ? 1 : 1)
    const forecastStart = document.edition === '2022-10' ? 2023 : nowcastEnd + 1
    return year >= forecastStart ? 'forecast' : 'nowcast'
  }
  const marker=document.columnMarkers[document.years.indexOf(year)]
  if(marker==='p' && year<Number(document.edition.slice(0,4)))return 'published_p_marker'
  const editionYear = Number(document.edition.slice(0, 4))
  const estimateYear = document.edition === '2024-10' || document.edition === '2026-10' ? null : document.edition.endsWith('-10') ? editionYear : editionYear - 1
  if (year >= editionYear && year !== estimateYear) return 'forecast'
  if (year === estimateYear) return 'estimate'
  return 'reported_historical'
}

export function buildSlduTables(recipes = SLDU_RECIPES) {
  const macro = [], poverty = []
  for (const document of recipes.documents) {
    invariant(document.years.length > 0 && document.rows.length >= 8, `empty edition ${document.edition}`)
    for (let index = 0; index < document.rows.length; index++) {
      const row = document.rows[index]
      invariant(row.values.length === document.years.length, `column count ${document.edition}: ${row.label}`)
      const isPoverty = row.label.toLowerCase().includes('poverty rate')
      const identity = isPoverty ? null : macroIdentity(row.label, document.edition)
      const ppp = isPoverty ? /\$(\d+(?:\.\d+)?) in (\d{4}) PPP/.exec(row.label) : null
      invariant(!isPoverty || ppp, `poverty definition missing: ${row.label}`)
      document.years.forEach((year, column) => {
        const value = row.values[column]
        invariant(value === null || Number.isFinite(value), `invalid cell ${document.edition}: ${row.label}`)
        const componentEstimate = !isPoverty && ['private_consumption_growth','government_consumption_growth','fixed_investment_growth','exports_growth','imports_growth'].includes(identity[0]) && ({'2023-10':[2020,2021],'2024-04':[2020,2021,2022],'2025-04':[2022,2023,2024],'2026-05':[2022,2023,2024,2025]}[document.edition]??[]).includes(year)
        const common = { record_id: `${document.edition}:${index}:${year}`, edition: document.edition, year, source_label: row.label, source_column_marker: document.columnMarkers[column]||'unmarked', observation_status: componentEstimate?'estimate':status(document, year, isPoverty), value,
          ...evidence(document, `PDF physical page ${document.page}; ${row.line ? `text line ${row.line}` : `reviewed row ${index + 1}`}; year ${year}`, row.review ?? null) }
        if (isPoverty) {
          invariant(value === null || value >= 0 && value <= 100, 'poverty percentage out of range')
          poverty.push({ ...common, poverty_line_usd_day: Number(ppp[1]), ppp_year: Number(ppp[2]), estimation_method: document.edition === '2026-10' ? 'HIES 2019 calibration with LFS survey-to-survey imputation and projections' : document.edition === '2021-04' ? 'HIES 2016 neutral-distribution projection' : 'HIES 2019 macro-to-micro simulation/projection', unit: '% population' })
        } else macro.push({ ...common, metric: identity[0], unit: identity[1], definition_note: componentEstimate?'The report footnote identifies expenditure components for this year as estimates.':document.edition >= '2025-10' && identity[0] === 'primary_balance' ? 'Excludes interest payments received.' : identity[0] === 'usable_reserves_usd' ? 'Published official reserves exclude the conditional Chinese currency swap.' : 'Use this edition’s source labels and footnotes; revisions and national-accounting changes are preserved.' })
      })
    }
  }
  const commonFields = [...evidenceFields, dim('edition', 'string', 'Report edition'), dim('year', 'year', 'Observation or forecast year'), dim('source_label', 'string', 'Printed source label'), dim('source_column_marker','string','Printed column marker (e/f/p or unmarked)'), dim('observation_status', 'string', 'Historical, estimate, nowcast or forecast'), dim('unit', 'string', 'Unit'), measure('value', 'Published value')]
  const sourceIds = recipes.documents.map(d => d.sourceId)
  const common = { vintage: 'SLDU editions April 2021–October 2026; reported years 2018–2028', notes: ['Each report edition remains separately queryable. Older forecasts are not observations; omitted cells stay null or absent.'], caveats: ['Selected economic tables only, not the complete reports. Do not splice different editions into a trend without checking definitions and revisions.'] }
  const latest = recipes.documents.find(d => d.edition === '2026-10')
  const regional = Object.entries({ Northern: 30, 'North Central': 18, 'North Western': 14, Central: 25, Eastern: 28, Western: 9, Sabaragamuwa: 26, Uva: 29, Southern: 15 }).map(([province, value]) => ({ record_id: `2026-10:2024:${province}`, edition: '2026-10', year: 2024, province, poverty_line_usd_day: 4.2, ppp_year: 2021, estimation_method: 'LFS survey-to-survey imputation', value, ...evidence(latest, 'PDF physical page 34, Figure 1.28, printed province label', 'Rounded whole-percentage map label visually reviewed; no district estimates inferred.') }))
  return [
    { ...common, dataset_id: 'worldbank-economic-outlook', title: 'World Bank economic outlook by report edition', source_ids: sourceIds, grain: 'Report edition × year × economic metric; definitions and units retained', primary_key: ['edition', 'metric', 'year'], fields: [...commonFields, dim('metric', 'string', 'Economic metric'), dim('definition_note', 'string', 'Definition note')], rows: macro },
    { ...common, dataset_id: 'worldbank-poverty-estimates', title: 'World Bank poverty estimates and forecast vintages', source_ids: sourceIds.filter(id => poverty.some(row => row.source_id === id)), grain: 'Report edition × year × poverty threshold × PPP base', primary_key: ['edition', 'year', 'poverty_line_usd_day', 'ppp_year'], fields: [...commonFields, dim('poverty_line_usd_day', 'number', 'Daily poverty threshold, USD'), dim('ppp_year', 'year', 'PPP price base'), dim('estimation_method', 'string', 'Estimation method')], caveats: [...common.caveats, '2011, 2017 and 2021 PPP thresholds and the October 2026 estimation revision are distinct. This is not official district HIES poverty. The latest table covers 2022–2028; no missing historical observations are invented.'], rows: poverty },
    { dataset_id: 'worldbank-poverty-province', title: 'World Bank provincial poverty estimates, 2024', source_ids: [latest.sourceId], vintage: '2024 estimates, October 2026 edition', grain: 'Province × 2024 reference year at USD 4.20/day, 2021 PPP', primary_key: ['province', 'year', 'edition'], fields: [...evidenceFields, dim('edition', 'string', 'Report edition'), dim('year', 'year', 'Reference year'), dim('province', 'string', 'Province'), dim('poverty_line_usd_day', 'number', 'Daily poverty threshold, USD'), dim('ppp_year', 'year', 'PPP base'), dim('estimation_method', 'string', 'Estimation method'), measure('value', 'Estimated poverty headcount', '% population')], caveats: ['Rounded province map labels, not district estimates or a provincial time series. Values are modelled rather than official HIES observations.'], rows: regional },
  ]
}

export function verifySlduSources(directory, fetchRemote = false, recipes = SLDU_RECIPES) {
  for (const document of recipes.documents) {
    const { path } = readSource(document, directory, fetchRemote)
    const page = pdfPages(path)[document.page - 1]
    invariant(page, `page missing ${document.sourceId}`)
    const lines = page.split('\n')
    for (const row of document.rows) if (row.line) invariant(sha256(lines[row.line - 1]) === row.lineHash, `reviewed row changed ${document.sourceId}: ${row.label}`)
  }
}

if (import.meta.main) {
  const arg = process.argv.indexOf('--source-dir')
  const directory = arg >= 0 ? resolve(process.argv[arg + 1]) : mkdtempSync(join(tmpdir(), 'dc-sldu-'))
  try {
    if (!process.argv.includes('--check')) verifySlduSources(directory, arg < 0)
    writeTables(buildSlduTables(), join(ROOT, 'public/data'), process.argv.includes('--check'))
  } finally { if (arg < 0) rmSync(directory, { recursive: true, force: true }) }
}
