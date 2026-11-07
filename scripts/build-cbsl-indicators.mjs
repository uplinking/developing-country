#!/usr/bin/env bun

// Normalize selected public aggregate tables published by the Central Bank of
// Sri Lanka. Source workbooks are downloaded only to a temporary directory (or
// read from --source-dir); they are never copied into a public directory.

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { parseIndicatorTable } from '../packages/datasets/src/table.ts'
import { readXlsxSheet } from './lib/xlsx.mjs'

const ROOT = resolve(import.meta.dir, '..')
const DEFAULT_OUTPUT = join(ROOT, 'public/data')
const TRADE_SHEET = 'xl/worksheets/sheet2.xml'

export const CBSL_SOURCES = Object.freeze({
  exports: Object.freeze({
    id: 'cbsl-external-sector-exports-table-2-02',
    file: 'table2.02_20260930_e.xlsx',
    url: 'https://www.cbsl.gov.lk/sites/default/files/cbslweb_documents/statistics/sheets/table2.02_20260930_e.xlsx',
  }),
  imports: Object.freeze({
    id: 'cbsl-external-sector-imports-table-2-04',
    file: 'table2.04_20260930_e.xlsx',
    url: 'https://www.cbsl.gov.lk/sites/default/files/cbslweb_documents/statistics/sheets/table2.04_20260930_e.xlsx',
  }),
  remittances: Object.freeze({
    id: 'cbsl-workers-remittances-table-2-14-2',
    file: 'table2.14.2_20260930_e.xlsx',
    url: 'https://www.cbsl.gov.lk/sites/default/files/cbslweb_documents/statistics/sheets/table2.14.2_20260930_e.xlsx',
  }),
  fiscal: Object.freeze({
    id: 'cbsl-fiscal-operations-table-3-01',
    file: 'table3.01_20260720.xlsx',
    url: 'https://www.cbsl.gov.lk/sites/default/files/cbslweb_documents/statistics/sheets/table3.01_20260720.xlsx',
  }),
  revenue: Object.freeze({
    id: 'cbsl-government-revenue-table-3-02',
    file: 'table3.02_20260720.xlsx',
    url: 'https://www.cbsl.gov.lk/sites/default/files/cbslweb_documents/statistics/sheets/table3.02_20260720.xlsx',
  }),
  debt: Object.freeze({
    id: 'cbsl-central-government-debt-table-3-05',
    file: 'table3.05_20260720.xlsx',
    url: 'https://www.cbsl.gov.lk/sites/default/files/cbslweb_documents/statistics/sheets/table3.05_20260720.xlsx',
  }),
  tourism: Object.freeze({
    id: 'cbsl-tourism-earnings-table-2-14-1',
    file: 'table2.14.1_20260930_e.xlsx',
    url: 'https://www.cbsl.gov.lk/sites/default/files/cbslweb_documents/statistics/sheets/table2.14.1_20260930_e.xlsx',
  }),
  fxAverage: Object.freeze({
    id: 'cbsl-monthly-average-exchange-rates',
    file: 'IF_Monthly_Average_Exchange_Rates.xlsx',
    url: 'https://www.cbsl.gov.lk/sites/default/files/cbslweb_documents/statistics/sheets/IF_Monthly_Average_Exchange_Rates.xlsx',
  }),
  fxMonthEnd: Object.freeze({
    id: 'cbsl-end-of-month-exchange-rates',
    file: 'IF_End_of_the_Month_Exchange_Rates.xlsx',
    url: 'https://www.cbsl.gov.lk/sites/default/files/cbslweb_documents/statistics/sheets/IF_End_of_the_Month_Exchange_Rates.xlsx',
  }),
  fxReer: Object.freeze({
    id: 'cbsl-neer-reer-indices',
    file: 'IF_REER.xlsx',
    url: 'https://www.cbsl.gov.lk/sites/default/files/cbslweb_documents/statistics/sheets/IF_REER.xlsx',
  }),
})

export const LICENSE_CAVEAT = 'CBSL makes the workbook freely downloadable but does not state an open-data reuse licence on the statistical-table page; this artifact contains normalized aggregate facts and does not redistribute the workbook.'

export function dim(id, type, label, unit) {
  const field = { id, role: 'dimension', type, label }
  if (unit) field.unit = unit
  return field
}

export function measure(id, type, label, unit, aggregation = 'none') {
  const field = { id, role: 'measure', type, label, aggregation }
  if (unit) field.unit = unit
  return field
}

export function table(definition) {
  return parseIndicatorTable({ schema_version: 1, country: 'LK', ...definition })
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && value !== undefined && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
  }
  return value
}

function writeTable(outputDir, dataset) {
  mkdirSync(outputDir, { recursive: true })
  const file = `${dataset.dataset_id}.json`
  writeFileSync(join(outputDir, file), `${JSON.stringify(canonical(dataset), null, 2)}\n`)
  console.log(`${file}: ${dataset.rows.length.toLocaleString()} rows`)
}

export function fail(message) {
  throw new Error(`CBSL indicator integrity error: ${message}`)
}

export function assert(condition, message) {
  if (!condition) fail(message)
}

export function normalizeLabel(value) {
  return String(value ?? '').replaceAll(/\s+/g, ' ').trim()
}

export function round(value, digits = 1) {
  const factor = 10 ** digits
  return Math.round((value + Number.EPSILON) * factor) / factor
}

export function rawNumber(value, label, { allowBlank = false, allowDash = false } = {}) {
  if (Number.isFinite(value)) return value
  const numericText = normalizeLabel(value).replaceAll(',', '')
  if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(numericText)) {
    const parsed = Number(numericText)
    if (Number.isFinite(parsed)) return parsed
  }
  if (allowBlank && (value === null || value === undefined || value === '')) return null
  if (allowDash && normalizeLabel(value) === '-') return null
  fail(`${label} is not a finite number: ${JSON.stringify(value)}`)
}

function publishedNumber(value, label, options) {
  const parsed = rawNumber(value, label, options)
  return parsed === null ? null : round(parsed, 1)
}

function approximate(actual, expected, label, tolerance = 0.001) {
  assert(Number.isFinite(actual) && Number.isFinite(expected), `${label} contains non-numeric values`)
  assert(Math.abs(actual - expected) <= tolerance, `${label} expected ${expected}, found ${actual}`)
}

export const MONTHS = Object.freeze(new Map([
  ['jan', 1], ['january', 1], ['feb', 2], ['february', 2], ['mar', 3], ['march', 3],
  ['apr', 4], ['april', 4], ['may', 5], ['jun', 6], ['june', 6], ['jul', 7], ['july', 7],
  ['aug', 8], ['august', 8], ['sep', 9], ['sept', 9], ['september', 9], ['oct', 10],
  ['october', 10], ['nov', 11], ['november', 11], ['dec', 12], ['december', 12],
]))

