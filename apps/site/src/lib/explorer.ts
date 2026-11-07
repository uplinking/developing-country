export const CANONICAL_EXPLORER_ORIGIN = 'https://explore.developing-country.org'

export function resolveExplorerHref(href: string, developmentOrigin?: string): string {
  if (!developmentOrigin) return href
  try {
    const url = new URL(href)
    if (url.origin !== CANONICAL_EXPLORER_ORIGIN) return href
    const local = new URL(developmentOrigin)
    url.protocol = local.protocol
    url.host = local.host
    return url.href
  } catch {
    return href
  }
}
