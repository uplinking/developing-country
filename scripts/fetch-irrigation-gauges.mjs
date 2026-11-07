#!/usr/bin/env bun

// Irrigation Department hydrology stations compiled by nuuuwan/lk_irrigation.
// Static locations and published alert / minor / major flood levels only.
// Live water levels are not fetched and must not be invented.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '..')
const DEFAULT_OUTPUT = join(ROOT, 'public/data/irrigation-gauges.geojson')
export const STATIONS_URL = 'https://raw.githubusercontent.com/nuuuwan/lk_irrigation/main/data/static/stations.json'
export const OFFICIAL_URL = 'https://www.irrigation.gov.lk/web/index.php?option=com_content&view=article&id=27&Itemid=128&lang=en'
export const EXPECTED_STATIONS = 40
const VINTAGE = '2026-09'
const SOURCE = 'Irrigation Department of Sri Lanka via nuuuwan/lk_irrigation'
const LICENCE = 'Station list compiled under MIT (nuuuwan/lk_irrigation); underlying hydrology figures are Sri Lanka government data whose reuse permission is not explicitly stated'
const BBOX = { west: 79.5, south: 5.8, east: 82.0, north: 9.9 }

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
  }
  return value
}

function slug(name) {
  const id = String(name).toLocaleLowerCase('en').replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-|-$/g, '')
  if (!id) throw new Error(`Cannot slugify station name ${name}`)
  return id
}

function finiteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} is not a finite number`)
  return value
}

export function buildGaugeCollection(stations, { refreshed = '2026-09-11' } = {}) {
  if (!Array.isArray(stations) || stations.length !== EXPECTED_STATIONS) {
    throw new Error(`Expected ${EXPECTED_STATIONS} hydrology stations, found ${stations?.length}`)
  }
  const features = []
  const seen = new Set()
  for (const station of stations) {
    const id = slug(station.name)
    if (seen.has(id)) throw new Error(`Duplicate station id ${id}`)
    seen.add(id)
    if (!Array.isArray(station.lat_lng) || station.lat_lng.length !== 2) {
      throw new Error(`${station.name} is missing lat_lng`)
    }
    const lat = finiteNumber(station.lat_lng[0], `${station.name} latitude`)
    const lng = finiteNumber(station.lat_lng[1], `${station.name} longitude`)
    if (lng < BBOX.west || lng > BBOX.east || lat < BBOX.south || lat > BBOX.north) {
      throw new Error(`${station.name} is outside Sri Lanka (${lng}, ${lat})`)
    }
    if ('water_level_m' in station || 'level_m' in station) {
      throw new Error(`${station.name} includes a live water level; this extract is static thresholds only`)
    }
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lng, lat] },
      properties: {
        id,
        name: String(station.name),
        river_name: String(station.river_name),
        district_id: String(station.district_id),
        alert_level_m: finiteNumber(station.alert_level_m, `${station.name} alert_level_m`),
        minor_flood_level_m: finiteNumber(station.minor_flood_level_m, `${station.name} minor_flood_level_m`),
        major_flood_level_m: finiteNumber(station.major_flood_level_m, `${station.name} major_flood_level_m`),
        source: SOURCE,
      },
    })
  }
  features.sort((left, right) => left.properties.id.localeCompare(right.properties.id))
  return {
    type: 'FeatureCollection',
    source: SOURCE,
    vintage: VINTAGE,
    licence: LICENCE,
    refreshed,
    features,
  }
}

async function loadStations(sourceDir) {
  if (sourceDir) {
    return JSON.parse(readFileSync(join(sourceDir, 'stations.json'), 'utf8'))
  }
  const response = await fetch(STATIONS_URL, { headers: { 'User-Agent': 'developing-country.org data refresh' } })
  if (!response.ok) throw new Error(`Source download failed (${response.status}): ${STATIONS_URL}`)
  return response.json()
}

if (import.meta.main) {
  const sourceIndex = process.argv.indexOf('--source-dir')
  const outputIndex = process.argv.indexOf('--output-dir')
  const sourceDir = sourceIndex >= 0 ? resolve(process.argv[sourceIndex + 1] ?? '') : null
  const outputPath = outputIndex >= 0
    ? join(resolve(process.argv[outputIndex + 1] ?? ''), 'irrigation-gauges.geojson')
    : DEFAULT_OUTPUT
  const collection = buildGaugeCollection(await loadStations(sourceDir))
  mkdirSync(resolve(outputPath, '..'), { recursive: true })
  writeFileSync(outputPath, `${JSON.stringify(canonical(collection))}\n`)
  console.log(`irrigation-gauges.geojson: ${collection.features.length} stations`)
}
