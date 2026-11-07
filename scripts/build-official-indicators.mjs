#!/usr/bin/env bun

// Normalize public aggregate tables from Sri Lankan government publications.
// Raw workbooks/PDFs are fetched into a temporary or caller-supplied cache and
// are never copied into public/. Only the compact, typed observations ship.

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { readXlsxSheet } from './lib/xlsx.mjs'

const ROOT = resolve(import.meta.dir, '..')
const DEFAULT_OUTPUT = join(ROOT, 'public/data')

const SOURCES = {
  households: {
    file: 'HH_GND_excel.xlsx',
    url: 'https://www.statistics.gov.lk/Population/StaticalInformation/CPH2024/HH_GND_excel',
  },
  populationGnd: {
    file: 'GN_population_excel.xlsx',
    url: 'https://www.statistics.gov.lk/Population/StaticalInformation/CPH2024/GN_population_excel',
  },
  water: {
    file: 'A5.xlsx',
    url: 'https://www.statistics.gov.lk/Population/StaticalInformation/CPH2024/HousingA/A5',
  },
  cooking: {
    file: 'A6.xlsx',
    url: 'https://www.statistics.gov.lk/Population/StaticalInformation/CPH2024/HousingA/A6',
  },
  lighting: {
    file: 'A7.xlsx',
    url: 'https://www.statistics.gov.lk/Population/StaticalInformation/CPH2024/HousingA/A7',
  },
  toilet: {
    file: 'A8.xlsx',
    url: 'https://www.statistics.gov.lk/Population/StaticalInformation/CPH2024/HousingA/A8',
  },
  populationEstimates: {
    file: '2.1a.pdf',
    url: 'https://www.statistics.gov.lk/abstract2025/CHAP2/2.1a.pdf',
  },
  labour: {
    file: '4.1a.pdf',
    url: 'https://www.statistics.gov.lk/abstract2025/CHAP4/4.1a.pdf',
  },
  employment: {
    file: '4.2a.pdf',
    url: 'https://www.statistics.gov.lk/abstract2025/CHAP4/4.2a.pdf',
  },
  poverty: {
    file: '4.6.pdf',
    url: 'https://www.statistics.gov.lk/abstract2025/CHAP4/4.6.pdf',
  },
  gdpCurrent: {
    file: '10.2.pdf',
    url: 'https://www.statistics.gov.lk/abstract2025/CHAP10/10.2.pdf',
  },
  gdpConstant: {
    file: '10.3.pdf',
    url: 'https://www.statistics.gov.lk/abstract2025/CHAP10/10.3.pdf',
  },
  health: {
    file: 'IMMR-Report-2024-final.xlsx',
    url: 'https://www.health.gov.lk/wp-content/uploads/2025/12/IMMR-Report-2024-final.xlsx',
  },
  ccpi: {
    file: 'Movements_of_CCPI-CCPI_Core_2021.pdf',
    url: 'https://www.statistics.gov.lk/Resource/en/InflationAndPrices/CCPI/Movements_of_CCPI-CCPI_Core_2021.pdf',
  },
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

const districtId = new Map(DISTRICTS.map(([id, name]) => [name, id]))
const SOURCE_GEOGRAPHY_ALIASES = new Map([
  ['Moneragala', 'Monaragala'],
  ['Ratnapura', 'Rathnapura'],
])

const dim = (id, type, label, unit) => ({ id, role: 'dimension', type, label, ...(unit ? { unit } : {}) })
const measure = (id, type, label, unit, aggregation = 'none') => ({
  id, role: 'measure', type, label, ...(unit ? { unit } : {}), aggregation,
})

function table(definition) {
  return { schema_version: 1, country: 'LK', ...definition }
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
  }
  return value
}

function writeTable(outputDir, name, value) {
  mkdirSync(outputDir, { recursive: true })
  const path = join(outputDir, name)
  writeFileSync(path, `${JSON.stringify(canonical(value), null, 2)}\n`)
  console.log(`${name}: ${value.rows.length.toLocaleString()} rows`)
}

function sourceArgs() {
  const sourceIndex = process.argv.indexOf('--source-dir')
  const outputIndex = process.argv.indexOf('--output-dir')
  return {
    sourceDir: sourceIndex >= 0 ? resolve(process.argv[sourceIndex + 1] ?? '') : null,
    outputDir: outputIndex >= 0 ? resolve(process.argv[outputIndex + 1] ?? '') : DEFAULT_OUTPUT,
    includeGranular: process.argv.includes('--include-granular'),
  }
}

async function materializeSources(explicitDir) {
  if (explicitDir) return { dir: explicitDir, temporary: false }
  const dir = mkdtempSync(join(tmpdir(), 'developing-country-indicators-'))
  for (const source of Object.values(SOURCES)) {
    const response = await fetch(source.url, { headers: { 'User-Agent': 'developing-country.org data refresh' } })
    if (!response.ok) throw new Error(`Source download failed (${response.status}): ${source.url}`)
    await Bun.write(join(dir, source.file), await response.arrayBuffer())
  }
  return { dir, temporary: true }
}

function requireSource(dir, key) {
  const source = SOURCES[key]
  const path = join(dir, source.file)
  readFileSync(path, { flag: 'r' })
  return path
}

function code(value, width) {
  if (!Number.isInteger(value)) throw new Error(`Expected integer administrative code, got ${value}`)
  return String(value).padStart(width, '0')
}

function gndId(row) {
  return `LK-${code(row[2], 2)}${code(row[4], 2)}${code(row[6], 3)}`
}

function ratio(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null
  return Math.round((numerator / denominator) * 1_000_000) / 10_000
}

function numeric(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} is not numeric`)
  return value
}

const EXPECTED_GND_ROWS = 14_008

function requiredText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} is not text`)
  return value.trim()
}

function worksheetDataRows(rows, headerRows, label) {
  const dataRows = rows.slice(headerRows).filter((row) => {
    if (row == null) return false
    if (!Array.isArray(row)) return true
    return !row.every((value) => value == null || (typeof value === 'string' && value.trim() === ''))
  })
  if (dataRows.length !== EXPECTED_GND_ROWS) {
    throw new Error(`Expected ${EXPECTED_GND_ROWS.toLocaleString('en-US')} non-empty ${label} rows, found ${dataRows.length.toLocaleString('en-US')}`)
  }
  return dataRows
}

