import rss from '@astrojs/rss'
import { getEmDashCollection, getSiteSettings } from 'emdash'
import type { APIContext } from 'astro'
import { articleFields } from '../lib/content'

export async function GET(context: APIContext) {
  const [{ entries: articles }, settings] = await Promise.all([
    getEmDashCollection('articles', { orderBy: { published_at: 'desc' }, limit: 100 }),
    getSiteSettings(),
  ])
  return rss({
    title: settings.title || 'developing-country.org',
    description: settings.tagline || 'Sri Lanka’s public data, brought together and explained.',
    site: context.site || 'https://developing-country.org',
    items: articles.filter((article) => articleFields(article.data).analysisKind !== 'tracked_claim').map((article) => {
      const data = articleFields(article.data)
      return {
        title: data.title,
        description: data.dek || '',
        pubDate: data.publishedAt || data.createdAt,
        link: data.format === 'dataset_note' ? `/data/${article.id}` : `/analysis/${article.id}`,
      }
    }),
  })
}
