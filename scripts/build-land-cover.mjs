// Build a compact, reproducible Sri Lanka land-cover dataset from ESA
// WorldCover 2021 v200. WorldCover is a categorical land-cover model: the
// derived `vegetated` flag groups vegetation classes; it is not NDVI, canopy
// condition, or a claim about current greenness.
//
// Requirements: Bun plus GDAL command-line tools (gdalbuildvrt, gdalwarp,
// gdal_translate, gdal_rasterize, gdalinfo, ogr2ogr).
//
// Usage:
//   bun scripts/build-land-cover.mjs
//   bun scripts/build-land-cover.mjs --source-dir /path/to/existing/tiles
//   bun scripts/build-land-cover.mjs --cache-dir /path/to/persistent/cache
//
// Environment equivalents: WORLDCOVER_SOURCE_DIR and WORLDCOVER_CACHE_DIR.
// Existing source/cache tiles are never downloaded again. A present but
// unreadable tile fails closed instead of being silently replaced.

import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE_BASE = 'https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map'
const TILE_IDS = Object.freeze(['N03E078', 'N06E078', 'N06E081', 'N09E078', 'N09E081'])
const GRID_DEGREES = 0.05
const GRID_SAMPLE_DEGREES = 0.001
const AREA_PIXEL_METRES = 100

export const WORLD_COVER_CLASSES = Object.freeze([
  { code: 10, label: 'Tree cover', vegetated: true },
  { code: 20, label: 'Shrubland', vegetated: true },
  { code: 30, label: 'Grassland', vegetated: true },
  { code: 40, label: 'Cropland', vegetated: true },
  { code: 50, label: 'Built-up', vegetated: false },
  { code: 60, label: 'Bare / sparse vegetation', vegetated: false },
  { code: 70, label: 'Snow and ice', vegetated: false },
  { code: 80, label: 'Permanent water bodies', vegetated: false },
  { code: 90, label: 'Herbaceous wetland', vegetated: true },
  { code: 95, label: 'Mangroves', vegetated: true },
  { code: 100, label: 'Moss and lichen', vegetated: true },
])

const CLASS_BY_CODE = new Map(WORLD_COVER_CLASSES.map((entry) => [entry.code, entry]))

export function worldCoverClass(code) {
  return CLASS_BY_CODE.get(Number(code))
}

function parseArgs(argv) {
  const options = {
    sourceDir: process.env.WORLDCOVER_SOURCE_DIR
      ? resolve(process.env.WORLDCOVER_SOURCE_DIR)
      : undefined,
    cacheDir: resolve(process.env.WORLDCOVER_CACHE_DIR || join(REPO_ROOT, 'data/src/worldcover-2021')),
    districtsPath: resolve(join(REPO_ROOT, 'public/data/demographics.geojson')),
    gridPath: resolve(join(REPO_ROOT, 'public/data/land-cover-grid.geojson')),
    tablePath: resolve(join(REPO_ROOT, 'public/data/land-cover-district.json')),
  }
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (!['--source-dir', '--cache-dir', '--districts', '--grid-output', '--table-output'].includes(flag)) {
      throw new Error(`Unknown option: ${flag}`)
    }
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`)
    index++
    const path = resolve(value)
    if (flag === '--source-dir') options.sourceDir = path
    if (flag === '--cache-dir') options.cacheDir = path
    if (flag === '--districts') options.districtsPath = path
    if (flag === '--grid-output') options.gridPath = path
    if (flag === '--table-output') options.tablePath = path
  }
  return options
}

async function run(command, args, { capture = false } = {}) {
  const child = Bun.spawn([command, ...args], {
    cwd: REPO_ROOT,
    stdout: capture ? 'pipe' : 'inherit',
    stderr: 'pipe',
  })
  const stdoutPromise = capture ? new Response(child.stdout).text() : Promise.resolve('')
  const stderrPromise = new Response(child.stderr).text()
  const [exitCode, stdout, stderr] = await Promise.all([child.exited, stdoutPromise, stderrPromise])
  if (exitCode !== 0) {
    throw new Error(`${command} failed (${exitCode}): ${stderr.trim()}`)
  }
  if (!capture && stderr.trim()) process.stderr.write(stderr)
  return stdout
}

async function requireGdal() {
  const required = ['gdalbuildvrt', 'gdalwarp', 'gdal_translate', 'gdal_rasterize', 'gdalinfo', 'ogr2ogr']
  for (const command of required) await run(command, ['--version'], { capture: true })
}

function tileFilename(tileId) {
  return `ESA_WorldCover_10m_2021_v200_${tileId}_Map.tif`
}

async function validateTile(path) {
  const info = JSON.parse(await run('gdalinfo', ['-json', path], { capture: true }))
  if (info?.bands?.[0]?.type !== 'Byte' || info?.size?.length !== 2) {
    throw new Error(`Unexpected WorldCover tile at ${path}`)
  }
}

async function download(url, destination) {
  await mkdir(dirname(destination), { recursive: true })
  const partial = `${destination}.part`
  await rm(partial, { force: true })
  console.log(`Downloading ${url}`)
  const response = await fetch(url)
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}) for ${url}`)
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial, { flags: 'wx' }))
  await rename(partial, destination)
}