function assertUniqueGndId(seen, id, label) {
  if (seen.has(id)) throw new Error(`${label} contains duplicate GN id ${id}`)
  seen.add(id)
}

export function buildGndPopulationFromWorksheetRows(rows) {
  const dataRows = worksheetDataRows(rows, 5, 'GN population')
  const observations = []
  const seenIds = new Set()
  for (const [index, row] of dataRows.entries()) {
    const rowLabel = `GN population row ${index + 6}`
    const id = gndId(row)
    assertUniqueGndId(seenIds, id, 'GN population workbook')
    const population = numeric(row[9], `${rowLabel} population`)
    const male = numeric(row[10], `${rowLabel} male population`)
    const female = numeric(row[11], `${rowLabel} female population`)
    const age0to14 = numeric(row[13], `${rowLabel} age 0–14 population`)
    const age15to59 = numeric(row[14], `${rowLabel} age 15–59 population`)
    const age60to64 = numeric(row[15], `${rowLabel} age 60–64 population`)
    const age65plus = numeric(row[16], `${rowLabel} age 65+ population`)
    observations.push({
      geography_id: id,
      geography_name: requiredText(row[7], `${rowLabel} GN name`),
      province: requiredText(row[1], `${rowLabel} province`),
      district: requiredText(row[3], `${rowLabel} district`),
      dsd: requiredText(row[5], `${rowLabel} DSD`),
      year: 2024,
      population,
      male,
      female,
      age_0_14: age0to14,
      age_15_59: age15to59,
      age_60_64: age60to64,
      age_65_plus: age65plus,
      child_share_pct: ratio(age0to14, population),
      working_age_share_pct: ratio(age15to59, population),
      older_60_plus_share_pct: ratio(age60to64 + age65plus, population),
      males_per_100_females: female > 0 ? Math.round((male / female) * 10_000) / 100 : null,
    })
  }
  return table({
    dataset_id: 'census-age-sex-gnd',
    title: 'Population by age and sex at GN-division level',
    description: 'Provisional Census 2024 population counts and broad age groups for each Grama Niladhari division.',
    grain: 'One row per GN division.',
    source_ids: ['dcs-cph-2024-population-gnd'],
    vintage: 'Census 2024 (provisional)',
    primary_key: ['geography_id'],
    caveats: ['GN codes reflect the 2024 source workbook and require a boundary crosswalk where administrative codes changed.'],
    fields: [
      dim('geography_id', 'string', 'GN division id'), dim('geography_name', 'string', 'GN division'),
      dim('province', 'string', 'Province'), dim('district', 'string', 'District'), dim('dsd', 'string', 'Divisional Secretariat division'),
      dim('year', 'year', 'Census year'),
      measure('population', 'integer', 'Population', 'people', 'sum'),
      measure('male', 'integer', 'Male population', 'people', 'sum'),
      measure('female', 'integer', 'Female population', 'people', 'sum'),
      measure('age_0_14', 'integer', 'Population aged 0–14', 'people', 'sum'),
      measure('age_15_59', 'integer', 'Population aged 15–59', 'people', 'sum'),
      measure('age_60_64', 'integer', 'Population aged 60–64', 'people', 'sum'),
      measure('age_65_plus', 'integer', 'Population aged 65+', 'people', 'sum'),
      measure('child_share_pct', 'number', 'Population aged 0–14', 'percent'),
      measure('working_age_share_pct', 'number', 'Population aged 15–59', 'percent'),
      measure('older_60_plus_share_pct', 'number', 'Population aged 60+', 'percent'),
      measure('males_per_100_females', 'number', 'Males per 100 females', 'ratio'),
    ],
    rows: observations,
  })
}

function buildGndPopulation(sourceDir) {
  return buildGndPopulationFromWorksheetRows(readXlsxSheet(requireSource(sourceDir, 'populationGnd')))
}

function groupRows(rows, keyOf) {
  const groups = new Map()
  for (const row of rows) {
    const key = keyOf(row)
    const group = groups.get(key) ?? []
    group.push(row)
    groups.set(key, group)
  }
  return groups
}

function sumField(rows, field) {
  return rows.reduce((total, row) => total + numeric(row[field], field), 0)
}

function buildDsdPopulation(gndTable) {
  const rows = []
  for (const [geographyId, members] of groupRows(gndTable.rows, (row) => row.geography_id.slice(0, 7))) {
    const first = members[0]
    const population = sumField(members, 'population')
    const male = sumField(members, 'male')
    const female = sumField(members, 'female')
    const age0to14 = sumField(members, 'age_0_14')
    const age15to59 = sumField(members, 'age_15_59')
    const age60to64 = sumField(members, 'age_60_64')
    const age65plus = sumField(members, 'age_65_plus')
    rows.push({
      geography_id: geographyId,
      geography_name: first.dsd,
      province: first.province,
      district: first.district,
      dsd: first.dsd,
      year: 2024,
      population,
      male,
      female,
      age_0_14: age0to14,
      age_15_59: age15to59,
      age_60_64: age60to64,
      age_65_plus: age65plus,
      child_share_pct: ratio(age0to14, population),
      working_age_share_pct: ratio(age15to59, population),
      older_60_plus_share_pct: ratio(age60to64 + age65plus, population),
      males_per_100_females: female > 0 ? Math.round((male / female) * 10_000) / 100 : null,
    })
  }
  if (rows.length !== 340) throw new Error(`Expected 340 published DSD population rows, found ${rows.length}`)
  return {
    ...gndTable,
    dataset_id: 'census-age-sex-dsd',
    title: 'Population by age and sex at Divisional Secretariat level',
    description: 'Provisional Census 2024 population counts and broad age groups aggregated to each Divisional Secretariat division.',
    grain: 'One row per Divisional Secretariat division.',
    primary_key: ['geography_id'],
    fields: gndTable.fields.map((field) => {
      if (field.id === 'geography_id') return { ...field, label: 'Divisional Secretariat division id' }
      if (field.id === 'geography_name' || field.id === 'dsd') return { ...field, label: 'Divisional Secretariat division' }
      return field
    }),
    caveats: [
      'Values are aggregated from the published GN-division workbook using its 2024 administrative codes.',
      'The source contains 340 DSD codes; it is not silently forced onto the platform’s older 331-boundary geometry set.',
      'The source GN records remain the reproducible input, but the public query artifact uses DSD grain to stay within edge-compute limits.',
    ],
    rows,
  }
}

