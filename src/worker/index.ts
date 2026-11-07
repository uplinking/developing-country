/// <reference types="@cloudflare/workers-types" />
//
// Platform Worker — the explorer backbone. Routes:
//   /api/auth/*  → Better Auth handler (sign-up/in, social, MCP OAuth, discovery)
//   /.well-known/oauth-*  → OAuth discovery proxied to Better Auth (root aliases)
//   /tiles/*  → legacy R2 PMTiles range-proxy; production browsers use the
//               direct tiles.developing-country.org R2 custom domain
//   /api/*    → REST API (api.ts → service.ts)
//   /mcp      → MCP server (mcp.ts → same service.ts)
//   /*        → SPA assets (ASSETS binding, dist/)
//
// PATH-PREFIX DEPLOYMENT (BASE_PATH, e.g. "/app"):
//   In production the app is served at https://example.org/app via zone
//   routes. Cloudflare hands us the FULL, prefixed path. We:
//     1. Answer OAuth discovery well-knowns first — they arrive UNPREFIXED at
//        the zone root (/.well-known/oauth-*), and also as RFC path-insertion /
//        -append variants. All map to Better Auth's discovery endpoints.
//     2. Route Better Auth's own routes (<BASE_PATH>/api/auth/*) to it WITH the
//        prefix intact — Better Auth derives its router basePath AND every
//        absolute URL it emits from the pathname of its configured baseURL
//        (= <BASE_PATH>/api/auth), so redirects, cookies and OAuth endpoints all
//        stay under /app. Do NOT strip the prefix for these.
//     3. Strip BASE_PATH for everything else and route root-relative exactly as
//        before, so tiles/api/mcp/SPA logic is prefix-agnostic and workers.dev
//        staging (no prefix) keeps working unchanged.
//
// Auth (Better Auth session cookie / MCP OAuth token, or dev header) is applied
// inside api.ts / mcp.ts. See docs/AUTH_SETUP.md and docs/MCP.md.

import { serveScheduledData } from './scheduledData'
import type { Env } from './types'
import { serveTile } from './tiles'
import { serveXyz } from './xyz'
import { handleApi } from './api'
import { handleMcp } from './mcp'
import { getAuth } from './betterAuth'
import { MapSession } from './session'
import { normalizeEmail } from './identity'
import { authenticate } from './auth'
import type { JsonObject, JsonValue } from '../shared/json'
import { isJsonObject, isJsonString, parseJsonObject } from '../shared/json'

export { MapSession }

/** Normalised BASE_PATH: "" or "/app" (no trailing slash). */
function basePrefix(env: Env): string {
  return (env.BASE_PATH?.trim() ?? '').replace(/\/+$/, '')
}

// OAuth discovery documents (RFC 8414 authorization-server, RFC 9728
// protected-resource). Clients may probe them at the zone root, or with the
// issuer path inserted (…/oauth-authorization-server/app) or appended
// (/app/.well-known/…). We answer ALL variants with the SAME canonical
// Better Auth metadata — Better Auth computes its URLs from the configured
// baseURL, independent of which variant was probed, so every variant returns
// endpoints under https://example.org/app/… and an issuer at the origin.
type DiscoveryKind = 'authorization-server' | 'protected-resource' | 'openid-configuration'

function discoveryKind(path: string): DiscoveryKind | null {
  if (path.includes('/.well-known/oauth-authorization-server')) return 'authorization-server'
  if (path.includes('/.well-known/oauth-protected-resource')) return 'protected-resource'
  // OIDC discovery. We mint id_tokens with `iss` = the zone origin, so an OIDC
  // client resolves THIS url to find the issuer's keys. Nothing served it: the
  // Worker's zone routes only covered /app* and the two oauth-* wellknowns,
  // and the bare origin has no other handler — so the request did not 404, it
  // HUNG until the client timed out. That is what killed claude.ai's connector
  // after an otherwise perfect OAuth: register, authorize and token all
  // succeeded (the access token is in D1), then discovery on the issuer stalled
  // and the connector gave up without ever calling /mcp. A 404 would have been
  // survivable; a hang was not.
  if (path.includes('/.well-known/openid-configuration')) return 'openid-configuration'
  return null
}

async function handleDiscovery(
  kind: DiscoveryKind,
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url)
  // Canonical Better Auth discovery endpoint lives at basePath + this path.
  // basePath = pathname of Better Auth's baseURL = <BASE_PATH>/api/auth.
  // Better Auth registers no openid-configuration route, but its
  // authorization-server document already carries every field OIDC discovery
  // requires (issuer, authorization/token/userinfo endpoints, jwks_uri,
  // response_types_supported, subject_types_supported, and the id_token alg),
  // so serve that same document under the OIDC name.
  const doc = kind === 'openid-configuration' ? 'authorization-server' : kind
  url.pathname = `${basePrefix(env)}/api/auth/.well-known/oauth-${doc}`
  url.search = ''
  const res = await getAuth(env).handler(
    new Request(url.toString(), { method: 'GET', headers: request.headers }),
  )
  const headers = new Headers(res.headers)
  headers.set('Access-Control-Allow-Origin', '*')
  return new Response(res.body, { status: res.status, headers })
}