export function period(year, month) {
  assert(Number.isInteger(year) && year >= 1900 && year <= 2100, `invalid year ${year}`)
  assert(Number.isInteger(month) && month >= 1 && month <= 12, `invalid month ${month}`)
  return `${year}-${String(month).padStart(2, '0')}`
}

export function parseMonthlyHeader(value) {
  if (Number.isFinite(value)) {
    assert(Number.isInteger(value), `Excel date serial is fractional: ${value}`)
    const date = new Date(Date.UTC(1899, 11, 30) + value * 86_400_000)
    assert(date.getUTCDate() === 1, `Excel date serial is not the first of a month: ${value}`)
    return { period: period(date.getUTCFullYear(), date.getUTCMonth() + 1), provisional: false }
  }
  const label = normalizeLabel(value)
  const provisional = /\([a-z]\)/i.test(label)
  const withoutFootnote = label.replaceAll(/\([a-z]\)/gi, '').replaceAll(/\s+/g, '')
  const match = /^([A-Za-z]+)-(\d{2}|\d{4})$/.exec(withoutFootnote)
  assert(match, `unrecognized monthly header ${JSON.stringify(value)}`)
  const month = MONTHS.get(match[1].toLowerCase())
  assert(month, `unrecognized month in ${JSON.stringify(value)}`)
  const yearToken = Number(match[2])
  const year = match[2].length === 2 ? 2000 + yearToken : yearToken
  return { period: period(year, month), provisional }
}

function nextPeriod(value) {
  const [year, month] = value.split('-').map(Number)
  return month === 12 ? period(year + 1, 1) : period(year, month + 1)
}

export function assertContiguousPeriods(periods, label) {
  assert(periods.length > 0, `${label} has no periods`)
  assert(new Set(periods).size === periods.length, `${label} has duplicate periods`)
  for (let index = 1; index < periods.length; index += 1) {
    assert(periods[index] === nextPeriod(periods[index - 1]), `${label} jumps from ${periods[index - 1]} to ${periods[index]}`)
  }
}

function category(id, label, source, parent = null, kind = 'component') {
  return Object.freeze({ id, label, source, parent, kind })
}

export const EXPORT_CATEGORIES = Object.freeze([
  category('agricultural', 'Agricultural exports', '1. Agricultural exports', null, 'subtotal'),
  category('tea', 'Tea', 'Tea', 'agricultural'),
  category('rubber', 'Rubber', 'Rubber', 'agricultural'),
  category('coconut', 'Coconut', 'Coconut', 'agricultural', 'subtotal'),
  category('coconut-kernel-products', 'Coconut kernel products', 'Kernel products', 'coconut'),
  category('coconut-other', 'Other coconut products', 'Other', 'coconut'),
  category('spices', 'Spices', 'Spices', 'agricultural'),
  category('vegetables', 'Vegetables', 'Vegetables', 'agricultural'),
  category('unmanufactured-tobacco', 'Unmanufactured tobacco', 'Unmanufactured tobacco', 'agricultural'),
  category('minor-agricultural-products', 'Minor agricultural products', 'Minor agricultural products', 'agricultural'),
  category('seafood', 'Seafood', 'Seafood', 'agricultural'),
  category('industrial', 'Industrial exports', '2. Industrial exports', null, 'subtotal'),
  category('food-beverages-tobacco', 'Food, beverages and tobacco', 'Food, beverages & tobacco', 'industrial'),
  category('animal-fodder', 'Animal fodder', 'Animal fodder', 'industrial'),
  category('textiles-garments', 'Textiles and garments', 'Textiles and garments', 'industrial', 'subtotal'),
  category('garments', 'Garments', 'Garments', 'textiles-garments'),
  category('textiles', 'Textiles', 'Textiles', 'textiles-garments'),
  category('other-made-up-textiles', 'Other made-up textile articles', 'Other made up textile articles', 'textiles-garments'),
  category('rubber-products', 'Rubber products', 'Rubber products', 'industrial'),
  category('gems-diamonds-jewellery', 'Gems, diamonds and jewellery', 'Gems, diamonds and jewellery', 'industrial'),
  category('machinery-mechanical-appliances', 'Machinery and mechanical appliances', 'Machinery and mechanical appliances', 'industrial'),
  category('transport-equipment', 'Transport equipment', 'Transport equipment', 'industrial'),
  category('petroleum-products', 'Petroleum products', 'Petroleum products', 'industrial'),
  category('chemical-products', 'Chemical products', 'Chemical products', 'industrial'),
  category('wood-paper-products', 'Wood and paper products', 'Wood and paper products', 'industrial'),
  category('printing-products', 'Printing-industry products', 'Printing industry products', 'industrial'),
  category('leather-travel-footwear', 'Leather, travel goods and footwear', 'Leather, travel goods and footwear', 'industrial'),
  category('plastics', 'Plastics and articles thereof', 'Plastics and articles thereof', 'industrial'),
  category('base-metals', 'Base metals and articles', 'Base metals and articles', 'industrial'),
  category('ceramics', 'Ceramic products', 'Ceramic products', 'industrial'),
  category('other-industrial', 'Other industrial exports', 'Other industrial exports', 'industrial'),
  category('mineral', 'Mineral exports', '3. Mineral exports', null, 'subtotal'),
  category('earths-stone', 'Earths and stone', 'Earths and stone', 'mineral'),
  category('ores-slag-ash', 'Ores, slag and ash', 'Ores, slag and ash', 'mineral'),
  category('precious-metals', 'Precious metals', 'Precious metals', 'mineral'),
  category('unclassified', 'Unclassified exports', '4. Unclassified', null, 'subtotal'),
  category('total', 'Total exports', 'Total exports', null, 'total'),
])

