import { useDeferredValue, useEffect, useId, useMemo, useState } from 'react'
import type { ExplorerMetric } from '@developing-country/emdash-blocks/figure-blocks'
import type { FiguresConfigInput } from './config'
import {
  EXPLORER_PAGE_SIZE,
  metricCell,
  metricMaxima,
  pageCount,
  pageOf,
  searchFieldsOf,
  searchRows,
  sortRows,
} from './explorerModel'
import { statFormat } from './binding'
import { provenanceText } from './provenance'
import { useDataView } from './useDataView'

export interface ExplorerProps {
  view_url: string
  title?: string
  title_field: string
  subtitle_field?: string
  search_fields?: string
  metrics: Array<Partial<ExplorerMetric> & Record<string, unknown>>
  badges?: Array<Partial<ExplorerMetric> & Record<string, unknown>>
  sort_field?: string
  sort_dir?: 'asc' | 'desc' | string
  config?: FiguresConfigInput
}

function cleanMetrics(input: ExplorerProps['metrics']): ExplorerMetric[] {
  return (Array.isArray(input) ? input : []).flatMap((metric) => {
    const field = typeof metric.field === 'string' ? metric.field.trim() : ''
    if (!field) return []
    const format = statFormat(metric.format)
    return [{
      field,
      label: typeof metric.label === 'string' && metric.label.trim() ? metric.label.trim() : field,
      ...(typeof metric.unit === 'string' && metric.unit ? { unit: metric.unit } : {}),
      ...(format ? { format } : {}),
    }]
  }).slice(0, 6)
}

