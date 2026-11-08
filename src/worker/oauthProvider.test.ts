// End-to-end OAuth tests against the real Better Auth handler and the real
// migrations, on a bun:sqlite-backed D1 binding (testing/d1.ts). Nothing here
// touches the network: CIMD fetches go through a stubbed global fetch.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readdirSync, readFileSync } from 'node:fs'
import { getMigrations } from 'better-auth/db/migration'
import { jwt } from 'better-auth/plugins'
import { signPrivateKeyJwtClientAssertion } from 'better-auth/oauth2'
import { cimd } from '@better-auth/cimd'
import { mcp } from '@better-auth/mcp'
import { authenticateMcp } from './auth'
import { getAuth, MCP_SCOPES, OAUTH_PROVIDER_SCHEMA } from './betterAuth'
import { hashLikeProvider } from './oauthLegacy'
import { handleOAuthRequest, resetOAuthSchemaCheck } from './oauthRoutes'
import { TestD1 } from './testing/d1'
import type { Env } from './types'

const ORIGIN = 'https://example.org'
const RESOURCE = `${ORIGIN}/mcp`
const CLAUDE_CALLBACK = 'https://claude.ai/api/mcp/auth_callback'
const SECRET = 'k9Q2v7Lm4Zx8Rt1Wp6Ys3Nd5Hb0Jc2Fg'

// The schema check caches "ready" per isolate; each test starts fresh.
beforeEach(() => resetOAuthSchemaCheck())

function makeEnv(db: TestD1): Env {
  const env: Partial<Env> = { DB: db as unknown as D1Database, BETTER_AUTH_SECRET: SECRET, BETTER_AUTH_URL: ORIGIN, BASE_PATH: '' }
  return env as Env
}

async function call(env: Env, request: Request): Promise<Response> {
  return (await handleOAuthRequest(request, env)) ?? getAuth(env).handler(request)
}

function form(body: Record<string, string>): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  }
}

async function json(response: Response): Promise<Record<string, unknown>> {
  const body: unknown = await response.json()
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new Error('expected a JSON object')
  return { ...body }
}

function str(value: unknown): string {
  if (typeof value !== 'string') throw new Error(`expected a string, got ${String(value)}`)
  return value
}

function claims(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'))
}

async function signUp(env: Env, email = 'person@example.org'): Promise<{ cookie: string; userId: string }> {
  const res = await call(
    env,
    new Request(`${ORIGIN}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ email, password: 'correct-horse-battery-staple', name: 'Person' }),
    }),
  )
  expect(res.status).toBe(200)
  const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
  const body = await json(res)
  const user = body.user
  if (typeof user !== 'object' || user === null) throw new Error('no user')
  return { cookie, userId: str(Reflect.get(user, 'id')) }
}

async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = crypto.randomUUID() + crypto.randomUUID()
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return { verifier, challenge: Buffer.from(digest).toString('base64url') }
}

/** Authorize → consent → code, as a signed-in browser would. */
async function authorizeCode(
  env: Env,
  cookie: string,
  clientId: string,
  redirectUri: string,
  challenge: string,
  path = '/api/auth/oauth2/authorize',
): Promise<string> {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: MCP_SCOPES.join(' '),
    state: 'state-1',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: RESOURCE,
  })
  const authorize = await call(env, new Request(`${ORIGIN}${path}?${query}`, { headers: { cookie } }))
  expect(authorize.status).toBe(302)
  const location = new URL(str(authorize.headers.get('location')), ORIGIN)
  // The consent page is the SPA root and carries a signed copy of the request.
  expect(location.pathname).toBe('/')
  expect(location.searchParams.get('sig')).toBeString()
  const consent = await call(
    env,
    new Request(`${ORIGIN}/api/auth/oauth2/consent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, origin: ORIGIN },
      body: JSON.stringify({ accept: true, oauth_query: location.search.slice(1) }),
    }),
  )
  expect(consent.status).toBe(200)
  const redirect = new URL(str((await json(consent)).url))
  expect(redirect.origin + redirect.pathname).toBe(redirectUri)
  expect(redirect.searchParams.get('iss')).toBe(ORIGIN)
  return str(redirect.searchParams.get('code'))
}

