import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { URBAN_DATASETS } from '../packages/datasets/src/urban'
import { parseIndicatorTable, selectRows } from '../packages/datasets/src/table'
import { buildUrbanTables, pocketCell, reviewedPocketCell, validateReviewedRow, validateReviewedWorkbookRow } from './build-urban-data.mjs'
import { canonical } from './lib/reviewed-source.mjs'

test('reviewed urban tables reproduce artifacts and every chart has one value per category', () => {
  for (const raw of buildUrbanTables()) {
    const table = parseIndicatorTable({ schema_version: 1, country: 'LK', ...raw })
    expect(canonical(table)).toEqual(JSON.parse(readFileSync(`public/data/${raw.dataset_id}.json`, 'utf8')))
    for (const preset of URBAN_DATASETS.find(d => d.id === raw.dataset_id)!.presets) {
      const result = selectRows(table, preset.query)
      expect(result.rows.length).toBeGreaterThan(0)
      expect(result.truncated).toBe(false)
      const keys = result.rows.map(r => JSON.stringify([r[preset.chart.dimension.field], preset.chart.series ? r[preset.chart.series.field] : null]))
      expect(new Set(keys).size).toBe(keys.length)
      const withUnits = selectRows(table, { ...preset.query, fields: [...preset.query.fields!, 'unit'] })
      expect(new Set(withUnits.rows.map(r => r.unit))).toEqual(new Set([preset.chart.measure.unit]))
    }
  }
})

test('unavailable, nil/negligible and malformed source numbers stay distinct', () => {
  expect(pocketCell('..')).toEqual({ value: null, observation_status: 'not_available' })
  expect(pocketCell('-')).toEqual({ value: null, observation_status: 'nil_or_negligible' })
  expect(pocketCell('0').value).toBe(0)
  expect(pocketCell('137,259').value).toBe(137259)
  expect(() => pocketCell('19.514.67')).toThrow('ambiguous numeric token')
  expect(() => pocketCell('4,580.08.')).toThrow('ambiguous numeric token')
})

test('page review rejects changed or reordered cells', () => {
  const row = { source_line: 'Libraries 121 75 1,098 1,294', cells: ['121', '75', '1,098', '1,294'] }
  expect(() => validateReviewedRow(row, [1, 2, 3, 4], 'Libraries   121 75 1,098 1,294')).not.toThrow()
  expect(() => validateReviewedRow(row, [1, 2, 3, 4], 'Libraries 75 121 1,098 1,294')).toThrow('missing from original page')
})

test('numeric exceptions require a review and cannot guess ambiguous values', () => {
  expect(() => reviewedPocketCell('19.514.67', {value: 19514.67, status: 'source_ambiguity', note: 'Guess'})).toThrow('must remain null')
  expect(() => reviewedPocketCell('4,580.08.', {value: 4580.08, status: 'reviewed_typography', note: ''})).toThrow('needs an explanation')
  const prices = buildUrbanTables().find(t => t.dataset_id === 'building-material-prices')!
  const sand = prices.rows.find(r => r.material === 'Sand with transport' && r.year === 2025)!
  expect(sand).toMatchObject({value: null, reported_token: '19.514.67', observation_status: 'source_ambiguity'})
  expect(sand.review_note).toContain('two decimal points')
  expect(prices.rows.find(r => r.material === 'Boiled lime' && r.year === 2025)).toMatchObject({value: 4580.08, reported_token: '4,580.08.', observation_status: 'reviewed_typography'})
  expect(() => reviewedPocketCell('941,257#', {value: 941258, status: 'revised', marker: '#', note: 'Revised in the source'})).toThrow('differs from its printed digits')
  expect(buildUrbanTables().find(t => t.dataset_id === 'transport-passengers-freight')!.rows.find(r => r.year === 2024 && r.operator === 'Sri Lanka Transport Board')).toMatchObject({value: 941257, reported_token: '941,257#', observation_status: 'revised'})
})

test('local service totals reconcile without adding the total twice', () => {
  const rows = buildUrbanTables().find(t => t.dataset_id === 'local-government-services')!.rows
  expect(rows).toHaveLength(20)
  for (const service of new Set(rows.map(r => r.service))) {
    const parts = rows.filter(r => r.service === service && r.council_type !== 'Total')
    const total = rows.find(r => r.service === service && r.council_type === 'Total')!
    expect(parts.reduce((sum, r) => sum + Number(r.value), 0)).toBe(total.value)
  }
})

