import { afterEach, describe, expect, test } from 'bun:test'
import { boundValue, normaliseBinding } from '../src/binding'
import { applyChartHighlight } from '../src/chartTheme'
import { acquireDataView, clearDataViewCache, DataViewError, fetchDataView, viewIdFromUrl } from '../src/dataView'
import { metricCell, metricMaxima, pageCount, pageOf, searchRows, sortRows } from '../src/explorerModel'
import { readGuess, writeGuess } from '../src/guessStore'
import { parseScrollyStep, resolveStepCamera } from '../src/steps'
import { resolveUnderlays } from '../src/underlays'
import { FALLBACK_TOKENS } from '../src/tokens'
import type { DataViewState } from '../src/useDataView'
import { compileChartView } from '@developing-country/views/flint'
import { chartRanking, gndChoropleth } from './fixtures'

const VIEW_URL = 'https://explore.developing-country.org/views/view_fixturegnd'

describe('scroll step overrides', () => {
  test('parses CMS numbers, ids and empty fields', () => {
    expect(parseScrollyStep({ text: ' Hi ', view_url: VIEW_URL, center_lng: '79.9', center_lat: 6.9, zoom: '11', show: 'a, b,,', highlight: 'LK-1' })).toEqual({
      text: 'Hi',
      viewUrl: VIEW_URL,
      camera: { center: [79.9, 6.9], zoom: 11 },
      show: ['a', 'b'],
      highlight: ['LK-1'],
      underlays: [],
    })
    expect(parseScrollyStep({ text: 'x', view_url: VIEW_URL, center_lng: '', center_lat: '', zoom: '', show: '', highlight: '' })).toEqual({
      text: 'x', viewUrl: VIEW_URL, camera: null, show: null, highlight: [], underlays: [],
    })
  })

  test('ignores out-of-range coordinates and keeps the view camera for the rest', () => {
    const step = parseScrollyStep({ text: '', view_url: VIEW_URL, center_lng: 200, center_lat: 6, zoom: 30 })
    expect(step.camera).toBeNull()
    const zoomOnly = parseScrollyStep({ text: '', view_url: VIEW_URL, zoom: 12 })
    expect(resolveStepCamera({ center: [80, 7], zoom: 7, bearing: 10 }, zoomOnly.camera)).toEqual({ center: [80, 7], zoom: 12, bearing: 10 })
  })
})

function readyState(rows: Array<Record<string, unknown>>): DataViewState {
  return { status: 'ready', error: null, data: { id: 'view_fixturegnd', view: gndChoropleth(), result: { rows }, rows, viewUrl: VIEW_URL } }
}

describe('bound values', () => {
  const rows = [{ district: 'Colombo', share: 0.234 }, { district: 'Gampaha', share: 0.4 }]

  test('resolves a filtered, scaled value with its provenance', () => {
    const value = boundValue(readyState(rows), { field: 'share', where_field: 'district', where_value: 'Colombo', scale: '100' }, 'percent')
    expect(value).toEqual({ status: 'ready', value: 23.400000000000002, text: '23.4%', source: 'Source: lk census 2024 · Vintage 2024 · 3 rows', viewTitle: gndChoropleth().title })
  })

  test('is explicitly unavailable rather than inventing a number', () => {
    expect(boundValue(readyState(rows), { field: 'missing' }).status).toBe('unavailable')
    expect(boundValue({ status: 'error', data: null, error: new DataViewError('revoked', 'This data view has been revoked.') }, { field: 'share' }))
      .toEqual({ status: 'unavailable', reason: 'This data view has been revoked.' })
    expect(boundValue({ status: 'loading', data: null, error: null }, { field: 'share' })).toEqual({ status: 'loading' })
    expect(normaliseBinding({ field: 'share', aggregate: 'median' })).toBeNull()
    expect(normaliseBinding({ field: '', aggregate: 'count' })).toEqual({ field: '', aggregate: 'count' })
  })
})

