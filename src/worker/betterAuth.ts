// Better Auth instance factory for the Worker.
//
// ONE INSTANCE PER REQUEST — never cache across requests. This is load-bearing.
//
// `betterAuth()` builds its context lazily and keeps it as a single internal
// promise (`auth.$context`) that every handler awaits. That promise resolves off
// the back of D1 I/O, so it belongs to the request that first triggered it.
// Cloudflare Workers scope I/O to the request that created it: a promise settled
// in request A NEVER settles for request B. Because `env` is the same object for
// every request in a warm isolate, memoising the instance per-env (a WeakMap,
// which is what this file used to do) handed request B request A's context —
// and B hung forever. Symptoms: `wallTime` climbing to the client timeout with
// `cpuTime: 1ms` and `outcome: canceled` in the tail, no exception, no log line.
// User-visible, this was the Google button stuck on "One moment…" and MCP OAuth
// discovery timing out so connectors (Grok, Claude, Cursor) died on a blank
// popup. Constructing per request is cheap — the expensive work is the lazy init
// that has to happen per request anyway.
//
// Better Auth speaks D1 natively: pass the D1 binding straight as `database`.
// Social providers are wired ONLY when their client id + secret are present, so
// email/password works out of the box for the closed beta with zero OAuth
// setup, and Google/GitHub light up the moment the human adds credentials.
// The mcp() plugin turns Better Auth into an OAuth 2.1 provider so AI clients
// can authorise against /mcp (discovery at /api/auth/.well-known/...).

import { betterAuth } from 'better-auth'
import { jwt, mcp } from 'better-auth/plugins'
import type { Env } from './types'

interface SocialProvider {
  clientId: string
  clientSecret: string
}

function buildSocialProviders(env: Env) {
  const providers: Record<string, SocialProvider> = {}
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    providers.google = {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    }
  }
  if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) {
    providers.github = {
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
    }
  }
  return providers
}

