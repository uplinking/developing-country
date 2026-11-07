import { assembleECharts, type ChartAssemblyInput } from 'flint-chart'
import type { ChartFamily, ChartViewSpec } from './index'

export type DataViewRow = Record<string, unknown>
export type EChartsOption = Record<string, unknown>
export interface ChartTheme {
  ink: string
  mutedInk: string
  line: string
  palette: string[]
}

// First four values mirror packages/ui/tokens.css; the final two extend that
// route system for series-heavy charts without introducing a second identity.
const PRODUCT_PALETTE = ['#d14321', '#00a191', '#e8930c', '#2456c4', '#8b5e3c', '#6f4e7c']

function chartType(family: ChartFamily, stacked: boolean): string {
  if (family === 'trend') return 'Line Chart'
  if (family === 'distribution') return 'Histogram'
  if (family === 'relationship') return 'Scatter Plot'
  if (family === 'composition') return 'Pie Chart'
  if (stacked) return 'Stacked Bar Chart'
  return 'Bar Chart'
}

const BAR_FAMILIES = new Set<ChartFamily>(['comparison', 'ranking'])

/**
 * Bars run horizontally when the spec says so, or, left unset, when there are
 * too many categories or labels too long for upright columns. Shared with
 * ChartFigure so the canvas height and the compiled layout always agree.
 */
export function chartOrientation(view: ChartViewSpec, rows: DataViewRow[]): 'horizontal' | 'vertical' {
  const explicit = view.presentation?.orientation
  if (explicit) return explicit
  if (!BAR_FAMILIES.has(view.intent.family) || view.presentation?.stacked) return 'vertical'
  const labels = new Set(rows.map((row) => String(row[view.intent.dimension.field] ?? '')))
  const longest = Math.max(0, ...[...labels].map((label) => label.length))
  return labels.size > 8 || (labels.size > 3 && longest > 14) ? 'horizontal' : 'vertical'
}

function semanticType(field: { unit?: string }, family: ChartFamily, dimension: boolean): string {
  if (dimension) return family === 'trend' ? 'Date' : 'Category'
  if (field.unit === '%' || field.unit?.toLowerCase().includes('percent')) return 'Percentage'
  return 'Quantity'
}

/** Compile the durable product contract into an ECharts option via Flint's semantic layer. */
export function compileChartView(
  view: ChartViewSpec,
  rows: DataViewRow[],
  theme: ChartTheme = {
    ink: '#16181d',
    mutedInk: '#5f5d56',
    line: 'rgba(22, 24, 29, 0.28)',
    palette: PRODUCT_PALETTE,
  },
  viewport = { width: 760, height: 420 },
): EChartsOption {
  const { dimension, measure, series } = view.intent
  const horizontal = chartOrientation(view, rows) === 'horizontal'
  const composition = view.intent.family === 'composition'
  // A histogram bins the measure itself; the dimension only names the rows.
  const distribution = view.intent.family === 'distribution'
  const encodings: Record<string, { field: string }> = composition
    ? { angle: { field: measure.field }, color: { field: dimension.field } }
    : distribution
      ? { x: { field: measure.field } }
      : horizontal
      ? { y: { field: dimension.field }, x: { field: measure.field } }
      : { x: { field: dimension.field }, y: { field: measure.field } }
  if (series && !composition && !distribution) encodings.color = { field: series.field }

  const semanticTypes: Record<string, string> = {
    [dimension.field]: semanticType(dimension, view.intent.family, true),
    [measure.field]: semanticType(measure, view.intent.family, false),
  }
  if (series) semanticTypes[series.field] = 'Category'

  const input: ChartAssemblyInput = {
    data: { values: rows },
    semantic_types: semanticTypes,
    chart_spec: {
      chartType: chartType(view.intent.family, view.presentation?.stacked === true),
      title: view.title,
      subtitle: view.description,
      encodings,
      baseSize: { width: 760, height: 420 },
      canvasSize: { width: 1200, height: 680 },
    },
    options: { addTooltips: true },
  }
  const raw = assembleECharts(input) as EChartsOption
  const option: EChartsOption = { ...raw }
  for (const key of Object.keys(option)) if (key.startsWith('_')) delete option[key]
  if (composition) applyCompositionData(option, rows, dimension.field, measure.field)
  option.backgroundColor = 'transparent'
  option.color = theme.palette
  option.textStyle = { fontFamily: 'Overpass, ui-sans-serif, system-ui, sans-serif', color: theme.ink }
  applySemanticLabels(option, view, horizontal)
  applySeriesPalette(option, theme.palette)
  applyTheme(option, theme)
  if (horizontal) applyCategoryLayout(option, view, viewport.width)
  else applyColumnLayout(option, view, viewport.width)
  applyBarMarks(option, view, horizontal, theme, viewport.width)
  if (view.presentation?.showLegend === false) option.legend = { show: false }
  return option
}

