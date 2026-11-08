// OAuth routing in front of Better Auth's MCP authorization server.
//
// Better Auth serves the endpoints under <BASE_PATH>/api/auth (oauth2/*, jwks,
// .well-known/*). This module adds what the Worker owes it on top:
//
//   1. Discovery at the zone root. Clients probe RFC 8414, OIDC and RFC 9728
//      documents at /.well-known/… with the issuer or resource path inserted,
//      appended, or not at all. Every variant gets the one canonical document.
//   2. The Better Auth 1.6 paths (/api/auth/mcp/authorize|token|register|
//      userinfo|jwks). Clients connected before the upgrade stored those URLs,
//      so they keep answering, backed by the new endpoints.
//   3. The legacy bridge (oauthLegacy.ts) runs before the authorize and token
//      endpoints so a pre-upgrade client finds its record and refresh token.
//   4. A clear 503 on every auth route while migration 0013 has not been
//      applied. Better Auth 1.7 checks its schema at startup and refuses to run
//      on the old one, so this turns that into one readable answer.
//   5. Bearer tokens only. The provider would bind tokens to a key if a client
//      sent a DPoP proof; this server does not verify DPoP on /mcp, so proofs
//      are dropped and DPoP is not advertised.

import { getAuth, mcpResource } from './betterAuth'
import {
  bridgeLegacyClient,
  bridgeLegacyRefreshToken,
  observeTokenClient,
} from './oauthLegacy'
import type { Env } from './types'
import type { JsonValue } from '../shared/json'
import { isJsonObject, isJsonString } from '../shared/json'

/** Normalised BASE_PATH: "" or "/app" (no trailing slash). */
export function basePrefix(env: Env): string {
  return (env.BASE_PATH?.trim() ?? '').replace(/\/+$/, '')
}

type DiscoveryKind = 'authorization-server' | 'protected-resource' | 'openid-configuration'

export function discoveryKind(path: string): DiscoveryKind | null {
  if (path.includes('/.well-known/oauth-authorization-server')) return 'authorization-server'
  if (path.includes('/.well-known/oauth-protected-resource')) return 'protected-resource'
  // An OIDC client resolves the issuer (the origin) + this path. It must answer:
  // when nothing served it the request HUNG rather than 404ing, and claude.ai
  // gave up after an otherwise perfect OAuth.
  if (path.includes('/.well-known/openid-configuration')) return 'openid-configuration'
  return null
}

// DPoP fields the provider advertises; dropped because /mcp accepts bearer tokens only.
const DPOP_METADATA_FIELDS = ['dpop_signing_alg_values_supported', 'dpop_bound_access_tokens_required']

async function serveDiscovery(kind: DiscoveryKind, request: Request, env: Env): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, MCP-Protocol-Version',
      },
    })
  }
  const url = new URL(request.url)
  // The issuer is the bare origin, so the provider answers RFC 8414 and OIDC
  // discovery at the root paths. The protected-resource document lives at
  // the RFC 9728 path with the resource path inserted.
  if (kind === 'protected-resource') {
    url.pathname = `/.well-known/oauth-protected-resource${new URL(mcpResource(env)).pathname}`
  } else {
    url.pathname = `/.well-known/${kind === 'authorization-server' ? 'oauth-authorization-server' : 'openid-configuration'}`
  }
  url.search = ''
  const res = await getAuth(env).handler(new Request(url.toString(), { method: 'GET', headers: request.headers }))
  const headers = new Headers(res.headers)
  headers.set('Access-Control-Allow-Origin', '*')
  headers.delete('content-length')
  if (!res.ok) return new Response(res.body, { status: res.status, headers })
  const body: JsonValue = await res.json()
  if (isJsonObject(body)) {
    const doc = { ...body }
    for (const field of DPOP_METADATA_FIELDS) delete doc[field]
    return new Response(request.method === 'HEAD' ? null : JSON.stringify(doc), { status: res.status, headers })
  }
  return new Response(JSON.stringify(body), { status: res.status, headers })
}

// ---------------------------------------------------------------------------
// Schema guard. Production migrations are applied by hand, so this Worker can
// start before 0013 is on D1. Better Auth 1.7 then throws SCHEMA_MISMATCH for
// every call, so every /api/auth/* route and discovery answers 503 with a
// message naming the migration, and nothing is written. Session checks on
// /api fail closed (401). 1.6 access tokens on /mcp keep working, because they
// are read with plain SQL from the untouched 1.6 tables.
// ---------------------------------------------------------------------------

/** Tables 0013 creates that the provider cannot run without. */
const REQUIRED_TABLES = ['oauthClient', 'oauthRefreshToken', 'oauthResource']
// Only ever flips to true (a boolean, never a promise: see betterAuth.ts).
let schemaReady = false

