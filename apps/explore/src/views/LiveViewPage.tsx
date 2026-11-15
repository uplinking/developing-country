import { Suspense, useMemo } from 'react'
import { useDataViewById } from '@developing-country/figures'
import { appUrl, withBase } from '../base'

import { LiveChart, LiveMap } from './lazyViews'

/**
 * The canonical /views/{id} page. Loading, validation and snapshot resolution
 * are the shared figures loader (the same one article figures use), so a view
 * fails closed identically everywhere it is opened.
 */
export default function LiveViewPage({ id }: { id: string }) {
  const apiBase = useMemo(() => appUrl('/').replace(/\/$/, ''), [])
  const state = useDataViewById(id, apiBase, typeof window === 'undefined' ? '' : window.location.href)

  if (state.status === 'error') return <main className="live-view-state"><p>{state.error.message}</p></main>
  if (state.status === 'loading') return <main className="live-view-state"><p>Loading live data…</p></main>
  const { view, result, rows } = state.data
  const sources = view.evidence.sourceIds.map((source) => source.replace(/^source:/, '').replaceAll('-', ' '))
  const vintages = [...new Set(view.evidence.datasetVersions.map((version) => version.vintage))]

  return (
    <main className={`live-view-page live-view-${view.kind}`}>
      <header className="live-view-header">
        <a className="live-view-brand" href={withBase('/')}>developing-country.org</a>
        <div>
          <p className="live-view-kicker">{view.country} / LIVE {view.kind.toUpperCase()}</p>
          <h1>{view.title}</h1>
          {view.description ? <p className="live-view-deck">{view.description}</p> : null}
        </div>
      </header>
      <section className="live-view-stage">
        <Suspense fallback={<div className="live-view-state"><p>Preparing live view…</p></div>}>
          {view.kind === 'chart' ? <LiveChart view={view} rows={rows} /> : <LiveMap view={view} result={result} />}
        </Suspense>
      </section>
      <footer className="live-view-footer">
        <span>{view.data.rowCount.toLocaleString()} rows</span>
        {result.truncated === true ? <strong>Bounded result — source query was truncated</strong> : null}
        {result.geometry_omitted ? <strong>Detailed geometry omitted from this bounded snapshot</strong> : null}
        <span>Sources: {sources.join(', ')}</span>
        {vintages.length > 0 ? <span>Vintage {vintages.join(', ')}</span> : null}
        <span>Updated {new Date(view.evidence.generatedAt).toLocaleDateString()}</span>
        <code>{view.data.resultChecksum.slice(0, 19)}…</code>
      </footer>
    </main>
  )
}
