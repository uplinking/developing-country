// Self-check for the JWT plugin's signing key.
//
// Better Auth stores each JWKS private key encrypted with BETTER_AUTH_SECRET
// and, from 1.7, signs every MCP access token with the newest live key. If that
// key was encrypted under an earlier secret, every token request fails with
// "Failed to decrypt private key" until the key is expired (production lost new
// MCP connections this way in November 2026). This module finds the key Better
// Auth will sign with, tries to decrypt it with the current secret, and says
// how to recover. It only reads: keys are never expired or deleted for you.
//
// Recovery is in docs/AUTH_SETUP.md ("Signing key cannot be decrypted").

import { symmetricDecrypt } from 'better-auth/crypto'
import type { JsonValue } from '../shared/json'
import { isJsonString } from '../shared/json'
import type { Env } from './types'

/** The algorithm the jwt plugin mints keys for (betterAuth.ts keyPairConfig). */
export const JWT_SIGNING_ALG = 'RS256'

/** Message prefix of the error Better Auth throws when a key won't decrypt. */
export const JWKS_DECRYPT_ERROR = 'Failed to decrypt private key'

export type SigningKeyHealth =
  /** The newest live key decrypts with the current secret. */
  | { status: 'ok'; kid: string; created_at: string | null }
  /** No live key; Better Auth mints one on the next signing request. */
  | { status: 'none' }
  /** The key Better Auth will sign with cannot be decrypted. Tokens fail. */
  | { status: 'undecryptable'; kid: string; created_at: string | null; recovery: string }
  /** The check itself failed (for example the table is missing). */
  | { status: 'unknown'; error: string }

interface JwksRow {
  id: string
  privateKey: string
  createdAt: string | number | null
  expiresAt: string | number | null
  alg: string | null
}

/** Better Auth's D1 rows hold dates as epoch milliseconds or ISO text. */
function toMillis(value: string | number | null): number | null {
  if (value === null || value === '') return null
  const n = Number(value)
  if (Number.isFinite(n)) return n
  const parsed = Date.parse(String(value))
  return Number.isFinite(parsed) ? parsed : null
}

function isoOrNull(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString()
}

/**
 * The key Better Auth 1.7 signs with: the newest live key of the configured
 * algorithm (rows without `alg` count as it), else the newest live key of any
 * algorithm. Mirrors resolveSigningKey in better-auth/plugins/jwt.
 */
export function selectSigningKey(rows: JwksRow[], now = Date.now()): JwksRow | null {
  const live = rows.filter((r) => {
    const exp = toMillis(r.expiresAt)
    return exp === null || exp > now
  })
  const newestFirst = (a: JwksRow, b: JwksRow) => (toMillis(b.createdAt) ?? 0) - (toMillis(a.createdAt) ?? 0)
  const preferred = live.filter((r) => r.alg === JWT_SIGNING_ALG || r.alg === null).sort(newestFirst)
  return preferred[0] ?? live.sort(newestFirst)[0] ?? null
}

/**
 * What to do about an undecryptable key, with the exact SQL for that row.
 * The timestamp must be ISO text, the format Better Auth writes: an integer
 * makes GET /api/auth/jwks throw (`expiresAt.getTime is not a function`),
 * which breaks verification of every MCP access token.
 */
export function signingKeyRecovery(kid: string, now = Date.now()): string {
  const safeKid = kid.replace(/'/g, "''")
  return (
    `JWKS signing key ${kid} cannot be decrypted with the current BETTER_AUTH_SECRET, so MCP token issuance fails. ` +
    `Either restore the secret it was encrypted with, or expire the key so Better Auth mints a new one on the next request: ` +
    `UPDATE jwks SET expiresAt = '${new Date(now).toISOString()}' WHERE id = '${safeKid}'; ` +
    `Never DELETE the row (its public key keeps verifying tokens it already signed). See docs/AUTH_SETUP.md, "Signing key cannot be decrypted".`
  )
}

async function decrypts(privateKey: string, secret: string): Promise<boolean> {
  try {
    // Better Auth stores the ciphertext as a JSON string.
    const data: JsonValue = JSON.parse(privateKey)
    if (!isJsonString(data)) return false
    await symmetricDecrypt({ key: secret, data })
    return true
  } catch {
    return false
  }
}

/** Check whether the key Better Auth will sign with decrypts under the current secret. */
export async function checkSigningKey(env: Pick<Env, 'DB' | 'BETTER_AUTH_SECRET'>, now = Date.now()): Promise<SigningKeyHealth> {
  const secret = env.BETTER_AUTH_SECRET?.trim()
  if (!secret) return { status: 'unknown', error: 'BETTER_AUTH_SECRET is not set' }
  let rows: JwksRow[]
  try {
    const result = await env.DB.prepare('SELECT id, privateKey, createdAt, expiresAt, alg FROM jwks').all<JwksRow>()
    rows = result.results
  } catch (e) {
    return { status: 'unknown', error: e instanceof Error ? e.message : String(e) }
  }
  const key = selectSigningKey(rows, now)
  if (!key) return { status: 'none' }
  const created_at = isoOrNull(toMillis(key.createdAt))
  if (await decrypts(key.privateKey, secret)) return { status: 'ok', kid: key.id, created_at }
  return { status: 'undecryptable', kid: key.id, created_at, recovery: signingKeyRecovery(key.id, now) }
}

export function isSigningKeyDecryptError(error: Error): boolean {
  return error.message.includes(JWKS_DECRYPT_ERROR)
}

/**
 * Log one actionable line for a signing failure: which key, and how to
 * recover. Called from Better Auth's onAPIError hook.
 */
export async function reportUndecryptableSigningKey(env: Pick<Env, 'DB' | 'BETTER_AUTH_SECRET'>): Promise<SigningKeyHealth> {
  const health = await checkSigningKey(env)
  if (health.status === 'undecryptable') {
    console.error(JSON.stringify({ op: 'jwks_signing_key_undecryptable', kid: health.kid, created_at: health.created_at, recovery: health.recovery }))
  } else {
    // The key changed between the failure and this check, or the check failed.
    console.error(JSON.stringify({ op: 'jwks_signing_key_undecryptable', check: health, recovery: 'Run GET /api/health to see the current signing key status; see docs/AUTH_SETUP.md, "Signing key cannot be decrypted".' }))
  }
  return health
}
