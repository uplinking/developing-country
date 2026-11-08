// Bridge from the Better Auth 1.6 MCP OAuth tables to the 1.7 OAuth provider.
//
// Migration 0013 renamed the old tables to legacyOauthApplication,
// legacyOauthAccessToken and legacyOauthConsent and left their rows alone,
// because the new provider stores client secrets and tokens as SHA-256 hashes
// and SQLite cannot compute those. This module moves each old client across the
// first time it shows up at the authorize or token endpoint, hashing values
// exactly as the provider does, so connections made before the upgrade keep
// working without the user reconnecting:
//
//   - client: copied into oauthClient (secret hashed) and linked to the MCP
//     resource; its consents come with it.
//   - refresh token: copied into oauthRefreshToken (hashed) when the client
//     presents it, then the provider rotates it as usual.
//   - access token: an old opaque token stays valid on /mcp until it expires
//     (at most an hour after it was issued; see legacyAccessTokenUser).
//
// Writes go through Better Auth's own adapter so dates, arrays and booleans are
// serialised the way the provider reads them. Everything is idempotent: a
// client or token that is already in the new tables is left alone, so retries
// and concurrent requests are harmless.

import type { getAuth } from './betterAuth'
import type { Env } from './types'
import type { JsonObject } from '../shared/json'
import { parseJsonObject } from '../shared/json'

type Auth = ReturnType<typeof getAuth>
type AuthContext = Awaited<Auth['$context']>

/** Client authentication method observed on a token request. */
export type ObservedAuthMethod = 'client_secret_basic' | 'client_secret_post' | 'none'

/** SHA-256, base64url without padding: the provider's default token and secret hash. */
export async function hashLikeProvider(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
  let binary = ''
  for (const byte of digest) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

interface LegacyClientRow {
  id: string
  name: string
  icon: string | null
  metadata: string | null
  clientId: string
  clientSecret: string | null
  redirectUrls: string
  type: string
  disabled: number | null
  userId: string | null
  createdAt: string | number
  updatedAt: string | number
}

interface LegacyTokenRow {
  id: string
  accessToken: string
  refreshToken: string
  accessTokenExpiresAt: string | number
  refreshTokenExpiresAt: string | number
  clientId: string
  userId: string | null
  scopes: string
  createdAt: string | number
}

interface LegacyConsentRow {
  id: string
  clientId: string
  userId: string
  scopes: string
  createdAt: string | number
  updatedAt: string | number
  consentGiven: number
}

/** Parse a stored D1 date (ISO text, or epoch milliseconds as a number or digits). */
function toDate(value: string | number | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null
  const date = new Date(/^\d+$/.test(String(value)) ? Number(value) : value)
  return Number.isNaN(date.getTime()) ? null : date
}

function splitScopes(scopes: string): string[] {
  return scopes.split(/\s+/).filter((scope) => scope.length > 0)
}

function metadataObject(value: string | JsonObject | null | undefined): JsonObject {
  if (!value) return {}
  if (typeof value !== 'string') return { ...value }
  return parseJsonObject(value) ?? {}
}

/** True while the legacy tables exist (they are absent on a fresh database). */
async function legacyTablesExist(env: Env): Promise<boolean> {
  try {
    const row = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'legacyOauthApplication'",
    ).first<{ name: string }>()
    return row !== null
  } catch {
    return false
  }
}

interface ClientRecord {
  clientId: string
  tokenEndpointAuthMethod?: string | null
  // The adapter returns JSON columns parsed; tolerate a raw string too.
  metadata?: string | JsonObject | null
}

function pendingAuthMethod(record: ClientRecord): boolean {
  return metadataObject(record.metadata).legacyAuthMethodPending === true
}

async function linkResource(ctx: AuthContext, clientId: string, resource: string): Promise<void> {
  const linked = await ctx.adapter.findOne({
    model: 'oauthClientResource',
    where: [
      { field: 'clientId', value: clientId },
      { field: 'resourceId', value: resource },
    ],
  })
  if (linked) return
  try {
    await ctx.adapter.create({
      model: 'oauthClientResource',
      data: { clientId, resourceId: resource, createdAt: new Date() },
    })
  } catch {
    // A concurrent request linked it first (unique clientId+resourceId).
  }
}

