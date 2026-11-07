// Base-path awareness. The SPA can be served at the origin root ('/') or under
// a path prefix ('/app/'). In production Vite bakes that into
// `import.meta.env.BASE_URL`. When this module is loaded from a hashed asset
// (MCP Apps iframe, or the site itself), derive the app root from
// `import.meta.url` so withBase() is an absolute URL the sandbox can fetch.

function runtimeBase(): string {
  try {
    const u = new URL(import.meta.url)
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      const i = u.pathname.lastIndexOf('/assets/')
      if (i >= 0) return `${u.origin}${u.pathname.slice(0, i)}/`
    }
  } catch {
    /* vite-dev / non-URL */
  }
  return import.meta.env.BASE_URL
}

/** Trailing slash. Absolute (`https://example.org/app/`) when loaded from /assets/; otherwise Vite's BASE_URL (`/` or `/app/`). */
export const BASE: string = runtimeBase()

/** Join an app-absolute path (`/api/…`, `/data/…`) onto the app root. */
export const withBase = (path: string): string => {
  const b = BASE.replace(/\/$/, '')
  const p = path.startsWith('/') ? path : `/${path}`
  return `${b}${p}`
}

function isAbsoluteHttp(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

/**
 * Absolute URL for an app-absolute path. `withBase` is already absolute when
 * this module loaded from `/assets/` (prod SPA and MCP Apps iframe); under
 * `vite dev` it is still a path, so we prefix the page origin. Never do
 * `origin + withBase(…)` yourself — that double-prefixes and Better Auth
 * rejects the result as `Invalid callbackURL`.
 */
export function appUrl(path: string): string {
  const u = withBase(path)
  if (isAbsoluteHttp(u)) return u
  return `${window.location.origin}${u}`
}

/** WebSocket URL for an app-absolute path (`/api/session/ws`). */
export function appWsUrl(path: string): string {
  return appUrl(path).replace(/^http/i, 'ws')
}
