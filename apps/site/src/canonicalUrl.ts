const SITE_HOST = 'developing-country.org'

/**
 * The one public address for a page, or null when the request already uses it. Every variant
 * a crawler can reach otherwise serves the same page under its own self-referencing canonical
 * tag, which Search Console reports as duplicates: plain http, a trailing slash, an upper-case
 * country code, and EmDash's per-collection URLs (/articles/<slug>) from its old sitemaps.
 * EmDash's own routes (/_emdash/…) and files are left alone.
 */
export function canonicalRedirect(requestUrl: string): string | null {
  const url = new URL(requestUrl)
  const original = url.href
  if (url.hostname === SITE_HOST || url.hostname === `www.${SITE_HOST}`) {
    url.protocol = 'https:'
    url.hostname = SITE_HOST
    url.port = ''
  }
  if (!url.pathname.startsWith('/_') && !/\.[a-z0-9]+$/i.test(url.pathname)) {
    let path = url.pathname.replace(/\/{2,}/g, '/')
    if (path.length > 1) path = path.replace(/\/+$/, '')
    path = path.replace(/^\/articles(?=\/[^/]+$)/, '/analysis')
    path = path.replace(/^(\/countries\/)([^/]+)$/, (_, prefix: string, code: string) => prefix + code.toLowerCase())
    url.pathname = path
  }
  return url.href === original ? null : url.href
}
