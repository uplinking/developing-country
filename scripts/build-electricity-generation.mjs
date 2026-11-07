#!/usr/bin/env bun
// Public NSO API -> archived source responses -> validated, versioned tables.
// No live upstream calls are made by catalogue readers.
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { parseIndicatorTable } from '../packages/datasets/src/table.ts'

const ROOT = resolve(import.meta.dir, '..')
import { SOURCE_ID, POWER_ID, ENERGY_ID, normalizePower, normalizeEnergy, validDate, mergeDates, tableFor } from '../packages/ingestion/src/electricity'
export { POWER_ID, ENERGY_ID, POWER_FIELDS, normalizePower, normalizeEnergy, validDate, mergeDates, tableFor } from '../packages/ingestion/src/electricity'

function writeAtomic(path, value) {
  mkdirSync(resolve(path, '..'), { recursive: true })
  writeFileSync(path + '.tmp', JSON.stringify(value, null, 2) + '\n')
  renameSync(path + '.tmp', path)
}
if (import.meta.main) {
  const arg = (key) => process.argv.find((v) => v.startsWith(`--${key}=`))?.slice(key.length + 3)
  const start = arg('date') || arg('from')
  const end = arg('to') || start
  if (!start || !end || !validDate(start) || !validDate(end) || start > end) throw new Error('Use --date=YYYY-MM-DD or --from=YYYY-MM-DD --to=YYYY-MM-DD (up to 31 days)')
  const count = (Date.parse(end) - Date.parse(start)) / 86400000 + 1
  if (count > 31) throw new Error('Backfill in batches of at most 31 days')
  const output = resolve(arg('output-dir') || join(ROOT, 'public/data'))
  const sourceDir = arg('source-dir')
  const batches = { [POWER_ID]: [], [ENERGY_ID]: [] }
  const archive = []
  for (let day = 0; day < count; day++) {
    const date = new Date(Date.parse(start) + day * 86400000).toISOString().slice(0, 10)
    for (const [endpoint, id, normalize] of [['load-curve', POWER_ID, normalizePower], ['energy-data', ENERGY_ID, normalizeEnergy]]) {
      const url = `https://edlcare.edl.lk/api/gensum/${endpoint}?date=${date}`
      let body
      if (sourceDir) body = readFileSync(join(sourceDir, `${endpoint}-${date}.json`), 'utf8')
      else {
        const response = await fetch(url, { signal: AbortSignal.timeout(25000), headers: { 'User-Agent': 'developing-country.org public-data ingestion' } })
        if (!response.ok) throw new Error(`${response.status} from ${url}`)
        body = await response.text()
      }
      const payload = JSON.parse(body)
      batches[id].push(normalize(payload, date))
      archive.push({ date, endpoint, url, body, checksum: createHash('sha256').update(body).digest('hex') })
    }
  }
  // Validate the whole batch before replacing any served data.
  const tables = Object.entries(batches).map(([id, rows]) => {
    const path = join(output, `${id}.json`)
    const oldRows = existsSync(path) ? parseIndicatorTable(JSON.parse(readFileSync(path, 'utf8'))).rows : []
    return tableFor(id, mergeDates(oldRows, rows))
  })
  const retrievedAt = new Date().toISOString()
  for (const item of archive) {
    const dir = join(ROOT, 'data/sources/nso-generation', item.date)
    mkdirSync(dir, { recursive: true })
    const path = join(dir, `${item.endpoint}.${item.checksum}.json`)
    if (!existsSync(path)) {
      writeFileSync(path, item.body)
      writeAtomic(path.replace(/\.json$/, '.provenance.json'), { url: item.url, checksum: `sha256:${item.checksum}`, retrievedAt, reportDate: item.date })
    }
  }
  for (const table of tables) {
    writeAtomic(join(output, `${table.dataset_id}.json`), table)
    console.log(`${table.dataset_id}: ${table.rows.length} rows, ${table.vintage}`)
  }
  if (!arg('output-dir')) {
    const path = join(ROOT, 'scripts/data-sources.json')
    const registry = JSON.parse(readFileSync(path, 'utf8'))
    const source = registry.sources.find((source) => source.id === SOURCE_ID)
    if (!source) throw new Error('Register nso-generation-api before running ingestion')
    source.refreshed = retrievedAt.slice(0, 10)
    source.vintage = tables[0].vintage
    writeAtomic(path, registry)
  }
}