async function mcpIdentity(env: Env, accessToken: string) {
  return authenticateMcp(new Request(RESOURCE, { method: 'POST', headers: { authorization: `Bearer ${accessToken}` } }), env)
}

describe('migration 0013', () => {
  test('matches the schema Better Auth generates for this configuration', async () => {
    // Re-derive the schema diff the way `npx auth generate` would, from a
    // database that already has every migration applied. Anything left to
    // create or add means the hand-written migration drifted.
    const db = new Database(':memory:')
    const dir = new URL('../../migrations/', import.meta.url)
    for (const file of readdirSync(dir).sort()) db.run(readFileSync(new URL(file, dir), 'utf8'))
    const { toBeCreated, toBeAdded } = await getMigrations({
      database: db,
      secret: SECRET,
      baseURL: `${ORIGIN}/api/auth`,
      emailAndPassword: { enabled: true },
      rateLimit: { enabled: true, storage: 'database' },
      plugins: [
        jwt(),
        mcp({ loginPage: '/', consentPage: '/', resource: RESOURCE, schema: OAUTH_PROVIDER_SCHEMA }),
        cimd({ fetchClientMetadataResource: async () => new Response('{}') }),
      ],
    })
    expect(toBeCreated.map((table) => table.table)).toEqual([])
    expect(toBeAdded.map((table) => table.table)).toEqual([])
    db.close()
  })

  test('is additive: the 1.6 tables, their columns and their rows are untouched', () => {
    const db = new TestD1().migrate({ before: '0013' })
    seedLegacy(db)
    const shape = (table: string) => db.sqlite.query(`PRAGMA table_info("${table}")`).all()
    const dump = (table: string) => db.sqlite.query(`SELECT * FROM "${table}" ORDER BY id`).all()
    const tables = ['oauthApplication', 'oauthAccessToken', 'oauthConsent', 'user', 'session', 'account']
    const before = tables.map((table) => [shape(table), dump(table)])
    db.migrate({ only: '0013_oauth_provider.sql' })
    expect(tables.map((table) => [shape(table), dump(table)])).toEqual(before)
    // Nothing is copied by SQL; the Worker moves rows on first use.
    expect(db.sqlite.query('SELECT COUNT(*) AS n FROM oauthClient').get()).toEqual({ n: 0 })
    const sql = readFileSync(new URL('../../migrations/0013_oauth_provider.sql', import.meta.url), 'utf8')
    const statements = sql
      .split('\n')
      .filter((line) => !line.startsWith('--'))
      .join('\n')
      .split(';')
      .map((statement) => statement.trim())
      .filter(Boolean)
    for (const statement of statements) {
      expect(statement).toMatch(/^(CREATE TABLE|CREATE INDEX|CREATE UNIQUE INDEX|ALTER TABLE "\w+" ADD COLUMN) /)
    }
  })

  test('the 1.6 Worker\'s queries still work after 0013 is applied', () => {
    // The exact statement shapes Better Auth 1.6's mcp() plugin ran.
    const db = new TestD1().migrate({ before: '0013' })
    seedLegacy(db)
    db.migrate({ only: '0013_oauth_provider.sql' })
    expect(db.sqlite.query('SELECT * FROM "oauthAccessToken" WHERE "refreshToken" = ?').get(LEGACY.refresh)).toMatchObject({ clientId: LEGACY.publicClient })
    expect(db.sqlite.query('SELECT * FROM "oauthApplication" WHERE "clientId" = ?').get(LEGACY.webClient)).toMatchObject({ type: 'web' })
    const now = new Date().toISOString()
    db.sqlite
      .query(
        `INSERT INTO "oauthAccessToken" (id, accessToken, refreshToken, accessTokenExpiresAt, refreshTokenExpiresAt, clientId, userId, scopes, createdAt, updatedAt)
         VALUES ('tok-new', 'a2', 'r2', ?, ?, ?, ?, 'openid', ?, ?)`,
      )
      .run(now, now, LEGACY.publicClient, LEGACY.userId, now, now)
    db.sqlite.query('INSERT INTO "jwks" (id, publicKey, privateKey, createdAt) VALUES (?, ?, ?, ?)').run('k-1.6', '{}', '{}', now)
    expect(db.sqlite.query('SELECT id, publicKey, privateKey, createdAt, expiresAt FROM "jwks"').all()).toHaveLength(1)
  })
})