export const IMPORT_CATEGORIES = Object.freeze([
  category('consumer', 'Consumer goods', '1. Consumer goods', null, 'subtotal'),
  category('food-beverages', 'Food and beverages', 'Food and beverages', 'consumer', 'subtotal'),
  category('vegetables', 'Vegetables', 'Vegetables', 'food-beverages'),
  category('sugar-confectionery', 'Sugar and confectionery', 'Sugar and confectionery', 'food-beverages'),
  category('cereals-milling', 'Cereals and milling-industry products', 'Cereals and milling industry products', 'food-beverages'),
  category('dairy', 'Dairy products', 'Dairy products', 'food-beverages'),
  category('seafood', 'Seafood', 'Seafood', 'food-beverages'),
  category('oils-fats', 'Oils and fats', 'Oils and fats', 'food-beverages'),
  category('spices', 'Spices', 'Spices', 'food-beverages'),
  category('fruits', 'Fruits', 'Fruits', 'food-beverages'),
  category('beverages', 'Beverages', 'Beverages', 'food-beverages'),
  category('other-food-beverages', 'Other food and beverages', 'Other food and beverages', 'food-beverages'),
  category('other-consumer', 'Other consumer goods', 'Other consumer goods', 'consumer', 'subtotal'),
  category('medical-pharmaceuticals', 'Medical and pharmaceuticals', 'Medical and pharmaceuticals', 'other-consumer'),
  category('personal-vehicles', 'Personal vehicles', 'Personal vehicles', 'other-consumer'),
  category('household-furniture', 'Household and furniture items', 'Household and furniture items', 'other-consumer'),
  category('home-appliances', 'Home appliances', 'Home appliances', 'other-consumer'),
  category('clothing-accessories', 'Clothing and accessories', 'Clothing and accessories', 'other-consumer'),
  category('cosmetics-toiletries', 'Cosmetics and toiletries', 'Cosmetics and toiletries', 'other-consumer'),
  category('rubber-products', 'Rubber products', 'Rubber products', 'other-consumer'),
  category('printed-materials-stationary', 'Printed materials and stationary', 'Printed materials and stationary', 'other-consumer'),
  category('telecommunication-devices', 'Telecommunication devices', 'Telecommunication devices', 'other-consumer'),
  category('other-non-food-consumables', 'Other non-food consumables', 'Other non-food consumables', 'other-consumer'),
  category('intermediate', 'Intermediate goods', '2. Intermediate goods', null, 'subtotal'),
  category('fuel', 'Fuel', 'Fuel', 'intermediate', 'subtotal'),
  category('crude-oil', 'Petroleum: crude oil', 'Petroleum : Crude oil', 'fuel'),
  category('refined-petroleum', 'Refined petroleum', 'Refined Petroleum', 'fuel'),
  category('coal', 'Coal', 'Coal', 'fuel'),
  category('textiles-articles', 'Textiles and textile articles', 'Textiles and textile articles', 'intermediate'),
  category('chemical-products', 'Chemical products', 'Chemical products', 'intermediate'),
  category('plastics', 'Plastics and articles thereof', 'Plastics and articles thereof', 'intermediate'),
  category('wheat-maize', 'Wheat and maize', 'Wheat and Maize', 'intermediate'),
  category('diamonds-precious-stones', 'Diamonds and precious or semi-precious stones', 'Diamonds and precious or semi stones', 'intermediate'),
  category('gold', 'Gold', 'Gold', 'intermediate'),
  category('paper-paperboard', 'Paper, paperboards and articles thereof', 'Paper and paperboards and articles thereof', 'intermediate'),
  category('base-metals', 'Base metals', 'Base metals', 'intermediate'),
  category('fertiliser', 'Fertiliser', 'Fertiliser', 'intermediate'),
  category('vehicle-machinery-parts', 'Vehicle and machinery parts', 'Vehicle and machinery parts', 'intermediate'),
  category('agricultural-inputs', 'Agricultural inputs', 'Agricultural inputs', 'intermediate'),
  category('food-preparations', 'Food preparations', 'Food preparations', 'intermediate'),
  category('rubber-articles', 'Rubber and articles thereof', 'Rubber and articles thereof', 'intermediate'),
  category('mineral-products', 'Mineral products', 'Mineral products', 'intermediate'),
  category('unmanufactured-tobacco', 'Unmanufactured tobacco', 'Unmanufactured tobacco', 'intermediate'),
  category('other-intermediate', 'Other intermediate goods', 'Other intermediate goods', 'intermediate'),
  category('investment', 'Investment goods', '3. Investment goods', null, 'subtotal'),
  category('machinery-equipment', 'Machinery and equipment', 'Machinery and equipment', 'investment'),
  category('building-materials', 'Building materials', 'Building materials', 'investment'),
  category('transport-equipment', 'Transport equipment', 'Transport equipment', 'investment'),
  category('other-investment', 'Other investment goods', 'Other investment Goods', 'investment'),
  category('unclassified', 'Unclassified imports', '4. Unclassified imports', null, 'subtotal'),
  category('total', 'Total imports', 'Total imports', null, 'total'),
  category('non-oil', 'Non-oil imports', 'Non oil Imports', null, 'supplementary'),
])

function validateCategoryDefinitions(definitions, flow) {
  const ids = new Set()
  const sources = new Set()
  for (const definition of definitions) {
    assert(!ids.has(definition.id), `${flow} duplicates category id ${definition.id}`)
    assert(!sources.has(normalizeLabel(definition.source)), `${flow} duplicates source label ${definition.source}`)
    ids.add(definition.id)
    sources.add(normalizeLabel(definition.source))
  }
  for (const definition of definitions) {
    assert(definition.parent === null || ids.has(definition.parent), `${flow} category ${definition.id} has unknown parent ${definition.parent}`)
  }
  assert(definitions.filter((definition) => definition.kind === 'total').length === 1, `${flow} must have one total series`)
}

function categoryLevel(definition, byId) {
  let level = 0
  let current = definition
  const seen = new Set()
  while (current.parent !== null) {
    assert(!seen.has(current.id), `category hierarchy cycles at ${current.id}`)
    seen.add(current.id)
    current = byId.get(current.parent)
    assert(current, `category ${definition.id} has an unknown parent`)
    level += 1
  }
  return level
}

function tradeValue(value, label) {
  if (Number.isFinite(value)) {
    return { value: round(value, 1), status: 'reported' }
  }
  if (normalizeLabel(value) === '…') return { value: null, status: 'negligible' }
  fail(`${label} is neither a number nor the source's negligible marker: ${JSON.stringify(value)}`)
}