function applyCategoryLayout(option: EChartsOption, view: ChartViewSpec, width: number): void {
  const axis = records(option.yAxis).find((axis) => axis.type === 'category')
  if (!axis) return
  // Keep at least half of even a narrow embed for the marks. ECharts 6's
  // automatic outer bounds otherwise reserve the width of the longest label.
  const labelWidth = Math.min(300, Math.floor(width * 0.32))
  for (const grid of records(option.grid)) {
    Object.assign(grid, { left: labelWidth + 20, right: 28, top: 40, bottom: 56,
      containLabel: false, outerBoundsMode: 'none' })
  }
  Object.assign(axis, {
    nameLocation: 'start', nameRotate: 0, nameGap: 16, inverse: true,
    nameTextStyle: { ...records(axis.nameTextStyle)[0], align: 'right', width: labelWidth, overflow: 'truncate' },
    axisLabel: { ...records(axis.axisLabel)[0], width: labelWidth, overflow: 'break',
      lineOverflow: 'truncate', height: 28, lineHeight: 14, ellipsis: '…', margin: 12 },
  })
  for (const valueAxis of records(option.xAxis)) {
    valueAxis.splitNumber = width < 500 ? 3 : 5
    valueAxis.axisLabel = { ...records(valueAxis.axisLabel)[0], hideOverlap: true,
      formatter: (value: number) => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value) }
  }
  if (!view.intent.series) {
    for (const series of records(option.series)) series.name = encodingLabel(view.intent.measure)
  }
  // Full source labels stay in axis/series data and in the tooltip. Wrapping
  // prevents long classifications from overflowing narrow embedded charts.
  option.tooltip = { ...records(option.tooltip)[0], confine: true,
    extraCssText: `max-width:${Math.max(120, Math.min(420, width - 48))}px;white-space:normal;overflow-wrap:anywhere`,
    formatter: (params: unknown) => {
      const items = records(params)
      const heading = items[0]?.axisValueLabel ?? items[0]?.name ?? ''
      return `<strong>${escapeTooltip(heading)}</strong>` + items.map(item => {
        const value = typeof item.value === 'number' ? item.value.toLocaleString('en') : item.value ?? '—'
        const label = view.intent.series ? item.seriesName : encodingLabel(view.intent.measure)
        return `<br>${escapeTooltip(label)}: <strong>${escapeTooltip(value)}</strong>`
      }).join('')
    } }
}

const compactNumber = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })

/**
 * Upright columns: labels stay level and wrap to two lines inside their slot,
 * the value-axis title sits above the plot instead of being squeezed down its
 * side, and a bar chart drops the category-axis title its labels already say.
 */
