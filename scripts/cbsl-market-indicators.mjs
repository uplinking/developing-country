import {
  CBSL_SOURCES,
  LICENSE_CAVEAT,
  MONTHS,
  assert,
  assertContiguousPeriods,
  dim,
  fail,
  measure,
  normalizeLabel,
  parseMonthlyHeader,
  period,
  rawNumber,
  round,
  table,
} from './build-cbsl-indicators.mjs'

export const FX_CURRENCIES = Object.freeze([
  { id: 'sdr', label: 'IMF Special Drawing Rights', column: 3, digits: 6 },
  { id: 'usd', label: 'US dollar', column: 4, digits: 4 },
  { id: 'gbp', label: 'Pound sterling', column: 5, digits: 4 },
  { id: 'inr', label: 'Indian rupee', column: 6, digits: 4 },
  { id: 'jpy', label: 'Japanese yen', column: 7, digits: 6 },
  { id: 'eur', label: 'Euro', column: 8, digits: 4 },
  { id: 'chf', label: 'Swiss franc', column: 9, digits: 4 },
  { id: 'aud', label: 'Australian dollar', column: 10, digits: 4 },
  { id: 'cad', label: 'Canadian dollar', column: 11, digits: 4 },
  { id: 'sgd', label: 'Singapore dollar', column: 12, digits: 4 },
  { id: 'dkk', label: 'Danish krone', column: 13, digits: 4 },
  { id: 'hkd', label: 'Hong Kong dollar', column: 14, digits: 4 },
  { id: 'nzd', label: 'New Zealand dollar', column: 15, digits: 4 },
  { id: 'nok', label: 'Norwegian krone', column: 16, digits: 4 },
  { id: 'sek', label: 'Swedish krona', column: 17, digits: 4 },
])

export const LVI_SEGMENTS = Object.freeze(['overall', 'residential', 'commercial', 'industrial'])

/** Official H1 2025 values from the CBSL LVI H2 2025 press table, used to validate the Data Library series. */
export const LVI_H1_2025 = Object.freeze({
  overall: 256.4,
  residential: 266.9,
  commercial: 254.3,
  industrial: 248.0,
})

/** Official H2 2025 values from land_valuation_indicator_second_half_of_2025_e.pdf. */
export const LVI_H2_2025 = Object.freeze({
  overall: 261.9,
  residential: 273.1,
  commercial: 260.6,
  industrial: 251.9,
})

export const LVI_SERIES = Object.freeze({
  overall: 'cbsl.Land Valuations Indicator (LVI) for Colombo (2017 1st Half = 100) - Overall.Half Yearly.json',
  residential: 'cbsl.Land Valuations Indicator (LVI) for Colombo (2017 1st Half = 100) - Residential.Half Yearly.json',
  commercial: 'cbsl.Land Valuations Indicator (LVI) for Colombo (2017 1st Half = 100) - Commercial.Half Yearly.json',
  industrial: 'cbsl.Land Valuations Indicator (LVI) for Colombo (2017 1st Half = 100) - Industrial.Half Yearly.json',
})

const LVI_DATA_LIBRARY = 'https://raw.githubusercontent.com/nuuuwan/lanka_data_timeseries/data/sources/cbsl'

export function parseFlexibleMonth(value) {
  if (Number.isFinite(value)) {
    const date = new Date(Date.UTC(1899, 11, 30) + value * 86_400_000)
    return { period: period(date.getUTCFullYear(), date.getUTCMonth() + 1), provisional: false }
  }
  return parseMonthlyHeader(value)
}

function parseYearHeader(value) {
  if (Number.isInteger(value) && value >= 1900 && value <= 2100) return { year: value, provisional: false }
  const label = normalizeLabel(value)
  const provisional = /\([a-z]\)/i.test(label)
  const match = /^(\d{4})/.exec(label)
  assert(match, `unrecognized year header ${JSON.stringify(value)}`)
  return { year: Number(match[1]), provisional }
}