export function buildTradeTable(sourceRows, flow, definitions = flow === 'exports' ? EXPORT_CATEGORIES : IMPORT_CATEGORIES) {
  assert(flow === 'exports' || flow === 'imports', `unknown trade flow ${flow}`)
  validateCategoryDefinitions(definitions, flow)
  const header = sourceRows.find((row) => normalizeLabel(row?.[0]) === 'Category')
  assert(header, `${flow} workbook has no Category header`)
  const lastColumn = header.reduce((last, value, index) => value == null ? last : index, 0)
  const headers = []
  for (let column = 1; column <= lastColumn; column += 1) {
    const parsed = parseMonthlyHeader(header[column])
    headers.push({ ...parsed, column })
  }
  assertContiguousPeriods(headers.map((entry) => entry.period), `${flow} workbook`)

  const rowByLabel = new Map()
  for (const row of sourceRows) {
    if (row?.[0] == null) continue
    const label = normalizeLabel(row[0])
    if (rowByLabel.has(label)) fail(`${flow} workbook repeats row label ${label}`)
    rowByLabel.set(label, row)
  }
  const byId = new Map(definitions.map((definition) => [definition.id, definition]))
  const sourceRowsById = new Map()
  definitions.forEach((definition) => {
    const row = rowByLabel.get(normalizeLabel(definition.source))
    assert(row, `${flow} workbook is missing category ${definition.source}`)
    sourceRowsById.set(definition.id, row)
  })

  const topLevelIds = definitions
    .filter((definition) => definition.parent === null && definition.kind === 'subtotal')
    .map((definition) => definition.id)
  const totalDefinition = definitions.find((definition) => definition.kind === 'total')
  for (const headerCell of headers) {
    const total = rawNumber(sourceRowsById.get(totalDefinition.id)?.[headerCell.column], `${flow} ${headerCell.period} total`)
    const parts = topLevelIds.map((id) => rawNumber(sourceRowsById.get(id)?.[headerCell.column], `${flow} ${headerCell.period} ${id}`))
    approximate(total, parts.reduce((sum, value) => sum + value, 0), `${flow} ${headerCell.period} category total`)
  }

  const observations = []
  for (const headerCell of headers) {
    definitions.forEach((definition, sourceOrder) => {
      const parsed = tradeValue(sourceRowsById.get(definition.id)[headerCell.column], `${flow} ${headerCell.period} ${definition.id}`)
      observations.push({
        period: headerCell.period,
        category_id: definition.id,
        category: definition.label,
        parent_category_id: definition.parent,
        category_level: categoryLevel(definition, byId),
        source_order: sourceOrder + 1,
        series_kind: definition.kind,
        provisional: headerCell.provisional,
        value_status: parsed.status,
        value_usd_million: parsed.value,
      })
    })
  }

  const isExports = flow === 'exports'
  const source = CBSL_SOURCES[flow]
  const latest = headers.at(-1).period
  return table({
    dataset_id: `merchandise-${flow}-monthly`,
    title: `Monthly merchandise ${flow} by category`,
    description: `Central Bank of Sri Lanka monthly merchandise ${flow} in US dollars using its published economic classification hierarchy.`,
    grain: `One row per month and published ${flow === 'exports' ? 'export' : 'import'} category or total.`,
    source_ids: [source.id],
    vintage: `${headers[0].period}–${latest}; ${headers.find((entry) => entry.provisional)?.period ?? 'no periods'} onward provisional`,
    primary_key: ['period', 'category_id'],
    notes: [
      'Values are rounded to one decimal place, matching the workbook’s published number format.',
      '(a) Classification of data on external trade was revised in 2010.',
      '(b) Provisional.',
      ...(isExports ? ['The source marker … is retained as a null value with value_status negligible.'] : []),
    ],
    caveats: [
      'The table contains overlapping totals, subtotals and components; do not sum across hierarchy levels.',
      'The 2010 classification revision can create a break in long-run category comparisons.',
      LICENSE_CAVEAT,
    ],
    fields: [
      dim('period', 'period', 'Month'),
      dim('category_id', 'string', 'Category id'),
      dim('category', 'string', 'Category'),
      dim('parent_category_id', 'string', 'Parent category id'),
      dim('category_level', 'integer', 'Hierarchy level'),
      dim('source_order', 'integer', 'Source order'),
      dim('series_kind', 'string', 'Series kind'),
      dim('provisional', 'boolean', 'Provisional'),
      dim('value_status', 'string', 'Value status'),
      measure('value_usd_million', 'number', isExports ? 'Exports' : 'Imports', 'USD million'),
    ],
    rows: observations,
  })
}

export function buildRemittancesTable(sourceRows) {
  const yearRow = sourceRows.find((row) => (row ?? []).filter((value) => Number.isInteger(value) && value >= 1900 && value <= 2100).length >= 1)
  assert(yearRow, 'remittances workbook has no year header')
  const yearColumns = []
  for (const [column, value] of yearRow.entries()) {
    if (Number.isInteger(value) && value >= 1900 && value <= 2100) yearColumns.push({ column, year: value })
  }
  assert(yearColumns.length > 0, 'remittances workbook has no usable years')
  const monthRows = new Map()
  for (const row of sourceRows) {
    const month = MONTHS.get(normalizeLabel(row?.[1]).toLowerCase())
    if (month) monthRows.set(month, row)
  }
  assert(monthRows.size === 12, `remittances workbook has ${monthRows.size} month rows instead of 12`)

  const observations = []
  for (const { column, year } of yearColumns) {
    for (let month = 1; month <= 12; month += 1) {
      const value = monthRows.get(month)[column]
      if (value === null || value === undefined || value === '') continue
      observations.push({
        period: period(year, month),
        value_usd_million: publishedNumber(value, `remittances ${year}-${month}`),
      })
    }
  }
  observations.sort((left, right) => left.period.localeCompare(right.period))
  assertContiguousPeriods(observations.map((row) => row.period), 'remittances workbook')
  return table({
    dataset_id: 'workers-remittances-monthly',
    title: 'Monthly workers’ remittances',
    description: 'Workers’ remittances reported by licensed banks to the Central Bank of Sri Lanka.',
    grain: 'One national row per month.',
    source_ids: [CBSL_SOURCES.remittances.id],
    vintage: `${observations[0].period}–${observations.at(-1).period}`,
    primary_key: ['period'],
    notes: [
      'Values are rounded to one decimal place, matching the workbook’s published number format.',
      '(a) Based on data provided by Licensed Banks.',
      '(b) Workers’ remittances may include other remittances, such as those received following Cyclone Ditwah.',
    ],
    caveats: [LICENSE_CAVEAT],
    fields: [
      dim('period', 'period', 'Month'),
      measure('value_usd_million', 'number', 'Workers’ remittances', 'USD million'),
    ],
    rows: observations,
  })
}

