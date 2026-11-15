// The sign-in / sign-up card body. Rendered in two places, which is why it is
// separate from the modal chrome around it:
//   • AuthModal      — floating over the map, the normal way in.
//   • ConnectFlow    — an MCP client (Grok, Claude, …) bounced the user here
//                      mid-OAuth, so the same card runs inside the consent page.
// Social buttons only render for providers the server actually has credentials
// for (GET /api/auth-providers).

import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { authClient, signIn, signUp, useSession, fetchConfiguredProviders } from './client'

type Mode = 'signin' | 'signup'

/**
 * A fetch that never reached a readable response — DNS, transport, or (our
 * case) a redirect chain the browser followed off-origin. Distinct from an
 * HTTP error, which Better Auth surfaces as `res.error`.
 */
function isNetworkError(err: Error): boolean {
  return err instanceof TypeError
}

/** Did the browser end up with a session, whatever the call reported? */
async function hasSession(): Promise<boolean> {
  try {
    const res = await authClient.getSession()
    return !!res.data?.user
  } catch {
    return false
  }
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  )
}

function GitHubMark() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.6-4-1.6-.5-1.4-1.3-1.8-1.3-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.6.2 2.8.1 3.1.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.7-5.5 6 .4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3z"
      />
    </svg>
  )
}

function ProviderMark({ id }: { id: string }) {
  if (id === 'google') return <GoogleMark />
  if (id === 'github') return <GitHubMark />
  return null
}

const PROVIDER_LABEL = new Map([
  ['google', 'Continue with Google'],
  ['github', 'Continue with GitHub'],
])

function errorFromLocation(): string | null {
  try {
    const q = new URLSearchParams(window.location.search)
    const err = q.get('error')
    if (!err) return null
    const desc = q.get('error_description')?.trim()
    if (desc) return desc
    if (err === 'account_not_linked') {
      return 'This email already has an account. Sign in with email, then Google will link.'
    }
    return err.replace(/_/g, ' ')
  } catch {
    return null
  }
}

export interface AuthPanelProps {
  /** Where the browser should land after a social round-trip. Absolute URL. */
  callbackURL?: string
  /** Social failures land here (defaults to callbackURL). Absolute URL. */
  errorCallbackURL?: string
  /** Called after a successful email sign-in / sign-up (social never returns). */
  onDone?: () => void
  /** Lets the parent disable its own close affordance while a request is open. */
  onBusyChange?: (busy: boolean) => void
  titleId?: string
  descId?: string
  title?: string
  sub?: string
  /** Surface name for the micro-label above the title; '' renders nothing. */
  kicker?: string
  autoFocus?: boolean
}