/** Decode a JWT payload without verifying (we are re-signing it, not trusting it). */
function decodeJwtPayload(token: string): JsonObject | null {
  const part = token.split('.')[1]
  if (!part) return null
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/')
    const json = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
    return parseJsonObject(json)
  } catch {
    return null
  }
}

/**
 * Re-sign the `id_token` the mcp plugin mints. THIS IS THE ONE THAT BROKE
 * claude.ai.
 *
 * The plugin's own /mcp/token handler signs the id_token like this:
 *
 *   const secretKey = { alg: 'HS256', key: await subtle.generateKey(HMAC…) }
 *
 * — a random HMAC key generated per request and then thrown away. It is never
 * stored, never published, and never derived from anything the client holds, so
 * the resulting id_token is UNVERIFIABLE BY CONSTRUCTION. It also carries no
 * `iss` claim, which OIDC requires. Meanwhile the discovery document promises
 * RS256 signatures at a jwks_uri. A client that ignores the id_token (Grok)
 * connects fine; a client that validates it per the metadata (claude.ai) has to
 * reject the token response — which is why registration, the auth code and the
 * access token all landed in D1 and the connector STILL reported
 * "Authorization with <server> failed" and then "couldn't connect".
 *
 * So: let Better Auth mint the token pair as usual, then replace the id_token
 * with one signed by the jwt plugin's RS256 key — the key actually published at
 * our jwks_uri — and add the missing `iss`. Everything else passes through
 * untouched, including every error response.
 */
async function handleMcpToken(request: Request, env: Env): Promise<Response> {
  const auth = getAuth(env)
  const res = await auth.handler(request)
  if (!res.ok) return res
  const body: JsonValue = await res.clone().json()
  if (!isJsonObject(body)) return res
  const idToken = isJsonString(body.id_token) ? body.id_token : null
  if (!idToken) return res
  const claims = decodeJwtPayload(idToken)
  if (!claims) return res
  try {
    const issuer = new URL(env.BETTER_AUTH_URL?.trim() || request.url).origin
    const signed = await auth.api.signJWT({
      body: { payload: { ...claims, iss: issuer } },
    })
    const token = signed?.token
    if (!token) return res
    const headers = new Headers(res.headers)
    headers.delete('content-length')
    return new Response(JSON.stringify({ ...body, id_token: token }), {
      status: res.status,
      headers,
    })
  } catch (e) {
    // Never fail the token exchange over the id_token: a client that ignores it
    // still gets a working access token. Log loudly instead.
    console.log(
      JSON.stringify({
        op: 'mcp_idtoken_resign_failed',
        err: e instanceof Error ? e.message : String(e),
      }),
    )
    return res
  }
}

/**
 * OIDC UserInfo for MCP access tokens (RFC 6749 Bearer). Better Auth's mcp()
 * plugin advertises this endpoint in its discovery document but ships no
 * handler for it. Claims mirror the id_token the token endpoint mints.
 */
async function handleUserinfo(request: Request, env: Env): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      },
    })
  }
  if (request.method !== 'GET' && request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }
  const unauthorized = () =>
    new Response(JSON.stringify({ error: 'invalid_token' }), {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        'WWW-Authenticate': 'Bearer error="invalid_token"',
        'Access-Control-Allow-Origin': '*',
      },
    })
  let userId: string | undefined
  try {
    const mcpSession = await getAuth(env).api.getMcpSession({ headers: request.headers })
    userId = mcpSession?.userId
  } catch {
    return unauthorized()
  }
  if (!userId) return unauthorized()
  const row = await env.DB.prepare(
    'SELECT id, email, emailVerified, name, image FROM "user" WHERE id = ?1',
  )
    .bind(userId)
    .first<{ id: string; email: string; emailVerified: number; name: string | null; image: string | null }>()
  if (!row) return unauthorized()
  return new Response(
    JSON.stringify({
      sub: row.id,
      email: row.email,
      email_verified: !!row.emailVerified,
      name: row.name ?? undefined,
      picture: row.image ?? undefined,
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      },
    },
  )
}

/**
 * JWKS for the MCP authorization server. The mcp plugin advertises the key set
 * at <basePath>/mcp/jwks but registers no route there; the REAL key set — the
 * RS256 pair the jwt plugin signs id_tokens with — is served by that plugin at
 * <basePath>/jwks. Serve the advertised URL from the real one so the two can
 * never drift, and so the first fetch lazily provisions the key pair.
 */