export function buildTradeMonthlyTotals(exportsTable, importsTable) {
  const rows = []
  for (const [flow, source] of [['exports', exportsTable], ['imports', importsTable]]) {
    for (const observation of source.rows) {
      if (observation.category_id !== 'total') continue
      rows.push({
        period: observation.period,
        flow,
        provisional: observation.provisional,
        value_usd_million: observation.value_usd_million,
      })
    }
  }
  rows.sort((left, right) => left.period.localeCompare(right.period) || left.flow.localeCompare(right.flow))
  const expectedRows = [exportsTable, importsTable]
    .reduce((sum, source) => sum + source.rows.filter((row) => row.category_id === 'total').length, 0)
  assert(rows.length === expectedRows, `trade totals expected ${expectedRows} rows, found ${rows.length}`)
  return table({
    dataset_id: 'merchandise-trade-monthly',
    title: 'Monthly merchandise trade',
    description: 'Total merchandise exports and imports reported by the Central Bank of Sri Lanka, in US dollars.',
    grain: 'One national row per month and trade flow.',
    source_ids: [CBSL_SOURCES.exports.id, CBSL_SOURCES.imports.id],
    vintage: `${rows[0].period}–${rows.at(-1).period}; ${rows.find((row) => row.provisional)?.period ?? 'no periods'} onward provisional`,
    primary_key: ['period', 'flow'],
    notes: ['Values are rounded to one decimal place, matching the workbooks’ published number format.', '(a) Classification of external-trade data was revised in 2010.', '(b) Provisional.'],
    caveats: ['The 2010 classification revision can create a break in long-run comparisons.', LICENSE_CAVEAT],
    fields: [
      dim('period', 'period', 'Month'),
      dim('flow', 'string', 'Trade flow'),
      dim('provisional', 'boolean', 'Provisional'),
      measure('value_usd_million', 'number', 'Trade value', 'USD million'),
    ],
    rows,
  })
}

export function buildTradeAnnualCategories(exportsTable, importsTable) {
  const groups = new Map()
  for (const [flow, source] of [['exports', exportsTable], ['imports', importsTable]]) {
    for (const observation of source.rows) {
      const year = Number(observation.period.slice(0, 4))
      const key = `${year}\u0000${flow}\u0000${observation.category_id}`
      let group = groups.get(key)
      if (!group) {
        group = {
          year,
          flow,
          category_id: observation.category_id,
          category: observation.category,
          parent_category_id: observation.parent_category_id,
          category_level: observation.category_level,
          source_order: observation.source_order,
          series_kind: observation.series_kind,
          provisional: false,
          months_observed: 0,
          months_reported: 0,
          negligible_months: 0,
          value_usd_million: 0,
        }
        groups.set(key, group)
      }
      group.months_observed += 1
      group.provisional ||= observation.provisional
      if (observation.value_status === 'negligible') {
        group.negligible_months += 1
      } else {
        group.months_reported += 1
        group.value_usd_million += observation.value_usd_million
      }
    }
  }
  const rows = [...groups.values()]
    .map((row) => ({
      ...row,
      partial_year: row.months_observed < 12,
      value_status: row.negligible_months > 0 ? 'contains_negligible_months' : 'reported',
      value_usd_million: round(row.value_usd_million, 1),
    }))
    .sort((left, right) => left.year - right.year || left.flow.localeCompare(right.flow) || left.source_order - right.source_order)
  assert(rows.length > 0, 'annual trade categories have no rows')
  return table({
    dataset_id: 'merchandise-trade-category-annual',
    title: 'Annual merchandise trade by category',
    description: 'Annual sums of the Central Bank of Sri Lanka’s monthly export and import categories, retaining its hierarchy.',
    grain: 'One national row per calendar year, trade flow and published category or total.',
    source_ids: [CBSL_SOURCES.exports.id, CBSL_SOURCES.imports.id],
    vintage: `${rows[0].year}–${rows.at(-1).year}; ${rows.at(-1).year} is year to date`,
    primary_key: ['year', 'flow', 'category_id'],
    notes: [
      'Annual values are sums of the monthly observations and are rounded to one decimal place.',
      'months_observed distinguishes complete years from the latest year-to-date period.',
      'A source marker of … is counted in negligible_months and contributes zero to the displayed annual sum; it is not silently reported as an observed zero.',
      '(a) Classification of external-trade data was revised in 2010.',
      '(b) Provisional.',
    ],
    caveats: [
      'The table contains overlapping totals, subtotals and components; do not sum across hierarchy levels.',
      'Annual sums containing a source value marked negligible are a lower-bound display at the workbook’s published precision.',
      'The 2010 classification revision can create a break in long-run category comparisons.',
      LICENSE_CAVEAT,
    ],
    fields: [
      dim('year', 'year', 'Year'),
      dim('flow', 'string', 'Trade flow'),
      dim('category_id', 'string', 'Category id'),
      dim('category', 'string', 'Category'),
      dim('parent_category_id', 'string', 'Parent category id'),
      dim('category_level', 'integer', 'Hierarchy level'),
      dim('source_order', 'integer', 'Source order'),
      dim('series_kind', 'string', 'Series kind'),
      dim('provisional', 'boolean', 'Provisional'),
      dim('partial_year', 'boolean', 'Partial year'),
      dim('months_observed', 'integer', 'Months observed'),
      dim('months_reported', 'integer', 'Months with a numeric value'),
      dim('negligible_months', 'integer', 'Months marked negligible'),
      dim('value_status', 'string', 'Value status'),
      measure('value_usd_million', 'number', 'Annual trade value', 'USD million'),
    ],
    rows,
  })
}

function sourceYear(value, label) {
  if (Number.isInteger(value) && value >= 1900 && value <= 2100) return { year: value, sourceLabel: String(value) }
  const sourceLabel = normalizeLabel(value)
  const match = /^(\d{4})/.exec(sourceLabel)
  assert(match, `${label} has invalid year ${JSON.stringify(value)}`)
  return { year: Number(match[1]), sourceLabel }
}

function annualRows(sourceRows, label) {
  const rows = []
  for (const row of sourceRows) {
    const value = row?.[1]
    if (!(Number.isInteger(value) && value >= 1900 && value <= 2100) && !/^\d{4}/.test(normalizeLabel(value))) continue
    rows.push({ row, ...sourceYear(value, label) })
  }
  rows.sort((left, right) => left.year - right.year)
  assert(rows.length > 0, `${label} has no annual observations`)
  for (let index = 1; index < rows.length; index += 1) {
    assert(rows[index].year === rows[index - 1].year + 1, `${label} jumps from ${rows[index - 1].year} to ${rows[index].year}`)
  }
  return rows
}

function pct(value, label) {
  return publishedNumber(value, label)
}

