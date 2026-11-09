/**
 * What a search engine should do with the explorer page at `href`. The SPA answers every path
 * with the same shell, and the map keeps its state in the query string, so without these hints
 * each layer combination, embed and mistyped path is a separate "page" Google has to
 * de-duplicate on its own. Live views and dataset charts are their own pages; any map state is
 * the map at its root; embeds, the sign-in flow and unknown paths stay out of the index.
 */
export type CrawlHint = { canonical: string } | { noindex: true }

const NOINDEX_PARAMS = ['embed', 'mcp', 'connect', 'client_id', 'response_type', 'redirect_uri']

export function crawlHint(href: string, basePath = ''): CrawlHint {
  const url = new URL(href)
  if (NOINDEX_PARAMS.some((param) => url.searchParams.has(param))) return { noindex: true }
  const path = url.pathname.startsWith(basePath) ? url.pathname.slice(basePath.length) : url.pathname
  const page = (rest: string) => ({ canonical: `${url.origin}${basePath}${rest}` })
  if (path === '' || path === '/') return page('/')
  const view = /^\/views\/([^/]+)\/?$/.exec(path)
  if (view) return page(`/views/${view[1]}`)
  const chart = /^\/datasets\/([^/]+)\/([^/]+)\/?$/.exec(path)
  if (chart) return page(`/datasets/${chart[1]}/${chart[2]}`)
  return { noindex: true }
}

export function applyCrawlHint(hint: CrawlHint, doc: Document = document): void {
  if ('noindex' in hint) {
    const meta = doc.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex'
    doc.head.append(meta)
    return
  }
  const link = doc.createElement('link')
  link.rel = 'canonical'
  link.href = hint.canonical
  doc.head.append(link)
}
