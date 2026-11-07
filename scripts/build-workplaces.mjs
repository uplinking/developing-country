#!/usr/bin/env bun
// Workplaces (offices) from Overture Maps Places for the Colombo study area.
//
// Input:  data/src/overture/places-<release>-colombo.json (gitignored), written by
//           uvx --with duckdb python -I scripts/fetch-overture-places.py
//         (prerequisite: uv; DuckDB is supplied by uvx, not a repo dependency)
// Output: public/data/workplaces.geojson — office points only (name, office_type,
//         category, confidence), provenance on the root.
//
// CLASSIFICATION (shared with scripts/build-metro-coverage.mjs via classifyPlace)
//   Keep a row only when every source licence is CDLA-Permissive-2.0, Apache-2.0
//   or CC0, confidence ≥ 0.5, and operating_status is not 'closed'.
//   office   basic_category in OFFICE_TYPES below, or taxonomy.hierarchy containing
//            corporate_or_business_office or professional_service
//   business every other categorised place except geographic entities, cultural and
//            historic sites, places of worship and religious organisations
//   (dropped) the excluded classes and rows with no category
//
// Places are listings, not employment counts: no headcount or floor area, coverage
// is uneven and confidence-filtered. Downloaded rows are data only.
// Idempotent and self-validating. Usage: bun scripts/build-workplaces.mjs [--check]

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const OVERTURE_RELEASE = '2026-09-23.1'
export const OVERTURE_CACHE = join(ROOT, `data/src/overture/places-${OVERTURE_RELEASE}-colombo.json`)
const OUT = join(ROOT, 'public/data/workplaces.geojson')
export const MIN_CONFIDENCE = 0.5
export const ALLOWED_LICENCES = new Set(['CDLA-Permissive-2.0', 'Apache-2.0', 'CC0', 'CC0-1.0'])

/** basic_category → office_type */
export const OFFICE_TYPES = Object.freeze({
  corporate_or_business_office: 'corporate',
  government_office: 'government',
  financial_service: 'financial',
  bank_or_credit_union: 'financial',
  professional_service: 'professional',
  real_estate_service: 'real_estate',
  media_service: 'media',
  design_service: 'design',
  b2b_transportation_and_storage_service: 'logistics',
})
const HIERARCHY_OFFICE = [
  ['corporate_or_business_office', 'corporate'],
  ['professional_service', 'professional'],
]
const EXCLUDED_ROOTS = new Set(['geographic_entities', 'cultural_and_historic'])
const WORSHIP = /(^|_)place_of_worship$|^religious_organization$/

/**
 * Classify one Overture place row. Returns { keep, reason, cls, officeType }:
 * cls is 'office' | 'business' | null.
 */
export function classifyPlace(p) {
  const licences = p.licenses ?? []
  if (licences.length === 0 || !licences.every((l) => ALLOWED_LICENCES.has(l))) return { keep: false, reason: 'licence' }
  if (!(typeof p.confidence === 'number' && p.confidence >= MIN_CONFIDENCE)) return { keep: false, reason: 'confidence' }
  if (p.operating_status === 'closed') return { keep: false, reason: 'closed' }
  const hierarchy = p.taxonomy_hierarchy ?? []
  const category = p.basic_category
  const officeType = OFFICE_TYPES[category] ?? HIERARCHY_OFFICE.find(([c]) => hierarchy.includes(c))?.[1]
  if (officeType) return { keep: true, cls: 'office', officeType }
  if (!category) return { keep: false, reason: 'uncategorised' }
  if (EXCLUDED_ROOTS.has(hierarchy[0])) return { keep: false, reason: hierarchy[0] }
  if (WORSHIP.test(category) || hierarchy.some((h) => WORSHIP.test(h))) return { keep: false, reason: 'place_of_worship' }
  return { keep: true, cls: 'business', officeType: null }
}

