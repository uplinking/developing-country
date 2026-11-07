import { useEffect, useMemo, useRef, useState } from 'react'
import type { ScrollyStep } from '@developing-country/emdash-blocks/figure-blocks'
import type { FiguresConfigInput } from './config'
import { ConfigScope } from './Figure'
import { ChartFigure } from './ChartFigure'
import { MapFigure } from './MapFigure'
import { activeStepIndex, parseScrollyStep, resolveStepCamera, stepParagraphs, stepTriggerLine, type StepState } from './steps'
import { useDataViews, type DataViewState } from './useDataView'
import { resolveUnderlays } from './underlays'

export interface ScrollyProps {
  title?: string
  steps: Array<Partial<ScrollyStep> | Record<string, unknown>>
  config?: FiguresConfigInput
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** Find the nearest step at or before `from` (then after it) whose view is ready and of `kind`. */
function nearestOfKind(parsed: StepState[], states: Map<string, DataViewState>, from: number, kind: 'map' | 'chart'): number {
  const ready = (i: number) => states.get(parsed[i]?.viewUrl ?? '')?.data?.view.kind === kind
  for (let i = from; i >= 0; i -= 1) if (ready(i)) return i
  for (let i = from + 1; i < parsed.length; i += 1) if (ready(i)) return i
  return -1
}

/**
 * Sticky figure + steps (dcScrolly). The active step is whichever crosses the
 * trigger line (see stepTriggerLine); focusing a step (keyboard) activates it
 * too. On phones the figure is pinned on top and the steps slide beneath it,
 * so the text never covers the map. One MapLibre instance serves every map
 * step, cross-fading between views. No band over the figure and no source
 * strip under it: the step cards number themselves, and an article lists every
 * cited view under Method & sources.
 */
export function Scrolly({ title, steps, config }: ScrollyProps) {
  const parsed = useMemo(() => steps.map(parseScrollyStep).filter((step) => step.viewUrl), [steps])
  const urls = useMemo(() => parsed.flatMap((step) => [step.viewUrl, ...step.underlays]), [parsed])
  const states = useDataViews(urls, config)
  const [active, setActive] = useState(0)
  const stepRefs = useRef<Array<HTMLLIElement | null>>([])
  const figureRef = useRef<HTMLDivElement>(null)
  const stepsRef = useRef<HTMLOListElement>(null)

  useEffect(() => {
    // The active step is the last one whose top has passed the trigger line.
    // Derived from scroll position on every frame rather than from an
    // IntersectionObserver band, which a fast flick can jump over entirely.
    let frame = 0
    const update = () => {
      frame = 0
      const figure = figureRef.current?.getBoundingClientRect()
      const list = stepsRef.current?.getBoundingClientRect()
      // Stacked when the pinned figure spans the same columns as the steps (phones).
      const stacked = Boolean(figure && list && figure.left < list.right && list.left < figure.right)
      const line = stepTriggerLine(window.innerHeight, figure ? figure.bottom : null, stacked)
      const tops = stepRefs.current.map((element) => (element ? element.getBoundingClientRect().top : null))
      const next = activeStepIndex(tops, line)
      setActive((current) => (current === next ? current : next))
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
    }
  }, [parsed.length])

  const step = parsed[active]
  const activeState = step ? states.get(step.viewUrl) : undefined
  const activeView = activeState?.data?.view ?? null
  const mapIndex = nearestOfKind(parsed, states, active, 'map')
  const chartIndex = nearestOfKind(parsed, states, active, 'chart')
  const mapStep = mapIndex >= 0 ? parsed[mapIndex] : undefined
  const chartStep = chartIndex >= 0 ? parsed[chartIndex] : undefined
  const mapData = mapStep ? states.get(mapStep.viewUrl)?.data : undefined
  const chartData = chartStep ? states.get(chartStep.viewUrl)?.data : undefined
  // Underlays belong to the map step on screen; ones shared with the previous
  // map step keep their mounted layers (the engine diffs by view id).
  const mapUnderlays = mapStep ? resolveUnderlays(mapStep.underlays, states, mapStep.viewUrl) : { views: [], statuses: [] }

  if (parsed.length === 0) {
    return <aside className="dcf dcf-unavailable" role="note">Scrolly unavailable: it has no steps with a Data View.</aside>
  }

  return (
    <section className="dcf dcf-scrolly" aria-label={title || 'Scrolling data story'}>
      {title ? <p className="dcf-scrolly__title">{title}</p> : null}
      <div className="dcf-scrolly__body">
        <div className="dcf-scrolly__sticky" ref={figureRef}>
          <div className="dcf-scrolly__figure" data-kind={activeView?.kind ?? 'loading'}>
            <div className="dcf-scrolly__stage">
              <ConfigScope config={config}>
                {mapData && mapData.view.kind === 'map' && mapStep ? (
                  <div className="dcf-scrolly__layer" data-shown={activeView?.kind === 'map'}>
                    <MapFigure
                      view={mapData.view}
                      rows={mapData.rows}
                      result={mapData.result}
                      camera={resolveStepCamera(mapData.view.camera, mapStep.camera)}
                      visibleLayers={mapStep.show}
                      highlight={mapStep.highlight}
                      interaction="hover"
                      underlays={mapUnderlays.views}
                      fade
                    />
                  </div>
                ) : null}
                {chartData && chartData.view.kind === 'chart' && chartStep ? (
                  <div className="dcf-scrolly__layer" data-shown={activeView?.kind === 'chart'}>
                    <ChartFigure view={chartData.view} rows={chartData.rows} {...(chartStep.highlight.length > 0 ? { highlight: chartStep.highlight } : {})} />
                  </div>
                ) : null}
              </ConfigScope>
              {!activeState || activeState.status === 'loading' ? (
                <div className="dcf-skeleton dcf-scrolly__veil" role="status"><span className="dcf-lamp" aria-hidden="true" />Loading data view</div>
              ) : null}
              {activeState?.status === 'error' ? (
                <div className="dcf-unavailable dcf-scrolly__veil" role="alert"><strong>Figure unavailable.</strong> {activeState.error.message}</div>
              ) : null}
            </div>
          </div>
        </div>
        <ol className="dcf-scrolly__steps" ref={stepsRef}>
          {parsed.map((item, index) => (
            <li
              key={`${index}:${item.viewUrl}`}
              ref={(element) => { stepRefs.current[index] = element }}
              data-step={index}
              data-active={index === active}
              className="dcf-step"
              tabIndex={0}
              aria-current={index === active ? 'step' : undefined}
              onFocus={() => setActive(index)}
            >
              <span className="dcf-step__number" aria-hidden="true">{pad(index + 1)}</span>
              <div className="dcf-step__text">
                {stepParagraphs(item.text).map((paragraph, p) => <p key={p}>{paragraph}</p>)}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

export default Scrolly
