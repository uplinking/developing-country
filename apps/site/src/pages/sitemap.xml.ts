import type { APIContext } from 'astro'
import { publishedEntries } from '../lib/cmsCollections'
import { articleFields, countryFields } from '../lib/content'
import { sitemapEntries, sitemapXml } from '../lib/sitemap'

export const prerender = false

/** Replaces EmDash's injected sitemap index, whose /<collection>/<slug> URLs all 404 here. */
export async function GET(context: APIContext) {
  const [articles, countries] = await Promise.all([publishedEntries('articles'), publishedEntries('countries')])
  const entries = sitemapEntries(
    articles.map((entry) => ({ id: entry.id, data: articleFields(entry.data) })),
    countries.map((entry) => {
      const updated = (entry.data as { updatedAt?: unknown }).updatedAt
      return { code: countryFields(entry.data).code, updatedAt: updated instanceof Date ? updated : undefined }
    }),
  )
  return new Response(sitemapXml(context.site?.href ?? 'https://developing-country.org', entries), {
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  })
}
