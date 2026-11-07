#!/usr/bin/env bun
// Build an interactive analysis article from a recipe, through the public MCP.
//
//   bun scripts/analysis-article.ts analysis/<slug>                     # local platform (wrangler dev, DEV_AUTH)
//   bun scripts/analysis-article.ts analysis/<slug> --mcp https://explore.developing-country.org/mcp
//   bun scripts/analysis-article.ts analysis/<slug> --refresh           # re-save every view
//   bun scripts/analysis-article.ts analysis/<slug> --revoke-replaced   # also revoke views this run supersedes
//   bun scripts/analysis-article.ts analysis/<slug> --submit http://localhost:4321/_emdash/api/mcp
//
// recipe.json  { figures: { <key>: <query_data arguments with presentation> } }
// article.json { slug, fields: { title, dek, research_question, methodology, … }, primary_view?, content: [...] }
//
// Every figure is saved as an immutable Data View by query_data (ADR 0002), so
// the article stores only view URLs (ADR 0003). The evidence bundle and source
// manifest are assembled from the `publication` blocks query_data returns —
// never typed by hand — and the draft is checked by the same validator the CMS
// publication gate uses before anything is submitted. Saved views are cached
// per MCP origin in out/<host>/views.json, so a re-run is idempotent and does
// not spend the view quota; --refresh re-saves them.
//
// Bearer tokens come from the environment only: PLATFORM_MCP_TOKEN for the
// platform MCP, CMS_MCP_TOKEN for --submit. Without a platform token the local
// DEV_AUTH identity is used (X-Dev-User).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { publicationIssues } from '../apps/site/src/publicationEvidence'

interface Publication {
  dataView: { viewUrl: string; queryId: string; resultChecksum: string }
  datasetVersions: Array<Record<string, unknown> & { datasetId: string; versionId: string }>
  sourceManifest: Array<{ sourceId: string; title: string; url: string }>
  unresolvedSourceIds?: string[]
}

interface Recipe {
  figures: Record<string, Record<string, unknown>>
}

type SourceBlock =
  | string
  | { h2: string }
  | { h3: string }
  | ({
      _type: string
      view?: string
      /** Recipe keys of map views drawn beneath the main view. */
      underlay?: string[]
      steps?: Array<Record<string, unknown> & { view?: string; underlay?: string[] }>
    } & Record<string, unknown>)

interface ArticleSource {
  slug: string
  fields: Record<string, unknown>
  primary_view?: string
  taxonomies?: Record<string, string[]>
  content: SourceBlock[]
}

const argv = process.argv.slice(2)
const dir = argv.find((a) => !a.startsWith('--'))
if (!dir) {
  console.error('usage: bun scripts/analysis-article.ts <analysis dir> [--mcp url] [--refresh] [--submit cms-mcp-url]')
  process.exit(2)
}
const flag = (name: string) => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}
const mcpUrl = flag('--mcp') ?? 'http://localhost:8787/mcp'
const submitUrl = flag('--submit')
const refresh = argv.includes('--refresh')
// Superseded views are kept unless asked: a published article may still pin them.
const revokeReplaced = argv.includes('--revoke-replaced')

const root = resolve(dir)
const recipe = JSON.parse(readFileSync(join(root, 'recipe.json'), 'utf8')) as Recipe
const article = JSON.parse(readFileSync(join(root, 'article.json'), 'utf8')) as ArticleSource
const outDir = join(root, 'out', new URL(mcpUrl).host.replace(/[^a-z0-9.-]/gi, '_'))
mkdirSync(outDir, { recursive: true })
const cachePath = join(outDir, 'views.json')
const previous: Record<string, { args: string; publication: Publication }> =
  existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : {}
const cache: Record<string, { args: string; publication: Publication }> = refresh ? {} : { ...previous }

// ---- MCP client -------------------------------------------------------------

async function mcpCall(url: string, token: string | undefined, name: string, args: Record<string, unknown>) {
  const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }
  if (token) headers.authorization = `Bearer ${token}`
  else headers['x-dev-user'] = 'analysis@developing-country.org'
  const rpc = async (id: number, method: string, params: unknown) => {
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) })
    const text = await response.text()
    const json = text.startsWith('event:') || text.startsWith('data:')
      ? JSON.parse(text.split('\n').find((line) => line.startsWith('data:'))!.slice(5))
      : JSON.parse(text)
    if (json.error) throw new Error(`${method}: ${JSON.stringify(json.error)}`)
    return json.result
  }
  await rpc(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'analysis-article', version: '1' } })
  const result = await rpc(2, 'tools/call', { name, arguments: args })
  const body = result.structuredContent ?? JSON.parse(result.content?.[0]?.text ?? '{}')
  if (result.isError) throw new Error(`${name} failed: ${JSON.stringify(body).slice(0, 1500)}`)
  return body
}

