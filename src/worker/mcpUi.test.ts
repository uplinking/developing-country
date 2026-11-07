import { describe, expect, test } from 'bun:test'
import { MCP_UI_RESOURCE_URI, PREVIOUS_MCP_UI_RESOURCE_URIS } from '../shared/mcpApp'
import { UI_DISPLAY_MODES, UI_TOOLS, uiCsp, uiResourceMeta } from './mcpUi'

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
})