async function resolveTiles(sourceDir, cacheDir) {
  const paths = []
  for (const tileId of TILE_IDS) {
    const filename = tileFilename(tileId)
    const supplied = sourceDir ? join(sourceDir, filename) : undefined
    const cached = join(cacheDir, filename)
    let path
    if (supplied && existsSync(supplied)) {
      path = supplied
      console.log(`Using source tile ${path}`)
    } else if (existsSync(cached)) {
      path = cached
      console.log(`Using cached tile ${path}`)
    } else {
      await download(`${SOURCE_BASE}/${filename}`, cached)
      path = cached
    }
    await validateTile(path)
    paths.push(path)
  }
  return paths
}

function rounded(value, digits) {
  const factor = 10 ** digits
  return Math.round((value + Number.EPSILON) * factor) / factor
}

function rectangleForIndex(xIndex, yIndex, size) {
  const minX = xIndex * size
  const minY = yIndex * size
  return [[
    [rounded(minX, 7), rounded(minY, 7)],
    [rounded(minX + size, 7), rounded(minY, 7)],
    [rounded(minX + size, 7), rounded(minY + size, 7)],
    [rounded(minX, 7), rounded(minY + size, 7)],
    [rounded(minX, 7), rounded(minY, 7)],
  ]]
}

export function gridFeaturesFromRaster(bytes, width, height, geoTransform, cellSize = GRID_DEGREES) {
  if (bytes.length !== width * height) {
    throw new Error(`Raster length mismatch: ${bytes.length} samples for ${width} × ${height}`)
  }
  const [originX, pixelWidth, rotationX, originY, rotationY, pixelHeight] = geoTransform
  if (rotationX !== 0 || rotationY !== 0 || pixelWidth <= 0 || pixelHeight >= 0) {
    throw new Error('Land-cover sample raster must be a north-up grid')
  }
  const byCell = new Map()
  for (let row = 0; row < height; row++) {
    const latitude = originY + (row + 0.5) * pixelHeight
    const yIndex = Math.floor(latitude / cellSize)
    for (let column = 0; column < width; column++) {
      const code = bytes[row * width + column]
      if (code === 0) continue
      if (!worldCoverClass(code)) throw new Error(`Unknown WorldCover class code ${code}`)
      const longitude = originX + (column + 0.5) * pixelWidth
      const xIndex = Math.floor(longitude / cellSize)
      const key = `${yIndex}:${xIndex}`
      let counts = byCell.get(key)
      if (!counts) {
        counts = { xIndex, yIndex, classes: new Map() }
        byCell.set(key, counts)
      }
      counts.classes.set(code, (counts.classes.get(code) || 0) + 1)
    }
  }
  return [...byCell.entries()]
    .map(([gridId, cell]) => {
      // Tie-break on the lower official class code so identical samples always
      // produce identical bytes, independent of GDAL hash/worker ordering.
      const [code] = [...cell.classes.entries()]
        .sort(([leftCode, leftCount], [rightCode, rightCount]) => rightCount - leftCount || leftCode - rightCode)[0]
      const entry = worldCoverClass(code)
      return {
        type: 'Feature',
        properties: {
          grid_id: gridId,
          class_code: entry.code,
          class_label: entry.label,
          vegetated: entry.vegetated,
          year: 2021,
        },
        geometry: { type: 'Polygon', coordinates: rectangleForIndex(cell.xIndex, cell.yIndex, cellSize) },
      }
    })
    .sort((left, right) => left.properties.grid_id.localeCompare(right.properties.grid_id))
}

function compareCoordinates(left, right) {
  return left[0] - right[0] || left[1] - right[1]
}

function canonicalRing(ring) {
  if (ring.length < 2) return ring
  const open = ring.slice(0, -1)
  let first = 0
  for (let index = 1; index < open.length; index++) {
    if (compareCoordinates(open[index], open[first]) < 0) first = index
  }
  const rotated = [...open.slice(first), ...open.slice(0, first)]
  return [...rotated, rotated[0]]
}

