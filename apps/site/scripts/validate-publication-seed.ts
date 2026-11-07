import { readFileSync } from 'node:fs'
import { publicationIssues } from '../src/publicationEvidence'

const seed = JSON.parse(readFileSync(new URL('../seed/seed.json', import.meta.url), 'utf8')) as {
  content?: { articles?: Array<{ id?: string; status?: string; data?: unknown }> }
}

let failed = false
for (const article of seed.content?.articles ?? []) {
  if (article.status !== 'published' && (article.data as { analysis_kind?: string })?.analysis_kind !== 'tracked_claim') continue
  for (const issue of publicationIssues(article.data)) {
    failed = true
    console.error(`publication-seed: ${article.id ?? '(unknown)'}.${issue.path}: ${issue.message}`)
  }
}
if (failed) process.exit(1)
console.log('publication-seed: ok — every seeded published Research Article passes the evidence gate')