const HOUSEHOLD_CATEGORY_COLUMNS = new Map([
  [10, 'protected-well households'],
  [15, 'National Water Supply Board households'],
  [16, 'local-authority piped-water households'],
  [17, 'community-organisation piped-water households'],
  [18, 'private-project piped-water households'],
  [19, 'tank, river or stream households'],
  [21, 'bottled-water households'],
  [22, 'RO-filtered-water households'],
  [25, 'firewood-cooking households'],
  [27, 'gas-cooking households'],
  [28, 'electric-cooking households'],
  [33, 'grid or rural-hydro lighting households'],
  [36, 'standalone-solar lighting households'],
  [40, 'exclusive in-unit toilet households'],
  [46, 'households not using a toilet'],
])

function indexPopulationRows(populationTable) {
  if (populationTable.rows.length !== EXPECTED_GND_ROWS) {
    throw new Error(`Expected ${EXPECTED_GND_ROWS.toLocaleString('en-US')} accepted GN population rows for the household join, found ${populationTable.rows.length.toLocaleString('en-US')}`)
  }
  const populationById = new Map()
  for (const row of populationTable.rows) {
    if (populationById.has(row.geography_id)) throw new Error(`GN population table contains duplicate GN id ${row.geography_id}`)
    populationById.set(row.geography_id, numeric(row.population, `GN population ${row.geography_id}`))
  }
  return populationById
}

export function buildGndHouseholdsFromWorksheetRows(rows, populationTable) {
  const populationById = indexPopulationRows(populationTable)
  const dataRows = worksheetDataRows(rows, 6, 'GN household')
  const observations = []
  const seenIds = new Set()
  for (const [index, row] of dataRows.entries()) {
    const rowLabel = `GN household row ${index + 7}`
    const id = gndId(row)
    assertUniqueGndId(seenIds, id, 'GN household workbook')
    const households = numeric(row[9], `${rowLabel} households`)
    const population = populationById.get(id)
    if (population === undefined) throw new Error(`${rowLabel} GN id ${id} has no matching population row`)
    const sum = (indices) => indices.reduce((total, column) => {
      const category = HOUSEHOLD_CATEGORY_COLUMNS.get(column) ?? `column ${column}`
      return total + numeric(row[column], `${rowLabel} ${category}`)
    }, 0)
    observations.push({
      geography_id: id,
      geography_name: requiredText(row[7], `${rowLabel} GN name`),
      province: requiredText(row[1], `${rowLabel} province`),
      district: requiredText(row[3], `${rowLabel} district`),
      dsd: requiredText(row[5], `${rowLabel} DSD`),
      year: 2024,
      households,
      average_household_size: households > 0 ? Math.round((population / households) * 100) / 100 : null,
      piped_water_share_pct: ratio(sum([15, 16, 17, 18]), households),
      national_water_board_share_pct: ratio(sum([15]), households),
      protected_well_share_pct: ratio(sum([10]), households),
      surface_water_share_pct: ratio(sum([19]), households),
      bottled_or_ro_water_share_pct: ratio(sum([21, 22]), households),
      firewood_cooking_share_pct: ratio(sum([25]), households),
      gas_cooking_share_pct: ratio(sum([27]), households),
      electric_cooking_share_pct: ratio(sum([28]), households),
      grid_electricity_lighting_share_pct: ratio(sum([33]), households),
      standalone_solar_lighting_share_pct: ratio(sum([36]), households),
      exclusive_toilet_in_unit_share_pct: ratio(sum([40]), households),
      no_toilet_use_share_pct: ratio(sum([46]), households),
    })
  }
  if (observations.length !== populationById.size) {
    throw new Error(`Expected all ${populationById.size.toLocaleString('en-US')} GN population rows to join to households, joined ${observations.length.toLocaleString('en-US')}`)
  }
  return table({
    dataset_id: 'census-households-gnd',
    title: 'Households and basic services at GN-division level',
    description: 'Provisional Census 2024 household counts and selected directly reported water, cooking, lighting and toilet categories.',
    grain: 'One row per GN division.',
    source_ids: ['dcs-cph-2024-households-gnd', 'dcs-cph-2024-population-gnd'],
    vintage: 'Census 2024 (provisional)',
    primary_key: ['geography_id'],
    notes: ['Shares are calculated from category counts in the source workbook; no categories are relabelled as safe, clean or improved.'],
    caveats: ['Average household size is derived by joining the provisional GN population and household workbooks on their published administrative codes.'],
    fields: [
      dim('geography_id', 'string', 'GN division id'), dim('geography_name', 'string', 'GN division'),
      dim('province', 'string', 'Province'), dim('district', 'string', 'District'), dim('dsd', 'string', 'Divisional Secretariat division'),
      dim('year', 'year', 'Census year'),
      measure('households', 'integer', 'Households', 'households', 'sum'),
      measure('average_household_size', 'number', 'Average household size', 'people per household'),
      measure('piped_water_share_pct', 'number', 'Piped-water households', 'percent'),
      measure('national_water_board_share_pct', 'number', 'National Water Supply Board households', 'percent'),
      measure('protected_well_share_pct', 'number', 'Protected-well households', 'percent'),
      measure('surface_water_share_pct', 'number', 'Tank, river or stream households', 'percent'),
      measure('bottled_or_ro_water_share_pct', 'number', 'Bottled or RO-water households', 'percent'),
      measure('firewood_cooking_share_pct', 'number', 'Firewood for cooking', 'percent'),
      measure('gas_cooking_share_pct', 'number', 'Gas for cooking', 'percent'),
      measure('electric_cooking_share_pct', 'number', 'Electricity for cooking', 'percent'),
      measure('grid_electricity_lighting_share_pct', 'number', 'Grid or rural-hydro lighting', 'percent'),
      measure('standalone_solar_lighting_share_pct', 'number', 'Standalone-solar lighting', 'percent'),
      measure('exclusive_toilet_in_unit_share_pct', 'number', 'Exclusive toilet within housing unit', 'percent'),
      measure('no_toilet_use_share_pct', 'number', 'Households not using a toilet', 'percent'),
    ],
    rows: observations,
  })
}