test('local revenue retains geographic scope, provisional status and missing receipts', () => {
  const rows = buildUrbanTables().find(t => t.dataset_id === 'local-government-revenue')!.rows
  expect(rows).toHaveLength(168)
  expect(rows.filter(r => r.council_type !== 'Pradeshiya Sabha').every(r => r.geography === 'Sri Lanka')).toBe(true)
  expect(rows.find(r => r.council_type === 'Pradeshiya Sabha' && r.geography === 'Northern' && r.revenue_category === 'Loans')).toMatchObject({value: null, reported_token: '..', observation_status: 'not_available', source_id: 'dcs-local-revenue-ps-2024'})
  expect(rows.find(r => r.council_type === 'Municipal' && r.revenue_category === 'Total revenue')).toMatchObject({value: 53561309, observation_status: 'provisional', unit: 'LKR thousand', source_id: 'dcs-local-revenue-mc-uc-2024'})
  expect(rows.find(r => r.council_type === 'Pradeshiya Sabha' && r.geography === 'Sri Lanka' && r.revenue_category === 'Total revenue')?.value).toBe(49034511)
})

test('mislabelled expenditure totals preserve the figures and a review on every affected cell', () => {
  const rows = buildUrbanTables().find(t => t.dataset_id === 'local-government-expenditure')!.rows
  expect(rows).toHaveLength(156)
  const ps = rows.filter(r => r.council_type === 'Pradeshiya Sabha')
  const totals = ps.filter(r => r.expenditure_category === 'Total expenditure')
  expect(totals).toHaveLength(10)
  for (const total of totals) {
    const value = (category: string) => Number(ps.find(r => r.geography === total.geography && r.expenditure_category === category)!.value)
    expect(Math.abs(Number(total.value) - value('Total recurrent expenditure') - value('Total capital expenditure'))).toBeLessThanOrEqual(1)
    expect(total.review_note).toContain('heading formula is I+II')
    expect(total.observation_status).toBe('provisional')
  }
})

test('health measures retain visit scaling, expenditure units and revision status', () => {
  const rows = buildUrbanTables().find(t => t.dataset_id === 'government-health-services')!.rows
  expect(rows).toHaveLength(130)
  expect(rows.find(r => r.year === 2025 && r.metric === 'Inpatient visits')).toMatchObject({value: 7291, unit: 'thousand visits', observation_status: 'provisional'})
  expect(rows.find(r => r.year === 2024 && r.metric === 'Hospital beds')).toMatchObject({value: 91159, unit: 'beds', observation_status: 'revised'})
  expect(rows.find(r => r.year === 2025 && r.metric === 'Health expenditure')).toMatchObject({value: 525470, unit: 'LKR million'})
  expect(rows.find(r => r.year === 2025 && r.metric === 'Health expenditure per 100,000 people')).toMatchObject({value: 2415287.74, unit: 'LKR thousand per 100,000 people'})
})

test('education counts reconcile to the published totals without summing ratios', () => {
  const rows = buildUrbanTables().find(t => t.dataset_id === 'school-resources')!.rows
  expect(rows).toHaveLength(80)
  for (const year of [2022, 2023, 2024, 2025]) for (const metric of ['Schools', 'Teachers', 'Pupils']) {
    const group = rows.filter(r => r.year === year && r.metric === metric)
    const total = group.find(r => r.school_type === 'All reported types')!
    expect(group.filter(r => r !== total).reduce((sum, r) => sum + Number(r.value), 0)).toBe(total.value)
  }
  expect(rows.find(r => r.metric === 'Pupil–teacher ratio' && r.school_type === 'Government' && r.year === 2025)).toMatchObject({value: 15, unit: 'pupils per teacher'})
})

test('foreign departures reconcile without inventing a sex split or joining skill schemes', () => {
  const rows = buildUrbanTables().find(t => t.dataset_id === 'foreign-employment-departures')!.rows
  for (let year = 2017; year <= 2025; year++) {
    const group = rows.filter(r => r.year === year)
    expect(group.filter(r => r.category !== 'Total').reduce((sum, r) => sum + Number(r.value), 0)).toBe(group.find(r => r.category === 'Total')!.value)
    expect(new Set(group.map(r => r.classification))).toEqual(new Set([year <= 2021 ? 'Detailed' : 'Broad']))
  }
  expect(rows.filter(r => r.category === 'Domestic housekeeping assistants').every(r => r.sex === 'Not separately reported')).toBe(true)
})

test('all four blue-shaded provincial unemployment cells carry their source caution', () => {
  const rows = buildUrbanTables().find(t => t.dataset_id === 'unemployment-by-province')!.rows
  const flagged = rows.filter(r => r.sampling_caution)
  expect(flagged.map(r => [r.geography, r.year, r.sex, r.value])).toEqual([
    ['North Central', 2024, 'Female', 5.5],
    ['North Central', 2025, 'Male', 1.3],
    ['Sabaragamuwa', 2025, 'Male', 2.3],
    ['Eastern', 2024, 'Male', 1.8],
  ])
  expect(flagged.every(r => r.review_note?.includes('coefficient of variation'))).toBe(true)
})

