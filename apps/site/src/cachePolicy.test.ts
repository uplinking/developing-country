import { describe, expect, test } from 'bun:test'
import { cacheDisposition, isPublicPageRequest } from './cachePolicy'

const request = (path: string, method = 'GET') => ({
  method,
  url: `https://developing-country.org${path}`,
})

describe('site Workers Cache boundary', () => {
  test('allows only public documents', () => {
    for (const path of ['/', '/about', '/initiatives', '/data', '/data/metro', '/analysis', '/analysis/evidence-needs-receipts', '/countries/lk', '/rss.xml']) {
      expect(isPublicPageRequest(request(path))).toBe(true)
    }
  })

  test('never preserves error responses for otherwise public URLs', () => {
    expect(cacheDisposition(request('/data/future-dataset'), null, 404)).toBe('private')
    expect(cacheDisposition(request('/analysis'), 'public, max-age=300', 500)).toBe('private')
  })

  test('denies admin, API, auth, editorial MCP, and preview-token requests', () => {
    for (const path of [
      '/_emdash/admin',
      '/_emdash/api/mcp',
      '/_emdash/api/auth/session',
      '/analysis/draft?_preview=signed-token',
      '/analysis/published/extra-segment',
      '/countries/lk/private/extra-segment',
      '/about/private/extra-segment',
      '/api/example',
    ]) {
      expect(isPublicPageRequest(request(path))).toBe(false)
    }
  })

  test('never caches mutations', () => {
    expect(isPublicPageRequest(request('/analysis', 'POST'))).toBe(false)
  })

  test('preserves only explicit immutable cache headers for public assets', () => {
    expect(cacheDisposition(request('/_emdash/api/media/file/articles/hero.webp'), 'public, max-age=31536000, immutable')).toBe('preserve')
    expect(cacheDisposition(request('/_astro/site.css'), 'public, max-age=31536000, immutable')).toBe('preserve')
    expect(cacheDisposition(request('/_emdash/api/media/file/articles/hero.webp'), null)).toBe('private')
    expect(cacheDisposition(request('/_emdash/api/auth/session'), 'public, max-age=31536000, immutable')).toBe('private')
    expect(cacheDisposition(request('/_emdash/api/media/file/articles/hero.webp', 'POST'), 'public, max-age=31536000, immutable')).toBe('private')
  })
})