function buildGndHouseholds(sourceDir, populationTable) {
  return buildGndHouseholdsFromWorksheetRows(readXlsxSheet(requireSource(sourceDir, 'households')), populationTable)
}

const HOUSEHOLD_SHARE_FIELDS = [
  'piped_water_share_pct', 'national_water_board_share_pct', 'protected_well_share_pct',
  'surface_water_share_pct', 'bottled_or_ro_water_share_pct', 'firewood_cooking_share_pct',
  'gas_cooking_share_pct', 'electric_cooking_share_pct', 'grid_electricity_lighting_share_pct',
  'standalone_solar_lighting_share_pct', 'exclusive_toilet_in_unit_share_pct', 'no_toilet_use_share_pct',
]

function weightedShare(rows, field, weightField = 'households') {
  const denominator = sumField(rows, weightField)
  if (denominator === 0) return null
  const numerator = rows.reduce((total, row) => {
    const weight = numeric(row[weightField], weightField)
    if (weight === 0) return total
    return total + numeric(row[field], field) * weight
  }, 0)
  return Math.round((numerator / denominator) * 10_000) / 10_000
}

function buildDsdHouseholds(gndTable) {
  const rows = []
  for (const [geographyId, members] of groupRows(gndTable.rows, (row) => row.geography_id.slice(0, 7))) {
    const first = members[0]
    const households = sumField(members, 'households')
    const row = {
      geography_id: geographyId,
      geography_name: first.dsd,
      province: first.province,
      district: first.district,
      dsd: first.dsd,
      year: 2024,
      households,
      average_household_size: weightedShare(members, 'average_household_size'),
    }
    for (const field of HOUSEHOLD_SHARE_FIELDS) row[field] = weightedShare(members, field)
    rows.push(row)
  }
  if (rows.length !== 340) throw new Error(`Expected 340 published DSD household rows, found ${rows.length}`)
  return {
    ...gndTable,
    dataset_id: 'census-households-dsd',
    title: 'Households and basic services at Divisional Secretariat level',
    description: 'Provisional Census 2024 household counts and selected water, cooking, lighting and toilet categories aggregated to each Divisional Secretariat division.',
    grain: 'One row per Divisional Secretariat division.',
    fields: gndTable.fields.map((field) => {
      if (field.id === 'geography_id') return { ...field, label: 'Divisional Secretariat division id' }
      if (field.id === 'geography_name' || field.id === 'dsd') return { ...field, label: 'Divisional Secretariat division' }
      return field
    }),
    notes: [
      'Shares are household-weighted from category counts in the published GN workbook; no categories are relabelled as safe, clean or improved.',
      'The source contains 340 DSD codes; it is not silently forced onto the platform’s older 331-boundary geometry set.',
      'The public query artifact uses DSD grain so bounded edge queries do not parse the 14,008-row GN workbook on every cold isolate.',
    ],
    caveats: ['Average household size joins the provisional population and household workbooks on their published 2024 administrative codes.'],
    rows,
  }
}

const SERVICE_TABLES = [
  {
    key: 'water', service: 'drinking_water',
    categories: ['protected_well', 'semi_protected_well', 'unprotected_well', 'tube_well', 'spring_or_fountain', 'national_water_board', 'local_authority', 'community_organisation', 'private_water_project', 'tank_river_or_stream', 'rain_water', 'bottled_water', 'ro_filtered_water', 'bowser', 'other'],
  },
  {
    key: 'cooking', service: 'cooking_fuel',
    categories: ['firewood', 'kerosene', 'gas', 'electricity', 'sawdust_or_paddy_husk', 'biogas', 'other', 'not_relevant'],
  },
  {
    key: 'lighting', service: 'lighting',
    categories: ['grid_or_rural_hydro', 'kerosene_lamp', 'solar_grid_connected', 'solar_standalone', 'biogas', 'generator', 'other'],
  },
  {
    key: 'toilet', service: 'toilet',
    categories: ['within_unit_exclusive', 'within_unit_shared', 'within_premises_exclusive', 'within_premises_shared', 'no_toilet_shares_elsewhere', 'common_or_public', 'not_using_toilet'],
  },
]

