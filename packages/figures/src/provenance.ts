import type { DataViewSpec } from '@developing-country/views'

export interface Provenance {
  sources: string[]
  vintages: string[]
  rows: number
  generated: string
  partial: boolean
}

function sourceName(id: string): string {
  return id.replace(/^source:/, '').replaceAll(/[-_]+/g, ' ')
}

/** Source and vintage line for a figure caption, straight from `view.evidence`. */
export function provenanceOf(view: DataViewSpec): Provenance {
  const vintages = [...new Set(view.evidence.datasetVersions.map((version) => version.vintage))]
  const generated = new Date(view.evidence.generatedAt)
  return {
    sources: [...new Set(view.evidence.sourceIds.map(sourceName))],
    vintages,
    rows: view.data.rowCount,
    generated: Number.isNaN(generated.getTime())
      ? view.evidence.generatedAt
      : generated.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }),
    partial: view.evidence.datasetVersions.some((version) => version.completeness.status !== 'complete'),
  }
}

export function provenanceText(view: DataViewSpec): string {
  const p = provenanceOf(view)
  const parts = [
    `Source: ${p.sources.join(', ')}`,
    p.vintages.length > 0 ? `Vintage ${p.vintages.join(', ')}` : null,
    `${p.rows.toLocaleString('en')} rows`,
  ].filter(Boolean)
  return parts.join(' · ')
}