test('reviewed building floor-area separators retain digits and reconcile every national total', () => {
  const rows = buildUrbanTables().find(t => t.dataset_id === 'building-construction-district')!.rows
  expect(rows.filter(r => r.observation_status === 'reviewed_typography').map(r => [r.geography, r.reported_token, r.value])).toEqual([
    ['Kalutara', '29,7322', 297322], ['Matale', '90,2593', 902593],
    ['Galle', '37,9196', 379196], ['Kilinochchi', '20,6575', 206575],
  ])
  for (const total of rows.filter(r => r.geography_type === 'country')) {
    const districts = rows.filter(r => r.geography_type === 'district' && r.metric === total.metric && r.construction_type === total.construction_type)
    expect(districts).toHaveLength(25)
    expect(districts.reduce((sum, r) => sum + Number(r.value), 0)).toBe(total.value)
  }
})

test('conflicting port tables and missing cargo years remain separate', () => {
  const rows = buildUrbanTables().find(t => t.dataset_id === 'port-traffic-cargo')!.rows
  const value = (table: string, year: number) => rows.find(r => r.report_table === table && r.port === 'Colombo' && r.metric === 'Total cargo handled' && r.year === year)!.value
  expect([value('7.13', 2018), value('7.14', 2018)]).toEqual([100152, 100151])
  expect([value('7.13', 2021), value('7.14', 2021)]).toEqual([103823, 103824])
  expect(rows.find(r => r.port === 'Hambantota' && r.year === 2024 && r.metric === 'Total cargo handled')).toMatchObject({value: null, reported_token: '..', observation_status: 'not_available'})
  expect(rows.find(r => r.port === 'Hambantota' && r.year === 2024 && r.metric === 'Ship arrivals')?.value).toBe(472)
})

test('utility connection breakdowns reconcile independently and coverage keeps its printed precision', () => {
  const rows = buildUrbanTables().find(t => t.dataset_id === 'water-supply-connections-coverage')!.rows
  for (const geography_scheme of ['Regional support centre', 'Operational region']) for (const year of [2023, 2024]) {
    const group = rows.filter(r => r.geography_scheme === geography_scheme && r.year === year)
    expect(group.filter(r => !r.is_national_total).reduce((sum, r) => sum + Number(r.value), 0)).toBe(group.find(r => r.is_national_total)!.value)
  }
  expect(rows.find(r => r.geography === 'Ratnapura' && r.year === 2024)).toMatchObject({value: 86690, geography_scheme: 'Operational region'})
  expect(rows.find(r => r.metric === 'Safe water coverage' && r.year === 2024)).toMatchObject({value: 98.8, reported_token: '98.80%', observation_status: 'reported', unit: '% of population'})
  const rounded = rows.filter(r => r.metric === 'Pipe-borne water coverage' && r.year === 2021)
  expect(rounded.find(r => r.provider_group === 'Total')!.value).toBe(55.7)
  expect(rounded.every(r => String(r.review_note).includes('visually reviewed'))).toBe(true)
  expect(() => reviewedPocketCell('98.80%', {value: 0.988, status: 'reported', marker: '%', note: 'Unit suffix'})).toThrow('differs from its printed digits')
})

test('water performance retains rounding and the documented staffing-unit error', () => {
  const rows = buildUrbanTables().find(t => t.dataset_id === 'water-operating-performance')!.rows
  expect(rows).toHaveLength(54)
  const select = (metric: string, section: string) => rows.find(r => r.metric === metric && r.report_section === section && r.year === 2024)!
  expect(select('Non-revenue water', 'Figure 33').value).toBe(24.8)
  expect(select('Non-revenue water', 'Table 5').value).toBe(24.76)
  expect(select('Staff per 1,000 connections', 'Table 5')).toMatchObject({value: 2.59, unit: 'staff per 1,000 connections'})
  expect(select('Staff per 1,000 connections', 'Table 5').review_note).toContain('incorrectly prints %')
  expect(select('Bacteriological sample pass rate', 'Figure 38')).toMatchObject({value: 99.8, unit: '% of tested samples'})
})

