#!/usr/bin/env bun

// Normalize Colombo District asking-price indices from CBSL Real Estate Market
// Analysis PDFs. Source PDFs are downloaded to a temporary directory (or read
// from --source-dir) and never copied into public/.

import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  LICENSE_CAVEAT,
  assert,
  assertContiguousPeriods,
  dim,
  measure,
  period,
  table,
} from './build-cbsl-indicators.mjs'

const ROOT = resolve(import.meta.dir, '..')
const DEFAULT_OUTPUT = join(ROOT, 'public/data')
const SURVEY_PAGE = 'https://www.cbsl.gov.lk/en/statistics/business-surveys/condominium-market-survey'
const PDF_BASE = 'https://www.cbsl.gov.lk/sites/default/files/cbslweb_documents/statistics'

/** First quarterly report that prints index levels rather than year-on-year rates. */
export const ASKING_PRICE_REPORTS = Object.freeze([
  '2024_q1', '2024_q2', '2024_q3', '2024_q4',
  '2025_q1', '2025_q2', '2025_q3', '2025_q4',
  '2026_q1',
])

export const PROPERTY_TYPES = Object.freeze([
  { id: 'land', label: 'Land', field: 'land' },
  { id: 'house', label: 'House', field: 'house' },
  { id: 'condominium', label: 'Condominium', field: 'condominium' },
])

const MONTH_INDEX = Object.freeze({
  January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
  July: 7, August: 8, September: 9, October: 10, November: 11, December: 12,
})
const MONTH_RE = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/
const YEAR_LINE = /^\s*(20\d{2})\s*(?:Q[1-4])?\s*$/
const YEAR_TOKEN = /\b(20[2-9]\d)\b/

export function pdfFileName(reportId) {
  return `real_estate_market_analysis_${reportId}.pdf`
}

export function pdfUrl(reportId) {
  return `${PDF_BASE}/${pdfFileName(reportId)}`
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && value !== undefined && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
  }
  return value
}

function pdfText(path) {
  const result = Bun.spawnSync(['pdftotext', '-layout', path, '-'])
  if (result.exitCode !== 0) {
    throw new Error(`pdftotext failed for ${path}: ${new TextDecoder().decode(result.stderr).trim()}`)
  }
  return new TextDecoder().decode(result.stdout)
}

function nextMonth(year, month) {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 }
}

/**
 * Read Table 1 index levels from one quarterly PDF. Older reports that only
 * print year-on-year rates return an empty list.
 */
export function parseAskingPriceTable(text) {
  const start = text.search(/Table 1:\s*Asking Price Indices/)
  if (start < 0) return []
  let chunk = text.slice(start)
  if (/Y-o-Y|Percentage Change/.test(chunk.slice(0, 800))) return []
  const hedonic = chunk.search(/hedonic regression/i)
  if (hedonic >= 0) chunk = chunk.slice(0, hedonic)

  const monthRows = []
  let firstYear = null
  for (const raw of chunk.split('\n')) {
    const line = raw.replace(/[‐–]/g, '-')
    const yearOnly = YEAR_LINE.exec(line)
    if (yearOnly) {
      const year = Number(yearOnly[1])
      if (year !== 2019 && firstYear == null) firstYear = year
      continue
    }
    const monthMatch = MONTH_RE.exec(line)
    if (!monthMatch) continue
    const values = [...line.matchAll(/\d+\.\d+/g)]
      .map((match) => Number(match[0]))
      .filter((value) => value >= 50 && value <= 400)
    if (values.length < 3) continue
    const [land, house, condominium] = values.slice(-3)
    const yearOnLine = YEAR_TOKEN.exec(line)
    if (yearOnLine && firstYear == null) firstYear = Number(yearOnLine[1])
    monthRows.push({ month: MONTH_INDEX[monthMatch[1]], land, house, condominium })
  }
  if (monthRows.length === 0 || firstYear == null) return []

  let year = firstYear
  let month = monthRows[0].month
  const rows = []
  for (const row of monthRows) {
    assert(row.month === month, `asking-price month sequence broke at ${period(year, month)}`)
    rows.push({
      period: period(year, month),
      land: row.land,
      house: row.house,
      condominium: row.condominium,
    })
    ;({ year, month } = nextMonth(year, month))
  }
  return rows
}

