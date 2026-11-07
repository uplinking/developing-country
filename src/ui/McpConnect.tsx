// The "MCP" action in the chrome bar. The trigger shows the client marks
// (Grok / Claude / GPT / Cursor) so it's obvious this connects your AI
// assistant rather than sharing a link. The dialog is three numbered steps:
// copy the URL, add it in the chosen client, sign in and ask.

import { useEffect, useId, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { appUrl } from '../base'

function mcpUrl(): string {
  return appUrl('/mcp')
}

function FaceClaude() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path
        fill="currentColor"
        d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z"
      />
    </svg>
  )
}
function FaceGrok() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M9.27 15.29 17.248 9.393c.391-.29.95-.177 1.137.272.98 2.369.542 5.215-1.41 7.169-1.951 1.954-4.667 2.382-7.149 1.406L7.115 19.497c3.889 2.661 8.611 2.003 11.562-.953 2.341-2.344 3.066-5.539 2.388-8.42l.006.007c-.983-4.232.242-5.924 2.75-9.383.06-.082.12-.164.179-.248L20.699 4.805 9.267 15.292M7.623 16.723c-2.792-2.67-2.31-6.801.071-9.184 1.761-1.763 4.647-2.483 7.166-1.425l2.705-1.25a7.808 7.808 0 0 0-1.829-1A8.975 8.975 0 0 0 5.984 5.83c-2.533 2.536-3.33 6.436-1.962 9.764 1.022 2.487-.653 4.246-2.34 6.022-.599.63-1.199 1.259-1.682 1.925z"
      />
    </svg>
  )
}
function FaceGpt() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path
        fill="currentColor"
        d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"
      />
    </svg>
  )
}
function FaceCursor() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path
        fill="currentColor"
        d="M11.503.131 1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.724V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23"
      />
    </svg>
  )
}

type ClientId = 'claude' | 'chatgpt' | 'grok' | 'cursor' | 'other'

const CLIENT_KEY = 'dc-mcp-client'
const EXAMPLE_PROMPTS = [
  'Chart Sri Lanka’s monthly workers’ remittances since 2019.',
  'Which divisions lost population between the 2012 and 2024 censuses?',
  'What’s within 2 km of Colombo Fort, and how has its population changed?',
]

function storedClient(): ClientId {
  try {
    const v = window.localStorage.getItem(CLIENT_KEY)
    if (v === 'claude' || v === 'chatgpt' || v === 'grok' || v === 'cursor' || v === 'other') return v
  } catch {
    /* storage blocked */
  }
  return 'claude'
}

function utf8Base64(text: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)))
}

