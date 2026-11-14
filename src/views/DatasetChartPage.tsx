import { sourceForDataset } from '../../packages/ingestion/src/registry'
import type { DatasetVersionRef } from '@developing-country/domain'
import { SiteHeader } from '@developing-country/ui/SiteHeader'
import { Suspense, useEffect, useMemo, useState } from 'react'
import {
  indicatorDataset,
  indicatorDatasetPath,
  indicatorPreset,
  parseIndicatorTable,
  selectRows,
  type IndicatorRow,
} from '@developing-country/datasets'
import type { ChartViewSpec } from '@developing-country/views'
import { withBase } from '../base'
import { datasetVersionEvidence, resultChecksum } from './datasetChartEvidence'
import './DatasetChartPage.css'

import { LiveChart } from './lazyViews'

// This page always ends in a chart: fetch its chunk alongside the data.
void LiveChart.preload()

interface DatasetChartPageProps {
  datasetId: string
  presetId: string
}

interface LoadedChart {
  version: DatasetVersionRef
  reportDate?: string
  vintage: string
  rows: IndicatorRow[]
  total: number
  truncated: boolean
  resultChecksum: string
  generatedAt: string
}

function siteOrigin(): string {
  return window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://127.0.0.1:4321'
    : 'https://developing-country.org'
}

export default function DatasetChartPage({ datasetId, presetId }: DatasetChartPageProps) {
  const dataset = indicatorDataset(datasetId)
  const preset = indicatorPreset(datasetId, presetId)
  const embedded = new URLSearchParams(window.location.search).get('embed') === 'dataset'
  const [loaded, setLoaded] = useState<LoadedChart | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!dataset || !preset) return
    const controller = new AbortController()
    void (async () => {
      try {
        setError(null)
        const scheduled = sourceForDataset(dataset.id)
        let runtime: { table: unknown; version: DatasetVersionRef; reportDate: string } | null = null
        if (scheduled) {
          const current = await fetch(withBase(`/api/datasets/${dataset.id}`), { signal: controller.signal })
          if (current.ok) runtime = await current.json()
          else if (current.status !== 404) throw new Error(`Dataset unavailable (${current.status})`)
        }
        const response = runtime ? null : await fetch(withBase(indicatorDatasetPath(dataset.id)), { signal: controller.signal })
        if (response && !response.ok) throw new Error(`Dataset unavailable (${response.status})`)
        const table = parseIndicatorTable(runtime ? runtime.table : await response!.json())
        if (table.dataset_id !== dataset.id) throw new Error('Dataset identity did not match its registered route.')
        if ([...table.source_ids].sort().join('\0') !== [...dataset.sourceIds].sort().join('\0')) {
          throw new Error('Dataset provenance did not match its registered sources.')
        }
        const selected = selectRows(table, preset.query)
        const generatedAt = new Date().toISOString()
        setLoaded({
          version: runtime?.version ?? datasetVersionEvidence(dataset.id, dataset.sourceIds),
          reportDate: runtime?.reportDate,
          vintage: runtime?.reportDate ?? table.vintage,
          rows: selected.rows,
          total: selected.total,
          truncated: selected.truncated,
          resultChecksum: await resultChecksum(selected.rows),
          generatedAt,
        })
      } catch (reason) {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : 'This dataset could not be loaded.')
        }
      }
    })()
    return () => controller.abort()
  }, [dataset, preset])

  const view = useMemo<ChartViewSpec | null>(() => {
    if (!dataset || !preset || !loaded) return null
    const queryId = `preset:${dataset.id}:${preset.id}`
    const datasetVersion = loaded.version
    return {
      version: 1,
      id: 'view_dataset_preview',
      kind: 'chart',
      country: 'LK',
      title: preset.title,
      description: preset.description,
      data: {
        queryId,
        resultChecksum: loaded.resultChecksum,
        rowCount: loaded.rows.length,
      },
      evidence: {
        queryId,
        generatedAt: loaded.generatedAt,
        sourceIds: [...dataset.sourceIds],
        datasetVersions: [datasetVersion],
      },
      theme: 'developing-country/v1',
      createdAt: loaded.generatedAt,
      intent: {
        family: preset.chart.family,
        dimension: preset.chart.dimension,
        measure: preset.chart.measure,
        series: preset.chart.series,
      },
      presentation: {
        orientation: preset.chart.orientation,
        stacked: preset.chart.stacked,
        showLegend: preset.chart.showLegend,
      },
    }
  }, [dataset, loaded, preset])

  if (!dataset || !preset) {
    return <main className="dataset-chart-state"><strong>Dataset view not found.</strong><a href={withBase('/')}>Open the Explorer</a></main>
  }

  const publicSite = siteOrigin()
  const fullPath = withBase(`/datasets/${encodeURIComponent(dataset.id)}/${encodeURIComponent(preset.id)}`)
  const chart = error ? (
    <div className="dataset-chart-state"><strong>We could not load this view.</strong><span>{error}</span></div>
  ) : view && loaded ? (
    <Suspense fallback={<div className="dataset-chart-loading">Preparing the chart…</div>}>
      <LiveChart view={view} rows={loaded.rows} />
    </Suspense>
  ) : (
    <div className="dataset-chart-loading">Reading the published table…</div>
  )

  if (embedded) {
    return (
      <main className="dataset-chart-embed">
        <aside className="dataset-chart-embed__selection" aria-label={`Selected data: ${dataset.label}`}>
          <span aria-hidden="true" />
          <div><small>Selected data</small><strong>{dataset.label}</strong></div>
        </aside>
        <section className="dataset-chart-embed__stage">{chart}</section>
        <footer className="dataset-chart-embed__footer">
          <span>{loaded?.vintage || dataset.vintage}</span>
          <a href={fullPath} target="_blank" rel="noreferrer">Explore all <span aria-hidden="true">↗</span></a>
        </footer>
      </main>
    )
  }

  return (
    <main className="dataset-chart-page">
      <SiteHeader siteUrl={publicSite} explorerUrl={withBase('/')} />
      <article className="dataset-chart-report">
        <header className="dataset-chart-report__head">
          <div className="dataset-chart-report__index">LK / DATA</div>
          <div>
            <p className="dataset-chart-report__kicker">{dataset.label}</p>
            <h1>{preset.title}</h1>
            <p className="dataset-chart-report__deck">{preset.description}</p>
          </div>
          <dl>
            <div><dt>Vintage</dt><dd>{loaded?.vintage || dataset.vintage}</dd></div>
            <div><dt>Rows shown</dt><dd>{loaded ? `${loaded.rows.length} of ${loaded.total}` : '—'}</dd></div>
            <div><dt>Source records</dt><dd>{dataset.sourceIds.length}</dd></div>
          </dl>
        </header>
        <section className="dataset-chart-report__stage" aria-label={preset.title}>{chart}</section>
        <footer className="dataset-chart-report__foot">
          <p>{dataset.description}</p>
          {loaded?.truncated ? <strong>Bounded preview. Use MCP query_data to narrow or request another slice.</strong> : null}
          <a href={`${publicSite}/data/${dataset.id}`}>Read the dataset note <span aria-hidden="true">→</span></a>
        </footer>
      </article>
    </main>
  )
}
