import cloudflare from '@astrojs/cloudflare'
import { cacheCloudflare } from '@astrojs/cloudflare/cache'
import react from '@astrojs/react'
import { d1, r2 } from '@emdash-cms/cloudflare'
import { developingCountryBlocks } from '@developing-country/emdash-blocks'
import { defineConfig } from 'astro/config'
import emdash from 'emdash/astro'

export default defineConfig({
  site: 'https://developing-country.org',
  output: 'server',
  adapter: cloudflare(),
  cache: { provider: cacheCloudflare() },
  routeRules: {
    '/': { maxAge: 300, swr: 86400 },
    '/about': { maxAge: 300, swr: 86400 },
    '/initiatives': { maxAge: 300, swr: 86400 },
    '/data': { maxAge: 300, swr: 86400 },
    '/data/**': { maxAge: 300, swr: 86400 },
    '/analysis': { maxAge: 300, swr: 86400 },
    '/analysis/**': { maxAge: 300, swr: 86400 },
    '/countries/**': { maxAge: 300, swr: 86400 },
    '/rss.xml': { maxAge: 300, swr: 3600 },
  },
  integrations: [
    react(),
    emdash({
      siteUrl: 'https://developing-country.org',
      database: d1({ binding: 'DB', session: 'auto' }),
      storage: r2({ binding: 'MEDIA' }),
      plugins: [developingCountryBlocks()],
      marketplace: false,
    }),
  ],
  image: { layout: 'constrained', responsiveStyles: true },
  devToolbar: { enabled: false },
  // The Cloudflare runner imports this virtual Astro entry while Vite is
  // rebuilding its SSR dependency graph. Optimizing it produces a transient
  // hashed chunk that the runner can request after it has been replaced.
  vite: {
    // packages/figures is linked source with its own React resolution; one
    // React instance must serve both the islands and the server renderer.
    resolve: { dedupe: ['react', 'react-dom'] },
    ssr: {
      optimizeDeps: {
        exclude: [
          'astro/app/manifest',
          '@astrojs/cloudflare/entrypoints/server',
          'emdash/n_kysely_migration',
        ],
      },
    },
  },
})
