#!/usr/bin/env bun

// Derive the 25-district Census 2012 → 2024 population-change table from the
// already-joined district GeoJSON. This does not re-run the census join.
//
//   bun scripts/build-population-change.mjs

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_GEOJSON = join(ROOT, 'public/data/demographics.geojson')
const DEFAULT_OUTPUT = join(ROOT, 'public/data/population-change-district.json')

export const DISTRICT_IDS = Object.freeze([
  'LK-11', 'LK-12', 'LK-13',
  'LK-21', 'LK-22', 'LK-23',
  'LK-31', 'LK-32', 'LK-33',
  'LK-41', 'LK-42', 'LK-43', 'LK-44', 'LK-45',
  'LK-51', 'LK-52', 'LK-53',
  'LK-61', 'LK-62',
  'LK-71', 'LK-72',
  'LK-81', 'LK-82',
  'LK-91', 'LK-92',
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

function percentChange(pop2024, pop2012) {
  return Math.round(((pop2024 - pop2012) / pop2012) * 10_000) / 100
}

function integer(value, label) {
  if (!Number.isInteger(value)) throw new Error(`${label} is not an integer`)
  return value
}

function requiredText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} is not text`)
  return value.trim()
}

export function buildPopulationChangeFromCollection(fc) {
  if (fc?.type !== 'FeatureCollection' || !Array.isArray(fc.features)) {
    throw new Error('population-change source must be a FeatureCollection')
  }
  if (fc.features.length !== DISTRICT_IDS.length) {
    throw new Error(`Expected ${DISTRICT_IDS.length} district features, found ${fc.features.length}`)
  }

  const rows = fc.features.map((feature, index) => {
    const p = feature?.properties ?? {}
    const geographyId = requiredText(p.id, `feature ${index} id`)
    const pop2012 = integer(p.pop_2012, `${geographyId} pop_2012`)
    const pop2024 = integer(p.pop, `${geographyId} pop`)
    if (pop2012 <= 0) throw new Error(`${geographyId} pop_2012 must be positive`)
    if (pop2024 <= 0) throw new Error(`${geographyId} pop must be positive`)
    const vintage = requiredText(p.vintage, `${geographyId} vintage`)
    if (vintage !== '2024') throw new Error(`${geographyId} vintage is ${vintage}, expected 2024 (district join is 100%)`)
    return {
      geography_id: geographyId,
      geography_name: requiredText(p.name, `${geographyId} name`),
      province: requiredText(p.province ?? p.parent, `${geographyId} province`),
      pop_2012: pop2012,
      pop_2024: pop2024,
      change: pop2024 - pop2012,
      change_pct: percentChange(pop2024, pop2012),
      area_km2: p.area,
    }
  })

  const got = rows.map((row) => row.geography_id).sort()
  const want = [...DISTRICT_IDS].sort()
  if (got.join() !== want.join()) {
    throw new Error(`District ids drifted: got ${got.join(', ')}`)
  }

  return {
    schema_version: 1,
    country: 'LK',
    dataset_id: 'population-change-district',
    title: 'Population change 2012 to 2024',
    description: 'Census 2012 and Census 2024 resident population for Sri Lanka’s 25 districts, with the arithmetic change between those enumerations.',
    grain: 'One row per district.',
    source_ids: ['lk-census-2012-2024-district-change'],
    vintage: 'Census 2012 and Census 2024',
    primary_key: ['geography_id'],
    notes: [
      'Census 2024 counts are Person-Sex total_value joined on gig-data id = region_id. District match is 100%. Those 2024 totals match Final Report Tables 6.1.11 / 6.1.14–6.1.15.',
      'Census 2012 counts are the gig-data population attribute on the same district geometries, so the choropleth and this table cannot drift.',
      'change_pct is (pop_2024 − pop_2012) / pop_2012, rounded to two decimal places.',
    ],
    caveats: [
      'This is district grain only. Divisional Secretariat and Grama Niladhari comparisons across 2012 and 2024 are misleading where those codes were recoded.',
      'These are census enumeration counts, not Registrar General mid-year estimates.',
      'Every district grew between these two censuses; the series does not currently include a shrinking district.',
      'Gig-data 2012 district totals differ from Final Report Table 6.1.11 in Colombo (−385), Kurunegala (−1,178), Vavuniya (−55) and Mullaitivu (−45). This table keeps the geometry-joined 2012 counts rather than mixing the final-report 2012 column into the choropleth.',
    ],
    fields: [
      dim('geography_id', 'string', 'District ID'),
      dim('geography_name', 'string', 'District'),
      dim('province', 'string', 'Province'),
      measure('pop_2012', 'integer', 'Census 2012 population', 'people', 'sum'),
      measure('pop_2024', 'integer', 'Census 2024 population', 'people', 'sum'),
      measure('change', 'integer', 'Change 2012 to 2024', 'people', 'sum'),
      measure('change_pct', 'number', 'Percent change 2012 to 2024', 'percent'),
      measure('area_km2', 'number', 'Area', 'km²', 'sum'),
    ],
    rows,
  }
}

function outputPath() {
  const index = process.argv.indexOf('--output')
  return index >= 0 ? resolve(process.argv[index + 1] ?? '') : DEFAULT_OUTPUT
}

function geojsonPath() {
  const index = process.argv.indexOf('--geojson')
  return index >= 0 ? resolve(process.argv[index + 1] ?? '') : DEFAULT_GEOJSON
}

if (import.meta.main) {
  const table = buildPopulationChangeFromCollection(JSON.parse(readFileSync(geojsonPath(), 'utf8')))
  const path = outputPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(canonical(table), null, 2)}\n`)
  console.log(`${path}: ${table.rows.length} rows`)
}
