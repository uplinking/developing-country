/// <reference types="@cloudflare/workers-types" />
//
// Platform Worker — the explorer backbone. Routes:
//   /api/auth/*  → Better Auth handler (sign-up/in, social, MCP OAuth, discovery)
//   /.well-known/*  → OAuth discovery proxied to Better Auth (oauthRoutes.ts)
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
import { basePrefix, handleOAuthRequest } from './oauthRoutes'
import { MapSession } from './session'
import { normalizeEmail } from './identity'
import { authenticate } from './auth'

export { MapSession }

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    const prefix = basePrefix(env)

    // (1) OAuth: discovery documents (which can arrive unprefixed at the zone
    // root), the authorize and token endpoints, and the Better Auth 1.6 paths
    // that clients connected before the upgrade still use. See oauthRoutes.ts.
    const oauth = await handleOAuthRequest(request, env)
    if (oauth) return oauth

    const authBase = `${prefix}/api/auth`

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