function buildDistrictServices(sourceDir) {
  const observations = []
  for (const config of SERVICE_TABLES) {
    const rows = readXlsxSheet(requireSource(sourceDir, config.key))
    const rowPairs = []
    for (let index = 0; index < rows.length; index += 1) {
      const countRow = rows[index]
      if (typeof countRow?.[0] !== 'string' || typeof countRow[1] !== 'number') continue
      const shareRow = rows.slice(index + 1).find((row) => row?.[0] == null && typeof row?.[1] === 'number')
      if (!shareRow) throw new Error(`${config.key}: ${countRow[0]} has no percentage row`)
      rowPairs.push([countRow, shareRow])
    }
    if (rowPairs.length !== DISTRICTS.length) {
      throw new Error(`${config.key}: expected ${DISTRICTS.length} geography rows, found ${rowPairs.length}`)
    }
    for (let geographyIndex = 0; geographyIndex < rowPairs.length; geographyIndex += 1) {
      const [countRow, shareRow] = rowPairs[geographyIndex]
      const [geographyId, geographyName] = DISTRICTS[geographyIndex]
      const sourceName = String(countRow[0]).replaceAll(/\s+/g, ' ').trim()
      const comparableSourceName = sourceName.toLocaleLowerCase('en').replaceAll(/[^a-z]/g, '')
      const sourceGeographyName = SOURCE_GEOGRAPHY_ALIASES.get(geographyName) ?? geographyName
      const comparableGeographyName = sourceGeographyName.toLocaleLowerCase('en').replaceAll(/[^a-z]/g, '')
      if (!comparableSourceName.endsWith(comparableGeographyName)) {
        throw new Error(`${config.key}: expected ${geographyName}, found ${sourceName}`)
      }
      const totalHouseholds = numeric(countRow[1], `${config.key} total households`)
      for (const [categoryIndex, category] of config.categories.entries()) {
        observations.push({
          geography_id: geographyId,
          geography_name: geographyName,
          year: 2024,
          service: config.service,
          category,
          households: numeric(countRow[categoryIndex + 2], `${config.key} ${category} households`),
          share_pct: numeric(shareRow[categoryIndex + 2], `${config.key} ${category} share`),
          total_households: totalHouseholds,
        })
      }
    }
  }
  return table({
    dataset_id: 'census-basic-services-district',
    title: 'Household water, cooking, lighting and toilet services by district',
    description: 'Census 2024 district totals and source-calculated shares across the published household-service categories.',
    grain: 'One row per district, service and source category.',
    source_ids: ['dcs-cph-2024-basic-housing'],
    vintage: 'Census 2024',
    primary_key: ['geography_id', 'service', 'category'],
    notes: ['The national row is retained with geography_id LK. Category labels are normalized without changing their meaning.'],
    fields: [
      dim('geography_id', 'string', 'Geography id'), dim('geography_name', 'string', 'Geography'), dim('year', 'year', 'Census year'),
      dim('service', 'string', 'Service'), dim('category', 'string', 'Source category'),
      measure('households', 'integer', 'Households', 'households', 'sum'),
      measure('share_pct', 'number', 'Share of households', 'percent'),
      measure('total_households', 'integer', 'Total households', 'households', 'none'),
    ],
    rows: observations,
  })
}

function pdfText(path) {
  const result = Bun.spawnSync(['pdftotext', '-layout', path, '-'])
  if (result.exitCode !== 0) throw new Error(`pdftotext failed for ${path}: ${new TextDecoder().decode(result.stderr).trim()}`)
  return new TextDecoder().decode(result.stdout)
}

function numberToken(value) {
  if (value === '-') return null
  const parsed = Number(value.replaceAll(',', ''))
  if (!Number.isFinite(parsed)) throw new Error(`Invalid numeric token ${value}`)
  return parsed
}

function lineFor(text, name, minValues, tokenPattern = /-?|\d[\d,.]*/g) {
  const line = text.split('\n').find((candidate) => candidate.includes(name) && (candidate.slice(candidate.indexOf(name) + name.length).match(tokenPattern) ?? []).length >= minValues)
  if (!line) throw new Error(`Could not find source row for ${name}`)
  return line.slice(line.indexOf(name) + name.length)
}

function buildPopulationEstimates(sourceDir) {
  const text = pdfText(requireSource(sourceDir, 'populationEstimates'))
  const years = [2020, 2021, 2022, 2023, 2024]
  const observations = []
  for (const [geographyId, geographyName] of DISTRICTS) {
    const suffix = lineFor(text, geographyName === 'Nuwara Eliya' ? 'Nuwara - Eliya' : geographyName, 15, /\d[\d,]*/g)
    const values = (suffix.match(/\d[\d,]*/g) ?? []).slice(0, 15).map(numberToken)
    if (values.length !== 15) throw new Error(`Population estimate row ${geographyName} has ${values.length} values`)
    years.forEach((year, yearIndex) => {
      ;['total', 'male', 'female'].forEach((sex, sexIndex) => {
        observations.push({ geography_id: geographyId, geography_name: geographyName, year, sex, population: values[yearIndex * 3 + sexIndex] * 1000 })
      })
    })
  }
  return table({
    dataset_id: 'population-estimates-district',
    title: 'Estimated mid-year population by district and sex',
    description: 'Registrar General population estimates published by DCS, expressed as people after converting the source table from thousands.',
    grain: 'One row per geography, year and sex.',
    source_ids: ['dcs-population-estimates-2025'],
    vintage: '2020–2024 estimates (2020–2023 provisional)',
    primary_key: ['geography_id', 'year', 'sex'],
    caveats: ['These are annual estimates based on the population balancing equation, not Census 2024 enumeration counts.'],
    fields: [
      dim('geography_id', 'string', 'Geography id'), dim('geography_name', 'string', 'Geography'),
      dim('year', 'year', 'Year'), dim('sex', 'string', 'Sex'),
      measure('population', 'integer', 'Estimated mid-year population', 'people', 'sum'),
    ],
    rows: observations,
  })
}

function buildLabourForce(sourceDir) {
  const text = pdfText(requireSource(sourceDir, 'labour'))
  const observations = []
  for (let year = 2016; year <= 2024; year += 1) {
    const suffix = lineFor(text, String(year), 8, /\d[\d,.]*/g)
    const values = (suffix.match(/\d[\d,.]*/g) ?? []).slice(0, 8).map(numberToken)
    observations.push({
      year,
      household_population_15_plus: values[0], total_labour_force: values[1], labour_force_participation_rate_pct: values[2],
      employed: values[3], employment_share_of_labour_force_pct: values[4], unemployed: values[5],
      unemployment_rate_pct: values[6], not_in_labour_force: values[7], provisional: year === 2024,
    })
  }
  return table({
    dataset_id: 'labour-force',
    title: 'Labour-force participation, employment and unemployment',
    description: 'National Labour Force Survey aggregates for the household population aged 15 and over.',
    grain: 'One national row per year.',
    source_ids: ['dcs-statistical-abstract-2025-labour'],
    vintage: '2016–2024 (2024 provisional)',
    primary_key: ['year'],
    fields: [
      dim('year', 'year', 'Year'), dim('provisional', 'boolean', 'Provisional'),
      measure('household_population_15_plus', 'integer', 'Household population aged 15+', 'people', 'sum'),
      measure('total_labour_force', 'integer', 'Labour force', 'people', 'sum'),
      measure('labour_force_participation_rate_pct', 'number', 'Labour-force participation rate', 'percent'),
      measure('employed', 'integer', 'Employed population', 'people', 'sum'),
      measure('employment_share_of_labour_force_pct', 'number', 'Employed share of labour force', 'percent'),
      measure('unemployed', 'integer', 'Unemployed population', 'people', 'sum'),
      measure('unemployment_rate_pct', 'number', 'Unemployment rate', 'percent'),
      measure('not_in_labour_force', 'integer', 'Population not in labour force', 'people', 'sum'),
    ],
    rows: observations,
  })
}