export default function AuthPanel({
  callbackURL,
  errorCallbackURL,
  onDone,
  onBusyChange,
  titleId,
  descId,
  title,
  sub,
  kicker = '',
  autoFocus = true,
}: AuthPanelProps) {
  const fallbackTitleId = useId()
  const fallbackDescId = useId()
  const headingId = titleId ?? fallbackTitleId
  const subId = descId ?? fallbackDescId
  const emailRef = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(() => errorFromLocation())
  const [providers, setProviders] = useState<string[]>([])
  const { refetch: refetchSession } = useSession()

  useEffect(() => {
    void fetchConfiguredProviders().then(setProviders)
  }, [])

  useEffect(() => {
    if (autoFocus) emailRef.current?.focus()
  }, [autoFocus])

  useEffect(() => {
    onBusyChange?.(busy)
  }, [busy, onBusyChange])

  const switchMode = (next: Mode) => {
    setMode(next)
    setError(null)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      if (mode === 'signup') {
        const res = await signUp.email({ email, password, name: name.trim() || email.split('@')[0] })
        if (res.error) throw new Error(res.error.message || 'Could not create the account')
      } else {
        const res = await signIn.email({ email, password })
        if (res.error) throw new Error(res.error.message || 'Email or password did not match')
      }
      await refetchSession?.()
      onDone?.()
    } catch (err) {
      const caught = err instanceof Error ? err : new Error(String(err))
      // The MCP plugin's after-hook hijacks ANY auth response that sets a
      // session cookie while an authorization is pending (`oidc_login_prompt`),
      // rewriting it into a 302 to the OAuth client's redirect_uri. That is
      // built for a form POST; ours is a fetch, so the browser follows the
      // redirect chain off-origin and the call rejects with "Failed to fetch" —
      // even though the account was created and the cookie WAS set. Treat a
      // network-level failure as "maybe it actually worked": re-read the
      // session, and if we now have one, carry on. Only a genuinely sessionless
      // failure is a real error.
      if (isNetworkError(caught)) {
        await refetchSession?.()
        if (await hasSession()) {
          onDone?.()
          return
        }
      }
      setError(caught.message || 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  // Social is a full-page redirect. We ask Better Auth for the provider URL
  // rather than letting the client navigate, so a provider that is misconfigured
  // surfaces as an error in this card instead of a dead tab. `callbackURL` is
  // where a successful round-trip lands (the map, or MCP authorize so Claude
  // gets its code). Failures use `errorCallbackURL`.
  const social = async (provider: string) => {
    setError(null)
    setBusy(true)
    try {
      const next = callbackURL ?? window.location.href
      const res = await signIn.social({
        provider,
        callbackURL: next,
        errorCallbackURL: errorCallbackURL ?? next,
        disableRedirect: true,
      })
      if (res.error) throw new Error(res.error.message || 'Social sign-in failed')
      const url = res.data?.url ?? ''
      if (!url) throw new Error(`${provider} did not return a sign-in URL`)
      window.location.assign(url)
    } catch (err) {
      const caught = err instanceof Error ? err : new Error(String(err))
      setError(caught.message || 'Social sign-in failed')
      setBusy(false)
    }
  }

  return (
    <>
      {kicker && <p className="auth-kicker">{kicker}</p>}
      <h2 id={headingId} className="auth-title">
        {title ?? (mode === 'signin' ? 'Welcome back' : 'Create an account')}
      </h2>
      <p id={subId} className="auth-sub">
        {sub ??
          (mode === 'signin'
            ? 'Same email on the map and in your AI client. Saves prospects, issues, and Analyze runs to this tab.'
            : 'Email is your identity. Prospects stay private; an agent can stage the map once you sign in.')}
      </p>

      <div className="auth-modes" role="tablist" aria-label="Account">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'signin'}
          className={`auth-mode${mode === 'signin' ? ' on' : ''}`}
          onClick={() => switchMode('signin')}
        >
          Sign in
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'signup'}
          className={`auth-mode${mode === 'signup' ? ' on' : ''}`}
          onClick={() => switchMode('signup')}
        >
          Create account
        </button>
      </div>

      {providers.length > 0 && (
        <>
          <div className="auth-social">
            {providers.map((p) => (
              <button
                key={p}
                type="button"
                className={`auth-social-btn${p === 'google' ? ' primary' : ''}`}
                onClick={() => social(p)}
                disabled={busy}
              >
                <ProviderMark id={p} />
                <span>{PROVIDER_LABEL.get(p) ?? `Continue with ${p}`}</span>
              </button>
            ))}
          </div>
          <div className="auth-divider">
            <span>or email</span>
          </div>
        </>
      )}

      <form className="auth-form" onSubmit={submit}>
        {mode === 'signup' && (
          <label className="auth-field">
            <span>Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Optional"
              autoComplete="name"
            />
          </label>
        )}
        <label className="auth-field">
          <span>Email</span>
          <input
            ref={emailRef}
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@email.com"
            autoComplete="email"
            inputMode="email"
          />
        </label>
        <label className="auth-field">
          <span>Password</span>
          <span className="auth-password">
            <input
              type={showPassword ? 'text' : 'password'}
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'signup' ? 'At least 8 characters' : 'Your password'}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              aria-label="Password"
            />
            <button
              type="button"
              className="auth-eye"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </span>
        </label>

        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="auth-submit" disabled={busy}>
          {busy ? 'One moment…' : mode === 'signin' ? 'Sign in with email' : 'Create account'}
        </button>
      </form>
    </>
  )
}
