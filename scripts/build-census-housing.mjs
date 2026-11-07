#!/usr/bin/env bun

// Census 2024 Table A1 — housing-unit structure by district.
// Source workbook is fetched to a cache (or --source-dir) and never copied into public/.

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { readXlsxSheet } from './lib/xlsx.mjs'

const ROOT = resolve(import.meta.dir, '..')
const DEFAULT_OUTPUT = join(ROOT, 'public/data')
const SOURCE = {
  file: 'A1.xlsx',
  url: 'https://www.statistics.gov.lk/Population/StaticalInformation/CPH2024/HousingA/A1',
}

const DISTRICTS = [
  ['LK', 'Sri Lanka'],
  ['LK-11', 'Colombo'], ['LK-12', 'Gampaha'], ['LK-13', 'Kalutara'],
  ['LK-21', 'Kandy'], ['LK-22', 'Matale'], ['LK-23', 'Nuwara Eliya'],
  ['LK-31', 'Galle'], ['LK-32', 'Matara'], ['LK-33', 'Hambantota'],
  ['LK-41', 'Jaffna'], ['LK-42', 'Mannar'], ['LK-43', 'Vavuniya'],
  ['LK-44', 'Mullaitivu'], ['LK-45', 'Kilinochchi'],
  ['LK-51', 'Batticaloa'], ['LK-52', 'Ampara'], ['LK-53', 'Trincomalee'],
  ['LK-61', 'Kurunegala'], ['LK-62', 'Puttalam'],
  ['LK-71', 'Anuradhapura'], ['LK-72', 'Polonnaruwa'],
  ['LK-81', 'Badulla'], ['LK-82', 'Moneragala'],
  ['LK-91', 'Ratnapura'], ['LK-92', 'Kegalle'],
]

const SOURCE_GEOGRAPHY_ALIASES = new Map([
  ['Moneragala', 'Monaragala'],
  ['Ratnapura', 'Rathnapura'],
])

export const HOUSING_STRUCTURE_CATEGORIES = Object.freeze([
  { id: 'single_house_single_storey', label: 'Single house, single storey' },
  { id: 'single_house_two_storey', label: 'Single house, two storey' },
  { id: 'single_house_more_than_two_storey', label: 'Single house, more than two storeys' },
  { id: 'attached_1st_floor', label: 'Attached house, 1st floor' },
  { id: 'attached_2nd_floor', label: 'Attached house, 2nd floor' },
  { id: 'attached_3_or_4_floors', label: 'Attached house, 3rd or 4th floor' },
  { id: 'attached_5_to_10_floors', label: 'Attached house, 5th to 10th floor' },
  { id: 'attached_11_to_19_floors', label: 'Attached house, 11th to 19th floor' },
  { id: 'attached_20_plus_floors', label: 'Attached house, 20th floor or higher' },
  { id: 'other', label: 'Other' },
])

const dim = (id, type, label, unit) => ({ id, role: 'dimension', type, label, ...(unit ? { unit } : {}) })
const measure = (id, type, label, unit, aggregation = 'none') => ({
  id, role: 'measure', type, label, ...(unit ? { unit } : {}), aggregation,
})

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
  }
  return value
}

