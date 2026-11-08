// The ui:// resource HTML for the MCP App, written from the built
// mcp-app.html (falls back to index.html for a build without that entry).
//
// Two load-time failure modes this guards against:
//
//  1. Waterfalls. The old loader copied only the entry <script> from
//     index.html, so the frame fetched main.tsx, then AppMcp, then its chunks,
//     before it could answer the host. mcp-app.html imports AppMcp statically,
//     and every modulepreload link is copied, so the frame fetches the whole
//     critical path in one round.
//
//  2. Stale resources. Hosts cache resource contents (ChatGPT documents up to
//     an hour), but a deploy replaces every hashed chunk, and the asset server
//     answers a missing /assets/*.js with the SPA's index.html (200,
//     text/html), which a module import rejects. A cached loader from the
//     previous deploy would never boot and never complete the host handshake.
//     The entry is therefore imported from an inline module that, if the
//     import fails, re-reads the live mcp-app page and imports its entry.

import type { Env } from './types'

/** App-absolute path of the built MCP entry page (Workers assets drop `.html`). */
export const MCP_ENTRY_PATH = '/mcp-app'

const ASSET_CANDIDATES = [MCP_ENTRY_PATH, '/mcp-app.html', '/index.html', '/']

function attrs(html: string, re: RegExp): string[] {
  return [...html.matchAll(re)].map((m) => m[1]!).filter(Boolean)
}

function escapeAttr(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
}

/** JSON for an inline <script>: no `</script>` or `<!--` can close or confuse it. */
function inlineJson(value: string | string[]): string {
  return JSON.stringify(value).replaceAll('<', '\\u003c')
}

/** Inline module: import the entry; on failure, import whatever the live page now names. */
function bootScript(entries: string[], freshUrl: string): string {
  return `
const entries = ${inlineJson(entries)};
const fresh = ${inlineJson(freshUrl)};
const load = (urls) => Promise.all(urls.map((url) => import(url)));
load(entries).catch(async (error) => {
  try {
    const res = await fetch(fresh, { cache: 'no-store' });
    if (!res.ok) throw error;
    const html = await res.text();
    const abs = (p) => new URL(p, fresh).href;
    const next = [...html.matchAll(/<script type="module"[^>]*\\bsrc="([^"]+)"/g)].map((m) => abs(m[1]));
    if (next.length === 0 || next.join() === entries.join()) throw error;
    for (const m of html.matchAll(/<link rel="stylesheet"[^>]*\\bhref="([^"]+)"/g)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.crossOrigin = '';
      link.href = abs(m[1]);
      document.head.append(link);
    }
    await load(next);
  } catch (cause) {
    console.error('[mcp-app] the app bundle did not load', cause);
    const root = document.getElementById('root');
    if (root && !root.hasChildNodes()) {
      root.textContent = 'This view could not load. Ask again, or open explore.developing-country.org.';
    }
  }
});`
}

/** The live entry page next to the built chunks: <origin><base>/assets/x.js -> <origin><base>/mcp-app. */
export function freshEntryUrl(entryScript: string): string {
  return new URL(`..${MCP_ENTRY_PATH}`, entryScript).href
}

/** The resource HTML for a built entry page, or null if it names no module script. */
export function mcpLoaderFromHtml(pageHtml: string, origin: string): string | null {
  const scripts = attrs(pageHtml, /<script type="module"[^>]*\bsrc="([^"]+)"/g)
  if (scripts.length === 0) return null
  const preloads = attrs(pageHtml, /<link rel="modulepreload"[^>]*\bhref="([^"]+)"/g)
  const styles = attrs(pageHtml, /<link rel="stylesheet"[^>]*\bhref="([^"]+)"/g)
  const abs = (p: string) => (/^https?:\/\//.test(p) ? p : new URL(p, `${origin}/`).href)
  const entries = scripts.map(abs)
  const preloadTags = [...new Set([...entries, ...preloads.map(abs)])]
    .map((h) => `    <link rel="modulepreload" crossorigin href="${escapeAttr(h)}" />`)
  const styleTags = styles.map((h) => `    <link rel="stylesheet" crossorigin href="${escapeAttr(abs(h))}" />`)
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>developing-country.org</title>
    <script>window.__DEVELOPING_COUNTRY_MCP__=1</script>
${[...styleTags, ...preloadTags].join('\n')}
    <script type="module">${bootScript(entries, freshEntryUrl(entries[0]!))}
    </script>
  </head>
  <body><div id="root"></div></body>
</html>`
}

let cached: string | null | undefined

/** The resource HTML for this deployment's build; cached per isolate (one isolate serves one deploy). */
export async function loadMcpAppHtml(env: Pick<Env, 'ASSETS'>, origin: string): Promise<string | null> {
  if (cached !== undefined) return cached
  for (const path of ASSET_CANDIDATES) {
    try {
      const res = await env.ASSETS.fetch(new Request(`https://assets.local${path}`))
      if (!res.ok) continue
      const html = mcpLoaderFromHtml(await res.text(), origin)
      if (!html) continue
      cached = html
      return cached
    } catch {
      continue
    }
  }
  cached = null
  return null
}

/** Test seam: forget the per-isolate copy. */
export function resetMcpAppHtmlCache(): void {
  cached = undefined
}
