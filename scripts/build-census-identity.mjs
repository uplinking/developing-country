#!/usr/bin/env bun

// Census 2024 final-report district ethnicity (Table 6.1.11) and religion
// (Tables 6.1.14–6.1.15). The PDF is fetched to a cache and never copied into public/.

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const ROOT = resolve(import.meta.dir, '..')
const DEFAULT_OUTPUT = join(ROOT, 'public/data')
const SOURCE = {
  file: 'CPH2024_Final_Eng.pdf',
  url: 'https://www.statistics.gov.lk/Resource/en/Population/CPH_2024/CPH2024_Final_Eng.pdf',
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

export const ETHNICITY_CATEGORIES = Object.freeze([
  { id: 'sinhalese', label: 'Sinhalese' },
  { id: 'sri_lanka_tamil', label: 'Sri Lanka Tamil' },
  { id: 'indian_tamil', label: 'Indian Tamil / Malaiyaga Thamilar' },
  { id: 'sri_lanka_moor', label: 'Sri Lanka Moor / Muslim' },
  { id: 'burgher', label: 'Burgher' },
  { id: 'malay', label: 'Malay' },
  { id: 'other', label: 'Other' },
])

export const RELIGION_CATEGORIES = Object.freeze([
  { id: 'buddhist', label: 'Buddhist' },
  { id: 'hindu', label: 'Hindu' },
  { id: 'islam', label: 'Islam' },
  { id: 'roman_catholic', label: 'Roman Catholic' },
  { id: 'other_christian', label: 'Other Christian' },
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

function pdfText(path) {
  const result = Bun.spawnSync(['pdftotext', '-layout', path, '-'])
  if (result.exitCode !== 0) throw new Error(`pdftotext failed: ${new TextDecoder().decode(result.stderr).trim()}`)
  return new TextDecoder().decode(result.stdout)
}

function integers(line) {
  return [...line.matchAll(/\d[\d,]*/g)].map((match) => Number(match[0].replaceAll(',', ''))).filter((n) => Number.isInteger(n))
}

function tableChunk(text, heading) {
  const start = text.lastIndexOf(heading)
  if (start < 0) throw new Error(`Missing ${heading}`)
  const rest = text.slice(start)
  const next = rest.search(/\n\s*Table 6\.\d\.\d+/)
  return next > 0 ? rest.slice(0, next) : rest.slice(0, 12_000)
}

function parseNamedRows(chunk, expectedCount) {
  const rows = []
  for (const [geographyId, geographyName] of DISTRICTS) {
    const pattern = new RegExp(`^\\s*${geographyName.replaceAll(' ', '\\s+')}\\s+([\\d,].+)$`, 'm')
    const match = pattern.exec(chunk)
    if (!match) throw new Error(`Missing ${geographyName} in ${chunk.slice(0, 80)}`)
    const values = integers(match[1])
    if (values.length < expectedCount) throw new Error(`${geographyName} has ${values.length} numbers, expected ${expectedCount}`)
    rows.push({ geographyId, geographyName, values: values.slice(0, expectedCount) })
  }
  return rows
}

function share(part, total) {
  return total > 0 ? Math.round((part / total) * 10_000) / 100 : 0
}

export function buildEthnicityFromText(text) {
  const chunk = tableChunk(text, 'Table 6.1.11 : Distribution of Population by Ethnic Group and District')
  const parsed = parseNamedRows(chunk, 16)
  const observations = []
  for (const row of parsed) {
    const total2012 = row.values[0]
    const total2024 = row.values[1]
    for (const [index, category] of ETHNICITY_CATEGORIES.entries()) {
      const pop2012 = row.values[2 + index * 2]
      const pop2024 = row.values[3 + index * 2]
      observations.push({
        geography_id: row.geographyId,
        geography_name: row.geographyName,
        year: 2012,
        category: category.id,
        category_label: category.label,
        population: pop2012,
        share_pct: share(pop2012, total2012),
        total_population: total2012,
      })
      observations.push({
        geography_id: row.geographyId,
        geography_name: row.geographyName,
        year: 2024,
        category: category.id,
        category_label: category.label,
        population: pop2024,
        share_pct: share(pop2024, total2024),
        total_population: total2024,
      })
    }
    const sum2012 = ETHNICITY_CATEGORIES.reduce((sum, _, index) => sum + row.values[2 + index * 2], 0)
    const sum2024 = ETHNICITY_CATEGORIES.reduce((sum, _, index) => sum + row.values[3 + index * 2], 0)
    if (sum2012 !== total2012) throw new Error(`${row.geographyName} 2012 ethnicity ${sum2012} != ${total2012}`)
    if (sum2024 !== total2024) throw new Error(`${row.geographyName} 2024 ethnicity ${sum2024} != ${total2024}`)
  }
  return identityTable({
    dataset_id: 'census-ethnicity-district',
    title: 'Population by ethnic group and district',
    description: 'Census 2012 and Census 2024 resident population by published ethnic group for Sri Lanka and its 25 districts.',
    source_ids: ['dcs-cph-2024-ethnicity'],
    vintage: 'Census 2012 and Census 2024',
    notes: [
      'Table 6.1.11 groups Sri Lanka Chetty, Bharatha, Veddas and Other as Other.',
      'Indian Tamil is published as Indian Tamil / Malaiyaga Thamilar in 2024.',
    ],
    caveats: [
      'Ethnic group is as declared by the respondent.',
      'These are census enumeration counts, not mid-year estimates.',
    ],
    rows: observations,
    categories: ETHNICITY_CATEGORIES.length,
  })
}

export function buildReligionFromText(text) {
  const parsed2012 = parseNamedRows(tableChunk(text, 'Table 6.1.14 : Distribution of Population by Religion and District, 2012'), 7)
  const parsed2024 = parseNamedRows(tableChunk(text, 'Table 6.1.15 : Distribution of Population by Religion and District, 2024'), 7)
  const observations = []
  for (const [year, parsed] of [[2012, parsed2012], [2024, parsed2024]]) {
    for (const row of parsed) {
      const total = row.values[0]
      const parts = row.values.slice(1)
      if (parts.reduce((sum, value) => sum + value, 0) !== total) {
        throw new Error(`${row.geographyName} ${year} religion parts ${parts.reduce((a, b) => a + b, 0)} != ${total}`)
      }
      for (const [index, category] of RELIGION_CATEGORIES.entries()) {
        observations.push({
          geography_id: row.geographyId,
          geography_name: row.geographyName,
          year,
          category: category.id,
          category_label: category.label,
          population: parts[index],
          share_pct: share(parts[index], total),
          total_population: total,
        })
      }
    }
  }
  return identityTable({
    dataset_id: 'census-religion-district',
    title: 'Population by religion and district',
    description: 'Census 2012 and Census 2024 resident population by published religion for Sri Lanka and its 25 districts.',
    source_ids: ['dcs-cph-2024-religion'],
    vintage: 'Census 2012 and Census 2024',
    notes: ['Roman Catholic and Other Christian are published as separate categories. Islam is the published label for the Muslim community.'],
    caveats: [
      'Religion is as declared by the respondent.',
      'These are census enumeration counts, not mid-year estimates.',
    ],
    rows: observations,
    categories: RELIGION_CATEGORIES.length,
  })
}

function identityTable({ dataset_id, title, description, source_ids, vintage, notes, caveats, rows, categories }) {
  return {
    schema_version: 1,
    country: 'LK',
    dataset_id,
    title,
    description,
    grain: 'One row per geography, census year and published category.',
    source_ids,
    vintage,
    primary_key: ['geography_id', 'year', 'category'],
    notes,
    caveats,
    fields: [
      dim('geography_id', 'string', 'Geography id'),
      dim('geography_name', 'string', 'Geography'),
      dim('year', 'year', 'Census year'),
      dim('category', 'string', 'Category'),
      dim('category_label', 'string', 'Category label'),
      measure('population', 'integer', 'Population', 'people', 'sum'),
      measure('share_pct', 'number', 'Share of geography total', 'percent'),
      measure('total_population', 'integer', 'Geography total', 'people', 'none'),
    ],
    rows,
  }
}

async function materialize(explicitDir) {
  if (explicitDir) return { dir: explicitDir, temporary: false }
  const dir = mkdtempSync(join(tmpdir(), 'developing-country-identity-'))
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
    const path = join(materialized.dir, SOURCE.file)
    readFileSync(path, { flag: 'r' })
    const text = pdfText(path)
    mkdirSync(outputDir, { recursive: true })
    for (const table of [buildEthnicityFromText(text), buildReligionFromText(text)]) {
      writeFileSync(join(outputDir, `${table.dataset_id}.json`), `${JSON.stringify(canonical(table), null, 2)}\n`)
      console.log(`${table.dataset_id}.json: ${table.rows.length} rows`)
    }
  } finally {
    if (materialized.temporary) rmSync(materialized.dir, { recursive: true, force: true })
  }
}