function applyColumnLayout(option: EChartsOption, view: ChartViewSpec, width: number): void {
  const family = view.intent.family
  if (family === 'composition') return
  const categoryAxis = records(option.xAxis)[0]
  if (!categoryAxis) return
  const count = Array.isArray(categoryAxis.data) ? categoryAxis.data.length : 0
  const left = 56
  const slot = count ? Math.max(44, Math.floor((width - left - 24) / count) - 8) : 96
  const keepName = family === 'distribution' || family === 'trend' || family === 'relationship'
  if (!keepName) delete categoryAxis.name
  // Up to 24 categories each get a wrapped label in their own slot; ECharts'
  // overlap check measures the unwrapped text and would hide some of them.
  // Histogram bins ("20.0–28.9") must not break mid-number: they stay whole
  // and ECharts thins them instead.
  const everyLabel = categoryAxis.type === 'category' && family !== 'distribution' && count > 0 && count <= 24
  categoryAxis.axisLabel = family === 'distribution'
    ? { ...records(categoryAxis.axisLabel)[0], rotate: 0, hideOverlap: true, margin: 10 }
    : { ...records(categoryAxis.axisLabel)[0], rotate: 0,
      hideOverlap: !everyLabel, ...(everyLabel ? { interval: 0 } : {}),
      width: slot, overflow: categoryAxis.type === 'category' ? 'break' : 'truncate',
      lineOverflow: 'truncate', height: 30, lineHeight: 14, ellipsis: '…', margin: 10 }
  if (keepName) Object.assign(categoryAxis, { nameLocation: 'middle', nameGap: 44 })
  for (const grid of records(option.grid)) {
    Object.assign(grid, { left, top: option.title ? 64 : 44, bottom: keepName ? 70 : 48, containLabel: false, outerBoundsMode: 'none' })
    if (typeof grid.right !== 'number' || grid.right < 20) grid.right = 20
  }
  for (const valueAxis of records(option.yAxis)) {
    if (valueAxis.type !== 'value') continue
    const right = typeof records(option.grid)[0]?.right === 'number' ? records(option.grid)[0]?.right as number : 20
    Object.assign(valueAxis, { nameLocation: 'end', nameRotate: 0, nameGap: 14,
      nameTextStyle: { ...records(valueAxis.nameTextStyle)[0], align: 'left', padding: [0, 0, 0, -left + 8],
        width: Math.max(80, width - right - 16), overflow: 'truncate', ellipsis: '…' } })
    valueAxis.axisLabel = { ...records(valueAxis.axisLabel)[0], hideOverlap: true,
      formatter: (value: number) => compactNumber.format(value) }
  }
}

/** Cap bar thickness, and print values on the bars when there are few to read. */
function applyBarMarks(option: EChartsOption, view: ChartViewSpec, horizontal: boolean, theme: ChartTheme, width: number): void {
  const bars = records(option.series).filter((series) => series.type === 'bar')
  for (const bar of bars) bar.barMaxWidth = horizontal ? 22 : 56
  if (bars.length !== 1 || view.intent.family === 'distribution') return
  const bar = bars[0]!
  const count = Array.isArray(bar.data) ? bar.data.length : 0
  // A narrow horizontal chart spends its width on labels; the value axis reads instead.
  if (!count || count > 12 || (horizontal && width < 480)) return
  const percent = view.intent.measure.unit === '%'
  bar.label = {
    show: true,
    position: horizontal ? 'right' : 'top',
    distance: 6,
    color: theme.ink,
    fontFamily: "'M PLUS 1 Code', ui-monospace, monospace",
    fontSize: 11,
    formatter: (params: { value?: unknown }) => {
      const raw = Array.isArray(params.value) ? params.value.find((entry) => typeof entry === 'number') : params.value
      if (typeof raw !== 'number' || !Number.isFinite(raw)) return ''
      const text = Math.abs(raw) >= 10000 ? compactNumber.format(raw) : raw.toLocaleString('en', { maximumFractionDigits: 1 })
      return percent ? `${text}%` : text
    },
  }
  if (horizontal) {
    for (const grid of records(option.grid)) {
      if (typeof grid.right === 'number' && grid.right < 64) grid.right = 64
    }
  }
}