describe('before migration 0013 is applied', () => {
  test('auth routes answer a clear 503 and write nothing; 1.6 access tokens still work', async () => {
    const db = new TestD1().migrate({ before: '0013' })
    seedLegacy(db)
    const env = makeEnv(db)
    const tablesBefore = db.sqlite.query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all()
    const paths = [
      ['GET', '/.well-known/oauth-authorization-server'],
      ['GET', '/.well-known/oauth-protected-resource/mcp'],
      ['GET', `/api/auth/oauth2/authorize?client_id=${LEGACY.publicClient}&response_type=code`],
      ['POST', '/api/auth/oauth2/token'],
      ['POST', '/api/auth/mcp/token'],
      ['POST', '/api/auth/oauth2/register'],
      ['POST', '/api/auth/oauth2/consent'],
      ['GET', '/api/auth/jwks'],
      ['POST', '/api/auth/sign-in/email'],
      ['GET', '/api/auth/get-session'],
    ] as const
    for (const [method, path] of paths) {
      const init: RequestInit = method === 'POST' ? form({ grant_type: 'refresh_token', refresh_token: LEGACY.refresh, client_id: LEGACY.publicClient }) : {}
      const res = await call(env, new Request(`${ORIGIN}${path}`, init))
      expect(res.status, path).toBe(503)
      expect(await json(res), path).toMatchObject({ error: 'temporarily_unavailable' })
    }
    expect(db.sqlite.query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all()).toEqual(tablesBefore)
    expect(await mcpIdentity(env, LEGACY.access)).toMatchObject({ email: LEGACY.email })

    // Once the migration lands, the same Worker recovers without a restart.
    db.migrate({ only: '0013_oauth_provider.sql' })
    const res = await call(
      env,
      new Request(`${ORIGIN}/api/auth/mcp/token`, form({ grant_type: 'refresh_token', refresh_token: LEGACY.refresh, client_id: LEGACY.publicClient })),
    )
    expect(res.status).toBe(200)
  })
})

describe('discovery', () => {
  test('advertises CIMD, DCR and public clients, without DPoP', async () => {
    const env = makeEnv(new TestD1().migrate())
    for (const path of ['/.well-known/oauth-authorization-server', '/.well-known/openid-configuration']) {
      const doc = await json(await call(env, new Request(`${ORIGIN}${path}`)))
      expect(doc.issuer).toBe(ORIGIN)
      expect(doc.client_id_metadata_document_supported).toBe(true)
      expect(doc.registration_endpoint).toBe(`${ORIGIN}/api/auth/oauth2/register`)
      expect(doc.token_endpoint).toBe(`${ORIGIN}/api/auth/oauth2/token`)
      expect(doc.token_endpoint_auth_methods_supported).toContain('none')
      expect(doc.token_endpoint_auth_methods_supported).toContain('private_key_jwt')
      expect(doc.code_challenge_methods_supported).toEqual(['S256'])
      expect(doc).not.toHaveProperty('dpop_signing_alg_values_supported')
    }
    for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']) {
      const doc = await json(await call(env, new Request(`${ORIGIN}${path}`)))
      expect(doc.resource).toBe(RESOURCE)
      expect(doc.authorization_servers).toEqual([ORIGIN])
      expect(doc).not.toHaveProperty('dpop_signing_alg_values_supported')
    }
  })
})