// Construct the instance. Its return type (with the mcp plugin's endpoints like
// getMcpSession) is inferred here and preserved through getAuth — we never
// annotate it with a widened `BetterAuthOptions`, which would erase the plugin
// API surface.
function buildAuth(env: Env) {
  // BETTER_AUTH_URL is the PUBLIC app base, which under a path prefix includes
  // it (e.g. https://example.org/app). Better Auth derives BOTH its
  // router basePath AND every absolute URL it emits (OAuth endpoints, social
  // redirect_uri, discovery metadata, Location redirects) from the *pathname* of
  // its baseURL — and it only auto-appends the default /api/auth when baseURL has
  // NO path. So we append /api/auth ourselves (idempotently): the auth mount
  // becomes <app base>/api/auth, e.g. https://example.org/app/api/auth,
  // and every generated URL correctly stays under /app. On workers.dev
  // staging / local dev (no prefix) this yields https://…/api/auth as before.
  const appBase = (env.BETTER_AUTH_URL?.trim() || 'http://localhost:8787').replace(/\/+$/, '')
  const baseURL = appBase.endsWith('/api/auth') ? appBase : `${appBase}/api/auth`
  const origin = new URL(baseURL).origin
  // FAIL CLOSED on a missing/weak secret. Better Auth's own guard falls back to
  // a globally-known DEFAULT_SECRET and only throws when `NODE_ENV==='production'`
  // — but on Cloudflare Workers NODE_ENV is never set, so that guard is inert and
  // a deploy without the secret would silently sign every session/CSRF/verification
  // token with a public key. We assert presence + length ourselves.
  const secret = env.BETTER_AUTH_SECRET?.trim()
  if (!secret || secret.length < 32) {
    throw new Error(
      'BETTER_AUTH_SECRET is missing or too short (need ≥32 chars). Set it via `wrangler secret put BETTER_AUTH_SECRET` (prod) or .dev.vars (local).',
    )
  }
  return betterAuth({
    database: env.DB,
    secret,
    baseURL,
    basePath: '/api/auth',
    // Same-origin SPA — no cross-site cookie dance needed. trustedOrigins
    // compares by ORIGIN, so the path prefix is irrelevant here: the deployment
    // origin (e.g. https://example.org) is the only trusted caller. The
    // session cookie is scoped to path "/" (Better Auth default) so the SPA
    // under /app sends it to /app/api/* — do not narrow it.
    trustedOrigins: [origin],
    emailAndPassword: {
      enabled: true,
      // Closed beta: let people in immediately. Flip to true once an email
      // sender is wired (v4) to require verification.
      requireEmailVerification: false,
    },
    socialProviders: buildSocialProviders(env),
    // Cookie OAuth state — Workers-safe. The database strategy writes a
    // verification row on every /sign-in/social; that path was hanging the
    // isolate so the browser stuck on "One moment…".
    //
    // Account linking: email sign-up does not verify addresses (no mailer), so
    // the Better Auth default `requireLocalEmailVerified: true` rejects Google
    // for the same Gmail. Symptom: Google "succeeds" then the user lands back
    // on the sign-in card with no session (`error=account_not_linked` in the
    // URL, previously unshown). Same email is one identity — link it.
    account: {
      storeStateStrategy: 'cookie',
      accountLinking: {
        enabled: true,
        trustedProviders: ['google', 'github'],
        requireLocalEmailVerified: false,
      },
    },
    advanced: {
      ipAddress: {
        ipAddressHeaders: ['cf-connecting-ip', 'x-real-ip', 'x-forwarded-for'],
      },
    },
    // Enable rate limiting EXPLICITLY. Better Auth's default is `isProduction`,
    // which is false on Workers (NODE_ENV unset) — so without this, sign-in has
    // no brute-force / credential-stuffing throttle. Tight limit on the
    // credential endpoints, looser global default.
    rateLimit: {
      enabled: true,
      // Persist counters in D1 — the default in-memory store does NOT work on
      // Workers (each request may hit a different isolate, so counts never
      // accumulate and the limit silently never fires in production).
      storage: 'database',
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 5 },
        '/sign-up/email': { window: 60, max: 5 },
        '/sign-in/social': { window: 60, max: 20 },
      },
    },
    // `resource` is the CANONICAL URI of the protected resource — our MCP
    // endpoint, <app base>/mcp. RFC 9728 §3.3 requires the `resource` field of
    // the protected-resource metadata to be identical to the URL the client
    // used; Better Auth's default is the bare ORIGIN, which is correct only for
    // a server mounted at the zone root. Under the /app path prefix that
    // default advertised the bare origin for a server that actually
    // lives at `https://example.org/app/mcp`, and strict clients
    // (claude.ai's connector) reject the mismatch — the popup finishes the
    // OAuth dance and then reports "Authorization with <server> failed".
    plugins: [
      // The jwt plugin owns an RS256 key pair in D1 (migration 0006) and is
      // what makes the mcp plugin's discovery document HONEST. Without it the
      // oidc-provider signs the id_token HS256 with the client's secret, while
      // the metadata hardcodes RS256 + a jwks_uri — so a client that verifies
      // the id_token per the metadata (claude.ai's connector) fails right after
      // a SUCCESSFUL token exchange, which is exactly what we were seeing:
      // registration, code and access token all landed, then the connector
      // reported "Authorization with <server> failed". `useJWTPlugin` below
      // switches the id_token over to those keys.
      jwt({ jwks: { keyPairConfig: { alg: 'RS256' } } }),
      mcp({
        loginPage: new URL(appBase).pathname || '/',
        resource: `${appBase}/mcp`,
        // `loginPage` is duplicated here because OIDCOptions requires it; the
        // mcp plugin passes this object straight through to oidcProvider().
        oidcConfig: { loginPage: new URL(appBase).pathname || '/', useJWTPlugin: true },
      }),
    ],
  })
}

/**
 * Build a Better Auth instance for THIS request. Do not memoise the result
 * across requests (see the header comment): on Workers a cached instance carries
 * a cross-request promise that never settles, which hangs every auth route.
 */
export function getAuth(env: Env): ReturnType<typeof buildAuth> {
  return buildAuth(env)
}

/** Which social providers are actually configured (for the sign-in UI probe). */
export function configuredProviders(env: Env): string[] {
  const out: string[] = []
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) out.push('google')
  if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) out.push('github')
  return out
}