test('household waste denominators and rounded shares retain separate sectors', () => {
  const rows = buildUrbanTables().find(t => t.dataset_id === 'household-waste-disposal')!.rows
  expect(rows).toHaveLength(220)
  const counts = rows.filter(r => r.metric === 'Households')
  expect(counts.filter(r => r.sector !== 'Sri Lanka').reduce((sum, r) => sum + Number(r.value), 0)).toBe(counts.find(r => r.sector === 'Sri Lanka')!.value)
  expect(rows.find(r => r.sector === 'Sri Lanka' && r.waste_type === 'Biodegradable waste' && r.method === 'By the local authority')?.value).toBe(23.9)
  for (const sector of ['Sri Lanka','Urban','Estate-Urban','Rural','Estate-Rural']) for (const waste_type of new Set(rows.filter(r => r.metric === 'Household share').map(r => r.waste_type))) {
    const group = rows.filter(r => r.sector === sector && r.waste_type === waste_type)
    expect(Math.abs(group.filter(r => r.method !== 'Total').reduce((sum, r) => sum + Number(r.value), 0) - 100)).toBeLessThanOrEqual(0.3)
  }
  expect(rows.find(r => r.sector === 'Estate-Urban' && r.waste_type === 'Liquid waste' && r.method === 'Connected to a piped sewer')).toMatchObject({value: 0, reported_token: '0.0', observation_status: 'reported'})
  expect(rows.some(r => r.waste_type === 'Glass cuttings and bottles' && r.method === 'Occupants burn')).toBe(false)
})

test('road safety reconciles crash severities and police divisions without turning crashes into deaths', () => {
  const rows = buildUrbanTables().find(t => t.dataset_id === 'road-crashes-fatalities')!.rows
  expect(rows).toHaveLength(418)
  const annual = rows.filter(r => r.report_table === 'NTC 9.1')
  for (const year of new Set(annual.map(r => r.year))) {
    const group = annual.filter(r => r.year === year)
    expect(group.filter(r => r.severity !== 'Total').reduce((sum, r) => sum + Number(r.value), 0)).toBe(group.find(r => r.severity === 'Total')!.value)
  }
  const division = rows.filter(r => r.report_table === 'NTC 9.3')
  for (const total of division.filter(r => r.is_geography_total)) {
    const parts = division.filter(r => !r.is_geography_total && r.severity === total.severity)
    expect(parts).toHaveLength(43)
    expect(parts.reduce((sum, r) => sum + Number(r.value), 0)).toBe(total.value)
  }
  const fatalities = rows.filter(r => r.report_table === 'DCS 7.6')
  expect(fatalities.filter(r => r.road_user !== 'Total').reduce((sum, r) => sum + Number(r.value), 0)).toBe(2521)
  expect(fatalities.every(r => r.year === 2024 && r.unit === 'people')).toBe(true)
  expect(rows.some(r => r.report_table === 'DCS 7.4')).toBe(false)
  expect(rows.find(r => r.geography === 'Foreshore Ports' && r.year === 2022)).toMatchObject({value: null, observation_status: 'nil_or_negligible', geography_scheme: 'Colombo police station area'})
})

test('housing preserves the three-unit historical vacancy discrepancy and recent totals', () => {
  const rows = buildUrbanTables().find(t => t.dataset_id === 'housing-occupancy-tenure')!.rows
  const vacant = rows.filter(r => r.year === 2012 && r.metric === 'Permanently closed or vacant housing units')
  expect(vacant.find(r => r.geography_type === 'country')!.value).toBe(686507)
  expect(vacant.filter(r => r.geography_type === 'district').reduce((sum, r) => sum + Number(r.value), 0)).toBe(686510)
  expect(vacant.every(r => String(r.review_note).includes('source discrepancy'))).toBe(true)
  for (const total of rows.filter(r => r.year === 2024 && r.geography_type === 'country' && r.unit === 'housing units')) {
    expect(rows.filter(r => r.year === 2024 && r.geography_type === 'district' && r.metric === total.metric).reduce((sum, r) => sum + Number(r.value), 0)).toBe(total.value)
  }
})

test('electricity retail data retains aggregate accounts, wholesale scope and undefined dashes', () => {
  const rows = buildUrbanTables().find(t => t.dataset_id === 'electricity-customers-sales')!.rows
  expect(rows).toHaveLength(348)
  for (const year of [2024, 2025]) {
    const group = rows.filter(r => r.year === year && r.metric === 'Consumer accounts' && r.operator === 'CEB' && r.breakdown === 'Distribution province')
    expect(group.filter(r => ['distribution area','wholesale','street lighting'].includes(String(r.category_type))).reduce((sum, r) => sum + Number(r.value), 0)).toBe(group.find(r => r.category_type === 'grand total')!.value)
    expect(group.find(r => r.category === 'Bulk Supply to LECO')).toMatchObject({value: 1, category_type: 'wholesale'})
  }
  expect(rows.find(r => r.operator === 'LECO' && r.metric === 'Consumer accounts' && r.category === 'Total' && r.year === 2025)?.value).toBe(638201)
  expect(rows.find(r => r.operator === 'LECO' && r.metric === 'Electricity sales' && r.category === 'Agriculture' && r.year === 2025)).toMatchObject({value: null, reported_token: '-', observation_status: 'source_ambiguity'})
  expect(rows.find(r => r.operator === 'CEB' && r.metric === 'Electricity sales' && r.category === 'Street Lighting' && r.year === 2025)).toMatchObject({value: 82, observation_status: 'estimate'})
})