export async function oauthSchemaReady(env: Env): Promise<boolean> {
  if (schemaReady) return true
  try {
    const { results } = await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${REQUIRED_TABLES.map((_, i) => `?${i + 1}`).join(', ')})`,
    )
      .bind(...REQUIRED_TABLES)
      .all<{ name: string }>()
    schemaReady = results.length === REQUIRED_TABLES.length
  } catch {
    schemaReady = false
  }
  return schemaReady
}

/** Test hook: forget a cached "ready". */
export function resetOAuthSchemaCheck(): void {
  schemaReady = false
}

function schemaMissing(): Response {
  console.log(JSON.stringify({ op: 'oauth_schema_missing', migration: '0013_oauth_provider.sql' }))
  return new Response(
    JSON.stringify({
      error: 'temporarily_unavailable',
      error_description: 'Sign-in is being upgraded: database migration 0013_oauth_provider.sql has not been applied yet.',
    }),
    {
      status: 503,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'Retry-After': '60',
        'Access-Control-Allow-Origin': '*',
      },
    },
  )
}

/** Old 1.6 endpoint → its 1.7 replacement, relative to the auth base. */
const LEGACY_ALIASES = new Map([
  ['/mcp/authorize', '/oauth2/authorize'],
  ['/mcp/token', '/oauth2/token'],
  ['/mcp/register', '/oauth2/register'],
  ['/mcp/userinfo', '/oauth2/userinfo'],
  ['/mcp/jwks', '/jwks'],
])

function withPath(request: Request, pathname: string, init?: RequestInit): Request {
  const url = new URL(request.url)
  url.pathname = pathname
  return new Request(url.toString(), { method: request.method, headers: request.headers, body: request.body, ...init })
}

async function handleAuthorize(request: Request, env: Env): Promise<Response> {
  const auth = getAuth(env)
  const clientId = new URL(request.url).searchParams.get('client_id')
  if (clientId) {
    try {
      await bridgeLegacyClient(env, auth, clientId, mcpResource(env))
    } catch (error) {
      logBridgeFailure('authorize', error instanceof Error ? error : String(error))
    }
  }
  return auth.handler(request)
}

async function handleToken(request: Request, env: Env): Promise<Response> {
  const auth = getAuth(env)
  if (request.method !== 'POST') return auth.handler(request)
  const headers = new Headers(request.headers)
  // Bearer tokens only (see header comment).
  headers.delete('dpop')
  const raw = await request.text()
  const type = headers.get('content-type') ?? ''
  let form = new URLSearchParams()
  if (type.includes('application/x-www-form-urlencoded')) form = new URLSearchParams(raw)
  else if (type.includes('application/json')) {
    try {
      const parsed: JsonValue = JSON.parse(raw)
      if (isJsonObject(parsed)) {
        for (const [key, value] of Object.entries(parsed)) if (isJsonString(value)) form.set(key, value)
      }
    } catch {
      // Let the provider produce its own error for a malformed body.
    }
  }
  const observed = observeTokenClient(headers, form)
  try {
    const resource = mcpResource(env)
    const refreshToken = form.get('grant_type') === 'refresh_token' ? form.get('refresh_token') : null
    if (refreshToken) await bridgeLegacyRefreshToken(env, auth, refreshToken, resource, observed ?? undefined)
    if (observed) await bridgeLegacyClient(env, auth, observed.clientId, resource, observed)
  } catch (error) {
    logBridgeFailure('token', error instanceof Error ? error : String(error))
  }
  return auth.handler(new Request(request.url, { method: 'POST', headers, body: raw }))
}

function logBridgeFailure(step: string, error: Error | string): void {
  console.log(JSON.stringify({ op: 'oauth_legacy_bridge_failed', step, err: error instanceof Error ? error.message : error }))
}

/**
 * Handle an OAuth or discovery request, or return null when `request` is not
 * one. Everything else under <BASE_PATH>/api/auth/* is passed to Better Auth by
 * the caller, after the schema guard here has let it through.
 */
export async function handleOAuthRequest(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url)
  const kind = discoveryKind(url.pathname)
  if (kind) return (await oauthSchemaReady(env)) ? serveDiscovery(kind, request, env) : schemaMissing()

  const authBase = `${basePrefix(env)}/api/auth`
  if (url.pathname !== authBase && !url.pathname.startsWith(`${authBase}/`)) return null
  if (!(await oauthSchemaReady(env))) return schemaMissing()
  let sub = url.pathname.slice(authBase.length)
  let req = request
  const alias = LEGACY_ALIASES.get(sub)
  if (alias) {
    sub = alias
    req = withPath(request, `${authBase}${alias}`)
  }
  if (sub === '/oauth2/authorize') return handleAuthorize(req, env)
  if (sub === '/oauth2/token') return handleToken(req, env)
  if (alias) return getAuth(env).handler(req)
  return null
}
