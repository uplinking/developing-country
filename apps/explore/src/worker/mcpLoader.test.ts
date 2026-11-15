import { describe, expect, test } from 'bun:test'
import { freshEntryUrl, loadMcpAppHtml, mcpLoaderFromHtml, resetMcpAppHtmlCache } from './mcpLoader'

const ORIGIN = 'https://explore.developing-country.org'

// Shape of Vite's built mcp-app.html.
const BUILT = `<!doctype html>
<html lang="en">
  <head>
    <script>window.__DEVELOPING_COUNTRY_MCP__ = true</script>
    <script type="module" crossorigin src="/assets/mcp-app-AAAA.js"></script>
    <link rel="modulepreload" crossorigin href="/assets/react-BBBB.js">
    <link rel="modulepreload" crossorigin href="/assets/AppMcp-CCCC.js">
    <link rel="stylesheet" crossorigin href="/assets/index-DDDD.css">
  </head>
  <body><div id="root"></div></body>
</html>`

describe('MCP App resource HTML', () => {
  const html = mcpLoaderFromHtml(BUILT, ORIGIN)!

  test('preloads the whole critical path so the frame fetches it in one round', () => {
    for (const chunk of ['mcp-app-AAAA.js', 'react-BBBB.js', 'AppMcp-CCCC.js']) {
      expect(html).toContain(`<link rel="modulepreload" crossorigin href="${ORIGIN}/assets/${chunk}" />`)
    }
    expect(html).toContain(`<link rel="stylesheet" crossorigin href="${ORIGIN}/assets/index-DDDD.css" />`)
    expect(html).toContain('window.__DEVELOPING_COUNTRY_MCP__=1')
  })

  test('imports the entry from a module that re-reads the live entry page when a cached copy is stale', () => {
    expect(html).toContain(`const entries = ["${ORIGIN}/assets/mcp-app-AAAA.js"];`)
    expect(html).toContain(`const fresh = "${ORIGIN}/mcp-app";`)
    // No static <script src>: a failed static load could not be recovered.
    expect(html).not.toMatch(/<script type="module"[^>]*\bsrc=/)
  })

  test('the boot script parses as a module', () => {
    const body = /<script type="module">([\s\S]*?)<\/script>/.exec(html)?.[1]
    expect(body).toBeDefined()
    // Top-level await is not used, so a plain function body is a fair syntax check.
    expect(() => new Function(body!.replace(/^\s*import\b.*$/gm, ''))).not.toThrow()
  })

  test('keeps a base-path prefix for the live entry page', () => {
    expect(freshEntryUrl('https://developing-country.org/app/assets/mcp-app-AAAA.js')).toBe('https://developing-country.org/app/mcp-app')
  })

  test('returns null for a page without a module entry', () => {
    expect(mcpLoaderFromHtml('<html><body></body></html>', ORIGIN)).toBeNull()
  })

  test('prefers the MCP entry page and falls back to index.html on an older build', async () => {
    const served = (pages: Record<string, string>) => ({
      ASSETS: {
        async fetch(request: Request) {
          const page = pages[new URL(request.url).pathname]
          return page ? new Response(page) : new Response('nf', { status: 404 })
        },
      },
    }) as never
    resetMcpAppHtmlCache()
    const fromEntry = await loadMcpAppHtml(served({ '/mcp-app': BUILT }), ORIGIN)
    expect(fromEntry).toContain('mcp-app-AAAA.js')
    resetMcpAppHtmlCache()
    const fromIndex = await loadMcpAppHtml(
      served({ '/index.html': BUILT.replace('mcp-app-AAAA', 'index-EEEE') }),
      ORIGIN,
    )
    expect(fromIndex).toContain('index-EEEE.js')
    resetMcpAppHtmlCache()
  })
})