function canonicalPolygon(polygon) {
  if (polygon.length === 0) return polygon
  const outer = canonicalRing(polygon[0])
  const holes = polygon.slice(1).map(canonicalRing).sort((left, right) => compareCoordinates(left[0], right[0]))
  return [outer, ...holes]
}

function canonicalGeometry(geometry) {
  const polygonParts = (candidate) => {
    if (candidate.type === 'Polygon') return [candidate.coordinates]
    if (candidate.type === 'MultiPolygon') return candidate.coordinates
    if (candidate.type === 'GeometryCollection') return candidate.geometries.flatMap(polygonParts)
    return []
  }
  const coordinates = polygonParts(geometry)
    .map(canonicalPolygon)
    .filter((polygon) => polygon.length > 0 && polygon[0].length >= 4)
    .sort((left, right) => compareCoordinates(left[0][0], right[0][0]))
  return coordinates.length > 0 ? { type: 'MultiPolygon', coordinates } : null
}

function normalizeClippedGrid(featureCollection) {
  const features = featureCollection.features
    .filter((feature) => feature.geometry && worldCoverClass(feature.properties?.class_code))
    .flatMap((feature) => {
      const geometry = canonicalGeometry(feature.geometry)
      if (!geometry) return []
      return [{
        type: 'Feature',
        properties: {
          grid_id: String(feature.properties.grid_id),
          class_code: Number(feature.properties.class_code),
          class_label: String(feature.properties.class_label),
          vegetated: Boolean(feature.properties.vegetated),
          year: 2021,
        },
        geometry,
      }]
    })
    .sort((left, right) => left.properties.grid_id.localeCompare(right.properties.grid_id))

  return {
    type: 'FeatureCollection',
    name: 'Sri Lanka dominant land-cover class grid',
    source: {
      id: 'esa-worldcover-2021',
      publisher: 'European Space Agency / WorldCover consortium',
      url: 'https://esa-worldcover.org/en/data-access',
      reference_year: 2021,
      product: 'ESA WorldCover 2021 v200',
      license: 'CC BY 4.0',
      attribution: '© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021)',
    },
    method: {
      cell_size_degrees: GRID_DEGREES,
      sample_size_degrees: GRID_SAMPLE_DEGREES,
      aggregation: 'dominant WorldCover class among deterministic nearest-neighbour samples; equal counts use the lower class code',
      clip: 'Sri Lanka district boundaries from public/data/demographics.geojson',
    },
    caveats: [
      'Vegetated is a grouping of categorical WorldCover classes; it is not NDVI, vegetation condition, or a current greenness measurement.',
      'WorldCover 2021 v200 has 76.7% independently validated global overall accuracy; local accuracy varies by class and place.',
      'The 2020 and 2021 WorldCover maps use different algorithm versions and must not be differenced as a clean land-cover change series.',
      'Each coarse cell shows one dominant modeled class and can hide smaller or mixed land-cover patches.',
    ],
    features,
  }
}

export function buildDistrictTable(districts, counts, pixelAreaKm2) {
  const rows = []
  const sorted = [...districts].sort((left, right) => left.id.localeCompare(right.id))
  for (const district of sorted) {
    const byClass = counts.get(district.index) || new Map()
    const classifiedPixels = [...byClass.values()].reduce((sum, count) => sum + count, 0)
    if (classifiedPixels === 0) throw new Error(`No classified WorldCover pixels for ${district.id}`)
    for (const entry of WORLD_COVER_CLASSES) {
      const pixels = byClass.get(entry.code) || 0
      if (pixels === 0) continue
      rows.push({
        geography_id: district.id,
        geography_name: district.name,
        year: 2021,
        class_code: entry.code,
        class_label: entry.label,
        area_km2: rounded(pixels * pixelAreaKm2, 2),
        share_pct: rounded((pixels / classifiedPixels) * 100, 4),
      })
    }
  }

  return {
    schema_version: 1,
    dataset_id: 'land-cover-district',
    country: 'LK',
    source_ids: ['esa-worldcover-2021'],
    vintage: '2021',
    title: 'Land cover by district',
    description: 'Estimated area and share of each observed ESA WorldCover 2021 class within Sri Lanka district boundaries.',
    grain: 'One row per Sri Lanka district and observed WorldCover class.',
    notes: [
      'Source: ESA WorldCover 2021 v200, https://esa-worldcover.org/en/data-access.',
      'Attribution: © ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021). Licensed CC BY 4.0.',
      `Areas are derived on an equal-area ${AREA_PIXEL_METRES} m grid; shares use classified pixels within each district as the denominator.`,
    ],
    caveats: [
      'WorldCover 2021 v200 has 76.7% independently validated global overall accuracy; local accuracy varies by class and place.',
      'Area figures are modeled, resampled estimates rather than cadastral or field-survey measurements.',
      'The 2020 and 2021 products use different algorithm versions and must not be treated as a clean change series.',
    ],
    primary_key: ['geography_id', 'class_code'],
    fields: [
      { id: 'geography_id', role: 'dimension', type: 'string', label: 'District ID' },
      { id: 'geography_name', role: 'dimension', type: 'string', label: 'District' },
      { id: 'year', role: 'dimension', type: 'year', label: 'Reference year' },
      { id: 'class_code', role: 'dimension', type: 'integer', label: 'WorldCover class code' },
      { id: 'class_label', role: 'dimension', type: 'string', label: 'WorldCover class' },
      { id: 'area_km2', role: 'measure', type: 'number', label: 'Estimated class area', unit: 'km²', aggregation: 'sum' },
      { id: 'share_pct', role: 'measure', type: 'number', label: 'Share of classified district area', unit: '%', aggregation: 'none' },
    ],
    rows,
  }
}

