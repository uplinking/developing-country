// Snapshot World Bank projects for Sri Lanka (official lender-side approvals).
// Idempotent: rewrites scripts/initiatives/world-bank.json only after validating the response.
//   bun scripts/initiatives/fetch-world-bank.ts
import { writeFile, rename } from 'node:fs/promises'

const FIELDS = ['id', 'project_name', 'boardapprovaldate', 'closingdate', 'status', 'curr_total_commitment',
  'curr_ibrd_commitment', 'curr_ida_commitment', 'grantamt']
const url = `https://search.worldbank.org/api/v3/projects?format=json&countrycode_exact=LK&rows=500&fl=${FIELDS.join(',')}`
const res = await fetch(url, { headers: { 'User-Agent': 'developing-country-money-tracker' }, signal: AbortSignal.timeout(60_000) })
if (!res.ok) throw new Error(`World Bank API ${res.status}`)
const body = await res.json() as { total: string; projects: Record<string, Record<string, unknown>> }
const projects = Object.values(body.projects ?? {})
if (projects.length < 100 || projects.length !== Number(body.total)) throw new Error(`Unexpected World Bank project count ${projects.length} of ${body.total}`)
for (const p of projects) {
  if (typeof p.id !== 'string' || !/^P\d+$/.test(p.id) || typeof p.project_name !== 'string') throw new Error(`Malformed project ${JSON.stringify(p).slice(0, 120)}`)
}
const trimmed = projects
  .map(p => Object.fromEntries(FIELDS.filter(f => p[f] != null).map(f => [f, p[f]])))
  .sort((a, b) => String(a.id).localeCompare(String(b.id)))
const out = { schema_version: 1, source: 'https://search.worldbank.org/api/v3/projects', retrieved: new Date().toISOString().slice(0, 10), total: projects.length, projects: trimmed }
const path = 'scripts/initiatives/world-bank.json'
await writeFile(`${path}.tmp`, JSON.stringify(out, null, 1) + '\n')
await rename(`${path}.tmp`, path)
console.log(`World Bank: ${projects.length} Sri Lanka projects`)
