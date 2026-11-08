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
// The mcp() plugin (@better-auth/mcp, built on @better-auth/oauth-provider)
// turns Better Auth into the OAuth 2.1 authorization server for /mcp. Clients
// identify themselves two ways:
//   - Client ID Metadata Documents (cimd()): the client_id is an HTTPS URL to a
//     JSON document the client hosts. Claude and ChatGPT use this when the
//     server advertises it, so no client row is created per connection.
//   - Dynamic Client Registration (RFC 7591), kept on for clients that do not
//     support CIMD yet.
// Endpoints live under <app base>/api/auth/oauth2/*. The old 1.6 paths
// (/api/auth/mcp/*) that already-connected clients stored are aliased in
// index.ts, and their stored clients and tokens move across in oauthLegacy.ts.

import { betterAuth } from 'better-auth'
import { jwt } from 'better-auth/plugins'
import { cimd } from '@better-auth/cimd'
import { mcp } from '@better-auth/mcp'
import { createCimdFetch, parseAllowedHosts } from './cimdFetch'
import type { Env } from './types'

/**
 * Table names for the OAuth provider's models. Two of the provider's tables
 * share names with Better Auth 1.6's MCP tables (`oauthAccessToken`,
 * `oauthConsent`) but not their columns. Renaming the provider's copies lets
 * migration 0013 be purely additive: the 1.6 tables stay exactly as they are,
 * so a Worker still running 1.6 keeps working after the migration, and the
 * new Worker reads them for the carry-over in oauthLegacy.ts.
 */
export const OAUTH_PROVIDER_TABLES = {
  accessToken: 'oauthProviderAccessToken',
  consent: 'oauthProviderConsent',
} as const

export const OAUTH_PROVIDER_SCHEMA = {
  oauthAccessToken: { modelName: OAUTH_PROVIDER_TABLES.accessToken },
  oauthConsent: { modelName: OAUTH_PROVIDER_TABLES.consent },
}

/** Scopes this server grants. `offline_access` is what earns a refresh token. */
export const MCP_SCOPES = ['openid', 'profile', 'email', 'offline_access']

/** Public app base without a trailing slash, e.g. https://example.org/app. */
export function appBaseUrl(env: Env): string {
  return (env.BETTER_AUTH_URL?.trim() || 'http://localhost:8787').replace(/\/+$/, '').replace(/\/api\/auth$/, '')
}

/** Canonical MCP resource identifier; access tokens carry it as `aud`. */
export function mcpResource(env: Env): string {
  return `${appBaseUrl(env)}/mcp`
}

/**
 * OAuth issuer: the bare origin. That is what the 1.6 setup put in `iss`, so
 * clients connected before the upgrade see no issuer change, and it keeps the
 * RFC 8414 / OIDC discovery documents at the zone root
 * (/.well-known/oauth-authorization-server, /.well-known/openid-configuration).
 */
export function oauthIssuer(env: Env): string {
  return new URL(appBaseUrl(env)).origin
}

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

// Construct the instance. Its return type (with the plugins' endpoints, such as
// the jwt plugin's getJwks) is inferred here and preserved through getAuth — we never
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
  const appBase = appBaseUrl(env)
  const baseURL = `${appBase}/api/auth`
  const origin = new URL(baseURL).origin
  const appPath = new URL(appBase).pathname.replace(/\/+$/, '') || '/'
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
    // The jwt plugin's /token route would hand out session JWTs signed with the
    // same key as OAuth access tokens; clients use /oauth2/token instead.
    disabledPaths: ['/token'],
    plugins: [
      // RS256 key pair in D1 (migration 0006). Signs id_tokens AND the JWT
      // access tokens the provider mints for the MCP resource, and serves them
      // at <base>/api/auth/jwks. `issuer` pins `iss` to the origin (see
      // oauthIssuer). No set-auth-jwt header: nothing in the app reads it.
      jwt({
        jwks: { keyPairConfig: { alg: 'RS256' } },
        jwt: { issuer: origin },
        disableSettingJwtHeader: true,
      }),
      // `resource` is the CANONICAL URI of the protected resource: our MCP
      // endpoint, <app base>/mcp. RFC 9728 §3.3 requires the protected-resource
      // metadata's `resource` to equal the URL the client used, and strict
      // clients (claude.ai) reject a mismatch after an otherwise good OAuth.
      // Access tokens are audience-bound to it.
      mcp({
        loginPage: appPath,
        // The same SPA route renders the consent card (ConnectFlow).
        consentPage: appPath,
        resource: mcpResource(env),
        scopes: MCP_SCOPES,
        schema: OAUTH_PROVIDER_SCHEMA,
        // DCR stays on as a fallback for clients without CIMD support. Better
        // Auth never enables it implicitly. Anonymous registrations get only
        // the scopes above, and 'infer' accepts native clients' loopback and
        // custom-scheme callbacks (Cursor, Claude Code).
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        clientRegistrationDefaultScopes: MCP_SCOPES,
        clientRegistrationDefaultApplicationType: 'infer',
      }),
      // Client ID Metadata Documents, MCP 2026-07-28 profile (requires
      // client_name and redirect_uris). The Workers transport and its limits
      // are documented in cimdFetch.ts.
      cimd({
        fetchClientMetadataResource: createCimdFetch({ allowedHosts: parseAllowedHosts(env.CIMD_ALLOWED_HOSTS) }),
        metadataProfile: 'mcp-2026-07-28',
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