/** Load the cached extract and classify every row. Throws with instructions if absent. */
export function loadPlaces() {
  if (!existsSync(OVERTURE_CACHE)) {
    throw new Error(
      `missing ${OVERTURE_CACHE} — run: uvx --with duckdb python -I scripts/fetch-overture-places.py`,
    )
  }
  const raw = JSON.parse(readFileSync(OVERTURE_CACHE, 'utf8'))
  if (raw.release !== OVERTURE_RELEASE || !Array.isArray(raw.columns) || !Array.isArray(raw.rows)) {
    throw new Error(`overture cache is not release ${OVERTURE_RELEASE} rows`)
  }
  const col = Object.fromEntries(raw.columns.map((c, k) => [c, k]))
  const tally = { rows: raw.rows.length, dropped: {}, office: {}, business: 0 }
  const places = []
  for (const r of raw.rows) {
    const p = {
      id: String(r[col.id]),
      name: typeof r[col.name] === 'string' && r[col.name].trim() ? r[col.name].trim() : null,
      basic_category: r[col.basic_category] ?? null,
      taxonomy_hierarchy: r[col.taxonomy_hierarchy] ?? [],
      confidence: r[col.confidence],
      operating_status: r[col.operating_status] ?? null,
      lng: r[col.lng],
      lat: r[col.lat],
      licenses: r[col.licenses] ?? [],
    }
    const c = classifyPlace(p)
    if (!c.keep) {
      tally.dropped[c.reason] = (tally.dropped[c.reason] ?? 0) + 1
      continue
    }
    if (c.cls === 'office') tally.office[c.officeType] = (tally.office[c.officeType] ?? 0) + 1
    else tally.business++
    places.push({ ...p, cls: c.cls, office_type: c.officeType })
  }
  return { release: raw.release, places, tally }
}

const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d

export function buildWorkplaces() {
  const { places, tally } = loadPlaces()
  const offices = places.filter((p) => p.cls === 'office').sort((a, b) => a.id.localeCompare(b.id))
  const fc = {
    type: 'FeatureCollection',
    source: `Overture Maps Foundation — Places (release ${OVERTURE_RELEASE})`,
    vintage: OVERTURE_RELEASE,
    licence: 'CDLA-Permissive-2.0 (rows limited to CDLA-Permissive-2.0, Apache-2.0 or CC0 sources)',
    refreshed: '2026-10-20',
    refresh: 'uvx --with duckdb python -I scripts/fetch-overture-places.py && bun scripts/build-workplaces.mjs',
    classification: `office = basic_category in ${Object.keys(OFFICE_TYPES).join('|')}, or taxonomy.hierarchy containing corporate_or_business_office|professional_service; confidence ≥ ${MIN_CONFIDENCE}; not closed`,
    features: offices.map((p) => ({
      type: 'Feature',
      id: `overture/${p.id}`,
      properties: {
        id: `overture/${p.id}`,
        name: p.name,
        kind: 'office',
        office_type: p.office_type,
        category: p.basic_category,
        confidence: round(p.confidence, 2),
      },
      geometry: { type: 'Point', coordinates: [round(p.lng, 6), round(p.lat, 6)] },
    })),
  }
  validate(fc, tally)
  return { fc, tally }
}

export function validate(fc, tally) {
  const problems = []
  if (fc.features.length < 2000) problems.push(`only ${fc.features.length} offices`)
  const ids = new Set()
  for (const f of fc.features) {
    const p = f.properties
    if (ids.has(p.id)) problems.push(`duplicate ${p.id}`)
    ids.add(p.id)
    if (!Object.values(OFFICE_TYPES).includes(p.office_type)) problems.push(`${p.id}: bad office_type ${p.office_type}`)
    if (!(p.confidence >= MIN_CONFIDENCE && p.confidence <= 1)) problems.push(`${p.id}: confidence ${p.confidence}`)
    const [lng, lat] = f.geometry.coordinates
    if (!(lng > 79.8 && lng < 80.1 && lat > 6.6 && lat < 7.15)) problems.push(`${p.id}: outside study bbox`)
  }
  if (tally.business < 10000) problems.push(`only ${tally.business} businesses`)
  if (problems.length) throw new Error(`build-workplaces: validation failed\n  ${problems.slice(0, 20).join('\n  ')}`)
}

if (import.meta.main) {
  const { fc, tally } = buildWorkplaces()
  const text = `${JSON.stringify(fc)}\n`
  const previous = existsSync(OUT) ? readFileSync(OUT, 'utf8') : null
  console.log(`places ${tally.rows}; dropped ${JSON.stringify(tally.dropped)}`)
  console.log(`offices ${fc.features.length} ${JSON.stringify(tally.office)}; businesses ${tally.business}`)
  const kb = (Buffer.byteLength(text) / 1024).toFixed(0)
  if (previous === text) console.log(`build-workplaces: unchanged public/data/workplaces.geojson (${kb} KB)`)
  else if (process.argv.includes('--check')) {
    console.error('build-workplaces: public/data/workplaces.geojson is stale')
    process.exit(1)
  } else {
    writeFileSync(OUT, text)
    console.log(`build-workplaces: wrote public/data/workplaces.geojson (${kb} KB)`)
  }
}