const INDUSTRIES = [
  'Agriculture, forestry and fishing', 'Mining and quarrying', 'Manufacturing',
  'Construction, utilities, water and waste', 'Wholesale and retail trade; vehicle repair',
  'Transportation and storage', 'Accommodation and food services', 'Information and communication',
  'Financial and insurance activities', 'Professional, scientific and technical activities',
  'Administrative and support services', 'Public administration, defence and compulsory social security',
  'Education', 'Human health and social work', 'Other service activities',
  'Households as employers and own-use production', 'Other activities',
]

function buildEmploymentByIndustry(sourceDir) {
  const text = pdfText(requireSource(sourceDir, 'employment'))
  const observations = []
  for (let year = 2018; year <= 2024; year += 1) {
    const suffix = lineFor(text, String(year), 18, /\d[\d,]*/g)
    const values = (suffix.match(/\d[\d,]*/g) ?? []).slice(0, 18).map(numberToken)
    const total = values[0]
    INDUSTRIES.forEach((industry, index) => observations.push({
      year, industry_id: `isic_group_${String(index + 1).padStart(2, '0')}`, industry,
      employed: values[index + 1], share_of_employment_pct: ratio(values[index + 1], total), provisional: year === 2024,
    }))
  }
  return table({
    dataset_id: 'employment-by-industry',
    title: 'Employment by major industry group',
    description: 'National employed population by the 17 industry groups used in the DCS Labour Force Survey table.',
    grain: 'One row per year and industry group.',
    source_ids: ['dcs-statistical-abstract-2025-employment'],
    vintage: '2018–2024 (2024 provisional)',
    primary_key: ['year', 'industry_id'],
    fields: [
      dim('year', 'year', 'Year'), dim('industry_id', 'string', 'Industry id'), dim('industry', 'string', 'Industry'),
      dim('provisional', 'boolean', 'Provisional'),
      measure('employed', 'integer', 'Employed population', 'people', 'sum'),
      measure('share_of_employment_pct', 'number', 'Share of employment', 'percent'),
    ],
    rows: observations,
  })
}

function buildPoverty(sourceDir) {
  const text = pdfText(requireSource(sourceDir, 'poverty'))
  const periods = ['1995-96', '2002', '2006-07', '2009-10', '2012-13', '2016', '2019']
  const observations = []
  for (const [geographyId, geographyName] of DISTRICTS) {
    const suffix = lineFor(text, geographyName, 7, /(?:-|\d+(?:\.\d+)?)/g)
    const values = (suffix.match(/(?:-|\d+(?:\.\d+)?)/g) ?? []).slice(0, 7).map(numberToken)
    periods.forEach((period, index) => observations.push({
      geography_id: geographyId, geography_name: geographyName, survey_period: period,
      poverty_headcount_ratio_pct: values[index], coverage_note: index < 4 && ['Northern', 'Eastern'].some(() => false)
        ? null : (index < 4 && ['Jaffna', 'Mannar', 'Vavuniya', 'Mullaitivu', 'Kilinochchi', 'Batticaloa', 'Ampara', 'Trincomalee'].includes(geographyName)
          ? 'Northern and Eastern provinces excluded from this survey period' : null),
    }))
  }
  return table({
    dataset_id: 'poverty-headcount-district',
    title: 'Poverty headcount ratio by district',
    description: 'Published Household Income and Expenditure Survey poverty headcount ratios across seven survey periods.',
    grain: 'One row per geography and survey period.',
    source_ids: ['dcs-hies-poverty'],
    vintage: '1995/96–2019; latest observation is pre-crisis',
    primary_key: ['geography_id', 'survey_period'],
    caveats: ['The 2019 poverty line was adjusted from the 2012/13 basis using NCPI.', 'Northern and Eastern provinces were excluded from the first four survey periods; those values are null.'],
    fields: [
      dim('geography_id', 'string', 'Geography id'), dim('geography_name', 'string', 'Geography'),
      dim('survey_period', 'string', 'Survey period'), dim('coverage_note', 'string', 'Coverage note'),
      measure('poverty_headcount_ratio_pct', 'number', 'Poverty headcount ratio', 'percent'),
    ],
    rows: observations,
  })
}

const GDP_ACTIVITIES = [
  { id: 'agriculture', label: 'Agriculture, forestry and fishing', phrase: 'Agriculture, Forestry & Fishing', seriesKind: 'gva_component', parentSeriesId: 'gva' },
  { id: 'industry', label: 'Manufacturing, mining, quarrying and other industries', phrase: 'Manufacturing, mining and', seriesKind: 'gva_component', parentSeriesId: 'gva' },
  { id: 'manufacturing', label: 'Manufacturing activities', phrase: 'Manufacturing activities', seriesKind: 'nested_component', parentSeriesId: 'industry' },
  { id: 'construction', label: 'Construction', phrase: 'Construction', seriesKind: 'gva_component', parentSeriesId: 'gva' },
  { id: 'trade_transport_hospitality', label: 'Trade, transport, accommodation and food services', phrase: 'Wholesale and retail trade,', seriesKind: 'gva_component', parentSeriesId: 'gva' },
  { id: 'information_communication', label: 'Information and communication', phrase: 'Information and Communication', seriesKind: 'gva_component', parentSeriesId: 'gva' },
  { id: 'finance_insurance', label: 'Financial and insurance activities', phrase: 'Financial and insurance activities', seriesKind: 'gva_component', parentSeriesId: 'gva' },
  { id: 'real_estate', label: 'Real estate including ownership of dwellings', phrase: 'Real estate activities(including', seriesKind: 'gva_component', parentSeriesId: 'gva' },
  { id: 'professional_admin_support', label: 'Professional, scientific, technical, administration and support', phrase: 'Professional, scientific, technical,', seriesKind: 'gva_component', parentSeriesId: 'gva' },
  { id: 'public_social_services', label: 'Public administration, defence, education, health and social work', phrase: 'Public administration, defense,', seriesKind: 'gva_component', parentSeriesId: 'gva' },
  { id: 'other_services', label: 'Other services', phrase: 'Other Services', seriesKind: 'gva_component', parentSeriesId: 'gva' },
  { id: 'gva', label: 'Gross value added at basic prices', phrase: 'Gross Value Added(GVA)', seriesKind: 'subtotal', parentSeriesId: 'gdp' },
  { id: 'taxes', label: 'Taxes on products', phrase: 'Taxes on products', seriesKind: 'adjustment_add', parentSeriesId: 'gdp' },
  { id: 'subsidies', label: 'Subsidies on products', phrase: 'Subsidies on products', seriesKind: 'adjustment_subtract', parentSeriesId: 'gdp' },
  { id: 'gdp', label: 'GDP at market prices', phrase: 'GDP at market price', seriesKind: 'total', parentSeriesId: null },
]

