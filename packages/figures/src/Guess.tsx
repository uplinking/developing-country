import { useEffect, useId, useRef, useState } from 'react'
import { formatBoundValue } from '@developing-country/emdash-blocks/figure-blocks'
import type { FiguresConfigInput } from './config'
import { boundValue, statFormat } from './binding'
import { useGuess } from './guessStore'
import { optionalNumber } from './steps'
import { useDataView } from './useDataView'

export interface GuessProps {
  guess_id: string
  question: string
  min: number | string
  max: number | string
  step?: number | string
  unit?: string
  format?: string
  reveal_hint?: string
  view_url: string
  field: string
  where_field?: string
  where_value?: string
  aggregate?: string
  scale?: number | string
  config?: FiguresConfigInput
}

function snap(value: number, min: number, step: number): number {
  const snapped = min + Math.round((value - min) / step) * step
  return Number(snapped.toFixed(6))
}

/** Position of `value` on the slider's scale, clamped to 0–100%. */
function percentAlong(value: number, min: number, max: number): number {
  return Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100))
}

/**
 * "Guess before you scroll" (dcGuess). The reader locks a guess; the answer is
 * revealed when the block scrolls into the top of the viewport, when the reader
 * scrolls past it, or on request — and by any dcStat with the same guess_id.
 */
export function Guess(props: GuessProps) {
  const min = optionalNumber(props.min)
  const max = optionalNumber(props.max)
  const stepValue = optionalNumber(props.step)
  const format = statFormat(props.format)
  const valid = min !== undefined && max !== undefined && max > min && Boolean(props.guess_id)
  const lo = min ?? 0
  const hi = max ?? 1
  const step = stepValue && stepValue > 0 ? stepValue : (hi - lo) / 100
  const [locked, lock] = useGuess(valid ? props.guess_id : undefined)
  const [draft, setDraft] = useState(() => snap((lo + hi) / 2, lo, step))
  const [revealed, setRevealed] = useState(false)
  const rootRef = useRef<HTMLElement>(null)
  const lockedRef = useRef(locked)
  lockedRef.current = locked
  const state = useDataView(props.view_url, props.config)
  const answer = boundValue(state, props as unknown as Record<string, unknown>, format, props.unit)
  const sliderId = useId()

  // Reveal once the reader has scrolled on: a locked guess after ~160px of
  // further scrolling with the block in the top third; an unlocked one once the
  // block has left the viewport. rAF-throttled, passive.
  const lockedAtY = useRef<number | null>(null)
  useEffect(() => {
    if (locked !== null && lockedAtY.current === null) lockedAtY.current = window.scrollY
  }, [locked])
  useEffect(() => {
    const element = rootRef.current
    if (!element || revealed) return
    let frame = 0
    const check = () => {
      frame = 0
      const rect = element.getBoundingClientRect()
      const scrolledOn = lockedAtY.current !== null && window.scrollY - lockedAtY.current > 160
      if ((lockedRef.current !== null && scrolledOn && rect.top < window.innerHeight * 0.33) || rect.bottom < 0) setRevealed(true)
    }
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(check) }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [revealed])

  if (!valid) {
    return <aside className="dcf dcf-unavailable" role="note">Guess unavailable: it needs a guess_id and a min below its max.</aside>
  }

  const shown = locked ?? draft
  const fmt = (value: number) => formatBoundValue(value, format, props.unit)

  return (
    <section ref={rootRef} className="dcf dcf-guess" data-locked={locked !== null} data-revealed={revealed}>
      <div className="dcf-figure__band">
        <span className="dcf-roundel" aria-hidden="true">?</span>
        <span className="dcf-kicker">Your guess</span>
      </div>
      <label className="dcf-guess__question" htmlFor={sliderId}>{props.question}</label>
      <output className="dcf-guess__value" htmlFor={sliderId} aria-live="polite">{fmt(shown)}</output>
      <input
        id={sliderId}
        className="dcf-guess__slider"
        type="range"
        min={lo}
        max={hi}
        step={step}
        value={shown}
        disabled={locked !== null}
        aria-valuetext={fmt(shown)}
        onChange={(event) => setDraft(Number(event.currentTarget.value))}
      />
      <div className="dcf-guess__scale" aria-hidden="true"><span>{fmt(lo)}</span><span>{fmt(hi)}</span></div>
      <div className="dcf-guess__actions">
        {locked === null ? (
          <button type="button" className="dcf-button dcf-button--primary" onClick={() => lock(draft)}>Lock in my guess</button>
        ) : (
          <p className="dcf-guess__locked">Locked at <strong>{fmt(locked)}</strong>.{props.reveal_hint ? ` ${props.reveal_hint}` : ''}</p>
        )}
        {!revealed ? (
          <button type="button" className="dcf-button" onClick={() => setRevealed(true)}>{locked === null ? 'Skip — show me' : 'Reveal now'}</button>
        ) : null}
      </div>
      {revealed ? (
        <div className="dcf-guess__reveal" role="status">
          {answer.status === 'ready' ? (
            <>
              <p>
                {locked !== null ? <>You guessed <strong>{fmt(locked)}</strong>. </> : <>No guess locked. </>}
                It’s <strong>{answer.text}</strong>.
              </p>
              <div className="dcf-guess__track" aria-hidden="true">
                {locked !== null ? <span className="dcf-guess__mark dcf-guess__mark--guess" style={{ left: `${percentAlong(locked, lo, hi)}%` }}>You</span> : null}
                <span className="dcf-guess__mark dcf-guess__mark--answer" style={{ left: `${percentAlong(answer.value, lo, hi)}%` }}>Data</span>
              </div>
              <p className="dcf-provenance"><span>{answer.source}</span><a className="dcf-open" href={props.view_url} target="_blank" rel="noopener">View data <span aria-hidden="true">↗</span></a></p>
            </>
          ) : answer.status === 'loading' ? (
            <p className="dcf-skeleton-line" aria-label="Loading the answer" />
          ) : (
            <p className="dcf-stat__value--unavailable"><span>Answer unavailable.</span> <small>{answer.reason}</small></p>
          )}
        </div>
      ) : null}
    </section>
  )
}

export default Guess
