import type { DataViewResultRow } from '@developing-country/views'
import { formatBoundValue, parseIdList, type ExplorerMetric, type StatFormat } from '@developing-country/emdash-blocks/figure-blocks'
import { numeric } from './mapStyle'

export const EXPLORER_PAGE_SIZE = 48

function fold(value: string): string {
  return value.normalize('NFKD').replaceAll(/[̀-ͯ]/g, '').toLowerCase()
}

/** Rows whose search fields contain every whitespace-separated term (accent- and case-insensitive). */
export function searchRows(rows: DataViewResultRow[], query: string, fields: string[]): DataViewResultRow[] {
  const terms = fold(query).split(/\s+/).filter(Boolean)
  if (terms.length === 0) return rows
  return rows.filter((row) => {
    const haystack = fold(fields.map((field) => String(row[field] ?? '')).join(' '))
    return terms.every((term) => haystack.includes(term))
  })
}

/** Stable sort: numbers numerically, text by locale; missing values always last. */
export function sortRows(rows: DataViewResultRow[], field: string | undefined, direction: 'asc' | 'desc'): DataViewResultRow[] {
  if (!field) return rows
  const sign = direction === 'asc' ? 1 : -1
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const av = a.row[field]
      const bv = b.row[field]
      const an = numeric(av)
      const bn = numeric(bv)
      const aMissing = av === null || av === undefined || av === ''
      const bMissing = bv === null || bv === undefined || bv === ''
      if (aMissing || bMissing) return aMissing === bMissing ? a.index - b.index : aMissing ? 1 : -1
      const order = an !== null && bn !== null ? an - bn : String(av).localeCompare(String(bv), 'en', { numeric: true })
      return order === 0 ? a.index - b.index : order * sign
    })
    .map(({ row }) => row)
}

/** Largest absolute value per metric, over all rows (bars stay comparable across searches). */
export function metricMaxima(rows: DataViewResultRow[], metrics: ExplorerMetric[]): Record<string, number> {
  const maxima: Record<string, number> = {}
  for (const metric of metrics) {
    let max = 0
    for (const row of rows) {
      const value = numeric(row[metric.field])
      if (value !== null) max = Math.max(max, Math.abs(value))
    }
    maxima[metric.field] = max
  }
  return maxima
}

export interface MetricCell {
  label: string
  text: string
  /** 0–1 share of the column maximum; null when the row has no value. */
  fraction: number | null
  /** Ten-cell unit glyph count for percentage metrics. */
  glyphs: number | null
}

export function metricCell(row: DataViewResultRow, metric: ExplorerMetric, max: number): MetricCell {
  const value = numeric(row[metric.field])
  const format = (metric.format ?? 'number') as StatFormat
  if (value === null) return { label: metric.label, text: '—', fraction: null, glyphs: null }
  return {
    label: metric.label,
    text: formatBoundValue(value, format, metric.unit),
    fraction: max > 0 ? Math.min(1, Math.abs(value) / max) : 0,
    glyphs: format === 'percent' ? Math.max(0, Math.min(10, Math.round(value / 10))) : null,
  }
}

export function searchFieldsOf(searchFields: string | undefined, titleField: string, subtitleField?: string): string[] {
  const fields = parseIdList(searchFields)
  if (fields.length > 0) return fields
  return subtitleField ? [titleField, subtitleField] : [titleField]
}

export function pageCount(total: number, size = EXPLORER_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / size))
}

export function pageOf<T>(items: T[], page: number, size = EXPLORER_PAGE_SIZE): T[] {
  const safe = Math.max(0, Math.min(page, pageCount(items.length, size) - 1))
  return items.slice(safe * size, safe * size + size)
}
