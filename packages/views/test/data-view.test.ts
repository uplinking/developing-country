import { describe, expect, test } from 'bun:test'
import {
  dataViewUrl,
  isDataViewUrl,
  validateDataViewPresentation,
  validateDataViewSpec,
  type ChartViewSpec,
} from '../src/index'
import { compileChartView } from '../src/flint'

const chart: ChartViewSpec = {
  version: 1,
  id: 'view_lk_population_trend',
  kind: 'chart',
  country: 'LK',
  title: 'Sri Lanka population trend',
  data: { queryId: 'query_population', resultChecksum: `sha256:${'a'.repeat(64)}`, rowCount: 12 },
  evidence: {
    datasetVersions: [
      {
        datasetId: 'lk-population',
        versionId: 'census-2024',
        country: 'LK',
        sourceIds: ['dcs'],
        vintage: '2024',
        refreshedAt: '2026-08-26T00:00:00.000Z',
        checksum: `sha256:${'b'.repeat(64)}`,
        completeness: {
          status: 'partial',
          coverage: 0.974,
          coverageNote: 'GND identifiers changed in three districts.',
          knownGaps: ['Unmatched GND identifiers'],
        },
      },
    ],
    sourceIds: ['dcs'],
    generatedAt: '2026-08-26T00:00:00.000Z',
  },
  theme: 'developing-country/v1',
  createdAt: '2026-08-26T00:00:00.000Z',
  intent: {
    family: 'trend',
    dimension: { field: 'year' },
    measure: { field: 'population', unit: 'people' },
  },
}

describe('validateDataViewSpec', () => {
  test('accepts a complete chart view', () => {
    expect(validateDataViewSpec(chart)).toEqual({ ok: true, value: chart })
  })

  test('rejects renderer configuration and incomplete references', () => {
    const invalid = {
      ...chart,
      data: { queryId: '', rowCount: -1, echartsOption: { series: [] } },
      intent: { ...chart.intent, family: 'raw-echarts' },
      echartsOption: { series: [] },
    }
    const result = validateDataViewSpec(invalid)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues).toContain('data.queryId is required')
      expect(result.issues).toContain('data.resultChecksum must be a lowercase sha256 checksum')
      expect(result.issues).toContain('data.rowCount must be a non-negative integer')
      expect(result.issues).toContain('data contains unknown fields: echartsOption')
      expect(result.issues).toContain('intent.family is not supported')
      expect(result.issues).toContain('view contains unknown fields: echartsOption')
    }
  })

  test('rejects empty provenance and map renderer payloads', () => {
    const invalid = {
      ...chart,
      kind: 'map',
      evidence: { ...chart.evidence, datasetVersions: [] },
      camera: { center: [200, 100], zoom: 30 },
      layers: [{ id: 'population', visible: true, paint: { color: 'red' } }],
      intent: undefined,
    }
    const result = validateDataViewSpec(invalid)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues).toContain('evidence.datasetVersions must be a non-empty array')
      expect(result.issues).toContain('camera.center must contain valid longitude and latitude')
      expect(result.issues).toContain('camera.zoom must be between 0 and 24')
      expect(result.issues).toContain('layers[0] contains unknown fields: paint')
    }
  })

  test('bounds persisted text, layers, and all camera numbers', () => {
    const invalid = {
      ...chart,
      kind: 'map',
      title: 'x'.repeat(161),
      description: 'x'.repeat(501),
      camera: { center: [Number.NaN, 7], zoom: Number.NaN },
      layers: Array.from({ length: 65 }, (_, index) => ({ id: `layer_${index}`, visible: true })),
      intent: undefined,
    }
    const result = validateDataViewSpec(invalid)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues).toContain('title must be at most 160 characters')
      expect(result.issues).toContain('description must be at most 500 characters')
      expect(result.issues).toContain('camera.center must contain valid longitude and latitude')
      expect(result.issues).toContain('camera.zoom must be between 0 and 24')
      expect(result.issues).toContain('layers must contain at most 64 entries')
    }
  })
})