/**
 * Make sure a client registered under Better Auth 1.6 exists in oauthClient.
 *
 * Confidential 1.6 clients did not record whether they authenticate with HTTP
 * Basic or a form field, and the new provider insists on the registered method.
 * Such a client is copied with the method marked pending, and the first token
 * request that proves the secret fixes it to the method that request used.
 */
export async function bridgeLegacyClient(
  env: Env,
  auth: Auth,
  clientId: string,
  resource: string,
  observed?: { method: ObservedAuthMethod; secret?: string | null },
): Promise<void> {
  if (!clientId || clientId.startsWith('https://')) return // CIMD client ids never existed in 1.6
  if (!(await legacyTablesExist(env))) return
  const ctx = await auth.$context
  const existing = await ctx.adapter.findOne<ClientRecord>({
    model: 'oauthClient',
    where: [{ field: 'clientId', value: clientId }],
  })
  if (existing) {
    if (observed && observed.method !== 'none' && pendingAuthMethod(existing)) {
      await settlePendingAuthMethod(env, ctx, clientId, observed)
    }
    return
  }

  const legacy = await env.DB.prepare('SELECT * FROM "legacyOauthApplication" WHERE "clientId" = ?1')
    .bind(clientId)
    .first<LegacyClientRow>()
  if (!legacy) return

  const isPublic = legacy.type === 'public' || !legacy.clientSecret
  const secretMatches =
    !isPublic && observed?.secret ? observed.secret === legacy.clientSecret : false
  const method: ObservedAuthMethod | null = isPublic
    ? 'none'
    : observed && observed.method !== 'none' && secretMatches
      ? observed.method
      : null
  const metadata = metadataObject(legacy.metadata)
  metadata.legacyMigratedAt = new Date().toISOString()
  if (method === null) metadata.legacyAuthMethodPending = true

  try {
    await ctx.adapter.create({
      model: 'oauthClient',
      data: {
        clientId: legacy.clientId,
        clientSecret: isPublic ? null : await hashLikeProvider(legacy.clientSecret ?? ''),
        disabled: legacy.disabled === 1,
        name: legacy.name,
        icon: legacy.icon,
        userId: legacy.userId,
        redirectUris: legacy.redirectUrls.split(',').map((uri) => uri.trim()).filter(Boolean),
        tokenEndpointAuthMethod: method ?? 'client_secret_basic',
        applicationType: 'web',
        grantTypes: ['authorization_code', 'refresh_token'],
        responseTypes: ['code'],
        requirePKCE: isPublic ? true : null,
        metadata: JSON.stringify(metadata),
        createdAt: toDate(legacy.createdAt) ?? new Date(),
        updatedAt: new Date(),
      },
    })
  } catch {
    // Another request copied it first; fall through to linking.
  }
  await linkResource(ctx, clientId, resource)
  await bridgeLegacyConsents(env, ctx, clientId, resource)
}

async function settlePendingAuthMethod(
  env: Env,
  ctx: AuthContext,
  clientId: string,
  observed: { method: ObservedAuthMethod; secret?: string | null },
): Promise<void> {
  const legacy = await env.DB.prepare('SELECT "clientSecret" FROM "legacyOauthApplication" WHERE "clientId" = ?1')
    .bind(clientId)
    .first<{ clientSecret: string | null }>()
  // Only a request that proves the secret may pick the method.
  if (!legacy?.clientSecret || !observed.secret || observed.secret !== legacy.clientSecret) return
  const record = await ctx.adapter.findOne<ClientRecord>({
    model: 'oauthClient',
    where: [{ field: 'clientId', value: clientId }],
  })
  if (!record) return
  const metadata = metadataObject(record.metadata)
  delete metadata.legacyAuthMethodPending
  await ctx.adapter.update({
    model: 'oauthClient',
    where: [{ field: 'clientId', value: clientId }],
    update: { tokenEndpointAuthMethod: observed.method, metadata: JSON.stringify(metadata), updatedAt: new Date() },
  })
}