export function stitchAskingPriceReports(reports) {
  const byPeriod = new Map()
  for (const report of reports) {
    for (const row of report.rows) {
      byPeriod.set(row.period, { ...row, report_id: report.id })
    }
  }
  const periods = [...byPeriod.keys()].sort()
  assertContiguousPeriods(periods, 'Colombo asking-price indices')
  return periods.map((key) => byPeriod.get(key))
}

export function buildAskingPriceTable(stitched) {
  assert(stitched[0].period === '2022-10', `series must start 2022-10, found ${stitched[0].period}`)
  assert(stitched.at(-1).period >= '2026-03', `series ends ${stitched.at(-1).period}, expected at least 2026-03`)
  const observations = stitched.flatMap((row) => PROPERTY_TYPES.map((type) => ({
    period: row.period,
    property_type: type.id,
    property_type_label: type.label,
    index_value: row[type.field],
    report_id: row.report_id,
  })))
  return table({
    dataset_id: 'colombo-asking-price-indices',
    title: 'Colombo asking-price indices',
    description: 'Monthly asking-price indices for land, houses and condominiums in Colombo District (2019=100), compiled by CBSL from publicly listed asking prices.',
    grain: 'One row per month and property type.',
    source_ids: ['cbsl-real-estate-asking-prices'],
    vintage: `${stitched[0].period}–${stitched.at(-1).period}; 2019=100`,
    primary_key: ['period', 'property_type'],
    notes: [
      LICENSE_CAVEAT,
      'CBSL compiles these indices with a hedonic regression based rolling-window time-dummy method. The base period is 2019=100.',
      'Coverage is Colombo District. Later quarterly reports can revise earlier months; the platform keeps the latest published value for each month.',
    ],
    caveats: [
      'These are asking-price indices, not transaction prices or the Land Valuation Indicator.',
      'They are not a listing-site scrape and do not include individual property advertisements.',
      'The Price Index for New Condominiums from the developer survey is a different series and is not in this table.',
    ],
    fields: [
      dim('period', 'period', 'Month'),
      dim('property_type', 'string', 'Property type'),
      dim('property_type_label', 'string', 'Property type label'),
      dim('report_id', 'string', 'Latest source report'),
      measure('index_value', 'number', 'Asking-price index', '2019=100'),
    ],
    rows: observations,
  })
}

function sourceArgs() {
  const sourceIndex = process.argv.indexOf('--source-dir')
  const outputIndex = process.argv.indexOf('--output-dir')
  return {
    sourceDir: sourceIndex >= 0 ? resolve(process.argv[sourceIndex + 1] ?? '') : null,
    outputDir: outputIndex >= 0 ? resolve(process.argv[outputIndex + 1] ?? '') : DEFAULT_OUTPUT,
  }
}

async function materializeSources(explicitDir) {
  if (explicitDir) return { dir: explicitDir, temporary: false }
  const dir = mkdtempSync(join(tmpdir(), 'developing-country-real-estate-'))
  for (const reportId of ASKING_PRICE_REPORTS) {
    const url = pdfUrl(reportId)
    const response = await fetch(url, { headers: { 'User-Agent': 'developing-country.org data refresh' } })
    if (!response.ok) throw new Error(`Source download failed (${response.status}): ${url}`)
    await Bun.write(join(dir, pdfFileName(reportId)), await response.arrayBuffer())
  }
  return { dir, temporary: true }
}

export function readAskingPriceReports(sourceDir) {
  const files = new Set(readdirSync(sourceDir))
  return ASKING_PRICE_REPORTS.map((id) => {
    const file = pdfFileName(id)
    assert(files.has(file), `missing ${file}`)
    return { id, rows: parseAskingPriceTable(pdfText(join(sourceDir, file))) }
  })
}

if (import.meta.main) {
  const { sourceDir, outputDir } = sourceArgs()
  const materialized = await materializeSources(sourceDir)
  try {
    const reports = readAskingPriceReports(materialized.dir)
    const dataset = buildAskingPriceTable(stitchAskingPriceReports(reports))
    mkdirSync(outputDir, { recursive: true })
    writeFileSync(join(outputDir, `${dataset.dataset_id}.json`), `${JSON.stringify(canonical(dataset), null, 2)}\n`)
    console.log(`${dataset.dataset_id}.json: ${dataset.rows.length} rows`)
  } finally {
    if (materialized.temporary) rmSync(materialized.dir, { recursive: true, force: true })
  }
}
