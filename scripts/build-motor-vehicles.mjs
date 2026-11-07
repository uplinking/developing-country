#!/usr/bin/env bun

// National motor-vehicle tables from DCS Pocket Book 8.2 (registered stock)
// and Statistical Abstract 7.3 (new registrations by class and fuel).
// Source PDFs are fetched to a cache (or --source-dir) and never copied into public/.
// Both tables are national. Do not invent district choropleths.

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { parseIndicatorTable } from '../packages/datasets/src/table.ts'

const ROOT = resolve(import.meta.dir, '..')
const DEFAULT_OUTPUT = join(ROOT, 'public/data')
const YEARS = Object.freeze([2020, 2021, 2022, 2023, 2024])

export const SOURCES = Object.freeze({
  pocket: Object.freeze({
    file: 'Pocket_Book2025.pdf',
    aliases: Object.freeze(['pocket.pdf', 'Pocket_Book2025.pdf']),
    url: 'https://www.statistics.gov.lk/Publication/PocketBook2025',
  }),
  abstract73: Object.freeze({
    file: '7.3.pdf',
    aliases: Object.freeze(['7.3.pdf']),
    url: 'https://www.statistics.gov.lk/abstract2025/CHAP7/7.3.pdf',
  }),
})

export const STOCK_CLASSES = Object.freeze([
  { id: 'total', label: 'Total', phrase: 'Total' },
  { id: 'passenger_cars', label: 'Passenger Cars', phrase: 'Passenger Cars' },
  { id: 'three_wheelers', label: 'Three Wheelers', phrase: 'Three Wheelers' },
  { id: 'buses', label: 'Buses (SLTB + private)', phrase: 'Buses (SLTB+ Private)' },
  { id: 'motor_cycles', label: 'Motor Cycles', phrase: 'Motor Cycles' },
  { id: 'lorries', label: 'Lorries', phrase: 'Lorries(a)' },
  { id: 'ambulances_and_hearses', label: 'Ambulances and Hearses', phrase: 'Ambulances and Hearses' },
  { id: 'dual_purpose_vehicles', label: 'Dual Purpose Vehicles', phrase: 'Dual Purpose Vehicles' },
  { id: 'tractors_and_engines', label: 'Tractors and Engines', phrase: 'Tractors & Engines(b)' },
  { id: 'quadricycle', label: 'Quadricycle', phrase: 'Quadricycle' },
  { id: 'motor_home', label: 'Motor Home', phrase: 'Motor Home' },
  { id: 'special_purpose_vehicles', label: 'Special Purpose Vehicles', phrase: 'Special Purpose vehicles' },
])

export const NEW_REGISTRATION_CLASSES = Object.freeze([
  { id: 'total', label: 'Total', phrase: 'Total' },
  { id: 'motor_cars', label: 'Motor cars', phrase: 'Motor cars' },
  { id: 'motor_tricycles_van', label: 'Motor tricycle vans', phrase: 'Motor Tricycles Van' },
  { id: 'motor_tricycles', label: 'Motor tricycles', phrase: 'Motor Tricycles' },
  { id: 'quadricycle', label: 'Quadricycle', phrase: 'Quadricycle' },
  { id: 'motor_home', label: 'Motor home', phrase: 'Motor Home' },
  { id: 'buses', label: 'Buses', phrase: 'Buses' },
  { id: 'motor_cycles', label: 'Motor cycles', phrase: 'Motor Cycles' },
  { id: 'dual_purpose_vehicles', label: 'Dual purpose vehicles', phrase: 'Dual Purpose Vehicles' },
  { id: 'single_cab', label: 'Single cab', phrase: 'Single Cab' },
  { id: 'special_purpose_vehicles', label: 'Special purpose vehicles', phrase: 'Special Purpose Vehicles' },
  { id: 'lorry_proper', label: 'Lorry — proper', phrase: 'Lorry- proper' },
  { id: 'lorry_prime_mover', label: 'Lorry — tractors (prime mover)', phrase: 'Lorry - tractors (Prime mover)' },
  { id: 'lorry_trailers', label: 'Lorry — trailers', phrase: 'Lorry - trailers' },
  { id: 'ambulances_and_hearses', label: 'Ambulances and hearses', phrase: 'Ambulances and hearses' },
  { id: 'land_tractor_4_wheel', label: 'Land vehicles — tractor (4 wheel)', phrase: 'Land vechicles - Tractor (4 wheel)' },
  { id: 'land_trailer', label: 'Land vehicles — trailer', phrase: 'Land vechicles - Trailer' },
  { id: 'land_tractor_2_wheel', label: 'Land vehicles — tractor (2 wheel)', phrase: 'Land vechicles - Tractor (2 wheel)' },
])

