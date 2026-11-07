import type { ChartViewSpec } from '@developing-country/views'
import type { DataViewRow } from '@developing-country/views/flint'
import { ChartFigure } from '@developing-country/figures'
import '@developing-country/figures/styles.css'

interface LiveChartProps {
  view: ChartViewSpec
  rows: DataViewRow[]
  className?: string
}

/** Explorer, MCP App and dataset pages share the article renderer (packages/figures). */
export default function LiveChart({ view, rows, className = '' }: LiveChartProps) {
  return <ChartFigure view={view} rows={rows} showTitle className={`live-chart ${className}`.trim()} />
}