test('reliability keeps ambiguous LECO dates, source hours and missing proposed-area cells', () => {
  const rows = buildUrbanTables().find(t => t.dataset_id === 'electricity-supply-reliability')!.rows
  expect(rows).toHaveLength(4110)
  const disputed = rows.filter(r => r.division === 'LECO' && r.report_quarter === '2025-Q1')
  expect(disputed).toHaveLength(42)
  expect(disputed.every(r => r.period === null && r.year === null && r.reported_year === 2024 && r.period_status === 'source_conflict')).toBe(true)
  expect(disputed.find(r => r.metric === 'SAIDI' && r.geography === 'Kotte' && r.reported_month === 'January')).toMatchObject({value: 0.96, unit: 'hours per customer'})
  expect(disputed.filter(r => r.metric === 'SAIFI' && r.reported_month === 'September')).toHaveLength(7)
  expect(rows.find(r => r.division === 'CEB DD2' && r.metric === 'SAIDI' && r.geography === 'Hasalaka (Proposed)' && r.period === '2025-07')).toMatchObject({value: null, observation_status: 'not_available', is_proposed: true})
  expect(rows.find(r => r.division === 'CEB DD2' && r.metric === 'SAIDI' && r.geography === 'Hasalaka (Proposed)' && r.period === '2026-01')).toMatchObject({value: 0, observation_status: 'reported', is_proposed: true})
})

test('workbook review rejects changed labels, displayed values, formulas and blank-to-zero changes', () => {
  const section = {sheet:'Source', columns:[{}], assertions:[{address:'A1',value:'SAIDI'}]}
  const row = {assertions:[], cells:['1.20'], source_cells:[{address:'B2',value:1.2,type:'n',formula:'A2/C2'}]}
  const valid = () => ({Sheets:{Source:{A1:{v:'SAIDI'},B2:{v:1.2,t:'n',w:'1.20',f:'A2/C2'}}}})
  expect(() => validateReviewedWorkbookRow(section,row,valid())).not.toThrow()
  const display = valid(); display.Sheets.Source.B2.w = '120%'
  expect(() => validateReviewedWorkbookRow(section,row,display)).toThrow('display changed')
  const formula = valid(); formula.Sheets.Source.B2.f = 'A2/D2'
  expect(() => validateReviewedWorkbookRow(section,row,formula)).toThrow('formula changed')
  const label = valid(); label.Sheets.Source.A1.v = 'SAIFI'
  expect(() => validateReviewedWorkbookRow(section,row,label)).toThrow('header or label changed')
  const blank = {assertions:[],cells:[''],source_cells:[{address:'B3',value:null,type:null,formula:null}]}
  const book = valid()
  expect(() => validateReviewedWorkbookRow(section,blank,book)).not.toThrow()
  Object.assign(book.Sheets.Source,{B3:{v:0,t:'n',w:'0'}})
  expect(() => validateReviewedWorkbookRow(section,blank,book)).toThrow('value changed')
})

test('functional-difficulty thresholds retain per-thousand rates and reconciled overlapping counts', () => {
  const rows = buildUrbanTables().find(t => t.dataset_id === 'functional-difficulties-disability')!.rows
  expect(rows).toHaveLength(780)
  for (const total of rows.filter(r => r.geography_type === 'country' && r.unit === 'people')) {
    const parts = rows.filter(r => r.geography_type === 'district' && r.threshold === total.threshold && r.metric === total.metric && r.domain === total.domain)
    expect(parts).toHaveLength(25)
    expect(parts.reduce((sum, r) => sum + Number(r.value), 0)).toBe(total.value)
  }
  for (const rate of rows.filter(r => r.metric === 'Prevalence rate')) {
    const population = rows.find(r => r.geography === rate.geography && r.threshold === rate.threshold && r.metric === 'Population aged 5+')!
    const count = rows.find(r => r.geography === rate.geography && r.threshold === rate.threshold && r.domain === rate.domain && r.metric === 'People with difficulty')!
    expect(Math.abs(Number(rate.value) - Number(count.value) / Number(population.value) * 1000)).toBeLessThanOrEqual(0.50001)
  }
  const national = rows.filter(r => r.geography_type === 'country' && r.domain === 'At least one domain' && r.metric === 'People with difficulty')
  expect(national.find(r => r.threshold === 'Any difficulty')!.value).toBe(3223413)
  expect(national.find(r => r.threshold === 'Disability threshold')!.value).toBe(727293)
})