export default function McpConnect({
  live,
  onCoverage,
  initialOpen = false,
}: {
  live?: boolean
  onCoverage?: () => void
  initialOpen?: boolean
}) {
  const titleId = useId()
  const [open, setOpen] = useState(initialOpen)
  const [client, setClient] = useState<ClientId>(storedClient)
  const [copied, setCopied] = useState<string | null>(null)
  const url = mcpUrl()
  const claudeCmd = `claude mcp add --transport http developing-country ${url}`
  const cursorJson = `{
  "mcpServers": {
    "developing-country": {
      "url": "${url}"
    }
  }
}`
  const cursorInstall =
    'cursor://anysphere.cursor-deeplink/mcp/install?name=developing-country&config=' +
    encodeURIComponent(utf8Base64(JSON.stringify({ url })))

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const pick = (id: ClientId) => {
    setClient(id)
    try {
      window.localStorage.setItem(CLIENT_KEY, id)
    } catch {
      /* storage blocked */
    }
  }

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      window.setTimeout(() => setCopied((k) => (k === key ? null : k)), 1600)
    } catch {
      /* clipboard blocked */
    }
  }

  const clients: Array<{ id: ClientId; name: string; face: ReactNode }> = [
    { id: 'claude', name: 'Claude', face: <FaceClaude /> },
    { id: 'chatgpt', name: 'ChatGPT', face: <FaceGpt /> },
    { id: 'grok', name: 'Grok', face: <FaceGrok /> },
    { id: 'cursor', name: 'Cursor', face: <FaceCursor /> },
    { id: 'other', name: 'Other', face: <span className="mcp-pick-dots">···</span> },
  ]

  const snippet = (key: string, text: string, label: string) => (
    <div className="mcp-snippet-wrap">
      <pre className="mcp-snippet">{text}</pre>
      <button type="button" className="mcp-copy" onClick={() => copy(key, text)}>
        {copied === key ? 'Copied' : label}
      </button>
    </div>
  )

  const recipe = (() => {
    switch (client) {
      case 'claude':
        return (
          <>
            <ol className="mcp-recipe">
              <li>Open <strong>Settings → Connectors</strong> on claude.ai or in the desktop app.</li>
              <li>Choose <strong>Add custom connector</strong>, name it <em>developing-country.org</em> and paste the URL.</li>
              <li>Select <strong>Connect</strong>, then turn it on in a chat from the <strong>+</strong> menu.</li>
            </ol>
            <a className="mcp-open" href="https://claude.ai/settings/connectors" target="_blank" rel="noreferrer">
              Open Claude connectors ↗
            </a>
            <p className="mcp-recipe-note">Using Claude Code? Run this in a terminal:</p>
            {snippet('claude', claudeCmd, 'Copy command')}
          </>
        )
      case 'chatgpt':
        return (
          <>
            <ol className="mcp-recipe">
              <li>Open <strong>Settings → Apps &amp; Connectors</strong>.</li>
              <li>Under <strong>Advanced settings</strong>, turn on <strong>Developer mode</strong>, then choose <strong>Create</strong>.</li>
              <li>Paste the URL, choose <strong>OAuth</strong> for authentication and save.</li>
            </ol>
            <a className="mcp-open" href="https://chatgpt.com/#settings/Connectors" target="_blank" rel="noreferrer">
              Open ChatGPT settings ↗
            </a>
          </>
        )
      case 'grok':
        return (
          <>
            <ol className="mcp-recipe">
              <li>Open <strong>grok.com/connectors</strong>.</li>
              <li>Choose <strong>New Connector → Custom</strong> and paste the URL.</li>
              <li>Finish the sign-in when Grok asks.</li>
            </ol>
            <a className="mcp-open" href="https://grok.com/connectors" target="_blank" rel="noreferrer">
              Open Grok connectors ↗
            </a>
          </>
        )
      case 'cursor':
        return (
          <>
            <ol className="mcp-recipe">
              <li>Select <strong>Add to Cursor</strong>, or paste the JSON below into <code>.cursor/mcp.json</code> (this project) or <code>~/.cursor/mcp.json</code> (every project).</li>
              <li>Cursor shows <strong>Needs login</strong> next to the server. Select it to sign in.</li>
            </ol>
            <a className="mcp-open" href={cursorInstall}>Add to Cursor ↗</a>
            {snippet('cursor', cursorJson, 'Copy JSON')}
          </>
        )
      case 'other':
        return (
          <ol className="mcp-recipe">
            <li>Add a <strong>remote MCP server</strong> (streamable HTTP) and paste the URL.</li>
            <li>Leave authentication on <strong>OAuth</strong>. The client registers itself, so there is no key to paste.</li>
            <li>Approve the sign-in when your browser opens.</li>
          </ol>
        )
    }
  })()

  return (
    <>
      <button
        type="button"
        className={`chrome-btn mcp-trigger${live ? ' live' : ''}`}
        onClick={() => setOpen(true)}
        aria-label="Connect your AI assistant: Claude, ChatGPT, Grok, Cursor or any MCP client"
        title="Connect your AI assistant"
      >
        <span className="mcp-avatars" aria-hidden="true">
          <span className="mcp-av face-grok">
            <FaceGrok />
          </span>
          <span className="mcp-av face-claude">
            <FaceClaude />
          </span>
          <span className="mcp-av face-gpt">
            <FaceGpt />
          </span>
          <span className="mcp-av face-cursor">
            <FaceCursor />
          </span>
        </span>
        <span className="chrome-btn-label">MCP</span>
      </button>

      {/* Portalled to <body> ON PURPOSE. Any blurred/filtered ancestor becomes a
          containing block for position:fixed descendants — an overlay rendered
          in place would size itself to its parent and hang off-screen. */}
      {open && createPortal(
        <div
          className="auth-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false)
          }}
        >
          <div
            className="auth-modal mcp-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="auth-sheet-grip" aria-hidden="true" />
            <header className="surf-band">
              <span className="band-title">Connect your assistant</span>
              {live ? <span className="mcp-live">Assistant live</span> : null}
              <button className="feature-close" onClick={() => setOpen(false)} aria-label="Close">
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
              <h2 id={titleId} className="auth-title">
                Ask your AI assistant about this data
              </h2>
              <p className="auth-sub">
                Add developing-country.org as a connector. Your assistant can then search 100+
                official tables and the map layers, and answer with sourced charts and maps.
              </p>

              <ol className="mcp-steps">
                <li className="mcp-step">
                  <span className="roundel" aria-hidden="true">1</span>
                  <div className="mcp-step-body">
                    <h3 className="mcp-step-title">Copy the connector URL</h3>
                    <div className="mcp-url-row">
                      <code className="mcp-url">{url}</code>
                      <button type="button" className="mcp-copy primary" onClick={() => copy('url', url)}>
                        {copied === 'url' ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  </div>
                </li>

                <li className="mcp-step">
                  <span className="roundel" aria-hidden="true">2</span>
                  <div className="mcp-step-body">
                    <h3 className="mcp-step-title">Add it to your assistant</h3>
                    <div className="mcp-picker" role="tablist" aria-label="Assistant">
                      {clients.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          role="tab"
                          id={`${titleId}-tab-${c.id}`}
                          aria-selected={client === c.id}
                          aria-controls={`${titleId}-panel`}
                          className="mcp-pick"
                          onClick={() => pick(c.id)}
                        >
                          <span className={`mcp-pick-face face-${c.id}`} aria-hidden="true">{c.face}</span>
                          <span className="mcp-pick-name">{c.name}</span>
                        </button>
                      ))}
                    </div>
                    <div
                      className="mcp-recipe-panel"
                      role="tabpanel"
                      id={`${titleId}-panel`}
                      aria-labelledby={`${titleId}-tab-${client}`}
                    >
                      {recipe}
                    </div>
                  </div>
                </li>

                <li className="mcp-step">
                  <span className="roundel" aria-hidden="true">3</span>
                  <div className="mcp-step-body">
                    <h3 className="mcp-step-title">Sign in, then ask</h3>
                    <p className="mcp-step-text">
                      The first time it connects, a developing-country.org sign-in opens. Use the
                      same account as this map. No API key needed. Then try:
                    </p>
                    <ul className="mcp-prompts">
                      {EXAMPLE_PROMPTS.map((prompt, i) => (
                        <li key={prompt}>
                          <button type="button" className="mcp-prompt" onClick={() => copy(`prompt-${i}`, prompt)}>
                            <span>{prompt}</span>
                            <span className="mcp-prompt-copy">{copied === `prompt-${i}` ? 'Copied' : 'Copy'}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                </li>
              </ol>

              <p className="mcp-foot">
                Answers cite their source and vintage, and say when data is missing.
                {onCoverage && (
                  <>
                    {' '}
                    <button type="button" className="mcp-inline" onClick={() => { setOpen(false); onCoverage() }}>
                      See what’s covered
                    </button>
                  </>
                )}
              </p>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
