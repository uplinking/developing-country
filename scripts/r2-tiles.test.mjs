import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { catalogEntries } from '../src/worker/ontology.ts'

const root = new URL('../', import.meta.url)

describe('direct R2 PMTiles delivery', () => {
  test('keeps the production build on the canonical tile origin', () => {
    for (const name of ['.env.explore', '.env.production']) {
      const env = readFileSync(new URL(name, root), 'utf8')
      expect(env).toContain('VITE_TILE_BASE=https://tiles.developing-country.org')
    }
    const pmtiles = catalogEntries().filter((entry) => entry.storage.kind === 'pmtiles')
    expect(pmtiles.length).toBeGreaterThan(0)
    expect(pmtiles.every((entry) => entry.path?.startsWith('https://tiles.developing-country.org/'))).toBe(true)
  })

  test('keeps static assets off the Worker and legacy tile proxies closed', () => {
    for (const name of ['wrangler.explore.jsonc']) {
      const config = readFileSync(new URL(name, root), 'utf8')
      expect(config).not.toMatch(/"run_worker_first"\s*:\s*\[\s*"\/\*"\s*\]/)
      expect(config).toContain('"ENABLE_TILE_COMPAT": "0"')
      expect(config).toContain('"/tiles/*"')
      expect(config).toContain('"/xyz/*"')
      expect(config).toContain('"bucket_name": "developing-country-tiles"')
      expect(config).toContain('"database_name": "developing-country-platform"')
    }
  })

  test('allows only public read/range CORS operations', () => {
    const config = JSON.parse(readFileSync(new URL('scripts/r2-tiles-cors.json', root), 'utf8'))
    expect(config).toEqual({
      rules: [{
        allowed: {
          origins: ['*'],
          methods: ['GET', 'HEAD'],
          headers: ['Range', 'If-Match', 'If-None-Match'],
        },
        exposeHeaders: ['Accept-Ranges', 'Cache-Control', 'Content-Length', 'Content-Range', 'ETag'],
        maxAgeSeconds: 86400,
      }],
    })
  })
})
