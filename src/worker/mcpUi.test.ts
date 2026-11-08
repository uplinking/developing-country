import { describe, expect, test } from 'bun:test'
import { MCP_UI_RESOURCE_URI, PREVIOUS_MCP_UI_RESOURCE_URIS } from '../shared/mcpApp'
import { UI_DISPLAY_MODES, UI_TOOLS, uiCsp, uiResourceMeta, widgetDomain } from './mcpUi'

describe('MCP App production identity and CSP', () => {
  test('advertises the renamed UI resource while retaining the previous URI aliases', () => {
    expect(MCP_UI_RESOURCE_URI).toBe('ui://developing-country/explorer/v0.11.0')
    expect(PREVIOUS_MCP_UI_RESOURCE_URIS).toContain('ui://developing-country/explorer/v0.10.0')
    expect(PREVIOUS_MCP_UI_RESOURCE_URIS).toContain('ui://developing-country/explorer/v0.9.0')
    expect(PREVIOUS_MCP_UI_RESOURCE_URIS).toContain('ui://developing-country/explorer/v0.8.0')
    expect(PREVIOUS_MCP_UI_RESOURCE_URIS).toContain('ui://developing-country/explorer/v0.7.0')
    expect(PREVIOUS_MCP_UI_RESOURCE_URIS).not.toContain(MCP_UI_RESOURCE_URI)
  })

  test('allows the production explorer origin to load its own bundle and API', () => {
    const meta = uiCsp({
      BETTER_AUTH_URL: 'https://explore.developing-country.org',
      PUBLIC_VIEW_ORIGIN: 'https://explore.developing-country.org',
    })
    expect(meta.csp.resourceDomains).toContain('https://explore.developing-country.org')
    expect(meta.csp.connectDomains).toContain('https://explore.developing-country.org')
    expect(meta.csp.resourceDomains).toContain('https://tiles.developing-country.org')
    expect(meta.csp.connectDomains).toContain('https://tiles.developing-country.org')
    expect(meta.csp.resourceDomains.filter((origin) => origin === 'https://explore.developing-country.org')).toHaveLength(1)
  })

  test('production CSP names no local development origins', () => {
    const meta = uiCsp({
      BETTER_AUTH_URL: 'https://explore.developing-country.org',
      PUBLIC_VIEW_ORIGIN: 'https://explore.developing-country.org',
      BASE_PATH: '',
    })
    expect(meta.csp.resourceDomains.some((origin) => origin.startsWith('http://'))).toBe(false)
    expect(meta.csp.connectDomains.some((origin) => origin.startsWith('http://'))).toBe(false)
  })

  test('a local deployment keeps the wrangler dev origins', () => {
    for (const env of [{}, { BETTER_AUTH_URL: 'http://localhost:8787' }]) {
      const meta = uiCsp(env)
      expect(meta.csp.resourceDomains).toContain('http://localhost:8787')
      expect(meta.csp.connectDomains).toContain('http://127.0.0.1:8787')
      expect(meta.csp.resourceDomains.filter((origin) => origin === 'http://localhost:8787')).toHaveLength(1)
    }
  })

  test('does not copy malformed deployment URLs into the host CSP', () => {
    const meta = uiCsp({ BETTER_AUTH_URL: 'not a URL', BASE_PATH: '/app/' })
    expect(meta.csp.resourceDomains).not.toContain('not a URL')
    expect(meta.csp.resourceDomains).not.toContain('http://localhost:8787')
  })

  test('one answer paints one app frame: the catalog lookup carries no UI', () => {
    expect([...UI_TOOLS].sort()).toEqual(['analyze_location', 'query_data'])
  })

  test('the resource carries the standard ui block plus host hints other hosts ignore', () => {
    const env = { BETTER_AUTH_URL: 'https://explore.developing-country.org' }
    const meta = uiResourceMeta(env)
    expect(meta.ui).toEqual(uiCsp(env))
    expect(meta['openai/ui'].availableDisplayModes).toEqual([...UI_DISPLAY_MODES])
    expect(meta['openai/widgetDescription'].length).toBeGreaterThan(0)
    // No legacy CSP alias: ui.csp is the one CSP every host reads.
    expect(Object.keys(meta)).not.toContain('openai/widgetCSP')
  })

  test('the widget origin goes to ChatGPT as its alias, never as ui.domain', () => {
    const meta = uiResourceMeta({ BETTER_AUTH_URL: 'https://explore.developing-country.org' })
    expect(meta['openai/widgetDomain']).toBe('https://explore.developing-country.org')
    // Claude rejects a ui.domain that is not its own hashed sandbox origin.
    expect(Object.keys(meta.ui)).not.toContain('domain')
    expect(widgetDomain({ BETTER_AUTH_URL: 'not a URL' })).toBe('https://explore.developing-country.org')
  })
})