export function buildFiscalOperationsTable(sourceRows) {
  const observations = annualRows(sourceRows, 'fiscal operations').map(({ row, year, sourceLabel }) => {
    const raw = {
      taxRevenue: rawNumber(row[2], `${year} tax revenue`),
      totalRevenue: rawNumber(row[3], `${year} total revenue`),
      grants: rawNumber(row[4], `${year} grants`),
      revenueAndGrants: rawNumber(row[5], `${year} revenue and grants`),
      recurrent: rawNumber(row[6], `${year} recurrent expenditure`),
      capitalNetLending: rawNumber(row[7], `${year} capital and net lending`),
      totalExpenditure: rawNumber(row[8], `${year} total expenditure`),
      currentBalance: rawNumber(row[9], `${year} current balance`),
      primaryBalance: rawNumber(row[10], `${year} primary balance`),
      overallBalance: rawNumber(row[11], `${year} overall balance`),
      foreignFinancing: rawNumber(row[12], `${year} foreign financing`),
      domesticFinancing: rawNumber(row[13], `${year} domestic financing`),
      privatisation: rawNumber(row[14], `${year} privatisation`, { allowBlank: true }),
      totalFinancing: rawNumber(row[15], `${year} total financing`),
    }
    // Older rows mix rounded published inputs with separately rounded totals.
    // A maximum discrepancy of one LKR million is therefore source-consistent.
    approximate(raw.revenueAndGrants, raw.totalRevenue + raw.grants, `${year} revenue and grants`, 1.01)
    approximate(raw.totalExpenditure, raw.recurrent + raw.capitalNetLending, `${year} expenditure total`, 1.01)
    approximate(raw.currentBalance, raw.totalRevenue - raw.recurrent, `${year} current-account balance`, 1.01)
    approximate(raw.overallBalance, raw.revenueAndGrants - raw.totalExpenditure, `${year} overall balance`, 1.01)
    approximate(raw.totalFinancing, raw.foreignFinancing + raw.domesticFinancing + (raw.privatisation ?? 0), `${year} financing total`, 1.01)
    return {
      year,
      source_year_label: sourceLabel,
      provisional: /\(b\)/i.test(sourceLabel),
      tax_revenue_rs_million: round(raw.taxRevenue, 1),
      total_revenue_rs_million: round(raw.totalRevenue, 1),
      grants_rs_million: round(raw.grants, 1),
      revenue_and_grants_rs_million: round(raw.revenueAndGrants, 1),
      recurrent_expenditure_rs_million: round(raw.recurrent, 1),
      capital_and_net_lending_rs_million: round(raw.capitalNetLending, 1),
      total_expenditure_rs_million: round(raw.totalExpenditure, 1),
      current_balance_rs_million: round(raw.currentBalance, 1),
      primary_balance_rs_million: round(raw.primaryBalance, 1),
      overall_budget_balance_rs_million: round(raw.overallBalance, 1),
      foreign_financing_rs_million: round(raw.foreignFinancing, 1),
      domestic_financing_rs_million: round(raw.domesticFinancing, 1),
      privatisation_financing_rs_million: raw.privatisation === null ? null : round(raw.privatisation, 1),
      total_financing_rs_million: round(raw.totalFinancing, 1),
      revenue_and_grants_pct_gdp: pct(row[16], `${year} revenue and grants GDP share`),
      expenditure_pct_gdp: pct(row[17], `${year} expenditure GDP share`),
      overall_budget_balance_pct_gdp: pct(row[18], `${year} overall balance GDP share`),
    }
  })
  return table({
    dataset_id: 'government-fiscal-operations-annual',
    title: 'Annual government fiscal operations',
    description: 'Government revenue, grants, expenditure, balances and financing reported by the Central Bank of Sri Lanka.',
    grain: 'One national row per calendar year.',
    source_ids: [CBSL_SOURCES.fiscal.id],
    vintage: `${observations[0].year}–${observations.at(-1).year}; ${observations.find((row) => row.provisional)?.year ?? 'none'} provisional`,
    primary_key: ['year'],
    notes: [
      'LKR values are in millions and rounded to one decimal place.',
      '(a) Data are based on GDP estimates compiled by DCS. From 2010 onwards, GDP shares use revised estimates with base year 2015.',
      '(b) Provisional.',
      'Source: Ministry of Finance, Planning and Economic Development.',
    ],
    caveats: [
      'The source leaves 2025 privatisation financing blank; it is preserved as null rather than inferred as zero.',
      LICENSE_CAVEAT,
    ],
    fields: [
      dim('year', 'year', 'Year'), dim('source_year_label', 'string', 'Source year label'), dim('provisional', 'boolean', 'Provisional'),
      measure('tax_revenue_rs_million', 'number', 'Tax revenue', 'LKR million'),
      measure('total_revenue_rs_million', 'number', 'Total revenue', 'LKR million'),
      measure('grants_rs_million', 'number', 'Grants', 'LKR million'),
      measure('revenue_and_grants_rs_million', 'number', 'Revenue and grants', 'LKR million'),
      measure('recurrent_expenditure_rs_million', 'number', 'Recurrent expenditure', 'LKR million'),
      measure('capital_and_net_lending_rs_million', 'number', 'Capital expenditure and net lending', 'LKR million'),
      measure('total_expenditure_rs_million', 'number', 'Total expenditure', 'LKR million'),
      measure('current_balance_rs_million', 'number', 'Current-account balance', 'LKR million'),
      measure('primary_balance_rs_million', 'number', 'Primary-account balance', 'LKR million'),
      measure('overall_budget_balance_rs_million', 'number', 'Overall budget balance', 'LKR million'),
      measure('foreign_financing_rs_million', 'number', 'Foreign financing', 'LKR million'),
      measure('domestic_financing_rs_million', 'number', 'Domestic financing', 'LKR million'),
      measure('privatisation_financing_rs_million', 'number', 'Privatisation financing', 'LKR million'),
      measure('total_financing_rs_million', 'number', 'Total financing', 'LKR million'),
      measure('revenue_and_grants_pct_gdp', 'number', 'Revenue and grants', 'percent of GDP'),
      measure('expenditure_pct_gdp', 'number', 'Expenditure', 'percent of GDP'),
      measure('overall_budget_balance_pct_gdp', 'number', 'Overall budget balance', 'percent of GDP'),
    ],
    rows: observations,
  })
}