function extractCommaValues(flatText, phrase, count = 6) {
  const at = flatText.indexOf(phrase)
  if (at < 0) throw new Error(`Could not find GDP row ${phrase}`)
  const values = (flatText.slice(at + phrase.length).match(/\b\d{1,3}(?:,\d{3})+\b/g) ?? []).slice(0, count).map(numberToken)
  if (values.length !== count) throw new Error(`GDP row ${phrase} has ${values.length} values`)
  return values
}

function buildGdp(sourceDir) {
  const years = [2019, 2020, 2021, 2022, 2023, 2024]
  const observations = []
  for (const [key, basis] of [['gdpCurrent', 'current'], ['gdpConstant', 'constant_2015']]) {
    const flat = pdfText(requireSource(sourceDir, key)).replace(/\s+/g, ' ')
    for (const { id: activityId, label: activity, phrase, seriesKind, parentSeriesId } of GDP_ACTIVITIES) {
      const values = extractCommaValues(flat, phrase)
      years.forEach((year, index) => observations.push({
        year, price_basis: basis, activity_id: activityId, activity, series_kind: seriesKind,
        parent_series_id: parentSeriesId,
        value_rs_million: values[index], provisional_or_revised: year >= 2020,
      }))
    }
  }
  return table({
    dataset_id: 'gdp-by-industry',
    title: 'GDP by major economic activity',
    description: 'DCS national-accounts component, subcomponent, subtotal, adjustment and total lines at current prices and constant 2015 prices.',
    grain: 'One non-additive published series line per year and price basis.',
    source_ids: ['dcs-statistical-abstract-2025-gdp-current', 'dcs-statistical-abstract-2025-gdp-constant'],
    vintage: '2019–2024 (source flags revisions and provisional values)',
    primary_key: ['year', 'price_basis', 'activity_id'],
    notes: [
      'Top-level gva_component rows reconcile to GVA within published rounding; manufacturing is a nested_component of industry and must not be added again.',
      'The published accounting identity is GDP at market prices = GVA at basic prices + taxes on products − subsidies on products, subject to rounding.',
    ],
    caveats: [
      'Rows are not mutually exclusive. Filter by series_kind and hierarchy before calculating; value_rs_million is deliberately non-additive across rows.',
      'Current-price and constant-price values answer different questions and must not be combined into one series.',
      'The source flags 2020–2024 values as revised or provisional.',
    ],
    fields: [
      dim('year', 'year', 'Year'), dim('price_basis', 'string', 'Price basis'), dim('activity_id', 'string', 'Activity id'),
      dim('activity', 'string', 'Economic activity'), dim('series_kind', 'string', 'Series kind'),
      dim('parent_series_id', 'string', 'Parent series id'), dim('provisional_or_revised', 'boolean', 'Provisional or revised'),
      measure('value_rs_million', 'integer', 'Value', 'LKR million', 'none'),
    ],
    rows: observations,
  })
}

function rangeTotal(row, start, end, totalIndex) {
  if (typeof row[totalIndex] === 'number') return row[totalIndex]
  return row.slice(start, end + 1).reduce((sum, value) => sum + (typeof value === 'number' ? value : 0), 0)
}

function buildHealth(sourceDir) {
  const sourceRows = readXlsxSheet(requireSource(sourceDir, 'health'), 'xl/worksheets/sheet2.xml')
  const observations = []
  let category = 'Unclassified'
  for (const row of sourceRows.slice(6)) {
    if (!row) continue
    if (typeof row[0] === 'string' && row[1] == null && row[2] == null) {
      category = row[0].trim()
      continue
    }
    if ((typeof row[1] !== 'string' && typeof row[1] !== 'number') || typeof row[2] !== 'string') continue
    const liveMale = rangeTotal(row, 3, 9, 10)
    const liveFemale = rangeTotal(row, 11, 17, 18)
    const deathMale = rangeTotal(row, 19, 25, 26)
    const deathFemale = rangeTotal(row, 27, 33, 34)
    observations.push({
      immr_code: String(row[1]).trim(), disease: row[2].trim(), category,
      live_discharges_year: 2024, live_discharges_male: liveMale, live_discharges_female: liveFemale,
      live_discharges_total: liveMale + liveFemale,
      deaths_year: 2023, deaths_male: deathMale, deaths_female: deathFemale, deaths_total: deathMale + deathFemale,
    })
  }
  return table({
    dataset_id: 'inpatient-morbidity-mortality',
    title: 'Indoor morbidity and mortality by disease group',
    description: 'Ministry of Health inpatient live discharges and deaths by IMMR/ICD disease group.',
    grain: 'One row per published IMMR disease group.',
    source_ids: ['moh-immr-2024'],
    vintage: 'Live discharges 2024; deaths 2023',
    primary_key: ['immr_code'],
    caveats: ['Inpatient events are not population prevalence.', 'The workbook labels live discharges as 2024 but deaths as 2023; the periods are kept separate.', 'Blank death cells are treated as zero, matching the workbook total conventions.'],
    fields: [
      dim('immr_code', 'string', 'IMMR code'), dim('disease', 'string', 'Disease group'), dim('category', 'string', 'Disease chapter'),
      dim('live_discharges_year', 'year', 'Live-discharges year'), dim('deaths_year', 'year', 'Deaths year'),
      measure('live_discharges_male', 'integer', 'Male live discharges', 'discharges', 'sum'),
      measure('live_discharges_female', 'integer', 'Female live discharges', 'discharges', 'sum'),
      measure('live_discharges_total', 'integer', 'Live discharges', 'discharges', 'sum'),
      measure('deaths_male', 'integer', 'Male deaths', 'deaths', 'sum'),
      measure('deaths_female', 'integer', 'Female deaths', 'deaths', 'sum'),
      measure('deaths_total', 'integer', 'Deaths', 'deaths', 'sum'),
    ],
    rows: observations,
  })
}