function escapeTooltip(value: unknown): string {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

function applyCompositionData(
  option: EChartsOption,
  rows: DataViewRow[],
  dimensionField: string,
  measureField: string,
): void {
  const pie = records(option.series).find((series) => series.type === 'pie')
  if (!pie) return
  pie.data = rows.flatMap((row) => {
    const name = row[dimensionField]
    const value = row[measureField]
    if ((typeof name !== 'string' && typeof name !== 'number') || typeof value !== 'number' || !Number.isFinite(value)) {
      return []
    }
    return [{ name: String(name), value }]
  })
}

function humanLabel(value: string): string {
  const spaced = value.replaceAll(/[_-]+/g, ' ').trim()
  return spaced ? `${spaced[0]?.toUpperCase() ?? ''}${spaced.slice(1)}` : value
}

function encodingLabel(encoding: { field: string; label?: string; unit?: string }): string {
  const label = encoding.label?.trim() || humanLabel(encoding.field)
  return encoding.unit ? `${label} (${encoding.unit})` : label
}

function applySemanticLabels(option: EChartsOption, view: ChartViewSpec, horizontal: boolean): void {
  const composition = view.intent.family === 'composition'
  if (view.intent.family === 'distribution') {
    for (const axis of records(option.xAxis)) axis.name = encodingLabel(view.intent.measure)
    for (const axis of records(option.yAxis)) axis.name = `${humanLabel(view.intent.dimension.label ?? view.intent.dimension.field)} count`
  } else if (!composition) {
    const x = horizontal ? view.intent.measure : view.intent.dimension
    const y = horizontal ? view.intent.dimension : view.intent.measure
    for (const axis of records(option.xAxis)) axis.name = encodingLabel(x)
    for (const axis of records(option.yAxis)) axis.name = encodingLabel(y)
  }

  const nameMap = new Map<string, string>()
  for (const series of records(option.series)) {
    if (typeof series.name !== 'string') continue
    const display = humanLabel(series.name)
    nameMap.set(series.name, display)
    series.name = display
  }
  for (const legend of records(option.legend)) {
    if (!Array.isArray(legend.data)) continue
    legend.data = legend.data.map((entry) => {
      if (typeof entry === 'string') return nameMap.get(entry) ?? humanLabel(entry)
      if (entry && typeof entry === 'object' && typeof (entry as Record<string, unknown>).name === 'string') {
        const item = entry as Record<string, unknown>
        return { ...item, name: nameMap.get(item.name as string) ?? humanLabel(item.name as string) }
      }
      return entry
    })
  }
  if (view.intent.series) {
    for (const graphic of records(option.graphic)) {
      const style = records(graphic.style)[0]
      if (style?.text === view.intent.series.field) style.text = encodingLabel(view.intent.series)
    }
  }
}

function applySeriesPalette(option: EChartsOption, palette: string[]): void {
  records(option.series).forEach((series, index) => {
    if (series.type === 'pie') return
    const color = palette[index % palette.length]
    series.itemStyle = { ...(records(series.itemStyle)[0] ?? {}), color }
    if (series.type === 'line') {
      series.lineStyle = { ...(records(series.lineStyle)[0] ?? {}), color }
    }
  })
}

function records(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
  return value && typeof value === 'object' ? [value as Record<string, unknown>] : []
}

function applyTheme(option: EChartsOption, theme: ChartTheme): void {
  for (const title of records(option.title)) {
    title.textStyle = { ...(records(title.textStyle)[0] ?? {}), color: theme.ink }
    title.subtextStyle = { ...(records(title.subtextStyle)[0] ?? {}), color: theme.mutedInk }
  }
  for (const legend of records(option.legend)) {
    legend.textStyle = { ...(records(legend.textStyle)[0] ?? {}), color: theme.ink }
  }
  for (const key of ['xAxis', 'yAxis', 'singleAxis']) {
    for (const axis of records(option[key])) {
      axis.nameTextStyle = { ...(records(axis.nameTextStyle)[0] ?? {}), color: theme.mutedInk }
      axis.axisLabel = { ...(records(axis.axisLabel)[0] ?? {}), color: theme.mutedInk }
      axis.axisLine = {
        ...(records(axis.axisLine)[0] ?? {}),
        lineStyle: { ...(records(records(axis.axisLine)[0]?.lineStyle)[0] ?? {}), color: theme.line },
      }
      axis.splitLine = {
        ...(records(axis.splitLine)[0] ?? {}),
        lineStyle: { ...(records(records(axis.splitLine)[0]?.lineStyle)[0] ?? {}), color: theme.line },
      }
    }
  }
}