async function rasterBytes(path, outputPath) {
  await run('gdal_translate', ['-q', '-of', 'ENVI', '-ot', 'Byte', path, outputPath])
  return new Uint8Array(await readFile(outputPath))
}

function countDistrictClasses(landCover, districtIndex) {
  if (landCover.length !== districtIndex.length) {
    throw new Error(`Raster length mismatch: ${landCover.length} land-cover vs ${districtIndex.length} districts`)
  }
  const counts = new Map()
  for (let index = 0; index < landCover.length; index++) {
    const district = districtIndex[index]
    const code = landCover[index]
    if (district === 0 || code === 0) continue
    if (!worldCoverClass(code)) throw new Error(`Unknown WorldCover class code ${code}`)
    let byClass = counts.get(district)
    if (!byClass) {
      byClass = new Map()
      counts.set(district, byClass)
    }
    byClass.set(code, (byClass.get(code) || 0) + 1)
  }
  return counts
}

async function build(options) {
  if (!existsSync(options.districtsPath)) throw new Error(`Missing district cutline: ${options.districtsPath}`)
  await requireGdal()
  const districtsGeojson = JSON.parse(await readFile(options.districtsPath, 'utf8'))
  if (districtsGeojson.type !== 'FeatureCollection' || districtsGeojson.features?.length !== 25) {
    throw new Error('District cutline must be a 25-feature GeoJSON FeatureCollection')
  }
  const districts = districtsGeojson.features.map((feature) => ({
    index: Number(String(feature.properties?.id || '').replace(/^LK-/, '')),
    id: String(feature.properties?.id || ''),
    name: String(feature.properties?.name || ''),
  }))
  if (districts.some((district) => !Number.isSafeInteger(district.index) || !district.id || !district.name)) {
    throw new Error('Every district cutline feature needs a numeric LK-* id and name')
  }
  const tiles = await resolveTiles(options.sourceDir, options.cacheDir)
  const workDir = await mkdtemp(join(tmpdir(), 'developing-country-worldcover-'))
  console.log(`Working in ${workDir}`)
  try {
    // The source boundary includes a few self-intersecting rings. Repair them
    // once with GDAL before any clipping/rasterization; retain the 25 district
    // features and their stable IDs rather than mutating the tracked source.
    const validDistricts = join(workDir, 'districts-valid.gpkg')
    await run('ogr2ogr', [
      '-q', '-overwrite', '-f', 'GPKG', '-makevalid', '-nlt', 'MULTIPOLYGON',
      '-nln', 'districts', validDistricts, options.districtsPath,
    ])

    const mosaic = join(workDir, 'worldcover.vrt')
    const sampleRaster = join(workDir, 'grid-samples.tif')
    const rawGrid = join(workDir, 'grid-raw.geojson')
    const clippedGrid = join(workDir, 'grid-clipped.geojson')
    const areaRaster = join(workDir, 'land-cover-100m.tif')
    const indexedDistricts = join(workDir, 'district-index.gpkg')
    const districtRaster = join(workDir, 'district-index.tif')

    await run('gdalbuildvrt', ['-q', '-overwrite', '-srcnodata', '0', '-vrtnodata', '0', mosaic, ...tiles])

    await run('gdalwarp', [
      // Nearest-neighbour samples preserve the categorical codes. Dominance and
      // deterministic tie-breaking happen in JavaScript below.
      '-q', '-overwrite',
      '-t_srs', 'EPSG:4326', '-r', 'near', '-tr', String(GRID_SAMPLE_DEGREES), String(GRID_SAMPLE_DEGREES), '-tap',
      '-cutline', validDistricts, '-crop_to_cutline', '-dstnodata', '0', '-ot', 'Byte',
      '-co', 'COMPRESS=ZSTD', '-co', 'TILED=YES', mosaic, sampleRaster,
    ])
    const sampleInfo = JSON.parse(await run('gdalinfo', ['-json', sampleRaster], { capture: true }))
    const [sampleWidth, sampleHeight] = sampleInfo.size
    const sampleBytes = await rasterBytes(sampleRaster, join(workDir, 'grid-samples.bin'))
    const rawFeatures = gridFeaturesFromRaster(
      sampleBytes,
      sampleWidth,
      sampleHeight,
      sampleInfo.geoTransform,
    )
    await writeFile(rawGrid, JSON.stringify({ type: 'FeatureCollection', features: rawFeatures }))
    await run('ogr2ogr', [
      '-q', '-overwrite', '-f', 'GeoJSON', '-clipsrc', validDistricts,
      '-makevalid', '-nlt', 'PROMOTE_TO_MULTI',
      '-lco', 'RFC7946=YES', '-lco', 'COORDINATE_PRECISION=6',
      clippedGrid, rawGrid,
    ])
    const grid = normalizeClippedGrid(JSON.parse(await readFile(clippedGrid, 'utf8')))
    if (grid.features.length === 0) throw new Error('Clipped land-cover grid is empty')

    await run('gdalwarp', [
      '-q', '-overwrite', '-multi', '-wo', 'NUM_THREADS=ALL_CPUS',
      '-t_srs', 'EPSG:6933', '-r', 'mode', '-tr', String(AREA_PIXEL_METRES), String(AREA_PIXEL_METRES), '-tap',
      '-cutline', validDistricts, '-crop_to_cutline', '-dstnodata', '0', '-ot', 'Byte',
      '-co', 'COMPRESS=ZSTD', '-co', 'TILED=YES', '-co', 'BIGTIFF=IF_SAFER', mosaic, areaRaster,
    ])
    await run('ogr2ogr', [
      '-q', '-overwrite', '-f', 'GPKG', '-dialect', 'sqlite',
      '-sql', "SELECT *, CAST(substr(id, 4) AS INTEGER) AS district_index FROM districts",
      '-t_srs', 'EPSG:6933', '-nln', 'districts', indexedDistricts, validDistricts,
    ])
    const rasterInfo = JSON.parse(await run('gdalinfo', ['-json', areaRaster], { capture: true }))
    const [width, height] = rasterInfo.size
    const [originX, pixelWidth, , originY, , pixelHeight] = rasterInfo.geoTransform
    const maxX = originX + width * pixelWidth
    const minY = originY + height * pixelHeight
    await run('gdal_rasterize', [
      '-q', '-a', 'district_index', '-init', '0', '-a_nodata', '0', '-ot', 'Byte', '-a_srs', 'EPSG:6933',
      '-te', String(originX), String(minY), String(maxX), String(originY),
      '-ts', String(width), String(height),
      '-co', 'COMPRESS=ZSTD', '-co', 'TILED=YES', indexedDistricts, districtRaster,
    ])

    const [landBytes, districtBytes] = await Promise.all([
      rasterBytes(areaRaster, join(workDir, 'land-cover.bin')),
      rasterBytes(districtRaster, join(workDir, 'district-index.bin')),
    ])
    if (landBytes.length !== width * height) {
      throw new Error(`Unexpected raw raster size ${landBytes.length}; wanted ${width * height}`)
    }
    const counts = countDistrictClasses(landBytes, districtBytes)
    const table = buildDistrictTable(districts, counts, (AREA_PIXEL_METRES ** 2) / 1_000_000)

    await mkdir(dirname(options.gridPath), { recursive: true })
    await mkdir(dirname(options.tablePath), { recursive: true })
    await writeFile(options.gridPath, `${JSON.stringify(grid)}\n`)
    await writeFile(options.tablePath, `${JSON.stringify(table)}\n`)

    const [gridStat, tableStat] = await Promise.all([stat(options.gridPath), stat(options.tablePath)])
    console.log(`Wrote ${options.gridPath}: ${grid.features.length} cells, ${(gridStat.size / 1_048_576).toFixed(2)} MiB`)
    console.log(`Wrote ${options.tablePath}: ${table.rows.length} rows, ${(tableStat.size / 1024).toFixed(1)} KiB`)
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}

if (import.meta.main) {
  build(parseArgs(process.argv.slice(2))).catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
