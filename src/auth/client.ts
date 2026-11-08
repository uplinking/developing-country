// Better Auth React client — same-origin, talks to the Worker's /api/auth/*
// handler. The session cookie is set/read automatically by the browser, so all
// our own /api fetches just need `credentials: 'include'` to ride along.

import { createAuthClient } from 'better-auth/react'
import { oauthProviderClient } from '@better-auth/oauth-provider/client'
import { appUrl, withBase } from '../base'
import { isJsonObject, isJsonString } from '../shared/json'
import type { JsonValue } from '../shared/json'

export const authClient = createAuthClient({
  // Full auth mount (e.g. `https://explore.developing-country.org/api/auth`).
  // Passing the complete URL avoids a split origin + `/api/auth` that
  // would miss the path prefix. appUrl() is already absolute when this
  // module loaded from /assets/.
  baseURL: appUrl('/api/auth'),
  fetchOptions: { credentials: 'include' },
  // On the MCP connect page the URL carries a signed copy of the OAuth request.
  // This plugin sends it with sign-in and consent calls so the server can
  // resume the authorization. On any other page it adds nothing.
  plugins: [oauthProviderClient()],
})

export const { useSession, signIn, signUp, signOut } = authClient

/** Which social providers the server actually has credentials for. */
export async function fetchConfiguredProviders(): Promise<string[]> {
  try {
    const res = await fetch(withBase('/api/auth-providers'), {
      headers: { Accept: 'application/json' },
      credentials: 'include',
    })
    if (!res.ok) return []
    const body: JsonValue = await res.json()
    if (!isJsonObject(body) || !Array.isArray(body.providers)) return []
    return body.providers.filter(isJsonString)
  } catch {
    return []
  }
}
