import { formatBoundValue, type StatFormat } from '@developing-country/emdash-blocks/figure-blocks'
import type { FiguresConfigInput } from './config'
import { boundValue, statFormat } from './binding'
import { useGuess } from './guessStore'
import { useDataView } from './useDataView'

export interface BoundStatProps {
  view_url: string
  field: string
  label: string
  where_field?: string
  where_value?: string
  aggregate?: string
  scale?: number | string
  format?: StatFormat | string
  unit?: string
  note?: string
  guess_id?: string
  config?: FiguresConfigInput
}

/** A number read from a Data View (dcStat), with its source; optionally compared with the reader's guess. */
export function BoundStat(props: BoundStatProps) {
  const state = useDataView(props.view_url, props.config)
  const format = statFormat(props.format)
  const bound = boundValue(state, props as unknown as Record<string, unknown>, format, props.unit)
  const [guess] = useGuess(props.guess_id || undefined)
  return (
    <aside className="dcf dcf-stat" data-state={bound.status} aria-busy={bound.status === 'loading'}>
      <div className="dcf-stat__band"><span className="dcf-kicker">{props.label}</span></div>
      {bound.status === 'loading' ? <p className="dcf-stat__value dcf-skeleton-block" aria-label="Loading value" /> : null}
      {bound.status === 'unavailable' ? (
        <p className="dcf-stat__value dcf-stat__value--unavailable"><span>Unavailable</span><small>{bound.reason}</small></p>
      ) : null}
      {bound.status === 'ready' ? <p className="dcf-stat__value">{bound.text}</p> : null}
      {bound.status === 'ready' && props.guess_id && guess !== null ? (
        <p className="dcf-stat__guess" role="status">
          You guessed <strong>{formatBoundValue(guess, format, props.unit)}</strong>. It’s <strong>{bound.text}</strong>.
        </p>
      ) : null}
      {props.note ? <p className="dcf-stat__note">{props.note}</p> : null}
      <p className="dcf-provenance">
        {bound.status === 'ready' ? <span>{bound.source}</span> : <span>{bound.status === 'loading' ? 'Loading source…' : 'No source value'}</span>}
        <a className="dcf-open" href={props.view_url} target="_blank" rel="noopener">View data <span aria-hidden="true">↗</span></a>
      </p>
    </aside>
  )
}

export default BoundStat