describe('guess store', () => {
  test('works without localStorage (in-memory fallback)', () => {
    expect(readGuess('g-test')).toBeNull()
    writeGuess('g-test', 40)
    expect(readGuess('g-test')).toBe(40)
  })
})

describe('chart highlight', () => {
  test('colours highlighted categories in the accent and mutes the rest', () => {
    const view = chartRanking()
    const option = compileChartView(view, [{ district: 'Colombo', share: 23 }, { district: 'Gampaha', share: 40 }])
    const next = applyChartHighlight(option, ['colombo'], FALLBACK_TOKENS)
    const series = (next.series as Array<{ data: Array<{ value: number; itemStyle: { color: string } }> }>)[0]
    expect(series?.data[0]).toEqual({ value: 23, itemStyle: { color: FALLBACK_TOKENS.routeFlag } })
    expect(series?.data[1]?.itemStyle.color).not.toBe(FALLBACK_TOKENS.routeFlag)
    expect(applyChartHighlight(option, [], FALLBACK_TOKENS)).toBe(option)
  })
})

describe('explorer model', () => {
  const rows = [
    { name: 'Kollupitiya', district: 'Colombo', share: 80 },
    { name: 'Négombo', district: 'Gampaha', share: 20 },
    { name: 'Kandy', district: 'Kandy', share: null },
  ]

  test('search is accent- and case-insensitive across fields', () => {
    expect(searchRows(rows, 'negombo', ['name']).map((row) => row.name)).toEqual(['Négombo'])
    expect(searchRows(rows, 'col koll', ['name', 'district'])).toHaveLength(1)
  })

  test('sort keeps missing values last in both directions', () => {
    expect(sortRows(rows, 'share', 'desc').map((row) => row.share)).toEqual([80, 20, null])
    expect(sortRows(rows, 'share', 'asc').map((row) => row.share)).toEqual([20, 80, null])
  })

  test('metric bars are scaled to the column max and percents get unit glyphs', () => {
    const max = metricMaxima(rows, [{ field: 'share', label: 'Share', format: 'percent' }])
    expect(max).toEqual({ share: 80 })
    expect(metricCell(rows[1] as Record<string, unknown>, { field: 'share', label: 'Share', format: 'percent' }, 80)).toEqual({ label: 'Share', text: '20%', fraction: 0.25, glyphs: 2 })
    expect(metricCell(rows[2] as Record<string, unknown>, { field: 'share', label: 'Share' }, 80).text).toBe('—')
  })

  test('paginates past one page', () => {
    const many = Array.from({ length: 130 }, (_, i) => i)
    expect(pageCount(many.length)).toBe(3)
    expect(pageOf(many, 2)).toEqual(many.slice(96))
    expect(pageOf(many, 99)).toEqual(many.slice(96))
  })
})

