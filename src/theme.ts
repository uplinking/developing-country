// The public explorer uses light editorial chrome. MCP hosts can still set a
// dark data surface by updating <html data-theme> through AppMcp. Until a host
// does, the MCP App has no data-theme and follows prefers-color-scheme — the
// same fallback tokens.css applies, so map and chrome resolve one theme.
export type ResolvedTheme = 'light' | 'dark'

const DARK_QUERY = '(prefers-color-scheme: dark)'

export function resolveTheme(): ResolvedTheme {
  const applied = document.documentElement.getAttribute('data-theme')
  if (applied === 'dark' || applied === 'light') return applied
  return window.matchMedia?.(DARK_QUERY).matches ? 'dark' : 'light'
}

/** Listen for host-applied theme changes (and the OS theme while none is applied). */
export function onThemeChange(listener: () => void): () => void {
  const observer = new MutationObserver(listener)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  })
  const media = window.matchMedia?.(DARK_QUERY)
  const onMedia = () => {
    if (!document.documentElement.hasAttribute('data-theme')) listener()
  }
  media?.addEventListener('change', onMedia)
  return () => {
    observer.disconnect()
    media?.removeEventListener('change', onMedia)
  }
}
