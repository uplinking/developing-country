import { describe, expect, test } from 'bun:test'

const read = (path: string) => Bun.file(path).text()

describe('shared product navigation shell', () => {
  test('both Workers and dataset reports render the same header component', async () => {
    for (const path of ['apps/site/src/layouts/SiteLayout.astro', 'src/App.tsx', 'src/views/DatasetChartPage.tsx']) {
      const source = await read(path)
      expect(source).toContain("from '@developing-country/ui/SiteHeader'")
      expect(source).toContain('<SiteHeader ')
      expect(source).not.toContain('dc-report-nav')
      expect(source).not.toContain('dc-product-nav')
    }
    const explorer = await read('src/App.tsx')
    expect(explorer).toContain('aria-label="Map controls"')
    // MCP and Sign in live once on the map: the toolbar's stateful controls own
    // them, and the explorer's header leaves its static copies out.
    expect(explorer).toMatch(/<SiteHeader [^>]*\binAppActions\b/)
    expect(explorer).toContain('<McpConnect')
    expect(explorer).toContain('<AccountControl')
    const header = await read('packages/ui/SiteHeader.tsx')
    expect(header).toContain('aria-label="Primary navigation"')
    expect(header).toContain('aria-label="Choose country"')
    expect(header).toContain("import './site-header.css'")
  })

  test('the landing page keeps only useful country and dataset content', async () => {
    const [landingPage, countryFeature] = await Promise.all([
      read('apps/site/src/pages/index.astro'),
      read('apps/site/src/components/CountryFeature.astro'),
    ])

    expect(landingPage).not.toContain('report-hero__proposition')
    expect(landingPage).not.toContain('Independent · starting with Sri Lanka')
    expect(landingPage).not.toContain('platformStats')
    expect(countryFeature).not.toContain('Starting in Sri Lanka')
    expect(countryFeature).not.toContain('More countries can follow')
    expect(countryFeature).not.toContain('country-feature__stats')
  })
})