function missingInSource(value) {
  const label = normalizeLabel(value)
  return value === null || value === undefined || value === '' || label === '-' || label === '–'
}

function isYearHeaderCell(value) {
  if (Number.isInteger(value) && value >= 1900 && value <= 2100) return true
  return /^\d{4}/.test(normalizeLabel(value))
}

export function buildTourismEarningsTable(sourceRows) {
  const header = sourceRows.find((row) => (row ?? []).some((value) => isYearHeaderCell(value)))
  assert(header, 'tourism workbook has no year header')
  const years = []
  for (let column = 0; column < header.length; column += 1) {
    const value = header[column]
    if (value === null || value === undefined || value === '') continue
    if (!isYearHeaderCell(value)) continue
    years.push({ column, ...parseYearHeader(value) })
  }
  assert(years.length > 0, 'tourism workbook has no usable years')

  const monthRows = new Map()
  for (const row of sourceRows) {
    const month = MONTHS.get(normalizeLabel(row?.[1]).toLowerCase())
    if (month) monthRows.set(month, row)
  }
  assert(monthRows.size === 12, `tourism workbook has ${monthRows.size} month rows instead of 12`)

  const observations = []
  for (const { column, year, provisional } of years) {
    for (let month = 1; month <= 12; month += 1) {
      const value = monthRows.get(month)[column]
      if (missingInSource(value)) continue
      observations.push({
        period: period(year, month),
        provisional: provisional || year >= 2026,
        methodology_revised: year >= 2026,
        value_usd_million: round(rawNumber(value, `tourism ${year}-${month}`), 1),
      })
    }
  }
  observations.sort((left, right) => left.period.localeCompare(right.period))
  assertContiguousPeriods(observations.map((row) => row.period), 'tourism earnings')
  return table({
    dataset_id: 'tourism-earnings-monthly',
    title: 'Monthly earnings from tourism',
    description: 'Monthly earnings from tourism in US dollars, published by the Central Bank of Sri Lanka from Sri Lanka Tourism Development Authority survey estimates.',
    grain: 'One national row per month.',
    source_ids: [CBSL_SOURCES.tourism.id],
    vintage: `${observations[0].period}–${observations.at(-1).period}; 2026 onward provisional and methodologically revised`,
    primary_key: ['period'],
    notes: [
      'Values are rounded to one decimal place in USD millions.',
      '(a) Based on the survey conducted by the Sri Lanka Tourism Development Authority.',
      '(b) Provisional.',
      '(c) SLTDA revised the monthly earnings methodology in May 2026, applying country-specific arrivals, average daily expenditure and average duration of stay retrospectively from January 2026.',
    ],
    caveats: [
      'January 2026 onward is not directly comparable with 2009–2025 because of the May 2026 methodology revision.',
      LICENSE_CAVEAT,
    ],
    fields: [
      dim('period', 'period', 'Month'),
      dim('provisional', 'boolean', 'Provisional'),
      dim('methodology_revised', 'boolean', 'Uses the May 2026 SLTDA methodology'),
      measure('value_usd_million', 'number', 'Earnings from tourism', 'USD million'),
    ],
    rows: observations,
  })
}

function parseFxWorkbook(sourceRows, rateKind) {
  const header = sourceRows.find((row) => normalizeLabel(row?.[2]) === 'Month' && normalizeLabel(row?.[4]) === 'USD')
  assert(header, `${rateKind} workbook is missing the currency header`)
  for (const currency of FX_CURRENCIES) {
    assert(normalizeLabel(header[currency.column]).toLowerCase() === currency.id, `${rateKind} column ${currency.column} is not ${currency.id}`)
  }

  const observations = []
  let year = null
  for (const row of sourceRows) {
    const yearCell = row?.[1]
    const monthLabel = normalizeLabel(row?.[2])
    if (normalizeLabel(yearCell).toLowerCase().startsWith('annual')) {
      year = null
      continue
    }
    if (Number.isInteger(yearCell) && yearCell >= 1900 && yearCell <= 2100) year = yearCell
    else if (/^\d{4}$/.test(normalizeLabel(yearCell))) year = Number(normalizeLabel(yearCell))
    const month = MONTHS.get(monthLabel.toLowerCase())
    if (!month || year === null) continue
    const currentPeriod = period(year, month)
    for (const currency of FX_CURRENCIES) {
      const value = row[currency.column]
      if (missingInSource(value)) continue
      observations.push({
        period: currentPeriod,
        currency: currency.id,
        currency_label: currency.label,
        rate_kind: rateKind,
        lkr_per_unit: round(rawNumber(value, `${rateKind} ${currency.id} ${currentPeriod}`), currency.digits),
      })
    }
  }
  return observations
}