const MONTH_NAMES = Object.freeze({
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
})

function percentToken(value) {
  if (value == null) return null
  const parsed = Number(String(value).replace('%', ''))
  if (!Number.isFinite(parsed)) throw new Error(`Invalid percent token ${value}`)
  return parsed
}

export function buildCcpiFromText(text) {
  const observations = []
  let year = null
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    const match = /^(?:(\d{4})\s+)?(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d+\.\d+)\s+(\d+\.\d+)(.*)$/.exec(line)
    if (!match) continue
    if (match[1]) year = Number(match[1])
    if (year == null) throw new Error(`CCPI row ${match[2]} is missing a year`)
    const month = MONTH_NAMES[match[2].toLowerCase()]
    const rest = [...(match[5].match(/-?\d+\.\d+%/g) ?? [])]
    observations.push({
      period: `${year}-${String(month).padStart(2, '0')}`,
      headline_index: Number(match[3]),
      core_index: Number(match[4]),
      headline_month_on_month_pct: rest[0] ? percentToken(rest[0]) : null,
      core_month_on_month_pct: rest[1] ? percentToken(rest[1]) : null,
      headline_year_on_year_pct: rest[2] ? percentToken(rest[2]) : null,
      core_year_on_year_pct: rest[3] ? percentToken(rest[3]) : null,
      headline_annual_average_pct: rest[4] ? percentToken(rest[4]) : null,
      core_annual_average_pct: rest[5] ? percentToken(rest[5]) : null,
    })
  }
  if (observations.length === 0) throw new Error('CCPI PDF produced no monthly observations')
  return table({
    dataset_id: 'ccpi-monthly',
    title: 'Colombo Consumer Price Index',
    description: 'Monthly headline and core Colombo Consumer Price Index (2021=100) compiled by the Department of Census and Statistics.',
    grain: 'One Colombo urban row per month. This is not a national CPI.',
    source_ids: ['dcs-ccpi-2021'],
    vintage: `${observations[0].period}–${observations.at(-1).period}; core excludes volatile food, energy and transport`,
    primary_key: ['period'],
    notes: [
      'Index reference period is 2021=100. Weights come from the 2019 Household Income and Expenditure Survey and cover urban areas of Colombo District.',
      'CCPI Core excludes volatile food, energy and transport.',
      'Year-on-year and 12-month-average rates are the published percentages; they are not recalculated from the rounded index.',
    ],
    caveats: [
      'This is a Colombo urban index, not a national CPI. The National Consumer Price Index is a separate series.',
      'The first months of the 2021=100 series do not yet have a year-on-year rate in the source table; those fields are null.',
    ],
    fields: [
      dim('period', 'period', 'Month'),
      measure('headline_index', 'number', 'Headline CCPI', '2021=100'),
      measure('core_index', 'number', 'Core CCPI', '2021=100'),
      measure('headline_month_on_month_pct', 'number', 'Headline month-on-month change', 'percent'),
      measure('core_month_on_month_pct', 'number', 'Core month-on-month change', 'percent'),
      measure('headline_year_on_year_pct', 'number', 'Headline year-on-year inflation', 'percent'),
      measure('core_year_on_year_pct', 'number', 'Core year-on-year inflation', 'percent'),
      measure('headline_annual_average_pct', 'number', 'Headline 12-month average inflation', 'percent'),
      measure('core_annual_average_pct', 'number', 'Core 12-month average inflation', 'percent'),
    ],
    rows: observations,
  })
}

function buildCcpi(sourceDir) {
  const table = buildCcpiFromText(pdfText(requireSource(sourceDir, 'ccpi')))
  if (table.rows[0].period !== '2022-01') throw new Error(`CCPI series must start in 2022-01, found ${table.rows[0].period}`)
  if (table.rows.at(-1).period < '2026-08') throw new Error(`CCPI series ends ${table.rows.at(-1).period}, expected at least 2026-08`)
  return table
}

export function buildOfficialIndicators(sourceDir, { includeGranular = false } = {}) {
  const gndPopulation = buildGndPopulation(sourceDir)
  const gndHouseholds = buildGndHouseholds(sourceDir, gndPopulation)
  return [
    buildDsdPopulation(gndPopulation),
    buildDsdHouseholds(gndHouseholds),
    ...(includeGranular ? [gndPopulation, gndHouseholds] : []),
    buildDistrictServices(sourceDir),
    buildPopulationEstimates(sourceDir),
    buildLabourForce(sourceDir),
    buildEmploymentByIndustry(sourceDir),
    buildPoverty(sourceDir),
    buildGdp(sourceDir),
    buildHealth(sourceDir),
    buildCcpi(sourceDir),
  ]
}

if (import.meta.main) {
  const { sourceDir, outputDir, includeGranular } = sourceArgs()
  const materialized = await materializeSources(sourceDir)
  try {
    for (const dataset of buildOfficialIndicators(materialized.dir, { includeGranular })) {
      writeTable(outputDir, `${dataset.dataset_id}.json`, dataset)
    }
  } finally {
    if (materialized.temporary) rmSync(materialized.dir, { recursive: true, force: true })
  }
}