test('housing condition keeps construction-period exclusions and distinct urban sector scopes', () => {
  const rows = buildUrbanTables().find(t => t.dataset_id === 'housing-condition-materials')!.rows
  const age = rows.filter(r => r.characteristic === 'Construction period' && r.metric === 'Housing units')
  expect(age.find(r => r.is_total)!.value).toBe(6029330)
  expect(age.filter(r => !r.is_total).reduce((sum, r) => sum + Number(r.value), 0)).toBe(6029330)
  const rooms = rows.filter(r => r.characteristic === 'Room count' && r.metric === 'Housing units')
  expect(rooms.find(r => r.geography_type === 'country' && r.category === 'Total')!.value).toBe(6030541)
  expect(rooms.filter(r => r.geography_type === 'sector' && r.category === 'One room').reduce((sum, r) => sum + Number(r.value), 0)).toBe(358358)
  expect(rows.some(r => r.characteristic === 'Material-based condition' && r.geography === 'Urban including estate-urban')).toBe(true)
  expect(rooms.some(r => r.geography === 'Estate-Urban')).toBe(true)
})

test('weather keeps blank night humidity and the visually reviewed Badulla temperature', () => {
  const rows = buildUrbanTables().find(t => t.dataset_id === 'weather-station-observations')!.rows
  expect(rows).toHaveLength(96)
  expect(rows.filter(r => r.metric === 'Average relative humidity — night' && r.value === null)).toHaveLength(9)
  expect(rows.find(r => r.station === 'Badulla' && r.metric === 'Average temperature')).toMatchObject({value:23.9,reported_token:'23.9',unit:'°C'})
  expect(rows.find(r => r.station === 'Badulla' && r.metric === 'Average temperature')!.review_note).toContain('stray 29.0')
  expect(rows.find(r => r.station === 'Badulla' && r.metric === 'Average relative humidity — night')).toMatchObject({value:null,reported_token:'',observation_status:'not_available'})
  expect(() => reviewedPocketCell('29.0', {value:null,status:'not_available',note:'Invalidly removing a numeric observation'})).toThrow('requires a blank')
})

test('administrative counts retain statistical-area exceptions and footnoted dashes', () => {
  const rows = buildUrbanTables().find(t => t.dataset_id === 'administrative-units-district')!.rows
  expect(rows).toHaveLength(156)
  expect(rows.every(r => r.as_of_date === '2025-12-19')).toBe(true)
  expect(rows.find(r => r.geography === 'Batticaloa' && r.division_type === 'GN divisions')).toMatchObject({value:346,reported_token:'346(b)'})
  expect(rows.find(r => r.geography === 'Matale' && r.division_type === 'GN divisions')).toMatchObject({value:532,reported_token:'532(a)'})
  expect(rows.find(r => r.geography === 'Ampara' && r.division_type === 'DS/AGA divisions')!.review_note).toContain('Sub-Divisional Secretariat')
  expect(rows.find(r => r.geography === 'Kegalle' && r.division_type === 'Urban Councils')).toMatchObject({value:null,reported_token:'-(c)',observation_status:'nil_or_negligible'})
  expect(() => reviewedPocketCell('1(c)',{value:2,status:'reported',marker:'(c)',note:'Council upgrade'})).toThrow('differs from its printed digits')
})

test('banking retains conflicting totals, population scaling and unavailable historic categories', () => {
  const rows = buildUrbanTables().find(t => t.dataset_id === 'bank-branches-density')!.rows
  expect(rows).toHaveLength(2925)
  const total = (report_table: string,year: number) => rows.find(r => r.report_table === report_table && r.year === year && r.geography_type === 'country' && r.bank === 'All licensed banks' && r.metric === 'Bank branches')!
  expect([total('7.8',2022).value,total('7.9',2022).value]).toEqual([3632,3630])
  expect(total('7.8',2025).observation_status).toBe('provisional')
  const inclusive = rows.find(r => r.report_table === '7.9' && r.year === 2013 && r.bank === 'All branches including rural banks' && r.metric === 'Bank branches')!
  expect(inclusive.value).toBe(5399)
  expect(inclusive.review_note).toContain('3322 + 2080 = 5402')
  for (const density of rows.filter(r => r.report_table === '7.8' && r.metric === 'Banking density')) {
    const population = rows.find(r => r.report_table === '7.8' && r.year === density.year && r.geography === density.geography && r.metric === 'Population')!
    const count = rows.find(r => r.report_table === '7.8' && r.year === density.year && r.geography === density.geography && r.bank === 'All licensed banks' && r.metric === 'Bank branches')!
    expect(Math.abs(Number(density.value) - Number(count.value) / Number(population.value) * 100)).toBeLessThan(1e-10)
    expect(population.unit).toBe('thousand people')
  }
  expect(rows.find(r => r.report_table === '7.9' && r.year === 2014 && r.bank === 'Others')).toMatchObject({value:null,reported_token:'',observation_status:'not_available'})
})