describe('agent-authored presentation', () => {
  test('accepts semantic chart intent without renderer configuration', () => {
    expect(
      validateDataViewPresentation({
        kind: 'chart',
        title: 'Largest districts by population',
        family: 'ranking',
        dimension: { field: 'name', label: 'District' },
        measure: { field: 'pop', label: 'Population', unit: 'people' },
        orientation: 'horizontal',
      }).ok,
    ).toBe(true)
  })

  test('rejects raw renderer payloads', () => {
    const result = validateDataViewPresentation({
      kind: 'chart',
      title: 'Unsafe renderer config',
      family: 'ranking',
      dimension: { field: 'name' },
      measure: { field: 'pop' },
      option: { series: [] },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues).toContain('presentation contains unknown fields: option')
  })

  test('compiles a branded Flint/ECharts option deterministically', () => {
    const option = compileChartView(
      {
        ...chart,
        intent: {
          family: 'ranking',
          dimension: { field: 'name' },
          measure: { field: 'pop', unit: 'people' },
        },
        presentation: { orientation: 'horizontal', showLegend: false },
      },
      [{ name: 'Colombo', pop: 2370000 }, { name: 'Kandy', pop: 1460000 }],
    )
    expect(option.color).toEqual(['#d14321', '#00a191', '#e8930c', '#2456c4', '#8b5e3c', '#6f4e7c'])
    expect(JSON.stringify(option)).toContain('bar')
    expect(Object.keys(option).some((key) => key.startsWith('_'))).toBe(false)
  })

  test('uses semantic labels and the product palette instead of raw field names', () => {
    const option = compileChartView(
      {
        ...chart,
        intent: {
          family: 'trend',
          dimension: { field: 'period', label: 'Month' },
          measure: { field: 'value_usd_million', label: 'Trade value', unit: 'USD million' },
          series: { field: 'flow', label: 'Flow' },
        },
      },
      [
        { period: '2026-01', flow: 'exports', value_usd_million: 10 },
        { period: '2026-01', flow: 'imports', value_usd_million: 20 },
      ],
    )
    expect((option.xAxis as { name: string }).name).toBe('Month')
    expect((option.yAxis as { name: string }).name).toBe('Trade value (USD million)')
    expect((option.legend as { data: string[] }).data).toEqual(['Exports', 'Imports'])
    expect((option.graphic as Array<{ style: { text: string } }>)[0]?.style.text).toBe('Flow')
    expect((option.series as Array<{ name: string; itemStyle: { color: string } }>).map((series) => [series.name, series.itemStyle.color]))
      .toEqual([['Exports', '#d14321'], ['Imports', '#00a191']])
  })

  test('preserves composition measures and lets the palette color individual slices', () => {
    const option = compileChartView(
      {
        ...chart,
        intent: {
          family: 'composition',
          dimension: { field: 'class_label', label: 'Land-cover class' },
          measure: { field: 'share_pct', label: 'Share', unit: '%' },
        },
      },
      [
        { class_label: 'Tree cover', share_pct: 70.7 },
        { class_label: 'Built-up', share_pct: 23.4 },
      ],
    )
    const series = (option.series as Array<{
      type: string
      data: Array<{ name: string; value: number }>
      itemStyle?: { color?: string }
    }>)[0]
    expect(series?.data).toEqual([
      { name: 'Tree cover', value: 70.7 },
      { name: 'Built-up', value: 23.4 },
    ])
    expect(series?.itemStyle?.color).toBeUndefined()
  })
})

describe('canonical Data View URLs', () => {
  test('builds and accepts the exact cross-surface URL contract', () => {
    const url = dataViewUrl('https://explore.developing-country.org', 'view_0123abcd')
    expect(url).toBe('https://explore.developing-country.org/views/view_0123abcd')
    expect(isDataViewUrl(url)).toBe(true)
  })

  test('rejects legacy paths, alternate origins, queries, and invalid ids', () => {
    expect(isDataViewUrl('https://example.org/app/views/view_0123abcd')).toBe(false)
    expect(isDataViewUrl('https://developing-country.org/views/view_0123abcd')).toBe(false)
    expect(isDataViewUrl('https://explore.developing-country.org/views/view_0123abcd?theme=raw')).toBe(false)
    expect(isDataViewUrl('https://explore.developing-country.org/VIEWS/view_0123abcd')).toBe(false)
    expect(isDataViewUrl('https://explore.developing-country.org/views/VIEW_0123ABCD')).toBe(false)
    expect(() => dataViewUrl('https://explore.developing-country.org/base', 'view_0123abcd')).toThrow()
    expect(() => dataViewUrl('https://explore.developing-country.org', '../admin')).toThrow()
  })
})

describe('long category labels', () => {
  test('preserves source labels while reserving plot space at desktop and mobile widths', () => {
    const label = 'Other injuries of specified, unspecified and multiple body regions (S09,S19,S29,S39,S49,S59,S69,S79,S89,S99)'
    const rows = [{ disease: label, discharges: 123456 }, { disease: 'Asthma', discharges: 70000 }]
    const view: ChartViewSpec = { ...chart,
      intent: { family: 'ranking', dimension: { field: 'disease', label: 'Disease group' }, measure: { field: 'discharges', label: 'Live discharges' } },
      presentation: { orientation: 'horizontal' },
    }
    for (const width of [320, 760, 1800]) {
      const option = compileChartView(view, rows, undefined, { width, height: 600 })
      const grid = option.grid as { left: number; right: number; outerBoundsMode: string }
      const axis = option.yAxis as { data: string[]; inverse: boolean; axisLabel: { width: number; overflow: string } }
      expect(width - grid.left - grid.right).toBeGreaterThan(width / 2)
      expect(grid.outerBoundsMode).toBe('none')
      expect(axis.data).toEqual(rows.map(row => row.disease))
      expect(axis.axisLabel.width).toBeLessThanOrEqual(300)
      expect(axis.axisLabel.overflow).toBe('break')
      expect(axis.axisLabel).toMatchObject({ height: 28, lineHeight: 14, lineOverflow: 'truncate' })
      expect(axis.inverse).toBe(true)
      expect((option.series as Array<{ data: number[]; name: string }>)[0]).toMatchObject({ data: [123456, 70000], name: 'Live discharges' })
      expect((option.tooltip as { confine: boolean }).confine).toBe(true)
      const tooltip = option.tooltip as { formatter: (params: unknown) => string }
      expect(tooltip.formatter([{ name: '<img src=x>', value: 123456 }]))
        .toBe('<strong>&lt;img src=x&gt;</strong><br>Live discharges: <strong>123,456</strong>')
    }
  })
})