async function bridgeLegacyConsents(env: Env, ctx: AuthContext, clientId: string, resource: string): Promise<void> {
  const { results } = await env.DB.prepare(
    'SELECT * FROM "legacyOauthConsent" WHERE "clientId" = ?1 AND "consentGiven" = 1',
  )
    .bind(clientId)
    .all<LegacyConsentRow>()
  for (const consent of results) {
    const already = await ctx.adapter.findOne({
      model: 'oauthConsent',
      where: [
        { field: 'clientId', value: clientId },
        { field: 'userId', value: consent.userId },
      ],
    })
    if (already) continue
    await ctx.adapter.create({
      model: 'oauthConsent',
      data: {
        clientId,
        userId: consent.userId,
        scopes: splitScopes(consent.scopes),
        resources: [resource],
        createdAt: toDate(consent.createdAt) ?? new Date(),
        updatedAt: toDate(consent.updatedAt) ?? new Date(),
      },
    })
  }
}

/**
 * Copy a 1.6 refresh token into oauthRefreshToken (hashed) so the provider can
 * rotate it. The legacy row stays put; once copied, the hashed row is the only
 * one the provider consults, so replaying the old token after rotation is
 * treated as reuse exactly like any other rotated refresh token.
 */
export async function bridgeLegacyRefreshToken(
  env: Env,
  auth: Auth,
  refreshToken: string,
  resource: string,
  observed?: { method: ObservedAuthMethod; secret?: string | null },
): Promise<void> {
  if (!refreshToken || !(await legacyTablesExist(env))) return
  const ctx = await auth.$context
  const hashed = await hashLikeProvider(refreshToken)
  const already = await ctx.adapter.findOne({ model: 'oauthRefreshToken', where: [{ field: 'token', value: hashed }] })
  if (already) return
  const legacy = await env.DB.prepare('SELECT * FROM "legacyOauthAccessToken" WHERE "refreshToken" = ?1')
    .bind(refreshToken)
    .first<LegacyTokenRow>()
  if (!legacy?.userId) return
  const expiresAt = toDate(legacy.refreshTokenExpiresAt)
  if (!expiresAt || expiresAt.getTime() <= Date.now()) return

  await bridgeLegacyClient(env, auth, legacy.clientId, resource, observed)
  try {
    await ctx.adapter.create({
      model: 'oauthRefreshToken',
      data: {
        token: hashed,
        clientId: legacy.clientId,
        userId: legacy.userId,
        scopes: splitScopes(legacy.scopes),
        resources: [resource],
        expiresAt,
        createdAt: toDate(legacy.createdAt) ?? new Date(),
      },
    })
  } catch {
    // Copied by a concurrent request.
  }
}

/**
 * User id for a 1.6 opaque access token that has not expired yet, else null.
 * These tokens live at most an hour, so this path goes quiet within an hour
 * of the deploy.
 */
export async function legacyAccessTokenUser(env: Env, accessToken: string): Promise<string | null> {
  if (!accessToken || !(await legacyTablesExist(env))) return null
  const row = await env.DB.prepare(
    'SELECT "userId", "accessTokenExpiresAt" FROM "legacyOauthAccessToken" WHERE "accessToken" = ?1',
  )
    .bind(accessToken)
    .first<{ userId: string | null; accessTokenExpiresAt: string | number }>()
  if (!row?.userId) return null
  const expiresAt = toDate(row.accessTokenExpiresAt)
  return expiresAt && expiresAt.getTime() > Date.now() ? row.userId : null
}

/**
 * Read client credentials from a token request the way the provider will:
 * HTTP Basic first, then form fields. Returns null for a request without a
 * client_id.
 */
export function observeTokenClient(
  headers: Headers,
  form: URLSearchParams,
): { clientId: string; method: ObservedAuthMethod; secret: string | null } | null {
  const authorization = headers.get('authorization') ?? ''
  if (/^basic\s+/i.test(authorization)) {
    try {
      const decoded = atob(authorization.replace(/^basic\s+/i, '').trim())
      const colon = decoded.indexOf(':')
      if (colon > 0) {
        return {
          clientId: decodeURIComponent(decoded.slice(0, colon)),
          secret: decodeURIComponent(decoded.slice(colon + 1)),
          method: 'client_secret_basic',
        }
      }
    } catch {
      return null
    }
  }
  const clientId = form.get('client_id')
  if (!clientId) return null
  const secret = form.get('client_secret')
  return { clientId, secret, method: secret ? 'client_secret_post' : 'none' }
}
