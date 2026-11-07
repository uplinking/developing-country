// MCP OAuth consent page.
//
// WHY THIS EXISTS. Better Auth's mcp() plugin is configured with
// `loginPage: '/app'` — this app. When an MCP client (Grok, Claude,
// ChatGPT, Cursor) starts an OAuth 2.1 authorization and the browser has no
// session, /api/auth/mcp/authorize 302s to the login page carrying the whole
// authorization query string. The login page owes the flow two things: sign the
// human in, then send them BACK to /api/auth/mcp/authorize with those same
// params, which now succeeds and redirects to the client with a code. Until
// this page existed the SPA swallowed those params and simply drew a map, so the
// connector's popup sat on a page that would never return a code and died.
//
// The Allow button navigates to OUR authorize endpoint, which validates
// redirect_uri against the registered client before redirecting anywhere.
// Cancel deliberately does NOT bounce to redirect_uri: that value is an
// unvalidated URL from the query string, and honouring it here would make this
// page an open redirect. We end the flow locally instead and let the client
// time out.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSession } from './client'
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

export default function ConnectFlow({ params }: { params: URLSearchParams }) {
  const { data: session, isPending } = useSession()
  const [handedOff, setHandedOff] = useState(false)
  const [cancelled, setCancelled] = useState(false)

  const host = clientHost(params.get('redirect_uri') ?? '')
  const label = clientLabel(host)
  const scopes = (params.get('scope') ?? '').split(/\s+/).filter(Boolean)

  // After Google, land on authorize (not this login page). The callback
  // Set-Cookie then the same-site 302 carries the session, so MCP can
  // finish without a second "you're still signed out" paint. Failures
  // come back here via errorCallbackURL so the card can show them.
  const authorizeUrl = useMemo(() => {
    const q = new URLSearchParams(params)
    q.delete('error')
    q.delete('error_description')
    return `${appUrl('/api/auth/mcp/authorize')}?${q.toString()}`
  }, [params])
  const here = useMemo(() => window.location.href, [])

  const allow = useCallback(() => {
    setHandedOff(true)
    window.location.assign(authorizeUrl)
  }, [authorizeUrl])

  const signedIn = !!session?.user

  useEffect(() => {
    document.title = `Connect ${label} — developing-country.org`
  }, [label])

  // This page only renders when authorize found no session. If one exists
  // now, they just signed in — finish the OAuth they started.
  useEffect(() => {
    if (!signedIn || isPending || handedOff || cancelled) return
    window.location.assign(authorizeUrl)
  }, [signedIn, isPending, handedOff, cancelled, authorizeUrl])

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
                <button
                  type="button"
                  className="connect-cancel"
                  onClick={() => setCancelled(true)}
                >
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
              onDone={allow}
            />
          )}
        </div>
      </div>
    </div>
  )
}