export function buildExchangeRatesTable(averageRows, monthEndRows) {
  const rows = [
    ...parseFxWorkbook(averageRows, 'monthly_average'),
    ...parseFxWorkbook(monthEndRows, 'month_end'),
  ].sort((left, right) => left.period.localeCompare(right.period) || left.rate_kind.localeCompare(right.rate_kind) || left.currency.localeCompare(right.currency))

  const usdAverage = rows.filter((row) => row.currency === 'usd' && row.rate_kind === 'monthly_average').map((row) => row.period)
  const usdMonthEnd = rows.filter((row) => row.currency === 'usd' && row.rate_kind === 'month_end').map((row) => row.period)
  assertContiguousPeriods(usdAverage, 'monthly average USD')
  assertContiguousPeriods(usdMonthEnd, 'month-end USD')

  return table({
    dataset_id: 'exchange-rates-monthly',
    title: 'Monthly exchange rates',
    description: 'Monthly average and month-end Sri Lanka rupee rates against published foreign currencies, from Central Bank of Sri Lanka exchange-rate workbooks.',
    grain: 'One row per month, currency and rate kind.',
    source_ids: [CBSL_SOURCES.fxAverage.id, CBSL_SOURCES.fxMonthEnd.id],
    vintage: `Monthly average ${usdAverage[0]}–${usdAverage.at(-1)}; month-end ${usdMonthEnd[0]}–${usdMonthEnd.at(-1)}`,
    primary_key: ['period', 'currency', 'rate_kind'],
    notes: [
      'Rates are Sri Lanka rupees per one unit of foreign currency, except JPY which is also quoted per yen.',
      'USD, GBP, EUR, AUD and CAD are rounded to four decimal places; SDR and JPY to six, matching the workbooks’ typical published precision.',
      'A source dash is omitted rather than stored as zero.',
    ],
    caveats: [
      'Euro and several other currencies are absent in earlier years; those months are missing rows, not zeros.',
      LICENSE_CAVEAT,
    ],
    fields: [
      dim('period', 'period', 'Month'),
      dim('currency', 'string', 'Currency id'),
      dim('currency_label', 'string', 'Currency'),
      dim('rate_kind', 'string', 'Rate kind'),
      measure('lkr_per_unit', 'number', 'Sri Lanka rupees per unit', 'LKR'),
    ],
    rows,
  })
}

