// Refresh scripts/initiatives/coverage.json week counts from the pinned lk_news index, so the page
// can tell a quiet week from a week we collected little news for. Idempotent.
//   bun scripts/initiatives/coverage.ts
import { readFile, writeFile, rename } from 'node:fs/promises'
import { loadIndex, pinRevision, weeklyCounts } from './lknews'

const path = 'scripts/initiatives/coverage.json'
const sha = await pinRevision()
const rows = await loadIndex(sha)
const prev = JSON.parse(await readFile(path, 'utf8'))
const weeks = weeklyCounts(rows, '2023-01-02')
if (Object.keys(weeks).length < 100) throw new Error('Coverage collapsed; refusing to write')
const out = { schema_version: 1, upstream: `nuuuwan/lk_news@${sha}`, read_to: prev.read_to, weeks }
await writeFile(`${path}.tmp`, JSON.stringify(out) + '\n')
await rename(`${path}.tmp`, path)
console.log(`coverage: ${Object.keys(weeks).length} weeks from lk_news@${sha.slice(0, 7)}`)
