/** Allow only navigation schemes the public site intentionally supports. */
export function safeCmsHref(value?: string | null): string | null {
  const href = value?.trim()
  if (!href || href.includes('\\') || [...href].some((character) => {
    const code = character.charCodeAt(0)
    return code <= 31 || code === 127
  }) || /^\/\//.test(href)) return null
  if (href.startsWith('/') || href.startsWith('#')) return href
  try {
    const url = new URL(href)
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol) ? href : null
  } catch {
    return null
  }
}
