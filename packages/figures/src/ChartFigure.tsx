import { useEffect, useRef, useState } from 'react'
import type { ChartViewSpec, DataViewResultRow } from '@developing-country/views'
import { chartOrientation, compileChartView, type EChartsOption } from '@developing-country/views/flint'
import { applyChartHighlight, chartThemeFrom } from './chartTheme'
import { useFigureTokens, useNearViewport, useReducedMotion } from './hooks'

export interface ChartFigureProps {
  view: ChartViewSpec
  rows: DataViewResultRow[]
  /** Overrides `view.presentation.highlight` (scrolly steps). */
  highlight?: string[]
  /** Keep the compiled chart title (standalone pages); figures show it in the frame. */
  showTitle?: boolean
  className?: string
}

function withoutTitle(option: EChartsOption): EChartsOption {
  const next = { ...option }
  delete next.title
  for (const grid of Array.isArray(next.grid) ? next.grid : next.grid ? [next.grid] : []) {
    if (grid && typeof grid === 'object' && typeof (grid as Record<string, unknown>).top === 'number') {
      ;(grid as Record<string, unknown>).top = Math.min(40, (grid as Record<string, number>).top ?? 40)
    }
  }
  return next
}

/** A Data View chart: Flint semantics, ECharts drawing, live tokens, accent highlight. */
export function ChartFigure({ view, rows, highlight, showTitle = false, className = '' }: ChartFigureProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const tokens = useFigureTokens(rootRef)
  const reducedMotion = useReducedMotion()
  const [failed, setFailed] = useState(false)
  const emphasis = highlight ?? view.presentation?.highlight ?? []
  const emphasisKey = emphasis.join('\n')

  const near = useNearViewport(rootRef)
  useEffect(() => {
    const root = rootRef.current
    if (!root || !near) return
    let disposed = false
    let cleanup = () => {}
    void import('./echartsSetup')
      .then(({ init }) => {
        if (disposed) return
        const chart = init(root, undefined, { renderer: 'canvas' })
        const render = () => {
          let option = compileChartView(view, rows, chartThemeFrom(tokens), { width: root.clientWidth, height: root.clientHeight })
          option = applyChartHighlight(option, emphasisKey ? emphasisKey.split('\n') : [], tokens)
          if (!showTitle) option = withoutTitle(option)
          option.animation = !reducedMotion
          option.animationDuration = 320
          option.animationEasing = 'linear'
          chart.setOption(option, { notMerge: true })
        }
        render()
        const resize = new ResizeObserver(() => {
          chart.resize()
          render()
        })
        resize.observe(root)
        cleanup = () => {
          resize.disconnect()
          chart.dispose()
        }
      })
      .catch(() => {
        if (!disposed) setFailed(true)
      })
    return () => {
      disposed = true
      cleanup()
    }
  }, [view, rows, tokens, emphasisKey, showTitle, reducedMotion, near])

  const bars = view.intent.family === 'ranking' || view.intent.family === 'comparison'
  const orientation = bars ? chartOrientation(view, rows) : 'vertical'
  const categories = new Set(rows.map((row) => row[view.intent.dimension.field])).size
  // Horizontal bars get a row each; a host that boxes the chart scrolls it.
  const minHeight = orientation === 'horizontal' ? categories * 32 + 88 : undefined
  return (
    <div
      className={`dcf dcf-chart ${className}`.trim()}
      data-orientation={bars ? orientation : undefined}
      data-shape={bars && orientation === 'vertical' && categories <= 4 ? 'few' : undefined}
    >
      <div
        ref={rootRef}
        className="dcf-chart__canvas"
        style={minHeight ? { minHeight } : undefined}
        role="img"
        aria-label={`Chart: ${view.title}`}
      />
      {failed ? <div className="dcf-map__veil dcf-map__veil--error" role="alert">The chart could not be drawn.</div> : null}
    </div>
  )
}

export default ChartFigure
