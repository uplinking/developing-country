// Data-refresh engine — the deterministic half of the `refresh-data` skill.
// The source registry is the single source of truth for human, agent, and CI
// refresh decisions. A due state requests review; it never changes evidence.
//
//   bun scripts/refresh.mjs list [--as-of YYYY-MM-DD]
//   bun scripts/refresh.mjs due [--scheduled] [--ids|--json] [--as-of YYYY-MM-DD]
//   bun scripts/refresh.mjs stale [days]     # backwards-compatible due report
//   bun scripts/refresh.mjs run <id>
//   bun scripts/refresh.mjs touch <id> [YYYY-MM-DD]

import { execSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { freshnessOf, refreshedPeriod, refreshKind } from '../src/shared/freshness.ts'

const CATALOGUE = new URL('./data-sources.json', import.meta.url)
const load = async () => JSON.parse(await readFile(CATALOGUE, 'utf8'))
const today = () => new Date().toISOString().slice(0, 10)

function fail(message) {
  console.error(message)
  process.exit(1)
}

function find(cat, id) {
  const source = cat.sources.find((candidate) => candidate.id === id)
  if (!source) fail(`Unknown source id: ${id}\nKnown: ${cat.sources.map((candidate) => candidate.id).join(', ')}`)
  return source
}

function option(args, name) {
  const index = args.indexOf(name)
  if (index < 0) return undefined
  const value = args[index + 1]
  if (!value || value.startsWith('--')) fail(`${name} requires a value`)
  return value
}

function stateFor(source, cat, assessedAt, threshold) {
  const candidate = threshold == null ? source : { ...source, freshness_days: threshold }
  return freshnessOf(candidate, cat.freshness_policy, assessedAt)
}

function rowsFor(cat, assessedAt, threshold) {
  return cat.sources
    .map((source) => ({ source, freshness: stateFor(source, cat, assessedAt, threshold) }))
    .sort((a, b) => (b.freshness.age_days ?? -1) - (a.freshness.age_days ?? -1))
}

function printRow({ source, freshness }) {
  const age = freshness.age_days == null ? '?' : `${freshness.age_days}d`
  const schedule = freshness.scheduled ? 'yes' : 'no'
  console.log(
    `  ${source.id.padEnd(16)} ${String(source.refreshed).padEnd(11)} ${age.padStart(6)}  ${freshness.status.padEnd(7)} ${freshness.kind.padEnd(9)} ${schedule.padEnd(3)}  ${source.name}`,
  )
}

function printTable(rows) {
  console.log(`\n  ${'id'.padEnd(16)} ${'refreshed'.padEnd(11)} ${'age'.padStart(6)}  ${'state'.padEnd(7)} ${'kind'.padEnd(9)} job  source`)
  console.log(`  ${'─'.repeat(94)}`)
  rows.forEach(printRow)
  if (rows.length === 0) console.log('  (none)')
  console.log(`\n  ${rows.length} source(s). Freshness is review urgency, not evidence validity.\n`)
}

const [command, ...args] = process.argv.slice(2)
const cat = await load()

if (command === 'list' || command === 'due' || command === 'stale') {
  const assessedAt = option(args, '--as-of') ?? today()
  const assessedTimestamp = Date.parse(`${assessedAt}T00:00:00.000Z`)
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(assessedAt) || Number.isNaN(assessedTimestamp) ||
    new Date(assessedTimestamp).toISOString().slice(0, 10) !== assessedAt
  ) {
    fail('--as-of must be a valid YYYY-MM-DD date')
  }
  const positional = args.filter((arg, index) => !arg.startsWith('--') && args[index - 1] !== '--as-of')
  const legacyThreshold = command === 'stale' && positional[0] != null ? Number(positional[0]) : undefined
  if (legacyThreshold != null && (!Number.isInteger(legacyThreshold) || legacyThreshold < 1)) {
    fail('stale days must be a positive integer')
  }

  let rows = rowsFor(cat, assessedAt, legacyThreshold)
  if (command !== 'list') rows = rows.filter(({ freshness }) => freshness.status === 'due' || freshness.status === 'overdue')
  if (args.includes('--scheduled')) rows = rows.filter(({ freshness }) => freshness.scheduled)

  if (args.includes('--ids')) {
    for (const { source } of rows) console.log(source.id)
  } else if (args.includes('--json')) {
    console.log(JSON.stringify(rows.map(({ source, freshness }) => ({
      id: source.id,
      name: source.name,
      refreshed_at: source.refreshed,
      freshness,
    })), null, 2))
  } else {
    printTable(rows)
  }
} else if (command === 'run') {
  const id = args[0]
  if (!id) fail('usage: refresh.mjs run <id>')
  const source = find(cat, id)
  const kind = refreshKind(source)
  if (kind !== 'automated') {
    console.log(`\n  ${source.id} is ${kind.toUpperCase()} — no automated pull.\n`)
    if (kind === 'curated') {
      console.log('  Re-verify the records against the primary source:')
      console.log(`    source     : ${source.url}`)
      console.log(`    datasets  : ${(source.layers || []).join(', ')}`)
      console.log(`    instruction: ${source.refresh}`)
      console.log(`\n  After a real verification: bun scripts/refresh.mjs touch ${source.id}\n`)
    }
    process.exit(0)
  }
  if (!String(source.refresh).startsWith('bun ')) fail(`Refusing non-Bun refresh command for ${source.id}`)
  console.log(`\n  ▶ ${source.name}\n    ${source.refresh}\n`)
  execSync(source.refresh, { stdio: 'inherit' })
  console.log(`\n  ✓ refresh command succeeded. Review the diff before touching ${source.id}.\n`)
} else if (command === 'touch') {
  const id = args[0]
  if (!id) fail('usage: refresh.mjs touch <id> [YYYY-MM-DD]')
  const source = find(cat, id)
  const date = args[1] || today()
  const period = refreshedPeriod(date)
  const current = Date.parse(`${today()}T00:00:00.000Z`)
  if (!period || period.start > current) fail(`bad date: ${date}`)
  source.refreshed = date
  await writeFile(CATALOGUE, `${JSON.stringify(cat, null, 2)}\n`)
  console.log(`  ✓ ${source.id} last-refreshed → ${date}`)
  console.log('    Rebuild Dataset Versions after reviewing the refreshed artifacts.')
} else {
  console.log(`refresh — data provenance engine

  bun scripts/refresh.mjs list [--as-of YYYY-MM-DD]
  bun scripts/refresh.mjs due [--scheduled] [--ids|--json] [--as-of YYYY-MM-DD]
  bun scripts/refresh.mjs stale [days]
  bun scripts/refresh.mjs run <id>
  bun scripts/refresh.mjs touch <id> [YYYY-MM-DD]
`)
}