test('vital statistics keep mortality denominators, unavailable cells and year flags', () => {
  const rows = buildUrbanTables().find(t => t.dataset_id === 'vital-statistics')!.rows
  expect(rows).toHaveLength(48)
  expect(rows.filter(r => r.value === null)).toHaveLength(14)
  expect(rows.find(r => r.year === 2021 && r.metric === 'Maternal mortality rate')).toMatchObject({value:33,unit:'per 100,000 live births',observation_status:'revised'})
  expect(rows.find(r => r.year === 2022 && r.metric === 'Infant mortality rate')).toMatchObject({value:6.5,unit:'per 1,000 live births',observation_status:'provisional'})
  expect(rows.find(r => r.year === 2025 && r.metric === 'Birth rate')).toMatchObject({value:9.9,unit:'per 1,000 people',observation_status:'provisional'})
})

test('irrigation distinguishes physical land from two-season cultivated extent', () => {
  const rows = buildUrbanTables().find(t => t.dataset_id === 'paddy-irrigation')!.rows
  expect(rows).toHaveLength(36)
  expect(rows.find(r => r.year === 2024 && r.scheme === 'Major' && r.metric === 'Irrigable area')?.value).toBe(390508)
  expect(rows.find(r => r.year === 2024 && r.scheme === 'Major' && r.metric === 'Irrigated area')?.value).toBe(693850)
  expect(rows.filter(r => r.year === 2025).every(r => r.review_note?.includes('no classification-break explanation'))).toBe(true)
})

test('tourism retains estimates, missing category details and matching direct-employment totals', () => {
  const rows = buildUrbanTables().find(t => t.dataset_id === 'tourism-activity')!.rows
  expect(rows).toHaveLength(206)
  expect(rows.filter(r => r.observation_status === 'not_available')).toHaveLength(19)
  expect(rows.filter(r => r.observation_status === 'nil_or_negligible')).toHaveLength(7)
  expect(rows.find(r => r.year === 2025 && r.metric === 'Indirect employment')).toMatchObject({value:251000,measurement_basis:'Estimated',observation_status:'provisional'})
  for (const year of [2022,2023,2024]) {
    const categories = rows.filter(r => r.year === year && r.table_scope === 'Establishment categories' && r.metric === 'Direct employment')
    const total = categories.find(r => r.category === 'Total')!
    expect(Number(total.value) - categories.filter(r => r !== total).reduce((s,r) => s + Number(r.value),0)).toBe(year === 2023 ? 90 : 0)
    if (year === 2023) expect(total.review_note).toContain('difference of 90 people')
    expect(rows.find(r => r.year === year && r.table_scope === 'National trends' && r.metric === 'Direct employment')?.value).toBe(total.value)
  }
  expect(rows.find(r => r.year === 2025 && r.metric === 'Establishments' && r.category === 'Total')).toMatchObject({value:9546,observation_status:'provisional'})
})

test('vocational data retain overlapping programme scopes, pending results, missing cells and zeros', () => {
  const rows = buildUrbanTables().find(t => t.dataset_id === 'vocational-training')!.rows
  expect(rows).toHaveLength(282)
  for (const year of [2024,2025]) for (const metric of ['Student intake','Students completed','Students dropped']) {
    const group = rows.filter(r => r.year === year && r.metric === metric && r.institution === 'Ceylon German Technical Training Institute')
    expect(group.filter(r => r.programme !== 'All reported programmes').reduce((s,r)=>s+Number(r.value),0)).toBe(group.find(r=>r.programme==='All reported programmes')?.value)
  }
  expect(rows.find(r=>r.year===2025&&r.metric==='Students completed'&&r.institution==='Sri Lanka Institute of Printing')).toMatchObject({value:123,reported_token:'123(a)',observation_status:'reported'})
  expect(rows.find(r=>r.year===2025&&r.metric==='Students completed'&&r.institution==='Sri Lanka Institute of Printing')?.review_note).toContain('447 students')
  expect(rows.find(r=>r.year===2024&&r.metric==='Part-time courses'&&r.institution==='University Colleges')).toMatchObject({value:null,reported_token:'…',observation_status:'not_available'})
  expect(rows.find(r=>r.year===2025&&r.metric==='Government grants'&&r.institution==='National Institute of Business Management')).toMatchObject({value:0,reported_token:'0.00',observation_status:'provisional'})
})

test('exam results retain candidate denominators and distinguish applications from attendance', () => {
  const rows = buildUrbanTables().find(t => t.dataset_id === 'school-examination-results')!.rows
  expect(rows).toHaveLength(22)
  for (const year of [2024,2025]) for (const candidate_group of ['School candidates','All candidates']) {
    const group=rows.filter(r=>r.year===year&&r.candidate_group===candidate_group&&r.examination==='GCE A/L')
    const value=(metric:string)=>Number(group.find(r=>r.metric===metric)!.value)
    expect(Math.abs(value('Qualified for university')/value('Candidates sat')*100-value('University qualification rate'))).toBeLessThan(0.01)
  }
  expect(rows.find(r=>r.year===2025&&r.examination==='GCE A/L'&&r.metric==='Candidates applied')).toMatchObject({candidate_group:'All candidates',value:340592})
  expect(rows.find(r=>r.year===2025&&r.examination==='GCE A/L'&&r.metric==='Candidates sat'&&r.candidate_group==='All candidates')?.value).toBe(281810)
})

