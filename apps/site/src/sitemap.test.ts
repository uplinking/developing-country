import { describe, expect, test } from 'bun:test'
import { articleFields } from './lib/content'
import { sitemapEntries, sitemapXml } from './lib/sitemap'

const article = (id: string, data: Record<string, unknown>) => ({ id, data: articleFields({ id, title: id, updatedAt: '2026-10-21T00:00:00Z', ...data }) })

describe('sitemapEntries', () => {
  const entries = sitemapEntries(
    [
      article('how-far', { format: 'analysis', analysis_kind: 'essay' }),
      article('claim', { format: 'analysis', analysis_kind: 'tracked_claim' }),
      article('workplaces', { format: 'dataset_note' }),
    ],
    [{ code: 'LK' }],
  )
  const paths = entries.map((entry) => entry.path)

  test('puts each entry at the route that serves it', () => {
    expect(paths).toContain('/analysis/how-far')
    expect(paths).toContain('/data/workplaces')
    expect(paths).toContain('/countries/lk')
  })

  test('leaves out tracked claims, which only redirect, and the collection fallback URLs', () => {
    expect(paths.some((path) => path.includes('claim'))).toBe(false)
    expect(paths.some((path) => path.startsWith('/articles/'))).toBe(false)
  })

  test('dates the listing pages by their newest entry', () => {
    expect(entries.find((entry) => entry.path === '/analysis')?.lastmod?.toISOString()).toBe('2026-10-21T00:00:00.000Z')
  })
})

describe('sitemapXml', () => {
  test('writes absolute, escaped URLs', () => {
    const xml = sitemapXml('https://developing-country.org/', [{ path: '/data/a&b' }])
    expect(xml).toContain('<loc>https://developing-country.org/data/a&amp;b</loc>')
    expect(xml.startsWith('<?xml')).toBe(true)
  })
})