function numeric(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} is not numeric`)
  return value
}

function comparable(name) {
  return name.toLocaleLowerCase('en').replaceAll(/[^a-z]/g, '')
}

export function buildHousingStructureFromSheet(rows) {
  const pairs = []
  for (let index = 0; index < rows.length; index += 1) {
    const countRow = rows[index]
    if (typeof countRow?.[0] !== 'string' || typeof countRow[1] !== 'number') continue
    const shareRow = rows.slice(index + 1).find((row) => row?.[0] == null && typeof row?.[1] === 'number')
    if (!shareRow) throw new Error(`${countRow[0]} has no percentage row`)
    pairs.push([countRow, shareRow])
  }
  if (pairs.length !== DISTRICTS.length) {
    throw new Error(`Expected ${DISTRICTS.length} geography rows, found ${pairs.length}`)
  }

  const observations = []
  for (let geographyIndex = 0; geographyIndex < pairs.length; geographyIndex += 1) {
    const [countRow, shareRow] = pairs[geographyIndex]
    const [geographyId, geographyName] = DISTRICTS[geographyIndex]
    const sourceName = String(countRow[0]).replaceAll(/\s+/g, ' ').trim()
    const expected = SOURCE_GEOGRAPHY_ALIASES.get(geographyName) ?? geographyName
    if (!comparable(sourceName).endsWith(comparable(expected))) {
      throw new Error(`Expected ${geographyName}, found ${sourceName}`)
    }
    const totalUnits = numeric(countRow[1], `${geographyName} housing units`)
    const categoryTotal = HOUSING_STRUCTURE_CATEGORIES.reduce(
      (sum, category, categoryIndex) => sum + numeric(countRow[categoryIndex + 2], `${geographyName} ${category.id}`),
      0,
    )
    if (categoryTotal !== totalUnits) {
      throw new Error(`${geographyName} categories sum to ${categoryTotal}, total is ${totalUnits}`)
    }
    for (const [categoryIndex, category] of HOUSING_STRUCTURE_CATEGORIES.entries()) {
      observations.push({
        geography_id: geographyId,
        geography_name: geographyName,
        year: 2024,
        category: category.id,
        category_label: category.label,
        housing_units: numeric(countRow[categoryIndex + 2], `${geographyName} ${category.id}`),
        share_pct: Math.round(numeric(shareRow[categoryIndex + 2], `${geographyName} ${category.id} share`) * 10_000) / 10_000,
        total_housing_units: totalUnits,
      })
    }
  }

  return {
    schema_version: 1,
    country: 'LK',
    dataset_id: 'census-housing-structure-district',
    title: 'Housing unit structure by district',
    description: 'Census 2024 occupied housing units by published structure type, including single houses by storeys and attached houses by floor band.',
    grain: 'One row per geography and housing-structure category.',
    source_ids: ['dcs-cph-2024-housing-structure'],
    vintage: 'Census 2024',
    primary_key: ['geography_id', 'category'],
    notes: [
      'The national row is retained with geography_id LK.',
      'Category labels follow the published Table A1 wording without renaming attached-floor bands as apartments.',
    ],
    caveats: [
      'These are occupied housing units, not households or resident population.',
      'A storey or floor band is the census structure class; it is not a building-height survey or a condominium register.',
    ],
    fields: [
      dim('geography_id', 'string', 'Geography id'),
      dim('geography_name', 'string', 'Geography'),
      dim('year', 'year', 'Census year'),
      dim('category', 'string', 'Structure category'),
      dim('category_label', 'string', 'Structure category label'),
      measure('housing_units', 'integer', 'Housing units', 'housing units', 'sum'),
      measure('share_pct', 'number', 'Share of housing units', 'percent'),
      measure('total_housing_units', 'integer', 'Total housing units', 'housing units', 'none'),
    ],
    rows: observations,
  }
}

async function materialize(explicitDir) {
  if (explicitDir) return { dir: explicitDir, temporary: false }
  const dir = mkdtempSync(join(tmpdir(), 'developing-country-housing-'))
  const response = await fetch(SOURCE.url, { headers: { 'User-Agent': 'developing-country.org data refresh' } })
  if (!response.ok) throw new Error(`Source download failed (${response.status}): ${SOURCE.url}`)
  await Bun.write(join(dir, SOURCE.file), await response.arrayBuffer())
  return { dir, temporary: true }
}

if (import.meta.main) {
  const sourceIndex = process.argv.indexOf('--source-dir')
  const outputIndex = process.argv.indexOf('--output-dir')
  const sourceDir = sourceIndex >= 0 ? resolve(process.argv[sourceIndex + 1] ?? '') : null
  const outputDir = outputIndex >= 0 ? resolve(process.argv[outputIndex + 1] ?? '') : DEFAULT_OUTPUT
  const materialized = await materialize(sourceDir)
  try {
    readFileSync(join(materialized.dir, SOURCE.file), { flag: 'r' })
    const table = buildHousingStructureFromSheet(readXlsxSheet(join(materialized.dir, SOURCE.file)))
    mkdirSync(outputDir, { recursive: true })
    writeFileSync(join(outputDir, `${table.dataset_id}.json`), `${JSON.stringify(canonical(table), null, 2)}\n`)
    console.log(`${table.dataset_id}.json: ${table.rows.length} rows`)
  } finally {
    if (materialized.temporary) rmSync(materialized.dir, { recursive: true, force: true })
  }
}