export function buildGovernmentRevenueTable(sourceRows) {
  const observations = annualRows(sourceRows, 'government revenue').map(({ row, year, sourceLabel }) => {
    const direct = rawNumber(row[2], `${year} direct tax`)
    const indirect = rawNumber(row[3], `${year} indirect tax`)
    const totalTax = rawNumber(row[4], `${year} total tax`)
    const nonTax = rawNumber(row[5], `${year} non-tax revenue`)
    const totalRevenue = rawNumber(row[6], `${year} total revenue`)
    approximate(totalTax, direct + indirect, `${year} total tax`)
    // The published components and total differ by as much as LKR 16.5 million
    // (2010). Retain the reported values and make that residual explicit.
    approximate(totalRevenue, totalTax + nonTax, `${year} total revenue`, 20)
    approximate(rawNumber(row[7], `${year} direct share`) + rawNumber(row[8], `${year} indirect share`), 100, `${year} direct and indirect shares`, 0.01)
    approximate(rawNumber(row[9], `${year} tax share`) + rawNumber(row[10], `${year} non-tax share`), 100, `${year} tax and non-tax shares`, 0.01)
    return {
      year,
      source_year_label: sourceLabel,
      provisional: /\(a\)/i.test(sourceLabel),
      direct_tax_rs_million: round(direct, 1),
      indirect_tax_rs_million: round(indirect, 1),
      total_tax_rs_million: round(totalTax, 1),
      non_tax_revenue_rs_million: round(nonTax, 1),
      total_revenue_rs_million: round(totalRevenue, 1),
      reported_total_less_components_rs_million: round(totalRevenue - totalTax - nonTax, 1),
      direct_tax_share_of_tax_pct: pct(row[7], `${year} direct tax share`),
      indirect_tax_share_of_tax_pct: pct(row[8], `${year} indirect tax share`),
      tax_share_of_revenue_pct: pct(row[9], `${year} tax share of revenue`),
      non_tax_share_of_revenue_pct: pct(row[10], `${year} non-tax share of revenue`),
    }
  })
  return table({
    dataset_id: 'government-revenue-annual',
    title: 'Annual government revenue composition',
    description: 'Direct tax, indirect tax and non-tax revenue reported by the Central Bank of Sri Lanka.',
    grain: 'One national row per calendar year.',
    source_ids: [CBSL_SOURCES.revenue.id],
    vintage: `${observations[0].year}–${observations.at(-1).year}; ${observations.find((row) => row.provisional)?.year ?? 'none'} provisional`,
    primary_key: ['year'],
    notes: ['LKR values and percentages are rounded to one decimal place.', '(a) Provisional.', 'Source: Ministry of Finance, Planning and Economic Development.'],
    caveats: ['The workbook’s reported total revenue differs slightly from the sum of tax and non-tax components in some years; the residual is exposed rather than silently changing source values.', LICENSE_CAVEAT],
    fields: [
      dim('year', 'year', 'Year'), dim('source_year_label', 'string', 'Source year label'), dim('provisional', 'boolean', 'Provisional'),
      measure('direct_tax_rs_million', 'number', 'Direct tax revenue', 'LKR million'),
      measure('indirect_tax_rs_million', 'number', 'Indirect tax revenue', 'LKR million'),
      measure('total_tax_rs_million', 'number', 'Total tax revenue', 'LKR million'),
      measure('non_tax_revenue_rs_million', 'number', 'Non-tax revenue', 'LKR million'),
      measure('total_revenue_rs_million', 'number', 'Total revenue', 'LKR million'),
      measure('reported_total_less_components_rs_million', 'number', 'Reported total less published components', 'LKR million'),
      measure('direct_tax_share_of_tax_pct', 'number', 'Direct tax share of tax revenue', 'percent'),
      measure('indirect_tax_share_of_tax_pct', 'number', 'Indirect tax share of tax revenue', 'percent'),
      measure('tax_share_of_revenue_pct', 'number', 'Tax share of total revenue', 'percent'),
      measure('non_tax_share_of_revenue_pct', 'number', 'Non-tax share of total revenue', 'percent'),
    ],
    rows: observations,
  })
}

export function buildGovernmentDebtTable(sourceRows) {
  const observations = annualRows(sourceRows, 'central government debt').map(({ row, year, sourceLabel }) => {
    const bills = rawNumber(row[2], `${year} Treasury bills`)
    const bonds = rawNumber(row[3], `${year} Treasury bonds`)
    const rupeeLoans = rawNumber(row[4], `${year} rupee loans`, { allowDash: true })
    const other = rawNumber(row[5], `${year} other domestic debt`)
    const domestic = rawNumber(row[6], `${year} domestic debt`)
    const foreign = rawNumber(row[7], `${year} foreign debt`)
    const total = rawNumber(row[8], `${year} total debt`)
    approximate(domestic, bills + bonds + (rupeeLoans ?? 0) + other, `${year} domestic-debt components`)
    approximate(total, domestic + foreign, `${year} total debt`, 1.01)
    approximate(rawNumber(row[11], `${year} total debt GDP share`), rawNumber(row[9], `${year} domestic debt GDP share`) + rawNumber(row[10], `${year} foreign debt GDP share`), `${year} debt GDP shares`, 0.2)
    return {
      year,
      source_year_label: sourceLabel,
      provisional: /\(j\)/i.test(sourceLabel),
      excludes_overdue_debt_service: year >= 2022,
      external_restructuring_effect: year >= 2024,
      treasury_bills_rs_million: round(bills, 1),
      treasury_bonds_rs_million: round(bonds, 1),
      rupee_loans_rs_million: rupeeLoans === null ? null : round(rupeeLoans, 1),
      rupee_loans_value_status: rupeeLoans === null ? 'dash_in_source' : 'reported',
      other_domestic_debt_rs_million: round(other, 1),
      domestic_debt_rs_million: round(domestic, 1),
      foreign_debt_rs_million: round(foreign, 1),
      total_debt_rs_million: round(total, 1),
      domestic_debt_pct_gdp: pct(row[9], `${year} domestic debt GDP share`),
      foreign_debt_pct_gdp: pct(row[10], `${year} foreign debt GDP share`),
      total_debt_pct_gdp: pct(row[11], `${year} total debt GDP share`),
    }
  })
  return table({
    dataset_id: 'central-government-debt-annual',
    title: 'Annual central government debt',
    description: 'Domestic and foreign central-government debt reported by the Central Bank of Sri Lanka for data continuity.',
    grain: 'One national end-of-year row per calendar year.',
    source_ids: [CBSL_SOURCES.debt.id],
    vintage: `${observations[0].year}–${observations.at(-1).year}; 2024–${observations.at(-1).year} provisional`,
    primary_key: ['year'],
    notes: [
      'LKR values and GDP shares are rounded to one decimal place.',
      '(a) Debt follows the IMF Public Sector Debt Statistics Framework; non-resident SLDB holdings are foreign debt, resident ISB holdings are domestic debt, and values are net of deposits.',
      '(b) From 2023, domestic-debt compilation uses data confirmed by the Ministry of Finance, Planning and Economic Development.',
      '(c) Treasury bills and bonds exclude government securities held by non-resident investors.',
      '(d) Foreign-loan data and classification are sourced from the Ministry’s CS-DRMS; 2024 and 2025 data were extracted on 27 February 2025 and 6 March 2026 respectively.',
      '(e) From December 2022, several project loans previously classified under CEB, Airport and Aviation Services, and Sri Lanka Ports Authority were absorbed into central-government debt.',
      '(f) 2024 and 2025 reflect external-debt restructuring.',
      '(g) GDP shares use DCS estimates; from 2010 they use base-year-2015 GDP, with 2023 and 2024 revised using the 17 March 2026 release.',
      '(h) End-2019 debt could increase if identified expenditure-payment arrears are incorporated; this would not affect end-2020 debt.',
      '(i) From 2022, outstanding debt excludes overdue debt-service payments after the 12 April 2022 interim servicing policy, including affected overdue interest deemed capitalised.',
      '(j) Provisional.',
      'Following establishment of the Public Debt Management Office, its Quarterly Statistical Debt Bulletin is the official debt source; CBSL presents this table for continuity using Ministry data.',
    ],
    caveats: [
      'The workbook uses a dash for Rupee Loans from 2023; this is retained as null with rupee_loans_value_status dash_in_source while the reported domestic total is preserved.',
      'Methodology, debt perimeter and restructuring breaks prevent naive comparison across all years.',
      LICENSE_CAVEAT,
    ],
    fields: [
      dim('year', 'year', 'Year'), dim('source_year_label', 'string', 'Source year label'), dim('provisional', 'boolean', 'Provisional'),
      dim('excludes_overdue_debt_service', 'boolean', 'Excludes overdue debt service under the interim policy'),
      dim('external_restructuring_effect', 'boolean', 'Reflects external-debt restructuring'),
      dim('rupee_loans_value_status', 'string', 'Rupee Loans value status'),
      measure('treasury_bills_rs_million', 'number', 'Treasury bills', 'LKR million'),
      measure('treasury_bonds_rs_million', 'number', 'Treasury bonds', 'LKR million'),
      measure('rupee_loans_rs_million', 'number', 'Rupee Loans', 'LKR million'),
      measure('other_domestic_debt_rs_million', 'number', 'Other domestic debt', 'LKR million'),
      measure('domestic_debt_rs_million', 'number', 'Domestic debt', 'LKR million'),
      measure('foreign_debt_rs_million', 'number', 'Foreign debt', 'LKR million'),
      measure('total_debt_rs_million', 'number', 'Total central-government debt', 'LKR million'),
      measure('domestic_debt_pct_gdp', 'number', 'Domestic debt', 'percent of GDP'),
      measure('foreign_debt_pct_gdp', 'number', 'Foreign debt', 'percent of GDP'),
      measure('total_debt_pct_gdp', 'number', 'Total debt', 'percent of GDP'),
    ],
    rows: observations,
  })
}

