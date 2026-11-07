import seed from '../seed/seed.json'
import { allCmsItems } from '../src/lib/cmsPagination'

const urlArgument = process.argv.find((argument) => argument.startsWith('--url='))
const baseUrl = urlArgument?.slice('--url='.length) ?? 'https://developing-country.org'
const apply = process.argv.includes('--apply')

type ListedArticle = { slug?: unknown; status?: unknown }
type ListResponse = { items: ListedArticle[]; nextCursor?: string | null }

async function emdash(args: string[]): Promise<string> {
  const child = Bun.spawn(['bun', 'run', 'emdash', ...args], {
    cwd: import.meta.dir.replace(/\/scripts$/, ''),
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  if (exitCode !== 0) {
    if (stderr) process.stderr.write(stderr)
    throw new Error(`emdash ${args.slice(0, 3).join(' ')} exited with code ${exitCode}`)
  }
  return stdout
}

async function listedArticles(): Promise<ListedArticle[]> {
  return allCmsItems(async (cursor) => JSON.parse(await emdash([
    'content', 'list', 'articles',
    `--url=${baseUrl}`,
    '--limit=100',
    ...(cursor ? [`--cursor=${cursor}`] : []),
    '--json',
  ])) as ListResponse)
}

const notes = seed.content.articles.filter((article) => article.data.format === 'dataset_note')
const existingSlugs = new Set(
  (await listedArticles())
    .map((article) => article.slug)
    .filter((slug): slug is string => typeof slug === 'string'),
)
const missing = notes.filter((article) => !existingSlugs.has(article.slug))

if (!apply) {
  console.log(JSON.stringify({
    baseUrl,
    existing: notes.length - missing.length,
    missing: missing.map((article) => article.slug),
  }, null, 2))
  process.exit(0)
}

for (const article of missing) {
  if (article.status !== 'published') {
    throw new Error(`Refusing to publish seed article ${article.slug}: status is not published`)
  }
  await emdash([
    'content', 'create', 'articles',
    `--url=${baseUrl}`,
    `--slug=${article.slug}`,
    `--data=${JSON.stringify(article.data)}`,
    '--json',
  ])
  console.log(`Published dataset note: ${article.slug}`)
}

const finalArticles = await listedArticles()
const finalPublishedSlugs = new Set(
  finalArticles
    .filter((article) => article.status === 'published')
    .map((article) => article.slug)
    .filter((slug): slug is string => typeof slug === 'string'),
)
const incomplete = notes
  .map((article) => article.slug)
  .filter((slug) => !finalPublishedSlugs.has(slug))

if (incomplete.length > 0) {
  throw new Error(`Dataset notes were not published: ${incomplete.join(', ')}`)
}

console.log(`Dataset note sync complete: ${notes.length} published, ${missing.length} created`)
