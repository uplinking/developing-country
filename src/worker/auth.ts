// Authentication for /api and /mcp — now powered by Better Auth.
//
// Web app: identity comes from a Better Auth **session cookie** (set by the
// /api/auth/* handler after sign-up / sign-in). We resolve it with
// `auth.api.getSession`.
//
// MCP: AI clients don't carry cookies — they present an OAuth 2.1 access token
// (Authorization: Bearer …) minted by the mcp() plugin. Resolve it with
// `auth.api.getMcpSession`. See authenticateMcp below.
//
// Dev mode: ONLY when `DEV_AUTH=1` is explicitly set (via .dev.vars locally)
// and there's no session do we trust the `X-Dev-User` header (default
// dev@local). Any other state fails CLOSED (401) so a production Worker with a
// missing session can never be spoofed via a plain header.

import type { Env, Identity } from './types'
import { getAuth } from './betterAuth'

/**
 * Resolve the caller identity for the REST API from a Better Auth session
 * cookie. Returns null when there's no valid session (caller should 401),
 * except in explicit dev mode where X-Dev-User is honoured.
 */
export async function authenticate(request: Request, env: Env): Promise<Identity | null> {
  const auth = getAuth(env)
  try {
    const session = await auth.api.getSession({ headers: request.headers })
    const email = session?.user?.email
    if (email) return { email: String(email), emailVerified: session.user.emailVerified === true, mode: 'user' }
  } catch {
    // fall through to dev bypass / fail-closed
  }
  return devFallback(request, env)
}

/**
 * Resolve identity for /mcp. Prefers the MCP OAuth access token (Bearer), then
 * falls back to a session cookie (a logged-in browser hitting /mcp), then dev.
 * Returns null ⇒ caller must 401 with a WWW-Authenticate challenge.
 */
export async function authenticateMcp(request: Request, env: Env): Promise<Identity | null> {
  const auth = getAuth(env)
  try {
    // getMcpSession returns the OAuth access-token record (userId + scopes), or
    // null when the Bearer token is missing/invalid. Map userId → email, which
    // is what the rest of the platform keys on.
    const mcpSession = await auth.api.getMcpSession({ headers: request.headers })
    if (mcpSession?.userId) {
      const looked = await emailForUserId(env, mcpSession.userId)
      if (looked) return { email: looked.email, emailVerified: looked.emailVerified, mode: 'user' }
    }
  } catch {
    // fall through
  }
  // A browser session cookie also authorises /mcp (same-origin dev/testing).
  try {
    const session = await auth.api.getSession({ headers: request.headers })
    const email = session?.user?.email
    if (email) return { email: String(email), emailVerified: session.user.emailVerified === true, mode: 'user' }
  } catch {
    /* ignore */
  }
  return devFallback(request, env)
}

// The MCP OAuth token record references a userId; map it to the email that the
// rest of the platform keys on. One indexed lookup, cheap.
async function emailForUserId(env: Env, userId: string): Promise<{ email: string; emailVerified: boolean } | null> {
  try {
    const row = await env.DB.prepare('SELECT email, emailVerified FROM "user" WHERE id = ?1')
      .bind(userId)
      .first<{ email: string; emailVerified: number | boolean }>()
    return row ? { email: row.email, emailVerified: Boolean(row.emailVerified) } : null
  } catch {
    return null
  }
}

// Local-dev bypass. Never trusts a header unless DEV_AUTH=1 is explicitly set
// (only ever in .dev.vars). Otherwise fail closed.
function devFallback(request: Request, env: Env): Identity | null {
  if (env.DEV_AUTH?.trim() !== '1') return null
  const dev = request.headers.get('X-Dev-User')?.trim()
  return { email: dev && dev.length > 0 ? dev : 'dev@local', emailVerified: true, mode: 'dev' }
}