/** Revoke a superseded view on the platform that saved it (owner-only REST call). */
async function revokeView(viewUrl: string): Promise<void> {
  const url = new URL(viewUrl)
  const id = url.pathname.split('/').pop()
  const headers: Record<string, string> = {}
  if (process.env.PLATFORM_MCP_TOKEN) headers.authorization = `Bearer ${process.env.PLATFORM_MCP_TOKEN}`
  else headers['x-dev-user'] = 'analysis@developing-country.org'
  const response = await fetch(`${new URL(mcpUrl).origin}/api/views/${id}/revoke`, { method: 'POST', headers })
  console.log(response.ok ? `revoked superseded ${id}` : `could not revoke ${id} (HTTP ${response.status}); revoke it by hand`)
}

// ---- 1. Save every figure as a Data View --------------------------------------

const publications: Record<string, Publication> = {}
for (const [key, args] of Object.entries(recipe.figures)) {
  const signature = JSON.stringify(args)
  const cached = cache[key]
  if (cached && cached.args === signature) {
    publications[key] = cached.publication
    continue
  }
  if (!args.presentation) throw new Error(`figure ${key} has no presentation; every figure must be saved as a view`)
  const body = await mcpCall(mcpUrl, process.env.PLATFORM_MCP_TOKEN, 'query_data', args)
  if (!body.publication) throw new Error(`figure ${key}: query_data returned no publication block`)
  if (body.publication.unresolvedSourceIds?.length) {
    throw new Error(`figure ${key}: sources without an HTTPS registry row: ${body.publication.unresolvedSourceIds.join(', ')}`)
  }
  publications[key] = body.publication
  const replaced = previous[key]?.publication.dataView.viewUrl
  if (revokeReplaced && replaced && replaced !== body.publication.dataView.viewUrl) await revokeView(replaced)
  cache[key] = { args: signature, publication: body.publication }
  writeFileSync(cachePath, `${JSON.stringify(cache, null, 2)}\n`)
  console.log(`saved ${key} → ${body.publication.dataView.viewUrl}${body.warnings ? ` (warnings: ${JSON.stringify(body.warnings)})` : ''}`)
}
for (const key of Object.keys(cache)) if (!recipe.figures[key]) delete cache[key]
writeFileSync(cachePath, `${JSON.stringify(cache, null, 2)}\n`)

const viewUrl = (key: string | undefined, where: string): string => {
  if (!key) throw new Error(`${where} names no view`)
  const publication = publications[key]
  if (!publication) throw new Error(`${where} references unknown figure "${key}"`)
  return publication.dataView.viewUrl
}

// ---- 2. Portable Text ---------------------------------------------------------

let keyCounter = 0
const nextKey = () => `k${(keyCounter++).toString(36).padStart(4, '0')}`

/** Paragraph text with **bold**, *italic* and [links](https://…). */
function spans(text: string): { children: unknown[]; markDefs: unknown[] } {
  const children: unknown[] = []
  const markDefs: unknown[] = []
  const pattern = /\*\*(.+?)\*\*|\*(.+?)\*|\[(.+?)\]\((https:\/\/[^)\s]+)\)/g
  let last = 0
  for (const match of text.matchAll(pattern)) {
    if (match.index! > last) children.push({ _type: 'span', _key: nextKey(), text: text.slice(last, match.index), marks: [] })
    if (match[1]) children.push({ _type: 'span', _key: nextKey(), text: match[1], marks: ['strong'] })
    else if (match[2]) children.push({ _type: 'span', _key: nextKey(), text: match[2], marks: ['em'] })
    else {
      const markKey = nextKey()
      markDefs.push({ _type: 'link', _key: markKey, href: match[4] })
      children.push({ _type: 'span', _key: nextKey(), text: match[3], marks: [markKey] })
    }
    last = match.index! + match[0].length
  }
  if (last < text.length) children.push({ _type: 'span', _key: nextKey(), text: text.slice(last), marks: [] })
  return { children, markDefs }
}

