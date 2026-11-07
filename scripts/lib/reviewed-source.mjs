import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseIndicatorTable } from '../../packages/datasets/src/table.ts'

export const sha256 = value => createHash('sha256').update(value).digest('hex')
export const dim = (id, type, label) => ({ id, type, label, role: 'dimension' })
export const measure = (id, label, unit) => ({ id, type: 'number', label, unit, role: 'measure', aggregation: 'none' })
export function invariant(condition, message) { if (!condition) throw new Error(`Reviewed-source integrity error: ${message}`) }
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  // oxlint-disable-next-line strict-types/no-runtime-typeof -- Canonical JSON serialization must distinguish primitive values from object containers.
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  return value
}
export const evidenceFields = [dim('record_id', 'string', 'Observation ID'), dim('source_id', 'string', 'Source ID'), dim('source_url', 'string', 'Original source'), dim('source_sha256', 'string', 'Original file SHA-256'), dim('source_locator', 'string', 'Source cell or page'), dim('review_note', 'string', 'Review note')]
export function evidence(source, locator, note = null) {
  return { source_id: source.sourceId, source_url: source.url, source_sha256: source.sha256, source_locator: locator, review_note: note }
}
export function writeTables(tables, directory, check = false) {
  mkdirSync(directory, { recursive: true })
  const outputs = tables.map(raw => {
    const table = parseIndicatorTable({ schema_version: 1, country: 'LK', ...raw })
    const output = JSON.stringify(canonical(table), null, 2) + '\n'
    const file = join(directory, `${table.dataset_id}.json`)
    return { table, output, file }
  })
  for (const { table, output, file } of outputs) {
    if (check) invariant(readFileSync(file, 'utf8') === output, `${table.dataset_id} differs from reviewed inputs`)
    else writeFileSync(file, output)
    console.log(`${table.dataset_id}: ${table.rows.length} observations${check ? ' verified' : ''}`)
  }
}
export function readSource(source, directory, fetchRemote = false) {
  mkdirSync(directory, { recursive: true })
  const path = join(directory, source.file)
  if (fetchRemote) {
    const result = Bun.spawnSync(['curl', '--max-time', '60', '--retry', '1', '-fsSL', '-A', 'Mozilla/5.0', source.url, '-o', path])
    invariant(result.exitCode === 0, `fetch failed for ${source.sourceId}: ${new TextDecoder().decode(result.stderr).slice(-300)}`)
  }
  const bytes = readFileSync(path)
  invariant(sha256(bytes) === source.sha256, `${source.sourceId} changed; review the new publication before updating its hash or cells`)
  return { path, bytes }
}
export function pdfPages(path) {
  const result = Bun.spawnSync(['pdftotext', '-layout', path, '-'])
  invariant(result.exitCode === 0, `pdftotext failed for ${path}`)
  return new TextDecoder().decode(result.stdout).split('\f')
}