export const FUELS = Object.freeze([
  { id: 'diesel_electric', label: 'Diesel/electric', phrase: 'Diesel/Electric' },
  { id: 'petrol_electric', label: 'Petrol/electric', phrase: 'Petrol/Electric' },
  { id: 'non_fuel', label: 'Non-fuel', phrase: 'Non Fuel' },
  { id: 'lp_gas', label: 'LP gas', phrase: 'LP Gas' },
  { id: 'diesel', label: 'Diesel', phrase: 'Diesel' },
  { id: 'petrol', label: 'Petrol', phrase: 'Petrol' },
  { id: 'electric', label: 'Electric', phrase: 'Electric' },
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

function pdfText(path) {
  const result = Bun.spawnSync(['pdftotext', '-layout', path, '-'])
  if (result.exitCode !== 0) throw new Error(`pdftotext failed: ${new TextDecoder().decode(result.stderr).trim()}`)
  return new TextDecoder().decode(result.stdout)
}

function tableChunk(text, heading, stop) {
  const start = text.lastIndexOf(heading)
  if (start < 0) throw new Error(`Missing ${heading}`)
  const rest = text.slice(start)
  const end = rest.search(stop)
  return end > 0 ? rest.slice(0, end) : rest.slice(0, 8_000)
}

function trailingYearTokens(line, blank) {
  const token = blank === '-' ? '-|\\d[\\d,]*' : '\\.\\.|\\d[\\d,]*'
  const match = line.match(new RegExp(`((?:${token})\\s+){4}(?:${token})\\s*$`))
  if (!match) return null
  return match[0].trim().split(/\s+/).map((cell) => {
    if (cell === blank || cell === '..') return null
    const value = Number(cell.replaceAll(',', ''))
    if (!Number.isSafeInteger(value)) throw new Error(`Bad year token ${cell} in ${line}`)
    return value
  })
}

function share(part, total) {
  if (part == null || total == null || total <= 0) return null
  return Math.round((part / total) * 10_000) / 100
}

function namedLine(chunk, phrase) {
  const pattern = new RegExp(`^.*${phrase.replaceAll(/[()]/g, '\\$&').replaceAll('+', '\\+')}\\s+.+$`, 'm')
  const match = pattern.exec(chunk)
  if (!match) throw new Error(`Missing row ${phrase}`)
  return match[0]
}

export function buildRegisteredStockFromText(text) {
  const chunk = tableChunk(text, '8.2 Registered Motor Vehicles, 2020 - 2024', /8\.3 Postal/)
  const byClass = new Map()
  for (const category of STOCK_CLASSES) {
    const values = trailingYearTokens(namedLine(chunk, category.phrase), '-')
    if (!values) throw new Error(`${category.phrase} has fewer than ${YEARS.length} year values`)
    byClass.set(category.id, values)
  }
  if (chunk.includes('Passenger Cars Per 100 Population') === false) {
    throw new Error('Pocket Book 8.2 is missing the cars-per-100-population footnote row; the table may have shifted')
  }
  const totals = byClass.get('total')
  const parts = STOCK_CLASSES.filter((category) => category.id !== 'total')
  for (const [index, year] of YEARS.entries()) {
    const sum = parts.reduce((total, category) => total + (byClass.get(category.id)[index] ?? 0), 0)
    if (sum !== totals[index]) throw new Error(`${year} stock parts ${sum} != total ${totals[index]}`)
  }
  const rows = []
  for (const category of STOCK_CLASSES) {
    const values = byClass.get(category.id)
    for (const [index, year] of YEARS.entries()) {
      const vehicles = values[index]
      rows.push({
        year,
        category: category.id,
        category_label: category.label,
        vehicles,
        share_pct: category.id === 'total' ? 100 : share(vehicles, totals[index]),
        total_vehicles: totals[index],
      })
    }
  }
  return parseIndicatorTable({
    schema_version: 1,
    country: 'LK',
    dataset_id: 'registered-motor-vehicles-annual',
    title: 'Registered motor vehicles',
    description: 'National stock of registered motor vehicles by published class, 2020–2024, compiled by DCS from Department of Motor Traffic figures.',
    grain: 'One row per calendar year and published vehicle class, including the national total.',
    source_ids: ['dcs-pocket-book-2025-vehicles'],
    vintage: '2020–2024',
    primary_key: ['year', 'category'],
    notes: [
      'Lorries include lorry proper, prime movers, lorry trailers, fork-lifts and other lorries.',
      'Tractors and engines include 2-wheel and 4-wheel land-vehicle tractors and land-vehicle trailers.',
      'Buses combine SLTB and private buses.',
    ],
    caveats: [
      'This is a national stock table. It is not a district map and must not be choroplethed.',
      'These are registered vehicles, not vehicles in use on a given day.',
      'A dash in the source for special-purpose vehicles in 2020–2021 is stored as null, not zero.',
    ],
    fields: [
      dim('year', 'year', 'Year'),
      dim('category', 'string', 'Category'),
      dim('category_label', 'string', 'Category label'),
      measure('vehicles', 'integer', 'Registered vehicles', 'vehicles', 'none'),
      measure('share_pct', 'number', 'Share of national stock', 'percent'),
      measure('total_vehicles', 'integer', 'National stock', 'vehicles', 'none'),
    ],
    rows,
  })
}

function classFromLine(line) {
  return NEW_REGISTRATION_CLASSES.find((category) => line.includes(category.phrase)) ?? null
}

function fuelFromLine(line) {
  return FUELS.find((fuel) => line.includes(fuel.phrase)) ?? null
}

export function buildNewRegistrationsFromText(text) {
  const chunk = tableChunk(
    text,
    'Table 7.3 : Number of new vehicles registered by class of vehicles and type of fuel used 2020 - 2024',
    /Source - Department of Motor Traffic/,
  )
  const observations = []
  let currentClass = null
  for (const rawLine of chunk.split('\n')) {
    const line = rawLine.replaceAll(/\s+/g, ' ').trim()
    if (!line) continue
    const nextClass = classFromLine(line)
    if (nextClass) currentClass = nextClass
    const values = trailingYearTokens(line, '..')
    if (!values || !currentClass) continue
    if (currentClass.id === 'total') {
      if (observations.some((row) => row.category === 'total')) continue
      for (const [index, year] of YEARS.entries()) {
        observations.push({
          year,
          category: 'total',
          category_label: currentClass.label,
          fuel: 'all',
          fuel_label: 'All fuels',
          vehicles: values[index],
        })
      }
      continue
    }
    const fuel = fuelFromLine(line)
    if (!fuel) continue
    for (const [index, year] of YEARS.entries()) {
      observations.push({
        year,
        category: currentClass.id,
        category_label: currentClass.label,
        fuel: fuel.id,
        fuel_label: fuel.label,
        vehicles: values[index],
      })
    }
  }
  const totals = YEARS.map((year) => {
    const row = observations.find((candidate) => candidate.category === 'total' && candidate.year === year)
    if (!row || row.vehicles == null) throw new Error(`Missing ${year} new-registration total`)
    return row.vehicles
  })
  for (const [index, year] of YEARS.entries()) {
    const sum = observations
      .filter((row) => row.year === year && row.category !== 'total')
      .reduce((total, row) => total + (row.vehicles ?? 0), 0)
    const residual = sum - totals[index]
    if (Math.abs(residual) > 1) {
      throw new Error(`${year} new-registration parts ${sum} != total ${totals[index]}`)
    }
  }
  const expectedKeys = new Set()
  for (const row of observations) expectedKeys.add(`${row.year}|${row.category}|${row.fuel}`)
  if (expectedKeys.size !== observations.length) throw new Error('Duplicate new-registration rows')
  return parseIndicatorTable({
    schema_version: 1,
    country: 'LK',
    dataset_id: 'new-vehicle-registrations-annual',
    title: 'New vehicle registrations',
    description: 'National new motor-vehicle registrations by published class and fuel type, 2020–2024, compiled by DCS from Department of Motor Traffic figures.',
    grain: 'One row per calendar year, published vehicle class and fuel type, including the national total.',
    source_ids: ['dcs-statistical-abstract-2025-new-vehicles'],
    vintage: '2020–2024',
    primary_key: ['year', 'category', 'fuel'],
    notes: [
      'The source spells land vehicles as “vechicles”; labels here use the English spelling.',
      'A double-dot in the source is stored as null, not zero.',
      'The 2022 published total is one vehicle above the sum of published class/fuel cells; that residual is left explicit.',
    ],
    caveats: [
      'This is a national table of newly registered vehicles. It is not a district map and must not be choroplethed.',
      'These are new registrations, not the stock of vehicles already on the register.',
      'Road length tables 7.1 and 7.2 were not published at this URL and are not inferred.',
    ],
    fields: [
      dim('year', 'year', 'Year'),
      dim('category', 'string', 'Category'),
      dim('category_label', 'string', 'Category label'),
      dim('fuel', 'string', 'Fuel'),
      dim('fuel_label', 'string', 'Fuel label'),
      measure('vehicles', 'integer', 'New registrations', 'vehicles', 'none'),
    ],
    rows: observations,
  })
}

function sourcePath(dir, source) {
  for (const name of source.aliases ?? [source.file]) {
    const path = join(dir, name)
    try {
      readFileSync(path, { flag: 'r' })
      return path
    } catch {
      continue
    }
  }
  throw new Error(`Missing ${source.file} in ${dir}`)
}

async function materialize(explicitDir) {
  if (explicitDir) return { dir: explicitDir, temporary: false }
  const dir = mkdtempSync(join(tmpdir(), 'developing-country-vehicles-'))
  for (const source of Object.values(SOURCES)) {
    const response = await fetch(source.url, { headers: { 'User-Agent': 'developing-country.org data refresh' } })
    if (!response.ok) throw new Error(`Source download failed (${response.status}): ${source.url}`)
    await Bun.write(join(dir, source.file), await response.arrayBuffer())
  }
  return { dir, temporary: true }
}

function writeTable(outputDir, dataset) {
  mkdirSync(outputDir, { recursive: true })
  writeFileSync(join(outputDir, `${dataset.dataset_id}.json`), `${JSON.stringify(canonical(dataset), null, 2)}\n`)
  console.log(`${dataset.dataset_id}.json: ${dataset.rows.length} rows`)
}

if (import.meta.main) {
  const sourceIndex = process.argv.indexOf('--source-dir')
  const outputIndex = process.argv.indexOf('--output-dir')
  const only = process.argv.includes('--only-stock') ? 'stock'
    : process.argv.includes('--only-new') ? 'new'
      : 'both'
  const sourceDir = sourceIndex >= 0 ? resolve(process.argv[sourceIndex + 1] ?? '') : null
  const outputDir = outputIndex >= 0 ? resolve(process.argv[outputIndex + 1] ?? '') : DEFAULT_OUTPUT
  const materialized = await materialize(sourceDir)
  try {
    if (only !== 'new') {
      writeTable(outputDir, buildRegisteredStockFromText(pdfText(sourcePath(materialized.dir, SOURCES.pocket))))
    }
    if (only !== 'stock') {
      writeTable(outputDir, buildNewRegistrationsFromText(pdfText(sourcePath(materialized.dir, SOURCES.abstract73))))
    }
  } finally {
    if (materialized.temporary) rmSync(materialized.dir, { recursive: true, force: true })
  }
}
