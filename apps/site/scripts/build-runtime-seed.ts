#!/usr/bin/env bun
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const sourcePath = resolve(import.meta.dir, '../seed/seed.json')
const runtimePath = resolve(import.meta.dir, '../seed/runtime.json')
const check = process.argv.includes('--check')
const source = JSON.parse(readFileSync(sourcePath, 'utf8')) as {
  content?: { articles?: Array<{ data?: { format?: string } }>; [key: string]: unknown }
  [key: string]: unknown
}
const content = source.content ?? {}
const articles = (content.articles ?? []).filter((article) => article.data?.format !== 'dataset_note')
const runtime = `${JSON.stringify({
  ...source,
  content: { ...content, articles },
}, null, 2)}\n`

if (check) {
  let actual = ''
  try { actual = readFileSync(runtimePath, 'utf8') } catch {}
  if (actual !== runtime) {
    console.error('runtime-seed: seed/runtime.json is stale; run bun run --cwd apps/site seed:runtime')
    process.exit(1)
  }
  console.log(`runtime-seed: ok — ${articles.length} non-dataset article(s); dataset notes stay in the operational seed`)
} else {
  writeFileSync(runtimePath, runtime)
  console.log(`runtime-seed: wrote ${articles.length} non-dataset article(s) to ${runtimePath}`)
}
