// The account compartment of the chrome bar. Signed out it is the one filled
// button in the whole header — the only accent, so the primary action is
// unambiguous. Signed in it collapses to an initial disc, because a signed-in
// identity is a status, not a call to action.
//
// While the session request is still open it renders a neutral placeholder disc
// rather than the words "Sign in": showing "Sign in" to someone who IS signed in
// and then swapping it a beat later is the flicker the old header had.

import { useEffect, useRef, useState } from 'react'
import { useSession, signOut } from './client'

export default function AccountControl({ onSignIn }: { onSignIn: () => void }) {
  const { data: session, isPending } = useSession()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !e.composedPath().includes(ref.current)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (isPending && !session?.user) {
    return <span className="account-pending" aria-label="Checking your session" />
  }

  if (!session?.user) {
    return (
      <button className="account-signin" onClick={onSignIn}>
        Sign in
      </button>
    )
  }

  const email = session.user.email
  const short = email.includes('@') ? email.slice(0, email.indexOf('@')) : email
  const initial = (session.user.name?.trim() || short || '?').charAt(0).toUpperCase()

  return (
    <div className="account" ref={ref}>
      <button
        className="account-btn"
        onClick={() => setOpen((o) => !o)}
        title={email}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account: ${email}`}
      >
        <span className="account-initial" aria-hidden="true">
          {initial}
        </span>
        <span className="account-email">{short}</span>
      </button>
      {open && (
        <div className="account-menu" role="menu">
          <div className="account-menu-head">
            Signed in as
            <strong>{email}</strong>
          </div>
          <button
            className="account-menu-item danger"
            role="menuitem"
            onClick={() => {
              void signOut()
              setOpen(false)
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