/** Searchable, sortable small multiples over a view's rows (dcExplorer). */
export function Explorer(props: ExplorerProps) {
  const state = useDataView(props.view_url, props.config)
  const metrics = useMemo(() => cleanMetrics(props.metrics), [props.metrics])
  const badges = useMemo(() => cleanMetrics(props.badges ?? []), [props.badges])
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const defaultSort = props.sort_field || metrics[0]?.field || props.title_field
  const [sortField, setSortField] = useState(defaultSort)
  const [direction, setDirection] = useState<'asc' | 'desc'>(props.sort_dir === 'asc' ? 'asc' : 'desc')
  const [page, setPage] = useState(0)
  const searchId = useId()
  const sortId = useId()
  const rows = state.data?.rows ?? []
  const fields = useMemo(() => searchFieldsOf(props.search_fields, props.title_field, props.subtitle_field), [props.search_fields, props.title_field, props.subtitle_field])
  const maxima = useMemo(() => metricMaxima(rows, metrics), [rows, metrics])
  const filtered = useMemo(() => sortRows(searchRows(rows, deferredQuery, fields), sortField, direction), [rows, deferredQuery, fields, sortField, direction])
  const pages = pageCount(filtered.length)
  const current = Math.min(page, pages - 1)
  const visible = pageOf(filtered, current)

  useEffect(() => setPage(0), [deferredQuery, sortField, direction])

  const sortOptions = [
    { field: props.title_field, label: 'Name' },
    ...metrics.map((metric) => ({ field: metric.field, label: metric.label })),
    ...badges.map((badge) => ({ field: badge.field, label: [badge.label, badge.unit].filter(Boolean).join(' ') })),
  ]
  const first = filtered.length === 0 ? 0 : current * EXPLORER_PAGE_SIZE + 1
  const last = Math.min(filtered.length, (current + 1) * EXPLORER_PAGE_SIZE)

  return (
    <section className="dcf dcf-explorer" aria-label={props.title || 'Explorer'}>
      <header className="dcf-figure__band">
        <span className="dcf-roundel" aria-hidden="true">E</span>
        <span className="dcf-kicker">Explorer</span>
        {state.data ? <span className="dcf-kicker dcf-figure__count">{rows.length.toLocaleString('en')} rows</span> : null}
      </header>
      {props.title ? <p className="dcf-figure__title">{props.title}</p> : null}
      <div className="dcf-explorer__controls">
        <label className="dcf-field" htmlFor={searchId}>
          <span className="dcf-kicker">Search</span>
          <input id={searchId} type="search" value={query} placeholder="Type a name" onChange={(event) => setQuery(event.currentTarget.value)} autoComplete="off" />
        </label>
        <label className="dcf-field" htmlFor={sortId}>
          <span className="dcf-kicker">Sort by</span>
          <select id={sortId} value={sortField} onChange={(event) => setSortField(event.currentTarget.value)}>
            {sortOptions.map((option) => <option key={option.field} value={option.field}>{option.label}</option>)}
          </select>
        </label>
        <button
          type="button"
          className="dcf-button dcf-explorer__direction"
          onClick={() => setDirection((value) => (value === 'asc' ? 'desc' : 'asc'))}
          aria-label={direction === 'asc' ? 'Sorted ascending; switch to descending' : 'Sorted descending; switch to ascending'}
        >
          {direction === 'asc' ? '↑ Low first' : '↓ High first'}
        </button>
      </div>
      {badges.some((badge) => badge.unit) ? (
        <p className="dcf-explorer__key" aria-hidden="true">
          {badges.map((badge) => <span key={badge.field}>{badge.label} {badge.unit ?? badge.field}</span>)}
        </p>
      ) : null}
      {state.status === 'loading' ? <div className="dcf-skeleton" role="status"><span className="dcf-lamp" aria-hidden="true" />Loading rows</div> : null}
      {state.status === 'error' ? <div className="dcf-unavailable" role="alert"><strong>Explorer unavailable.</strong> {state.error.message}</div> : null}
      {state.status === 'ready' && metrics.length === 0 ? <div className="dcf-unavailable" role="alert">Explorer unavailable: no metrics are configured.</div> : null}
      {state.status === 'ready' && metrics.length > 0 ? (
        <>
          <p className="dcf-kicker dcf-explorer__count" aria-live="polite">
            {filtered.length === 0 ? 'No matches' : `Showing ${first.toLocaleString('en')}–${last.toLocaleString('en')} of ${filtered.length.toLocaleString('en')}`}
          </p>
          <ul className="dcf-explorer__grid">
            {visible.map((row, index) => {
              const title = String(row[props.title_field] ?? '—')
              const subtitle = props.subtitle_field ? row[props.subtitle_field] : undefined
              return (
                <li key={`${title}:${current}:${index}`} className="dcf-card">
                  <p className="dcf-card__title">{title}</p>
                  {subtitle !== undefined && subtitle !== null && subtitle !== '' ? <p className="dcf-card__subtitle">{String(subtitle)}</p> : null}
                  <dl className="dcf-card__metrics">
                    {metrics.map((metric) => {
                      const cell = metricCell(row, metric, maxima[metric.field] ?? 0)
                      return (
                        <div key={metric.field} className="dcf-metric" data-active={metric.field === sortField}>
                          <dt>{cell.label}</dt>
                          <dd>{cell.text}</dd>
                          {cell.glyphs !== null ? (
                            <span className="dcf-metric__glyphs" aria-hidden="true">
                              {Array.from({ length: 10 }, (_, i) => <span key={i} data-on={i < (cell.glyphs ?? 0)} />)}
                            </span>
                          ) : (
                            <span className="dcf-metric__bar" aria-hidden="true"><span style={{ width: `${(cell.fraction ?? 0) * 100}%` }} /></span>
                          )}
                        </div>
                      )
                    })}
                  </dl>
                  {badges.length > 0 ? (
                    <p className="dcf-card__badges">
                      {badges.map((badge) => {
                        const { unit: _unit, ...plain } = badge
                        const cell = metricCell(row, plain, 0)
                        return (
                          <span
                            key={badge.field}
                            className="dcf-badge"
                            data-active={badge.field === sortField}
                            title={badge.unit ? `${cell.text} ${badge.unit}` : undefined}
                          >
                            <span aria-hidden="true">{badge.label}</span>
                            {' '}{cell.text}
                            {badge.unit ? <span className="dcf-visually-hidden"> {badge.unit}</span> : null}
                          </span>
                        )
                      })}
                    </p>
                  ) : null}
                </li>
              )
            })}
          </ul>
          {pages > 1 ? (
            <nav className="dcf-explorer__pager" aria-label="Explorer pages">
              <button type="button" className="dcf-button" disabled={current === 0} onClick={() => setPage(current - 1)}>← Previous</button>
              <span className="dcf-kicker">Page {current + 1} / {pages}</span>
              <button type="button" className="dcf-button" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>Next →</button>
            </nav>
          ) : null}
          <p className="dcf-provenance">
            <span>{provenanceText(state.data.view)}</span>
            <a className="dcf-open" href={props.view_url} target="_blank" rel="noopener">Open in explorer <span aria-hidden="true">↗</span></a>
          </p>
        </>
      ) : null}
    </section>
  )
}

export default Explorer
