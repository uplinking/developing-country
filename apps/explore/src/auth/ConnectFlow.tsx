// MCP OAuth consent page.
//
// WHY THIS EXISTS. Better Auth's mcp() plugin uses this app as both its
// `loginPage` and its `consentPage`. When an MCP client (Claude, ChatGPT,
// Cursor, Grok) starts an OAuth 2.1 authorization, /api/auth/oauth2/authorize
// sends the browser here with a SIGNED copy of the authorization request
// (`sig`, `exp`, `ba_*` params): first to sign in if there is no session, then
// to approve the client if this user has not approved it before.
//
// Signing in: the auth client's oauthProviderClient plugin sends the signed
// query with the sign-in call, and the server resumes the authorization,
// landing back here for consent. Google/GitHub return to the authorize URL.
//
// Approving: Allow and Cancel POST /oauth2/consent with the signed query. The
// server checks the signature, then redirects to the client's REGISTERED
// redirect_uri (with a code, or with access_denied). This page never navigates
// to redirect_uri itself, so it cannot become an open redirect.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { authClient, useSession } from './client'
import AuthPanel from './AuthPanel'
import { Wordmark } from '@developing-country/ui/Wordmark'
import { appUrl } from '../base'

/** Hostname of the requesting client, for display only. */
function clientHost(redirectUri: string): string {
  try {
    return new URL(redirectUri).host
  } catch {
    return redirectUri
  }
}

const KNOWN = new Map([
  ['grok.com', 'Grok'],
  ['claude.ai', 'Claude'],
  ['chatgpt.com', 'ChatGPT'],
  ['openai.com', 'ChatGPT'],
  ['cursor.com', 'Cursor'],
  ['cursor.sh', 'Cursor'],
])

function clientLabel(host: string): string {
  const bare = host.replace(/^www\./, '')
  for (const [domain, name] of KNOWN) {
    if (bare === domain || bare.endsWith(`.${domain}`)) return name
  }
  return bare
}

// Parameters the server adds when it signs the authorization request.
const SIGNING_PARAMS = ['sig', 'exp', 'ba_iat', 'ba_pl', 'ba_param']

export default function ConnectFlow({ params }: { params: URLSearchParams }) {
  const { data: session, isPending } = useSession()
  const [handedOff, setHandedOff] = useState(false)
  const [cancelled, setCancelled] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const signed = params.has('sig')

  const host = clientHost(params.get('redirect_uri') ?? '')
  const label = clientLabel(host)
  const scopes = (params.get('scope') ?? '').split(/\s+/).filter(Boolean)

  // After Google, land on authorize (not this login page). The callback
  // Set-Cookie then the same-site 302 carries the session, so MCP can
  // finish without a second "you're still signed out" paint. Failures
  // come back here via errorCallbackURL so the card can show them.
  const authorizeUrl = useMemo(() => {
    const q = new URLSearchParams(params)
    for (const key of [...SIGNING_PARAMS, 'error', 'error_description']) q.delete(key)
    return `${appUrl('/api/auth/oauth2/authorize')}?${q.toString()}`
  }, [params])
  const here = useMemo(() => window.location.href, [])

  // Record the user's choice. With a signed query the server answers with the
  // client's redirect URL; an unsigned (old or hand-edited) URL goes back
  // through authorize, which re-signs it and returns here.
  const decide = useCallback(
    async (accept: boolean) => {
      setError(null)
      if (!signed) {
        if (!accept) {
          setCancelled(true)
          return
        }
        setHandedOff(true)
        window.location.assign(authorizeUrl)
        return
      }
      setHandedOff(true)
      const { data, error: failure } = await authClient.oauth2.consent({ accept })
      const next = data?.url ?? null
      if (failure || !next) {
        setHandedOff(false)
        setError(failure?.message || 'This request expired. Start the connection again from the app.')
        return
      }
      if (!accept) setCancelled(true)
      window.location.assign(next)
    },
    [signed, authorizeUrl],
  )
  const allow = useCallback(() => void decide(true), [decide])
  const cancel = useCallback(() => void decide(false), [decide])

  const signedIn = !!session?.user

  useEffect(() => {
    document.title = `Connect ${label} — developing-country.org`
  }, [label])

  return (
    <div className="connect-page">
      <div className="connect-card">
        <header className="surf-band">
          <Wordmark className="connect-wordmark" />
        </header>
        <div className="cabinet-body">
          {cancelled ? (
            <>
              <h1 className="auth-title">Connection cancelled</h1>
              <p className="auth-sub">
                Nothing was shared with {label}. You can close this window.
              </p>
            </>
          ) : handedOff ? (
            <>
              <h1 className="auth-title">Connecting…</h1>
              <p className="auth-sub">Handing {label} back its authorization.</p>
            </>
          ) : isPending ? (
            <>
              <h1 className="auth-title">One moment…</h1>
              <p className="auth-sub">Checking whether you are signed in.</p>
            </>
          ) : signedIn ? (
            <>
              <p className="auth-kicker">Authorize</p>
              <h1 className="auth-title">Connect {label} to developing-country.org</h1>
              <p className="auth-sub">
                {label} is asking to use developing-country.org tools as{' '}
                <strong>{session.user.email}</strong>. Its tool calls will stage on
                the maps you have open under this email.
              </p>

              <ul className="connect-scopes">
                <li>Read the Sri Lanka twin — layers, spatial queries, coverage.</li>
                <li>Read and write your own prospects, issues, and Analyze runs.</li>
                <li>Stage the map in a signed-in developing-country.org tab.</li>
              </ul>

              {error && <p className="auth-error" role="alert">{error}</p>}

              <p className="connect-meta">
                <span>Requesting host</span>
                <code>{host}</code>
              </p>
              {scopes.length > 0 && (
                <p className="connect-meta">
                  <span>Scopes</span>
                  <code>{scopes.join(' ')}</code>
                </p>
              )}

              <div className="connect-actions">
                <button type="button" className="auth-submit" onClick={allow}>
                  Allow {label}
                </button>
                <button type="button" className="connect-cancel" onClick={cancel}>
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <AuthPanel
              kicker="Authorize"
              title={`Sign in to connect ${label}`}
              sub={`${label} wants to use developing-country.org tools. Sign in and we'll hand it back an authorization — nothing is shared until you approve it.`}
              callbackURL={authorizeUrl}
              errorCallbackURL={here}
            />
          )}
        </div>
      </div>
    </div>
  )
}
