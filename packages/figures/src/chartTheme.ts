import type { ChartTheme, EChartsOption } from '@developing-country/views/flint'
import { mixColor, type FigureTokens } from './tokens'

/** Flint theme from the live tokens; series colours follow the route order. */
export function chartThemeFrom(tokens: FigureTokens): ChartTheme {
  return {
    ink: tokens.ink,
    mutedInk: tokens.inkDim,
    line: tokens.lineSoft,
    palette: [
      tokens.routeFlag,
      tokens.routeSystem,
      tokens.routeSun,
      tokens.routeInfo,
      mixColor(tokens.routeFlag, tokens.ink, 0.45),
      mixColor(tokens.routeInfo, tokens.ink, 0.45),
    ],
  }
}

function records(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry))
  return value && typeof value === 'object' ? [value as Record<string, unknown>] : []
}

function normal(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replaceAll(/[_-]+/g, ' ')
}

/**
 * Emphasise `highlight` (dimension or series values) in the accent colour and
 * recede everything else. Works on the option Flint compiles: category-axis
 * bars, named line/bar series, and pie slices. Returns a new option.
 */
export function applyChartHighlight(option: EChartsOption, highlight: readonly string[], tokens: FigureTokens): EChartsOption {
  if (highlight.length === 0) return option
  const wanted = new Set(highlight.map(normal))
  const accent = tokens.routeFlag
  const muted = mixColor(tokens.inkDim, tokens.paper, 0.55)
  const next: EChartsOption = { ...option }
  const categoryAxis = [...records(option.xAxis), ...records(option.yAxis)].find((axis) => axis.type === 'category' && Array.isArray(axis.data))
  const categories = (categoryAxis?.data as unknown[] | undefined) ?? []
  const series = records(option.series).map((entry) => ({ ...entry }))
  const seriesMatch = series.some((entry) => wanted.has(normal(entry.name)))

  for (const entry of series) {
    if (entry.type === 'pie' && Array.isArray(entry.data)) {
      entry.data = entry.data.map((item) => {
        const datum = records(item)[0]
        if (!datum) return item
        return { ...datum, itemStyle: { ...records(datum.itemStyle)[0], color: wanted.has(normal(datum.name)) ? accent : muted } }
      })
      continue
    }
    if (seriesMatch) {
      // Series-level emphasis (e.g. one district's line among many).
      const on = wanted.has(normal(entry.name))
      entry.itemStyle = { ...records(entry.itemStyle)[0], color: on ? accent : muted }
      if (entry.type === 'line') entry.lineStyle = { ...records(entry.lineStyle)[0], color: on ? accent : muted, width: on ? 3 : 1.5 }
      entry.z = on ? 3 : 2
      continue
    }
    if (entry.type === 'bar' && Array.isArray(entry.data)) {
      entry.data = entry.data.map((item, index) => {
        const tuple = Array.isArray(item) ? item : null
        const category = tuple ? tuple[0] : categories[index]
        const color = wanted.has(normal(category)) ? accent : muted
        const datum = records(item)[0]
        if (datum) return { ...datum, itemStyle: { ...records(datum.itemStyle)[0], color } }
        return { value: item, itemStyle: { color } }
      })
    }
  }
  next.series = series
  return next
}