test('GDP expenditure preserves accounting negatives and nominal/share units', () => {
  expect(pocketCell('(1,300,850)')).toEqual({value:-1300850,observation_status:'reported'})
  expect(pocketCell('(3.9)').value).toBe(-3.9)
  expect(()=>pocketCell('(1,23)')).toThrow('ambiguous numeric token')
  const rows = buildUrbanTables().find(t => t.dataset_id === 'gdp-expenditure')!.rows
  expect(rows).toHaveLength(130)
  for (const year of [2021,2022,2023,2024,2025]) {
    const value=(component:string)=>Number(rows.find(r=>r.year===year&&r.component===component&&r.measure==='Nominal value')!.value)
    expect(Math.abs(value('Final consumption expenditure')+value('Gross capital formation')+value('External balance of goods and services')-value('GDP at market prices'))).toBeLessThanOrEqual(1)
    expect(Math.abs(value('Exports of goods and services')-value('Imports of goods and services')-value('External balance of goods and services'))).toBeLessThanOrEqual(1)
  }
  expect(rows.find(r=>r.year===2025&&r.component==='External balance of goods and services'&&r.measure==='GDP share')).toMatchObject({value:-3.9,reported_token:'(3.9)',unit:'% of GDP',observation_status:'provisional'})
  expect(rows.find(r=>r.year===2024&&r.component==='GDP at market prices'&&r.measure==='Nominal value')).toMatchObject({value:30095825,unit:'LKR million',observation_status:'revised'})
})

test('trade indices retain their base and separate value, volume and terms of trade', () => {
  const rows = buildUrbanTables().find(t => t.dataset_id === 'external-trade-indices')!.rows
  expect(rows).toHaveLength(25)
  expect(new Set(rows.map(r=>r.unit))).toEqual(new Set(['2010=100']))
  for (const year of [2021,2022,2023,2024,2025]) {
    const value=(metric:string,trade_flow:string)=>Number(rows.find(r=>r.year===year&&r.metric===metric&&r.trade_flow===trade_flow)!.value)
    const implied=(value('Value index','Exports')/value('Volume index','Exports'))/(value('Value index','Imports')/value('Volume index','Imports'))*100
    expect(Math.abs(implied-value('Terms of trade','Export/import unit-price ratio'))).toBeLessThan(0.15)
  }
  expect(rows.find(r=>r.year===2025&&r.metric==='Value index'&&r.trade_flow==='Imports')?.value).toBe(426.7)
})

test('transport capacity reconciles provinces without replacing conflicting tables or undefined rail counts', () => {
  const rows = buildUrbanTables().find(t => t.dataset_id === 'public-transport-capacity')!.rows
  expect(rows).toHaveLength(137)
  for (const metric of ['Fleet','Buses operated','Seating capacity']) {
    const group = rows.filter(r=>r.table_scope==='Private bus provincial capacity'&&r.metric===metric)
    const provincial = group.filter(r=>r.geography_type==='province').reduce((s,r)=>s+Number(r.value),0)
    expect(provincial).toBe(group.find(r=>r.geography_type==='country'&&r.service_type==='Intra-provincial')?.value)
    const inter = Number(group.find(r=>r.service_type==='Inter-provincial')!.value)
    expect(provincial+inter).toBe(group.find(r=>r.geography_type==='country'&&r.service_type==='All services')?.value)
  }
  const routes = rows.filter(r=>r.table_scope==='Private bus routes')
  expect(routes.filter(r=>r.service_type!=='All services').reduce((s,r)=>s+Number(r.value),0)).toBe(4047)
  const conflicts=rows.filter(r=>r.year===2023&&r.metric==='Fleet'&&(r.service_type==='Inter-provincial'||(r.table_scope==='Inter-provincial service history'&&r.service_type==='All services')))
  expect(conflicts.map(r=>r.value)).toEqual([3151,3152])
  expect(conflicts.every(r=>r.review_note?.includes('not reconciled by replacement'))).toBe(true)
  expect(rows.filter(r=>r.table_scope==='Rail rolling stock'&&r.value===null)).toHaveLength(6)
  expect(rows.filter(r=>r.table_scope==='Rail rolling stock'&&r.value===null).every(r=>r.observation_status==='source_ambiguity')).toBe(true)
  expect(rows.find(r=>r.table_scope==='SLTB operational averages'&&r.year===2023&&r.metric==='Average buses operated per day')).toMatchObject({value:4379,unit:'buses'})
})
