import { describe, expect, test } from 'bun:test'
import { ROBOTS_TXT, robotsResponse } from './robots'

describe('robots.txt', () => {
  test('keeps filtered and searched listings out of crawls', () => {
    for (const rule of ['Disallow: /data?', 'Disallow: /analysis?', 'Disallow: /*?', 'Disallow: /_emdash/']) {
      expect(ROBOTS_TXT.split('\n')).toContain(rule)
    }
  })

  test('still allows plain pages and points at the sitemap', () => {
    expect(ROBOTS_TXT).toContain('Allow: /\n')
    expect(ROBOTS_TXT).toContain('Sitemap: https://developing-country.org/sitemap.xml')
  })

  test('is served as cacheable plain text', () => {
    const response = robotsResponse()
    expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8')
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=86400')
  })
})