function toPortableText(blocks: SourceBlock[]): unknown[] {
  return blocks.map((block, index) => {
    if (typeof block === 'string') return { _type: 'block', _key: nextKey(), style: 'normal', ...spans(block) }
    if ('h2' in block) return { _type: 'block', _key: nextKey(), style: 'h2', ...spans(block.h2 as string) }
    if ('h3' in block) return { _type: 'block', _key: nextKey(), style: 'h3', ...spans(block.h3 as string) }
    const { view, steps, underlay, ...rest } = block
    const node: Record<string, unknown> = { ...rest, _key: nextKey() }
    if (view !== undefined) node.view_url = viewUrl(view, `content[${index}] ${block._type}`)
    if (underlay?.length) node.underlay_urls = underlay.map((key) => viewUrl(key, `content[${index}].underlay`)).join(', ')
    if (steps) {
      node.steps = steps.map(({ view: stepView, underlay: stepUnderlay, ...step }, stepIndex) => ({
        ...step,
        _key: nextKey(),
        view_url: viewUrl(stepView, `content[${index}].steps[${stepIndex}]`),
        ...(stepUnderlay?.length
          ? { underlay_urls: stepUnderlay.map((key) => viewUrl(key, `content[${index}].steps[${stepIndex}].underlay`)).join(', ') }
          : {}),
      }))
    }
    return node
  })
}

const content = toPortableText(article.content)

// ---- 3. Evidence from the publication blocks ----------------------------------

const used = new Set<string>()
const collect = (block: SourceBlock) => {
  if (typeof block !== 'string' && '_type' in block) {
    if (block.view) used.add(block.view)
    for (const key of block.underlay ?? []) used.add(key)
    for (const step of block.steps ?? []) {
      if (step.view) used.add(step.view)
      for (const key of step.underlay ?? []) used.add(key)
    }
  }
}
article.content.forEach(collect)
if (article.primary_view) used.add(article.primary_view)
const unused = Object.keys(recipe.figures).filter((key) => !used.has(key))
if (unused.length) throw new Error(`figures saved but never used in the article: ${unused.join(', ')}`)

const versions = new Map<string, Record<string, unknown>>()
const sources = new Map<string, { sourceId: string; title: string; url: string }>()
const dataViews = new Map<string, Publication['dataView']>()
for (const key of used) {
  const publication = publications[key]!
  dataViews.set(publication.dataView.viewUrl, publication.dataView)
  for (const version of publication.datasetVersions) {
    const existing = versions.get(version.datasetId)
    if (existing && existing.versionId !== version.versionId) {
      throw new Error(`figures pin two versions of ${version.datasetId}: ${existing.versionId} and ${version.versionId}; re-run with --refresh`)
    }
    versions.set(version.datasetId, version)
  }
  for (const source of publication.sourceManifest) sources.set(source.sourceId, source)
}

const fields = {
  ...article.fields,
  format: 'analysis',
  analysis_kind: 'essay',
  country_code: 'LK',
  content,
  ...(article.primary_view ? { primary_view_url: viewUrl(article.primary_view, 'primary_view') } : {}),
  evidence_bundle: {
    version: 1,
    kind: 'platform-query',
    country: 'LK',
    generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    datasetVersions: [...versions.values()].sort((a, b) => String(a.datasetId).localeCompare(String(b.datasetId))),
    dataViews: [...dataViews.values()],
  },
  source_manifest: [...sources.values()].sort((a, b) => a.sourceId.localeCompare(b.sourceId)),
}

// ---- 4. Validate with the CMS publication gate, then write or submit ------------

const issues = publicationIssues({ ...fields, status: 'published' })
// The gate only accepts canonical production view URLs. A local run is expected
// to fail that one rule; everything else must pass.
const localOrigin = !mcpUrl.startsWith('https://explore.developing-country.org/')
const blocking = issues.filter((issue) => !(localOrigin && /canonical|view url|viewUrl|data view/i.test(JSON.stringify(issue))))
for (const issue of issues) console.log(`${blocking.includes(issue) ? 'BLOCKING' : 'local-only'}: ${JSON.stringify(issue)}`)
if (blocking.length) process.exit(1)

const payload = { collection: 'articles', slug: article.slug, data: fields, ...(article.taxonomies ? { taxonomies: article.taxonomies } : {}) }
writeFileSync(join(outDir, 'article.json'), `${JSON.stringify(payload, null, 2)}\n`)
console.log(`${Object.keys(publications).length} views, ${versions.size} dataset versions, ${sources.size} sources → ${join(outDir, 'article.json')}`)

if (submitUrl) {
  const created = await mcpCall(submitUrl, process.env.CMS_MCP_TOKEN, 'content_create', payload)
  console.log(`submitted draft: ${JSON.stringify(created).slice(0, 300)}`)
}
