// Sign-in / sign-up over the map. This file is only the modal cabinet — the
// card body lives in AuthPanel so the MCP consent page (ConnectFlow) can reuse
// it. The cabinet opens with a nameboard band, like every other surface.

import { useCallback, useEffect, useId, useState } from 'react'
import AuthPanel from './AuthPanel'
import { appUrl } from '../base'

export default function AuthModal({ onClose }: { onClose: () => void }) {
  const titleId = useId()
  const descId = useId()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  // Stable identity: AuthPanel reports busy from an effect, so a fresh closure
  // every render would re-fire it on each keystroke.
  const onBusyChange = useCallback((b: boolean) => setBusy(b), [])

  return (
    <div
      className="auth-overlay"
      onClick={(e) => {
        if (!busy && e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="auth-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
      >
        <div className="auth-sheet-grip" aria-hidden="true" />
        <header className="surf-band">
          <span className="band-title">Account</span>
          <button className="feature-close" onClick={onClose} aria-label="Close" disabled={busy}>
            <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
              <path
                d="M3.2 3.2l9.6 9.6M12.8 3.2l-9.6 9.6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>

        <div className="cabinet-body">
          <AuthPanel
            titleId={titleId}
            descId={descId}
            kicker=""
            onDone={onClose}
            onBusyChange={onBusyChange}
            callbackURL={appUrl('/')}
          />
        </div>
      </div>
    </div>
  )
}
