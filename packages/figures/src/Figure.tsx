import type { ReactNode } from 'react'
import type { DataViewSpec } from '@developing-country/views'
import { FiguresProvider, useFiguresConfig, type FiguresConfigInput } from './config'
import { ChartFigure } from './ChartFigure'
import { MapFigure } from './MapFigure'
import { provenanceOf } from './provenance'
import { useDataViews, type DataViewState } from './useDataView'
import { devWarn, resolveUnderlays, type UnderlayStatus } from './underlays'
import type { MapSceneView } from './mapEngine'

export type FigureSize = 'inline' | 'wide' | 'full'

export interface FigureFrameProps {
  view: DataViewSpec | null
  viewUrl: string
  title?: string
  caption?: string
  size?: FigureSize
  className?: string
  /** Underlay views listed in the caption so every drawn view keeps its provenance link. */
  underlays?: UnderlayStatus[]
  children: ReactNode
}

/** The signage slab every figure sits in: route band, title, stage, provenance, explorer link. */
export function FigureFrame({ view, viewUrl, title, caption, size = 'inline', className = '', underlays = [], children }: FigureFrameProps) {
  const kind = view?.kind ?? 'loading'
  const provenance = view ? provenanceOf(view) : null
  const heading = title || view?.title
  return (
    <figure className={`dcf dcf-figure dcf-size-${size} ${className}`.trim()} data-kind={kind}>
      <header className="dcf-figure__band">
        <span className="dcf-roundel" aria-hidden="true">{kind === 'chart' ? 'C' : 'M'}</span>
        <span className="dcf-kicker">{view ? `Figure · ${view.kind === 'map' ? 'Map' : 'Chart'}` : 'Figure'}</span>
        {provenance ? <span className="dcf-kicker dcf-figure__count">{provenance.rows.toLocaleString('en')} rows</span> : null}
      </header>
      {heading ? <p className="dcf-figure__title">{heading}</p> : <p className="dcf-figure__title dcf-skeleton-line" aria-hidden="true" />}
      <div className="dcf-figure__stage">{children}</div>
      <figcaption className="dcf-figure__caption">
        {caption ? <p className="dcf-figure__text">{caption}</p> : null}
        <p className="dcf-provenance">
          {provenance ? (
            <>
              <span>Source: {provenance.sources.join(', ')}</span>
              {provenance.vintages.length > 0 ? <span>Vintage {provenance.vintages.join(', ')}</span> : null}
              <span>Saved {provenance.generated}</span>
              {provenance.partial ? <span>Partial coverage</span> : null}
            </>
          ) : <span>Loading provenance…</span>}
          <a className="dcf-open" href={viewUrl} target="_blank" rel="noopener">Open in explorer <span aria-hidden="true">↗</span></a>
        </p>
        {underlays.length > 0 ? <UnderlayList underlays={underlays} /> : null}
      </figcaption>
    </figure>
  )
}

/** "Beneath" line: each underlay view, its state and its own explorer link. */
export function UnderlayList({ underlays }: { underlays: UnderlayStatus[] }) {
  return (
    <ul className="dcf-provenance dcf-underlays" aria-label="Views drawn beneath">
      {underlays.map((item) => (
        <li key={item.url} data-state={item.state}>
          <span>Beneath: {item.title ?? item.url.split('/').pop()}</span>
          {item.state === 'loading' ? <span>Loading…</span> : null}
          {item.state === 'error' || item.state === 'ignored' ? <span>Not drawn: {item.message}</span> : null}
          <a className="dcf-open" href={item.url} target="_blank" rel="noopener">View <span aria-hidden="true">↗</span></a>
        </li>
      ))}
    </ul>
  )
}

export function FigureStage({ state, highlight, underlays }: { state: DataViewState; highlight?: string[]; underlays?: MapSceneView[] }) {
  if (state.status === 'loading') {
    return <div className="dcf-skeleton" role="status" aria-live="polite"><span className="dcf-lamp" aria-hidden="true" />Loading data view</div>
  }
  if (state.status === 'error') {
    return <div className="dcf-unavailable" role="alert"><strong>Figure unavailable.</strong> {state.error.message}</div>
  }
  const { view, rows, result } = state.data
  if (view.kind === 'chart') return <ChartFigure view={view} rows={rows} {...(highlight ? { highlight } : {})} />
  return <MapFigure view={view} rows={rows} result={result} {...(highlight ? { highlight } : {})} {...(underlays ? { underlays } : {})} />
}

export interface FigureProps {
  viewUrl: string
  /** Map views drawn beneath `viewUrl`, bottom first (already validated canonical URLs). */
  underlayUrls?: string[]
  title?: string
  caption?: string
  size?: FigureSize
  config?: FiguresConfigInput
}

/** One inline figure (dcFigure): map or chart, whichever the view is. */
export function Figure({ viewUrl, underlayUrls = [], title, caption, size = 'inline', config }: FigureProps) {
  const states = useDataViews([viewUrl, ...underlayUrls], config)
  const state: DataViewState = states.get(viewUrl) ?? { status: 'loading', data: null, error: null }
  const isChart = state.data?.view.kind === 'chart'
  if (isChart && underlayUrls.length > 0) devWarnChartMain(viewUrl)
  const underlays = isChart ? { views: [], statuses: [] } : resolveUnderlays(underlayUrls, states, viewUrl)
  return (
    <FigureFrame view={state.data?.view ?? null} viewUrl={viewUrl} title={title} caption={caption} size={size} underlays={underlays.statuses}>
      <ConfigScope config={config}>
        <FigureStage state={state} underlays={underlays.views} />
      </ConfigScope>
    </FigureFrame>
  )
}

function devWarnChartMain(viewUrl: string): void {
  devWarn(`${viewUrl} is a chart view; its underlay_urls were ignored (underlays are for maps).`)
}


/** Islands pass config as props; children read it through context. */
export function ConfigScope({ config, children }: { config?: FiguresConfigInput; children: ReactNode }) {
  const resolved = useFiguresConfig(config)
  return <FiguresProvider value={resolved}>{children}</FiguresProvider>
}

export default Figure