function requireSource(sourceDir, key) {
  const source = CBSL_SOURCES[key]
  const path = join(sourceDir, source.file)
  const signature = readFileSync(path, { flag: 'r' }).subarray(0, 4)
  assert(signature[0] === 0x50 && signature[1] === 0x4b && signature[2] === 0x03 && signature[3] === 0x04, `${basename(path)} is not an XLSX ZIP archive`)
  return path
}

export async function buildCbslIndicators(sourceDir, { includeDetailedTrade = false } = {}) {
  const exports = buildTradeTable(readXlsxSheet(requireSource(sourceDir, 'exports'), TRADE_SHEET), 'exports')
  const imports = buildTradeTable(readXlsxSheet(requireSource(sourceDir, 'imports'), TRADE_SHEET), 'imports')
  const remittances = buildRemittancesTable(readXlsxSheet(requireSource(sourceDir, 'remittances')))
  const fiscal = buildFiscalOperationsTable(readXlsxSheet(requireSource(sourceDir, 'fiscal')))
  const revenue = buildGovernmentRevenueTable(readXlsxSheet(requireSource(sourceDir, 'revenue')))
  const debt = buildGovernmentDebtTable(readXlsxSheet(requireSource(sourceDir, 'debt')))
  const { buildMarketIndicators } = await import('./cbsl-market-indicators.mjs')
  const market = await buildMarketIndicators(sourceDir, {
    readSheet: (dir, key) => readXlsxSheet(requireSource(dir, key)),
  })

  assert(exports.rows.length === 236 * EXPORT_CATEGORIES.length, `exports expected ${236 * EXPORT_CATEGORIES.length} rows, found ${exports.rows.length}`)
  assert(imports.rows.length === 236 * IMPORT_CATEGORIES.length, `imports expected ${236 * IMPORT_CATEGORIES.length} rows, found ${imports.rows.length}`)
  assert(exports.rows[0].period === '2007-01' && exports.rows.at(-1).period === '2026-08', 'exports coverage must be 2007-01–2026-08')
  assert(imports.rows[0].period === '2007-01' && imports.rows.at(-1).period === '2026-08', 'imports coverage must be 2007-01–2026-08')
  assert(remittances.rows.length === 212 && remittances.rows[0].period === '2009-01' && remittances.rows.at(-1).period === '2026-08', 'remittances coverage must be 212 months from 2009-01–2026-08')
  for (const dataset of [fiscal, revenue, debt]) {
    assert(dataset.rows.length === 36, `${dataset.dataset_id} expected 36 annual rows, found ${dataset.rows.length}`)
    assert(dataset.rows[0].year === 1990 && dataset.rows.at(-1).year === 2025, `${dataset.dataset_id} coverage must be 1990–2025`)
  }
  const published = [
    buildTradeMonthlyTotals(exports, imports),
    buildTradeAnnualCategories(exports, imports),
    remittances,
    fiscal,
    revenue,
    debt,
    ...market,
  ]
  return includeDetailedTrade ? [...published, exports, imports] : published
}

function parseArgs(argv = process.argv.slice(2)) {
  let sourceDir = null
  let outputDir = DEFAULT_OUTPUT
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === '--include-detailed-trade') continue
    assert(flag === '--source-dir' || flag === '--output-dir', `unknown argument ${flag}`)
    const value = argv[index + 1]
    assert(value && !value.startsWith('--'), `${flag} requires a path`)
    if (flag === '--source-dir') sourceDir = resolve(value)
    else outputDir = resolve(value)
    index += 1
  }
  return { sourceDir, outputDir, includeDetailedTrade: argv.includes('--include-detailed-trade') }
}

async function materializeSources(explicitDir) {
  if (explicitDir) return { dir: explicitDir, temporary: false }
  const dir = mkdtempSync(join(tmpdir(), 'developing-country-cbsl-'))
  for (const source of Object.values(CBSL_SOURCES)) {
    const response = await fetch(source.url, { headers: { 'User-Agent': 'developing-country.org data refresh' } })
    if (!response.ok) throw new Error(`Source download failed (${response.status}): ${source.url}`)
    await Bun.write(join(dir, source.file), await response.arrayBuffer())
  }
  return { dir, temporary: true }
}

if (import.meta.main) {
  const { sourceDir, outputDir, includeDetailedTrade } = parseArgs()
  const materialized = await materializeSources(sourceDir)
  try {
    for (const dataset of await buildCbslIndicators(materialized.dir, { includeDetailedTrade })) writeTable(outputDir, dataset)
  } finally {
    if (materialized.temporary) rmSync(materialized.dir, { recursive: true, force: true })
  }
}
