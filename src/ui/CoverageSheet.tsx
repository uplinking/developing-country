import { useEffect, useState } from 'react'
import { withBase } from '../base'
import { isJsonObject, type JsonValue } from '../shared/json'

interface CoverageRow {
  id: string
  title: string
  official?: { status?: string; source?: string; note?: string }
  osm?: { status?: string; note?: string }
  ours?: { status?: string; note?: string; storage?: string }
  blocker?: string | null
  last_checked?: string
}

interface CoverageDoc {
  version?: string
  note?: string
  rows?: CoverageRow[]
}

export default function CoverageSheet({ onClose }: { onClose: () => void }) {
  const [doc, setDoc] = useState<CoverageDoc | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(withBase('/api/coverage'), { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const value: JsonValue = await res.json()
        if (!isJsonObject(value)) throw new Error('Invalid coverage response')
        const doc: CoverageDoc = JSON.parse(JSON.stringify(value))
        return doc
      })
      .then((body) => {
        if (!cancelled) setDoc(body)
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="feature-sheet coverage-sheet" data-route="info">
      <div className="feature-head">
        <div>
          <span className="feature-kind">Data commons</span>
          <h2 className="feature-title">Coverage ledger</h2>
        </div>
        <button className="feature-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <p className="feature-blurb">
        {doc?.note ??
          'Official vs OSM vs what developing-country.org ships. known_absent means we have no geometry — we do not invent it.'}
      </p>
      {error && <p className="feature-blurb">Could not load coverage: {error}</p>}
      {!doc && !error && <p className="feature-blurb">Loading…</p>}
      {doc?.rows?.map((row) => (
        <section key={row.id} className="coverage-row">
          <h3>
            {row.title} <code>{row.id}</code>
          </h3>
          <dl className="feature-rows">
            <div className="feature-row">
              <dt>Official</dt>
              <dd>
                {row.official?.status ?? '—'}
                {row.official?.source ? ` · ${row.official.source}` : ''}
              </dd>
            </div>
            <div className="feature-row">
              <dt>OSM</dt>
              <dd>{row.osm?.status ?? '—'}{row.osm?.note ? ` · ${row.osm.note}` : ''}</dd>
            </div>
            <div className="feature-row">
              <dt>On the map</dt>
              <dd>{row.ours?.status ?? '—'}{row.ours?.note ? ` · ${row.ours.note}` : ''}</dd>
            </div>
            {row.blocker ? (
              <div className="feature-row">
                <dt>Blocker</dt>
                <dd>{row.blocker}</dd>
              </div>
            ) : null}
            {row.last_checked ? (
              <div className="feature-row">
                <dt>Last checked</dt>
                <dd>{row.last_checked}</dd>
              </div>
            ) : null}
          </dl>
        </section>
      ))}
    </div>
  )
}
