import { describe, expect, test } from 'bun:test'
import type { ChartViewSpec } from '../src/index'
import { compileChartView } from '../src/flint'

const records = (value: unknown): Array<Record<string, unknown>> =>
  (Array.isArray(value) ? value : value ? [value] : []) as Array<Record<string, unknown>>

describe('compileChartView distribution', () => {
  test('bins the measure, not the row labels', () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ stop: `Stop ${i}`, overstatement: 20 + i * 5 }))
    const view = {
      kind: 'chart',
      title: 'Overstatement',
      intent: {
        family: 'distribution',
        dimension: { field: 'stop', label: 'Stop' },
        measure: { field: 'overstatement', label: 'Overstatement', unit: '%' },
      },
    } as unknown as ChartViewSpec
    const option = compileChartView(view, rows)
    const series = records(option.series)
    expect(series.length).toBeGreaterThan(0)
    expect((series[0]?.data as unknown[]).length).toBeGreaterThan(1)
    expect(records(option.xAxis)[0]?.name).toBe('Overstatement (%)')
    expect(records(option.yAxis)[0]?.name).toBe('Stop count')
  })
})

describe('compileChartView bar layout', () => {
  const view = (rows: number, presentation = {}) => ({
    kind: 'chart',
    title: 'Scenarios',
    intent: {
      family: rows > 2 ? 'ranking' : 'comparison',
      dimension: { field: 'name', label: 'Network' },
      measure: { field: 'share', label: 'Share of stops within 10 min', unit: '%' },
    },
    presentation,
  }) as unknown as ChartViewSpec

  test('a short comparison keeps level labels, drops the echoing axis title and labels the bars', () => {
    const rows = [{ name: 'Network + best 3 candidates', share: 41.2 }, { name: 'Current network', share: 33.8 }]
    const option = compileChartView(view(2), rows, undefined, { width: 690, height: 420 })
    const x = records(option.xAxis)[0]!
    const y = records(option.yAxis)[0]!
    const bar = records(option.series)[0]!
    expect(x.type).toBe('category')
    expect(x.name).toBeUndefined()
    expect(records(x.axisLabel)[0]).toMatchObject({ rotate: 0, overflow: 'break' })
    expect(y).toMatchObject({ name: 'Share of stops within 10 min (%)', nameLocation: 'end', nameRotate: 0 })
    expect(records(option.grid)[0]?.bottom).toBeLessThanOrEqual(48)
    expect(bar.barMaxWidth).toBe(56)
    const label = records(bar.label)[0]!
    expect(label.show).toBe(true)
    expect((label.formatter as (p: { value: number }) => string)({ value: 41.2 })).toBe('41.2%')
  })

  test('many long categories switch to horizontal bars unless the spec pins vertical', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ name: `Public Library stop ${i}`, share: i }))
    const auto = compileChartView(view(10), rows)
    expect(records(auto.yAxis)[0]?.type).toBe('category')
    expect(records(auto.series)[0]?.barMaxWidth).toBe(22)
    const pinned = compileChartView(view(10, { orientation: 'vertical' }), rows)
    expect(records(pinned.xAxis)[0]?.type).toBe('category')
  })
})