export function buildEffectiveExchangeRateTable(sourceRows) {
  const observations = []
  for (const row of sourceRows) {
    const label = row?.[1]
    if (label === null || label === undefined || label === '') continue
    if (typeof label === 'string' && label.trim().startsWith('(')) continue
    if (normalizeLabel(label) === 'Month') continue
    let parsed
    try {
      parsed = parseFlexibleMonth(label)
    } catch {
      continue
    }
    observations.push({
      period: parsed.period,
      index_id: 'neer',
      index_label: 'NEER (2017=100)',
      provisional: parsed.provisional || / \(d\)$/i.test(normalizeLabel(label)),
      value: round(rawNumber(row[2], `NEER ${parsed.period}`), 2),
    })
    observations.push({
      period: parsed.period,
      index_id: 'reer',
      index_label: 'REER (2017=100)',
      provisional: parsed.provisional || / \(d\)$/i.test(normalizeLabel(label)),
      value: round(rawNumber(row[3], `REER ${parsed.period}`), 2),
    })
  }
  observations.sort((left, right) => left.period.localeCompare(right.period) || left.index_id.localeCompare(right.index_id))
  const neer = observations.filter((row) => row.index_id === 'neer').map((row) => row.period)
  assert(neer.length > 0, 'NEER workbook has no monthly observations')
  return table({
    dataset_id: 'effective-exchange-rate-indices',
    title: 'Nominal and real effective exchange-rate indices',
    description: 'Monthly NEER and REER indices (2017=100, 24-currency basket) published by the Central Bank of Sri Lanka.',
    grain: 'One national row per month and index.',
    source_ids: [CBSL_SOURCES.fxReer.id],
    vintage: `${neer[0]}–${neer.at(-1)}; latest months provisional`,
    primary_key: ['period', 'index_id'],
    notes: [
      '(a) NEER and REER are rebased to 2017=100.',
      '(b) REER was revised using rebased CPI figures of several trading-partner countries from January 2026.',
      '(c) REER uses the rebased CCPI (2021=100) from February 2023.',
      '(d) Provisional.',
      'Values are rounded to two decimal places.',
    ],
    caveats: [
      'REER is not a bilateral rupee/dollar rate; it adjusts NEER for inflation differentials.',
      LICENSE_CAVEAT,
    ],
    fields: [
      dim('period', 'period', 'Month'),
      dim('index_id', 'string', 'Index id'),
      dim('index_label', 'string', 'Index'),
      dim('provisional', 'boolean', 'Provisional'),
      measure('value', 'number', 'Index value', '2017=100'),
    ],
    rows: observations,
  })
}

function halfFromIsoDate(iso) {
  const month = iso.slice(5, 7)
  const yearMonth = iso.slice(0, 7)
  if (month === '06') return { period: yearMonth, half: 'H1' }
  if (month === '12') return { period: yearMonth, half: 'H2' }
  fail(`LVI observation ${iso} is not a June or December half-year`)
}

export function buildLandValuationTable(seriesBySegment) {
  const rows = []
  for (const segment of LVI_SEGMENTS) {
    const series = seriesBySegment[segment]
    assert(series && typeof series === 'object', `missing LVI series for ${segment}`)
    const dates = Object.keys(series).sort()
    assert(dates[0] === '2017-06-01', `${segment} LVI must start in 2017 H1`)
    const h1 = series['2025-06-01']
    assert(h1 === LVI_H1_2025[segment], `${segment} 2025 H1 expected ${LVI_H1_2025[segment]}, found ${h1}`)
    const merged = { ...series }
    if (merged['2025-12-01'] == null) merged['2025-12-01'] = LVI_H2_2025[segment]
    else assert(merged['2025-12-01'] === LVI_H2_2025[segment], `${segment} 2025 H2 expected ${LVI_H2_2025[segment]}, found ${merged['2025-12-01']}`)
    for (const [iso, value] of Object.entries(merged).sort(([left], [right]) => left.localeCompare(right))) {
      const { period: periodValue, half } = halfFromIsoDate(iso)
      rows.push({
        period: periodValue,
        half,
        segment,
        index_value: round(rawNumber(value, `LVI ${segment} ${iso}`), 1),
      })
    }
  }
  rows.sort((left, right) => left.period.localeCompare(right.period) || left.segment.localeCompare(right.segment))
  const overall = rows.filter((row) => row.segment === 'overall').map((row) => row.period)
  assert(overall[0] === '2017-06', 'overall LVI must start in 2017 H1')
  assert(overall.at(-1) === '2025-12', 'overall LVI must include 2025 H2')
  return table({
    dataset_id: 'colombo-land-valuation-indicator',
    title: 'Colombo Land Valuation Indicator',
    description: 'Half-yearly Land Valuation Indicator for Colombo District (2017 H1=100), with residential, commercial, industrial and overall sub-indices.',
    grain: 'One Colombo-district row per half-year and sub-index.',
    source_ids: ['cbsl-land-valuation-indicator'],
    vintage: '2017 H1–2025 H2; 2017 H1=100 series revised in June 2022',
    primary_key: ['period', 'segment'],
    notes: [
      'The Land Price Index was renamed Land Valuation Indicator from 2019 H2.',
      'The whole 2017 H1=100 series was revised in June 2022 using re-estimated Government Valuation Department data.',
      'Coverage is Colombo District Divisional Secretariat divisions, not the island.',
      '2025 H2 values are taken from the official CBSL press table dated 25 February 2026; earlier points come from the CBSL Economic Data Library series.',
    ],
    caveats: [
      'This is a valuation indicator for Colombo District land, not a transaction-price or island-wide house-price index.',
      'The June 2022 methodology revision means pre-revision publications should not be mixed with this series.',
      LICENSE_CAVEAT,
    ],
    fields: [
      dim('period', 'period', 'Half-year end'),
      dim('half', 'string', 'Half'),
      dim('segment', 'string', 'Sub-index'),
      measure('index_value', 'number', 'Land Valuation Indicator', '2017 H1=100'),
    ],
    rows,
  })
}