describe('dynamic client registration', () => {
  test('registers, authorizes, exchanges, calls /mcp and refreshes', async () => {
    const env = makeEnv(new TestD1().migrate())
    const { cookie } = await signUp(env)
    const registered = await call(
      env,
      new Request(`${ORIGIN}/api/auth/oauth2/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          client_name: 'Claude',
          redirect_uris: [CLAUDE_CALLBACK],
          token_endpoint_auth_method: 'none',
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
        }),
      }),
    )
    expect(registered.status).toBe(201)
    const clientId = str((await json(registered)).client_id)
    const { verifier, challenge } = await pkce()
    const code = await authorizeCode(env, cookie, clientId, CLAUDE_CALLBACK, challenge)

    const exchanged = await call(
      env,
      new Request(
        `${ORIGIN}/api/auth/oauth2/token`,
        form({ grant_type: 'authorization_code', code, redirect_uri: CLAUDE_CALLBACK, client_id: clientId, code_verifier: verifier, resource: RESOURCE }),
      ),
    )
    expect(exchanged.status).toBe(200)
    const tokens = await json(exchanged)
    expect(tokens.token_type).toBe('Bearer')
    const access = claims(str(tokens.access_token))
    expect(access.iss).toBe(ORIGIN)
    expect(access.aud).toContain(RESOURCE)
    expect(access).not.toHaveProperty('cnf')
    expect(claims(str(tokens.id_token)).iss).toBe(ORIGIN)
    expect(await mcpIdentity(env, str(tokens.access_token))).toMatchObject({ email: 'person@example.org', mode: 'user' })

    const refreshed = await call(
      env,
      new Request(`${ORIGIN}/api/auth/oauth2/token`, form({ grant_type: 'refresh_token', refresh_token: str(tokens.refresh_token), client_id: clientId })),
    )
    expect(refreshed.status).toBe(200)
    expect(await mcpIdentity(env, str((await json(refreshed)).access_token))).toMatchObject({ email: 'person@example.org' })
  })

  test('drops DPoP proofs so tokens stay bearer tokens', async () => {
    const env = makeEnv(new TestD1().migrate())
    const { cookie } = await signUp(env)
    const registered = await json(
      await call(
        env,
        new Request(`${ORIGIN}/api/auth/oauth2/register`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ client_name: 'Native', redirect_uris: [CLAUDE_CALLBACK], token_endpoint_auth_method: 'none' }),
        }),
      ),
    )
    const clientId = str(registered.client_id)
    const { verifier, challenge } = await pkce()
    const code = await authorizeCode(env, cookie, clientId, CLAUDE_CALLBACK, challenge)
    const res = await call(
      env,
      new Request(`${ORIGIN}/api/auth/oauth2/token`, {
        method: 'POST',
        // A malformed proof: if it reached the provider the request would fail.
        headers: { 'content-type': 'application/x-www-form-urlencoded', dpop: 'not-a-real-proof' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: CLAUDE_CALLBACK, client_id: clientId, code_verifier: verifier, resource: RESOURCE }),
      }),
    )
    expect(res.status).toBe(200)
    const tokens = await json(res)
    expect(tokens.token_type).toBe('Bearer')
    expect(claims(str(tokens.access_token))).not.toHaveProperty('cnf')
  })

  test('rejects an access token minted for another audience', async () => {
    const env = makeEnv(new TestD1().migrate())
    await signUp(env)
    const auth = getAuth(env)
    const { token } = await auth.api.signJWT({ body: { payload: { sub: 'someone', aud: 'https://elsewhere.example/mcp', azp: 'x' } } })
    expect(await mcpIdentity(env, token)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Pre-upgrade (Better Auth 1.6) rows. Shapes copied from what 1.6's mcp()
// plugin wrote: plaintext secrets and tokens, comma-joined redirect URLs,
// space-separated scopes, ISO-8601 dates, 0/1 booleans.
// ---------------------------------------------------------------------------

const LEGACY = {
  userId: 'legacy-user',
  email: 'early@example.org',
  publicClient: 'legacyPublicClientId0000000000000',
  webClient: 'legacyWebClientId00000000000000000',
  webSecret: 'legacyWebSecret0000000000000000000',
  access: 'legacyAccessToken000000000000000',
  refresh: 'legacyRefreshToken00000000000000',
  webRefresh: 'legacyWebRefreshToken000000000000',
  expiredRefresh: 'legacyExpiredRefresh0000000000000',
}

function iso(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString()
}

function seedLegacy(db: TestD1): void {
  const now = iso(0)
  db.sqlite
    .query('INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)')
    .run(LEGACY.userId, 'Early', LEGACY.email, now, now)
  const app = db.sqlite.query(
    `INSERT INTO "oauthApplication" (id, name, icon, metadata, clientId, clientSecret, redirectUrls, type, disabled, userId, createdAt, updatedAt)
     VALUES (?, ?, NULL, NULL, ?, ?, ?, ?, 0, NULL, ?, ?)`,
  )
  app.run('app-public', 'Claude', LEGACY.publicClient, '', `${CLAUDE_CALLBACK},https://claude.com/api/mcp/auth_callback`, 'public', now, now)
  app.run('app-web', 'ChatGPT', LEGACY.webClient, LEGACY.webSecret, 'https://chatgpt.com/connector_platform_oauth_redirect', 'web', now, now)
  const token = db.sqlite.query(
    `INSERT INTO "oauthAccessToken" (id, accessToken, refreshToken, accessTokenExpiresAt, refreshTokenExpiresAt, clientId, userId, scopes, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'openid profile email offline_access', ?, ?)`,
  )
  token.run('tok-1', LEGACY.access, LEGACY.refresh, iso(30 * 60_000), iso(6 * 86_400_000), LEGACY.publicClient, LEGACY.userId, now, now)
  token.run('tok-2', 'legacyWebAccess', LEGACY.webRefresh, iso(-60_000), iso(6 * 86_400_000), LEGACY.webClient, LEGACY.userId, now, now)
  token.run('tok-3', 'legacyExpiredAccess', LEGACY.expiredRefresh, iso(-86_400_000), iso(-60_000), LEGACY.publicClient, LEGACY.userId, now, now)
  db.sqlite
    .query(
      `INSERT INTO "oauthConsent" (id, clientId, userId, scopes, createdAt, updatedAt, consentGiven)
       VALUES ('consent-1', ?, ?, 'openid profile email offline_access', ?, ?, 1)`,
    )
    .run(LEGACY.publicClient, LEGACY.userId, now, now)
}

function upgradedEnv(): { env: Env; db: TestD1 } {
  const db = new TestD1().migrate({ before: '0013' })
  seedLegacy(db)
  db.migrate({ only: '0013_oauth_provider.sql' })
  return { env: makeEnv(db), db }
}

describe('connections made before the upgrade', () => {
  test('an unexpired 1.6 access token still opens /mcp', async () => {
    const { env } = upgradedEnv()
    expect(await mcpIdentity(env, LEGACY.access)).toMatchObject({ email: LEGACY.email })
    expect(await mcpIdentity(env, 'legacyWebAccess')).toBeNull() // expired a minute ago
    expect(await mcpIdentity(env, 'not-a-token')).toBeNull()
  })

  test('a public client refreshes at the old /mcp/token URL without reconnecting', async () => {
    const { env, db } = upgradedEnv()
    const res = await call(
      env,
      new Request(`${ORIGIN}/api/auth/mcp/token`, form({ grant_type: 'refresh_token', refresh_token: LEGACY.refresh, client_id: LEGACY.publicClient })),
    )
    expect(res.status).toBe(200)
    const tokens = await json(res)
    expect(await mcpIdentity(env, str(tokens.access_token))).toMatchObject({ email: LEGACY.email })
    expect(claims(str(tokens.access_token)).aud).toContain(RESOURCE)

    // The client moved across with its consent and resource link; the
    // refresh token is stored hashed, never in plaintext.
    const client = db.sqlite.query('SELECT tokenEndpointAuthMethod, redirectUris, clientSecret FROM oauthClient WHERE clientId = ?').get(LEGACY.publicClient)
    expect(client).toEqual({
      tokenEndpointAuthMethod: 'none',
      redirectUris: JSON.stringify([CLAUDE_CALLBACK, 'https://claude.com/api/mcp/auth_callback']),
      clientSecret: null,
    })
    expect(db.sqlite.query('SELECT COUNT(*) AS n FROM oauthConsent WHERE clientId = ?').get(LEGACY.publicClient)).toEqual({ n: 1 })
    expect(db.sqlite.query('SELECT COUNT(*) AS n FROM oauthClientResource WHERE clientId = ?').get(LEGACY.publicClient)).toEqual({ n: 1 })
    expect(db.sqlite.query('SELECT COUNT(*) AS n FROM oauthRefreshToken WHERE token = ?').get(LEGACY.refresh)).toEqual({ n: 0 })
    expect(db.sqlite.query('SELECT COUNT(*) AS n FROM oauthRefreshToken WHERE token = ?').get(await hashLikeProvider(LEGACY.refresh))).toEqual({ n: 1 })

    // The rotated refresh token is an ordinary 1.7 token from here on.
    const second = await call(
      env,
      new Request(`${ORIGIN}/api/auth/oauth2/token`, form({ grant_type: 'refresh_token', refresh_token: str(tokens.refresh_token), client_id: LEGACY.publicClient })),
    )
    expect(second.status).toBe(200)
  })

  test('a confidential client refreshes with HTTP Basic and its plaintext secret', async () => {
    const { env, db } = upgradedEnv()
    const basic = `Basic ${btoa(`${LEGACY.webClient}:${LEGACY.webSecret}`)}`
    const res = await call(
      env,
      new Request(`${ORIGIN}/api/auth/mcp/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: basic },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: LEGACY.webRefresh }),
      }),
    )
    expect(res.status).toBe(200)
    const client = db.sqlite.query('SELECT tokenEndpointAuthMethod, clientSecret FROM oauthClient WHERE clientId = ?').get(LEGACY.webClient)
    expect(client).toEqual({ tokenEndpointAuthMethod: 'client_secret_basic', clientSecret: await hashLikeProvider(LEGACY.webSecret) })
  })

  test('a confidential client that posts its secret in the form also works', async () => {
    const { env } = upgradedEnv()
    // First contact is an authorize (no secret yet), so the method is pending.
    const { challenge } = await pkce()
    const query = new URLSearchParams({ response_type: 'code', client_id: LEGACY.webClient, redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect', scope: 'openid', code_challenge: challenge, code_challenge_method: 'S256' })
    await call(env, new Request(`${ORIGIN}/api/auth/mcp/authorize?${query}`))
    const res = await call(
      env,
      new Request(
        `${ORIGIN}/api/auth/oauth2/token`,
        form({ grant_type: 'refresh_token', refresh_token: LEGACY.webRefresh, client_id: LEGACY.webClient, client_secret: LEGACY.webSecret }),
      ),
    )
    expect(res.status).toBe(200)
  })

  test('a wrong secret is refused and does not pick the auth method', async () => {
    const { env, db } = upgradedEnv()
    const res = await call(
      env,
      new Request(
        `${ORIGIN}/api/auth/oauth2/token`,
        form({ grant_type: 'refresh_token', refresh_token: LEGACY.webRefresh, client_id: LEGACY.webClient, client_secret: 'wrong' }),
      ),
    )
    expect(res.status).toBeGreaterThanOrEqual(400)
    const client = db.sqlite.query('SELECT metadata FROM oauthClient WHERE clientId = ?').get(LEGACY.webClient) as { metadata: string }
    expect(JSON.parse(client.metadata)).toMatchObject({ legacyAuthMethodPending: true })
  })

  test('an expired 1.6 refresh token is refused', async () => {
    const { env } = upgradedEnv()
    const res = await call(
      env,
      new Request(`${ORIGIN}/api/auth/mcp/token`, form({ grant_type: 'refresh_token', refresh_token: LEGACY.expiredRefresh, client_id: LEGACY.publicClient })),
    )
    expect(res.status).toBe(400)
    expect((await json(res)).error).toBe('invalid_grant')
  })

  test('a pre-upgrade client can authorize again through the old URL without a new consent', async () => {
    const { env, db } = upgradedEnv()
    // Sign the legacy user in: give them a password account and a session.
    const { cookie } = await signUp(env, 'later@example.org')
    const later = db.sqlite.query('SELECT id FROM "user" WHERE email = ?').get('later@example.org') as { id: string }
    db.sqlite.query('UPDATE "oauthConsent" SET userId = ?').run(later.id)
    const { verifier, challenge } = await pkce()
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: LEGACY.publicClient,
      redirect_uri: CLAUDE_CALLBACK,
      scope: MCP_SCOPES.join(' '),
      state: 's',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      resource: RESOURCE,
    })
    const authorize = await call(env, new Request(`${ORIGIN}/api/auth/mcp/authorize?${query}`, { headers: { cookie } }))
    expect(authorize.status).toBe(302)
    // Stored consent carried over, so the browser goes straight back to Claude.
    const location = new URL(str(authorize.headers.get('location')))
    expect(location.origin + location.pathname).toBe(CLAUDE_CALLBACK)
    const code = str(location.searchParams.get('code'))
    const res = await call(
      env,
      new Request(`${ORIGIN}/api/auth/mcp/token`, form({ grant_type: 'authorization_code', code, redirect_uri: CLAUDE_CALLBACK, client_id: LEGACY.publicClient, code_verifier: verifier, resource: RESOURCE })),
    )
    expect(res.status).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// Client ID Metadata Documents. ChatGPT's real document (fetched 2026-11-08)
// uses private_key_jwt with a jwks_uri, so the test signs a client assertion.
// ---------------------------------------------------------------------------

const CHATGPT_CLIENT_ID = 'https://chatgpt.com/oauth/client.json'
const CHATGPT_REDIRECT = 'https://chatgpt.com/connector_platform_oauth_redirect'

describe('client ID metadata documents', () => {
  const realFetch = globalThis.fetch
  let keys: CryptoKeyPair
  let jwk: JsonWebKey
  let fetched: string[]

  beforeEach(async () => {
    const pair = await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify'],
    )
    if (!('privateKey' in pair)) throw new Error('expected a key pair')
    keys = pair
    jwk = { ...(await crypto.subtle.exportKey('jwk', keys.publicKey)), kid: 'chatgpt-test', alg: 'RS256', use: 'sig' }
    fetched = []
    const stub = async (input: string | URL | Request): Promise<Response> => {
      const url = new URL(input instanceof Request ? input.url : input.toString())
      fetched.push(url.toString())
      if (url.hostname === 'cloudflare-dns.com') {
        const type = url.searchParams.get('type')
        const answer = type === 'A' ? [{ type: 1, data: '104.18.32.47' }] : []
        return Response.json({ Status: 0, Answer: answer }, { headers: { 'content-type': 'application/dns-json' } })
      }
      if (url.toString() === CHATGPT_CLIENT_ID) {
        return Response.json(
          {
            client_id: CHATGPT_CLIENT_ID,
            client_uri: 'https://chatgpt.com/',
            redirect_uris: [CHATGPT_REDIRECT],
            token_endpoint_auth_method: 'private_key_jwt',
            token_endpoint_auth_methods_supported: ['none', 'private_key_jwt'],
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
            client_name: 'ChatGPT',
            logo_uri: 'https://persistent.oaistatic.com/sonic/misc/openai-logo.png',
            token_endpoint_auth_signing_alg: 'RS256',
            jwks_uri: 'https://chatgpt.com/oauth/jwks.json',
          },
          { headers: { 'cache-control': 'public, max-age=300' } },
        )
      }
      if (url.toString() === 'https://chatgpt.com/oauth/jwks.json') return Response.json({ keys: [jwk] })
      return new Response('not found', { status: 404 })
    }
    globalThis.fetch = Object.assign(stub, { preconnect: realFetch.preconnect })
  })

  afterEach(() => {
    globalThis.fetch = realFetch
  })

  test('ChatGPT connects by metadata URL and refreshes with private_key_jwt', async () => {
    const db = new TestD1().migrate()
    const env = makeEnv(db)
    const { cookie } = await signUp(env)
    const { verifier, challenge } = await pkce()
    const code = await authorizeCode(env, cookie, CHATGPT_CLIENT_ID, CHATGPT_REDIRECT, challenge)
    expect(fetched).toContain(CHATGPT_CLIENT_ID)

    const stored = db.sqlite.query('SELECT clientDiscoveryId, tokenEndpointAuthMethod FROM oauthClient WHERE clientId = ?').get(CHATGPT_CLIENT_ID)
    expect(stored).toEqual({ clientDiscoveryId: 'cimd', tokenEndpointAuthMethod: 'private_key_jwt' })

    const assertion = async () =>
      signPrivateKeyJwtClientAssertion({
        clientId: CHATGPT_CLIENT_ID,
        tokenEndpoint: `${ORIGIN}/api/auth/oauth2/token`,
        privateKeyJwk: { ...(await crypto.subtle.exportKey('jwk', keys.privateKey)), kid: 'chatgpt-test', alg: 'RS256' },
        algorithm: 'RS256',
      })
    const exchanged = await call(
      env,
      new Request(
        `${ORIGIN}/api/auth/oauth2/token`,
        form({
          grant_type: 'authorization_code',
          code,
          redirect_uri: CHATGPT_REDIRECT,
          client_id: CHATGPT_CLIENT_ID,
          code_verifier: verifier,
          resource: RESOURCE,
          client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
          client_assertion: await assertion(),
        }),
      ),
    )
    const tokens = await json(exchanged)
    expect(exchanged.status).toBe(200)
    expect(await mcpIdentity(env, str(tokens.access_token))).toMatchObject({ email: 'person@example.org' })

    const refreshed = await call(
      env,
      new Request(
        `${ORIGIN}/api/auth/oauth2/token`,
        form({
          grant_type: 'refresh_token',
          refresh_token: str(tokens.refresh_token),
          client_id: CHATGPT_CLIENT_ID,
          client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
          client_assertion: await assertion(),
        }),
      ),
    )
    expect(refreshed.status).toBe(200)
    // One row for ChatGPT however many times people connect.
    expect(db.sqlite.query('SELECT COUNT(*) AS n FROM oauthClient').get()).toEqual({ n: 1 })
  })

  test('a metadata document with a redirect URI the request does not use is refused', async () => {
    const env = makeEnv(new TestD1().migrate())
    const { cookie } = await signUp(env)
    const { challenge } = await pkce()
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: CHATGPT_CLIENT_ID,
      redirect_uri: 'https://attacker.example/callback',
      scope: 'openid',
      code_challenge: challenge,
      code_challenge_method: 'S256',
    })
    const res = await call(env, new Request(`${ORIGIN}/api/auth/oauth2/authorize?${query}`, { headers: { cookie } }))
    const location = res.headers.get('location') ?? ''
    expect(location.startsWith('https://attacker.example')).toBe(false)
  })
})