async function handleJwks(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'OPTIONS') {
    return new Response('Method Not Allowed', { status: 405 })
  }
  const url = new URL(request.url)
  url.pathname = `${basePrefix(env)}/api/auth/jwks`
  url.search = ''
  const res = await getAuth(env).handler(
    new Request(url.toString(), { method: 'GET', headers: request.headers }),
  )
  const headers = new Headers(res.headers)
  headers.set('Access-Control-Allow-Origin', '*')
  return new Response(res.body, { status: res.status, headers })
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    const prefix = basePrefix(env)

    // (1) OAuth discovery — handle before anything else; these can arrive
    // unprefixed at the zone root.
    const kind = discoveryKind(url.pathname)
    if (kind) return handleDiscovery(kind, request, env)

    const authBase = `${prefix}/api/auth`

    // (2a) Two endpoints Better Auth ADVERTISES but never implements. The
    // mcp() plugin's authorization-server metadata always lists
    // `userinfo_endpoint` and `jwks_uri` under <basePath>/mcp/…, but the plugin
    // registers no route for either, so both 404. Metadata that points at a 404
    // is a broken promise to any client that follows it — fill them in here,
    // ahead of the Better Auth handler, rather than lying in the discovery doc.
    if (url.pathname === `${authBase}/mcp/token`) return handleMcpToken(request, env)
    if (url.pathname === `${authBase}/mcp/userinfo`) return handleUserinfo(request, env)
    if (url.pathname === `${authBase}/mcp/jwks`) return handleJwks(request, env)

    // (2) Better Auth owns <BASE_PATH>/api/auth/*. Hand it the request with the
    // prefix INTACT (its router basePath includes the prefix). Its own discovery
    // aliases at <BASE_PATH>/api/auth/.well-known/* were already caught in (1).
    if (url.pathname === authBase || url.pathname.startsWith(`${authBase}/`)) {
      const t0 = Date.now()
      try {
        const res = await getAuth(env).handler(request)
        console.log(
          JSON.stringify({
            op: 'auth',
            path: url.pathname,
            method: request.method,
            status: res.status,
            ms: Date.now() - t0,
          }),
        )
        return res
      } catch (e) {
        console.log(
          JSON.stringify({
            op: 'auth_err',
            path: url.pathname,
            method: request.method,
            ms: Date.now() - t0,
            err: e instanceof Error ? e.message : String(e),
          }),
        )
        throw e
      }
    }

    // (2b) A zone catch-all can send us EVERY path on the zone, including
    // ones that have nothing to do with this app. Answer them fast rather than
    // letting anything stall: the bare origin is the app's front door, so send
    // it to the app. Everything below still falls through to the asset handler,
    // which 404s unknown paths — the point is that a real response always
    // arrives, because a hang here is what silently killed OAuth clients.
    if (prefix && (url.pathname === '/' || url.pathname === '')) {
      const destination = new URL(`${url.origin}${prefix}/`)
      destination.search = url.search
      return Response.redirect(destination.toString(), 302)
    }

    // (3) Strip BASE_PATH; route root-relative like the un-prefixed deployment.
    let req = request
    let path = url.pathname
    if (prefix && (path === prefix || path.startsWith(`${prefix}/`))) {
      path = path.slice(prefix.length) || '/'
      url.pathname = path
      req = new Request(url.toString(), request)
    }

    if (path.startsWith('/xyz/')) return serveXyz(req, env, ctx)
    if (path.startsWith('/tiles/')) return serveTile(req, env)
    if (path === '/mcp' || path === '/mcp/') return handleMcp(req, env, ctx)
    if (path === '/api/session/ws' || path === '/api/session/ws/') return handleSessionWs(req, env)
    if (path.startsWith('/api/datasets/')) return serveScheduledData(req, env, path)
    if (path.startsWith('/api/')) return handleApi(req, env, ctx)

    const cors =
      path.startsWith('/data/') || path.startsWith('/assets/') || path.startsWith('/fonts/')
    if (cors && request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': 'Range, Content-Type',
        },
      })
    }
    const asset = await env.ASSETS.fetch(req)
    if (!cors) return asset
    const headers = new Headers(asset.headers)
    headers.set('Access-Control-Allow-Origin', '*')
    headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
    headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, ETag, Accept-Ranges')
    return new Response(asset.body, { status: asset.status, statusText: asset.statusText, headers })
  },
}

async function handleSessionWs(request: Request, env: Env): Promise<Response> {
  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
    return new Response('expected websocket', { status: 426 })
  }
  const identity = await authenticate(request, env)
  if (!identity) return new Response('unauthorized', { status: 401 })
  if (!env.SESSIONS) return new Response('sessions unbound', { status: 503 })
  const attach = { email: identity.email, tabId: crypto.randomUUID(), role: 'tab' as const }
  const headers = new Headers()
  for (const k of ['Upgrade', 'Connection', 'Sec-WebSocket-Key', 'Sec-WebSocket-Version', 'Sec-WebSocket-Protocol']) {
    const v = request.headers.get(k)
    if (v) headers.set(k, v)
  }
  headers.set('X-Session-Attach', JSON.stringify(attach))
  const stub = env.SESSIONS.getByName('email:' + normalizeEmail(identity.email))
  return stub.fetch(new Request(request, { headers }))
}

export type { Env }
