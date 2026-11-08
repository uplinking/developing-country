// Authentication for /api and /mcp — now powered by Better Auth.
//
// Web app: identity comes from a Better Auth **session cookie** (set by the
// /api/auth/* handler after sign-up / sign-in). We resolve it with
// `auth.api.getSession`.
//
// MCP: AI clients don't carry cookies — they present an OAuth 2.1 access token
// (Authorization: Bearer …) minted by the mcp() plugin. Tokens bound to the MCP
// resource are RS256 JWTs, verified locally against the jwt plugin's key set.
// See verifyMcpAccessToken below.
//
// Dev mode: ONLY when `DEV_AUTH=1` is explicitly set (via .dev.vars locally)
// and there's no session do we trust the `X-Dev-User` header (default
// dev@local). Any other state fails CLOSED (401) so a production Worker with a
// missing session can never be spoofed via a plain header.

import { verifyJwsAccessToken } from 'better-auth/oauth2'
import type { Env, Identity } from './types'
import type { JsonValue } from '../shared/json'
import { OAUTH_PROVIDER_TABLES, getAuth, mcpResource, oauthIssuer } from './betterAuth'
import { hashLikeProvider, legacyAccessTokenUser } from './oauthLegacy'

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
  const bearer = bearerToken(request.headers)
  if (bearer) {
    const userId = await verifyMcpAccessToken(env, auth, bearer)
    if (userId) {
      const looked = await emailForUserId(env, userId)
      if (looked) return { email: looked.email, emailVerified: looked.emailVerified, mode: 'user' }
    }
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

function bearerToken(headers: Headers): string | null {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(headers.get('authorization') ?? '')
  return match?.[1] ?? null
}

function isJwt(token: string): boolean {
  return token.split('.').length === 3
}

/**
 * Resolve an MCP access token to the user id it was issued for, or null.
 *
 * - JWT: the provider's audience-bound access token. Checked locally against
 *   the jwt plugin's key set (no network round trip): RS256 signature, issuer,
 *   audience = the MCP resource, expiry, and an `azp` (the client). A token
 *   carrying a DPoP confirmation (`cnf`) is refused: this server only accepts
 *   bearer tokens.
 * - Opaque: issued when a client omits `resource`. Looked up by its hash in
 *   the provider's access-token table; must be unexpired, unrevoked and, when it names
 *   resources, name this one.
 * - Legacy: an unexpired opaque token from Better Auth 1.6 (see oauthLegacy).
 */
export async function verifyMcpAccessToken(
  env: Env,
  auth: ReturnType<typeof getAuth>,
  token: string,
): Promise<string | null> {
  const resource = mcpResource(env)
  if (isJwt(token)) {
    try {
      const payload = await verifyJwsAccessToken(token, {
        jwksFetch: async () => auth.api.getJwks(),
        verifyOptions: { issuer: oauthIssuer(env), audience: resource, algorithms: ['RS256'], requiredClaims: ['azp', 'sub'] },
      })
      // `sub` is a required claim above, so it is present; refuse DPoP-bound tokens.
      if (payload.cnf !== undefined || !payload.sub) return null
      return payload.sub
    } catch {
      return null
    }
  }
  try {
    const row = await env.DB.prepare(
      `SELECT "userId", "expiresAt", "revoked", "resources" FROM "${OAUTH_PROVIDER_TABLES.accessToken}" WHERE "token" = ?1`,
    )
      .bind(await hashLikeProvider(token))
      .first<{ userId: string | null; expiresAt: string | number; revoked: string | number | null; resources: string | null }>()
    if (row?.userId && !row.revoked && new Date(row.expiresAt).getTime() > Date.now()) {
      const resources: JsonValue = row.resources ? JSON.parse(row.resources) : null
      if (!Array.isArray(resources) || resources.includes(resource)) return row.userId
      return null
    }
  } catch {
    // fall through to the legacy table
  }
  try {
    return await legacyAccessTokenUser(env, token)
  } catch {
    return null
  }
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
