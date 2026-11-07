import seed from '../seed/seed.json'

const apply = process.argv.includes('--apply')
const url = process.argv.find((arg) => arg.startsWith('--url='))?.slice(6)
if (!url) throw new Error('Usage: bun scripts/sync-claim-drafts.ts --url=https://developing-country.org [--apply]')
const baseUrl = new URL(url)
if (baseUrl.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(baseUrl.hostname)) throw new Error('CMS URL must be HTTPS')
interface Item { id: string; slug: string; status: string }
async function cms(args: string[]) {
  const child = Bun.spawn(['bun', 'run', 'emdash', ...args, `--url=${url}`, '--json'], { cwd: `${import.meta.dir}/..`, stdout: 'pipe', stderr: 'pipe' })
  const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  if (code) throw new Error(`CMS operation failed: ${err}`)
  return JSON.parse(out)
}
async function list(collection: string): Promise<Item[]> {
  const items: Item[] = []
  let cursor: string | undefined
  do {
    const page = await cms(['content', 'list', collection, '--limit=100', ...(cursor ? [`--cursor=${cursor}`] : [])])
    items.push(...page.items)
    cursor = page.nextCursor
  } while (cursor)
  return items
}
async function create(collection: string, slug: string, data: unknown): Promise<Item> {
  const file = `${import.meta.dir}/.claim-draft-${process.pid}.json`
  await Bun.write(file, JSON.stringify(data))
  try {
    const item = await cms(['content', 'create', collection, `--slug=${slug}`, `--file=${file}`, '--draft']) as Item
    if (!item.id || item.status !== 'draft') throw new Error(`Expected a draft for ${slug}`)
    return item
  } finally { await Bun.file(file).delete() }
}
const gaps = await list('data_gaps')
const claims = await list('articles')
const newGaps = seed.content.data_gaps.filter((gap) => !gaps.some((existing) => existing.slug === gap.slug))
const newClaims = seed.content.articles.filter((article) => 'analysis_kind' in article.data && article.data.analysis_kind === 'tracked_claim' && !claims.some((existing) => existing.slug === article.slug))
console.log(JSON.stringify({ url, apply, missingDataDrafts: newGaps.map((gap) => gap.slug), claimDrafts: newClaims.map((claim) => claim.slug) }, null, 2))
if (!apply) process.exit(0)
// All collection schemas and the publication migration must already be installed.
// Never update an existing editor-owned record, and never auto-publish.
for (const gap of newGaps) gaps.push(await create('data_gaps', gap.slug, gap.data))
for (const article of newClaims) {
  if (!('missing_data' in article.data) || !Array.isArray(article.data.missing_data)) throw new Error('Claim has no gap references')
  const missingData = article.data.missing_data.map((ref) => {
    const seededGap = seed.content.data_gaps.find((gap) => `$ref:${gap.id}` === ref)
    const liveGap = gaps.find((gap) => gap.slug === seededGap?.slug)
    if (!liveGap) throw new Error(`Cannot resolve data gap: ${ref}`)
    return liveGap.id
  })
  await create('articles', article.slug, { ...article.data, missing_data: missingData })
}
console.log('Drafts created with resolved CMS references. Human editors own review and publication.')