export async function loadLandValuationSeries(sourceDir, fetchImpl = fetch) {
  const { existsSync, readFileSync } = await import('node:fs')
  const { join } = await import('node:path')
  const local = Boolean(sourceDir) && LVI_SEGMENTS.every((segment) => existsSync(join(sourceDir, `lvi-${segment}.json`)))
  const seriesBySegment = {}
  for (const segment of LVI_SEGMENTS) {
    if (local) {
      seriesBySegment[segment] = JSON.parse(readFileSync(join(sourceDir, `lvi-${segment}.json`), 'utf8')).cleaned_data
      continue
    }
    const url = `${LVI_DATA_LIBRARY}/${encodeURIComponent(LVI_SERIES[segment])}`
    const response = await fetchImpl(url, { headers: { 'User-Agent': 'developing-country.org data refresh' } })
    if (!response.ok) fail(`LVI series download failed (${response.status}): ${url}`)
    seriesBySegment[segment] = (await response.json()).cleaned_data
  }
  return seriesBySegment
}

export async function buildMarketIndicators(sourceDir, { readSheet, fetchImpl = fetch } = {}) {
  const tourism = buildTourismEarningsTable(readSheet(sourceDir, 'tourism'))
  const exchangeRates = buildExchangeRatesTable(readSheet(sourceDir, 'fxAverage'), readSheet(sourceDir, 'fxMonthEnd'))
  const effectiveRates = buildEffectiveExchangeRateTable(readSheet(sourceDir, 'fxReer'))
  const landValuation = buildLandValuationTable(await loadLandValuationSeries(sourceDir, fetchImpl))
  assert(tourism.rows[0].period === '2009-01' && tourism.rows.at(-1).period >= '2026-08', 'tourism earnings coverage must run 2009-01 through at least 2026-08')
  const usdAverage = exchangeRates.rows.filter((row) => row.currency === 'usd' && row.rate_kind === 'monthly_average')
  const usdMonthEnd = exchangeRates.rows.filter((row) => row.currency === 'usd' && row.rate_kind === 'month_end')
  assert(usdAverage[0].period === '1986-01' && usdAverage.at(-1).period >= '2026-08', 'monthly average USD coverage must run 1986-01 through at least 2026-08')
  assert(usdMonthEnd[0].period === '1995-01' && usdMonthEnd.at(-1).period >= '2026-08', 'month-end USD coverage must run 1995-01 through at least 2026-08')
  const neer = effectiveRates.rows.filter((row) => row.index_id === 'neer')
  assertContiguousPeriods(neer.map((row) => row.period), 'NEER')
  assert(neer[0].period === '2013-01' && neer.at(-1).period >= '2026-07', 'NEER coverage must run 2013-01 through at least 2026-07')
  assert(landValuation.rows.filter((row) => row.segment === 'overall').length === 18, 'LVI overall series must have 18 half-years')
  return [tourism, exchangeRates, effectiveRates, landValuation]
}