describe('data view loading', () => {
  afterEach(() => clearDataViewCache())

  test('accepts only canonical view URLs on the configured origin', () => {
    expect(viewIdFromUrl(VIEW_URL, 'https://explore.developing-country.org')).toBe('view_fixturegnd')
    expect(viewIdFromUrl(`${VIEW_URL}?x=1`, 'https://explore.developing-country.org')).toBeNull()
    expect(viewIdFromUrl('https://evil.example/views/view_a', 'https://explore.developing-country.org')).toBeNull()
  })

  test('loads the snapshot from the checksum-derived URL, not the response', async () => {
    const requested: string[] = []
    const fetchImpl = (async (url: string) => {
      requested.push(url)
      if (url.endsWith('/api/views/view_fixturegnd')) {
        return Response.json({ view: gndChoropleth(), result_url: 'https://evil.example/x.json' })
      }
      return Response.json({ rows: [{ gnd_id: 'LK-1', share: 4 }] })
    }) as typeof fetch
    const loaded = await fetchDataView({ id: 'view_fixturegnd', apiBase: 'https://explore.developing-country.org', viewUrl: VIEW_URL, fetchImpl })
    expect(requested[1]).toBe(`https://explore.developing-country.org/api/views/view_fixturegnd/result/${'a'.repeat(64)}.json`)
    expect(loaded.rows).toEqual([{ gnd_id: 'LK-1', share: 4 }])
  })

  test('maps HTTP failures and mismatched ids to explicit errors', async () => {
    const respond = (body: unknown, status = 200) => (async () => Response.json(body, { status })) as unknown as typeof fetch
    const base = { id: 'view_fixturegnd', apiBase: 'https://x.test', viewUrl: VIEW_URL }
    await expect(fetchDataView({ ...base, fetchImpl: respond({}, 410) })).rejects.toMatchObject({ kind: 'revoked' })
    await expect(fetchDataView({ ...base, fetchImpl: respond({}, 404) })).rejects.toMatchObject({ kind: 'not-found' })
    await expect(fetchDataView({ ...base, fetchImpl: respond({ view: { kind: 'map' } }) })).rejects.toMatchObject({ kind: 'invalid' })
    await expect(fetchDataView({ ...base, id: 'view_other', fetchImpl: respond({ view: gndChoropleth(), result: {} }) })).rejects.toMatchObject({ kind: 'invalid' })
  })

  test('shares one request per view and aborts it when every figure leaves', async () => {
    let calls = 0
    let aborted = false
    const fetchImpl = ((_url: string, init?: RequestInit) => {
      calls += 1
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => { aborted = true; reject(new DOMException('aborted', 'AbortError')) })
      })
    }) as typeof fetch
    const options = { id: 'view_fixturegnd', apiBase: 'https://x.test', viewUrl: VIEW_URL, fetchImpl }
    const a = acquireDataView(options)
    const b = acquireDataView(options)
    a.promise.catch(() => {})
    expect(calls).toBe(1)
    a.release()
    expect(aborted).toBe(false)
    b.release()
    expect(aborted).toBe(true)
  })
})

describe('stringified matching', () => {
  test('numeric chart dimensions can be highlighted by their string form', () => {
    const view = { ...chartRanking(), intent: { family: 'ranking' as const, dimension: { field: 'decile' }, measure: { field: 'share' } }, presentation: { orientation: 'horizontal' as const } }
    const option = compileChartView(view, [{ decile: 9, share: 1 }, { decile: 10, share: 2 }, { decile: 1, share: 3 }])
    const next = applyChartHighlight(option, ['9', '10'], FALLBACK_TOKENS)
    const colors = (next.series as Array<{ data: Array<{ itemStyle: { color: string } }> }>)[0]?.data.map((datum) => datum.itemStyle.color)
    expect(colors?.filter((color) => color === FALLBACK_TOKENS.routeFlag)).toHaveLength(2)
  })
})

describe('underlays', () => {
  const OUTLINES = 'https://explore.developing-country.org/views/view_outlines'
  const RANK = 'https://explore.developing-country.org/views/view_fixturerank'

  test('steps parse underlay URLs, dropping blanks, duplicates and the step view itself', () => {
    const step = parseScrollyStep({ text: 'x', view_url: VIEW_URL, underlay_urls: ` ${OUTLINES}, ,${OUTLINES},${VIEW_URL}` })
    expect(step.underlays).toEqual([OUTLINES])
  })

  test('only ready map views are drawn; charts are ignored and failures reported', () => {
    const states = new Map<string, DataViewState>([
      [OUTLINES, readyState([{ id: 'c1' }])],
      [RANK, { status: 'ready', error: null, data: { id: 'view_fixturerank', view: chartRanking(), result: {}, rows: [], viewUrl: RANK } }],
      ['https://explore.developing-country.org/views/view_gone', { status: 'error', data: null, error: new DataViewError('revoked', 'This data view has been revoked.') }],
    ])
    const resolved = resolveUnderlays([OUTLINES, RANK, 'https://explore.developing-country.org/views/view_gone', 'https://explore.developing-country.org/views/view_pending', VIEW_URL], states, VIEW_URL)
    expect(resolved.views.map((entry) => entry.view.id)).toEqual(['view_fixturegnd'])
    expect(resolved.statuses.map((status) => status.state)).toEqual(['ready', 'ignored', 'error', 'loading'])
  })
})
