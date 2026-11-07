const PUBLIC_PAGE = /^(?:\/|\/about\/?|\/initiatives\/?|\/data(?:\/[^/]+)?\/?|\/analysis(?:\/[^/]+)?\/?|\/countries\/[^/]+\/?|\/rss\.xml)$/
const IMMUTABLE_PUBLIC_ASSET = /^\/(?:_astro\/|_emdash\/api\/media\/file\/)/

/** True only for anonymous, host-independent public documents. */
export function isPublicPageRequest(request: { method: string; url: string }): boolean {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false
  const url = new URL(request.url)
  if (url.searchParams.has('_preview')) return false
  return PUBLIC_PAGE.test(url.pathname)
}

export function cacheDisposition(
  request: { method: string; url: string },
  upstreamCacheControl: string | null,
  upstreamStatus = 200,
): 'preserve' | 'private' {
  if (upstreamStatus < 200 || upstreamStatus >= 300) return 'private'
  if (isPublicPageRequest(request)) return 'preserve'
  if (request.method !== 'GET' && request.method !== 'HEAD') return 'private'
  const path = new URL(request.url).pathname
  const explicitlyImmutable = Boolean(
    upstreamCacheControl && /(?:^|,)\s*public\b/i.test(upstreamCacheControl) && /\bimmutable\b/i.test(upstreamCacheControl),
  )
  return IMMUTABLE_PUBLIC_ASSET.test(path) && explicitlyImmutable ? 'preserve' : 'private'
}
