import type { ArticleFields } from './content'

export interface SitemapEntry {
  path: string
  lastmod?: Date
}

/** Pages that are not CMS entries but are worth indexing. */
export const STATIC_PATHS = ['/', '/analysis', '/data', '/initiatives', '/about', '/connect', '/privacy', '/terms'] as const

/**
 * Every public URL, at the route that actually serves it. EmDash's own sitemap builds
 * `/<collection>/<slug>`, which matches none of ours: essays live at /analysis, dataset notes at
 * /data, countries at their code, and tracked claims only redirect, so they are left out.
 */
export function sitemapEntries(
  articles: Array<{ id: string; data: ArticleFields }>,
  countries: Array<{ code: string; updatedAt?: Date }>,
): SitemapEntry[] {
  const newest = (dates: Array<Date | undefined>) => dates.reduce<Date | undefined>((a, b) => (b && (!a || b > a) ? b : a), undefined)
  const essays = articles.filter((entry) => entry.data.format === 'analysis' && entry.data.analysisKind === 'essay')
  const notes = articles.filter((entry) => entry.data.format === 'dataset_note')
  const lastmods: Record<string, Date | undefined> = {
    '/': newest(articles.map((entry) => entry.data.updatedAt)),
    '/analysis': newest(essays.map((entry) => entry.data.updatedAt)),
    '/data': newest(notes.map((entry) => entry.data.updatedAt)),
  }
  return [
    ...STATIC_PATHS.map((path) => ({ path, lastmod: lastmods[path] })),
    ...countries.map((country) => ({ path: `/countries/${country.code.toLowerCase()}`, lastmod: country.updatedAt })),
    ...essays.map((entry) => ({ path: `/analysis/${entry.id}`, lastmod: entry.data.updatedAt })),
    ...notes.map((entry) => ({ path: `/data/${entry.id}`, lastmod: entry.data.updatedAt })),
  ]
}

const escapeXml = (value: string) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!)

export function sitemapXml(origin: string, entries: SitemapEntry[]): string {
  const urls = entries.map((entry) => {
    const lastmod = entry.lastmod && entry.lastmod.getTime() > 0 ? `<lastmod>${entry.lastmod.toISOString()}</lastmod>` : ''
    return `  <url><loc>${escapeXml(new URL(entry.path, origin).href)}</loc>${lastmod}</url>`
  })
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`
}
