import { describe, expect, test } from 'bun:test'
import { catalog, datasetDocuments } from './dataSearchFixture'
import { EMPTY_STATE, dataIndexView, dataQueryRedirect, parseState, stateFragment, type DataIndexPayload } from './lib/dataIndex'

const site = 'https://developing-country.org'

const payload: DataIndexPayload = {
  rows: [
    { id: 'a', kind: 'available', themeIds: ['ENER'], publisherTypeId: 'government', publisherId: 'cbsl', publisherName: 'Central Bank' },
    { id: 'b', kind: 'available', themeIds: ['ECON'], publisherTypeId: 'government', publisherId: 'dcs', publisherName: 'Census Department' },
    { id: 'c', kind: 'available', themeIds: ['ECON', 'ENER'], publisherTypeId: 'international', publisherId: 'wb', publisherName: 'World Bank' },
    { id: 'g', kind: 'missing', themeIds: ['HEAL'], publisherTypeId: 'government', publisherId: 'moh', publisherName: 'Health Ministry' },
  ],
  documents: [
    { id: 'a', text: { title: ['Electricity outages'] } },
    { id: 'b', text: { title: ['Household rent'] } },
    { id: 'c', text: { title: ['Electricity access'] } },
    { id: 'g', text: { title: ['Hospital waiting times'] } },
  ],
  synonyms: {},
  themeIds: ['AGRI', 'ECON', 'ENER', 'HEAL'],
  publisherTypeIds: ['government', 'international', 'community'],
}

describe('state in the URL', () => {
  test('round-trips through the fragment and drops defaults', () => {
    const state = { tab: 'missing' as const, q: 'rent', theme: 'ECON', publisherType: 'government', publisher: 'dcs' }
    expect(parseState(`#${stateFragment(state)}`)).toEqual(state)
    expect(stateFragment(EMPTY_STATE)).toBe('')
    expect(stateFragment({ ...EMPTY_STATE, q: '  ' })).toBe('')
  })

  test('reads old query strings the same way', () => {
    expect(parseState('?tab=missing&publisher_type=platform&q=Colombo%20rent')).toEqual({
      tab: 'missing', q: 'Colombo rent', theme: '', publisherType: 'platform', publisher: '',
    })
  })
})

describe('dataQueryRedirect', () => {
  test('moves /data query strings into the fragment', () => {
    expect(dataQueryRedirect(`${site}/data?publisher=world-bank&q=electricity%20outages&tab=missing&theme=TECH`))
      .toBe(`${site}/data#q=electricity+outages&tab=missing&theme=TECH&publisher=world-bank`)
    expect(dataQueryRedirect(`${site}/data?tab=available`)).toBe(`${site}/data`)
    expect(dataQueryRedirect(`${site}/data?utm_source=x`)).toBe(`${site}/data`)
  })

  test('leaves other URLs and previews alone', () => {
    for (const path of ['/data', '/data/some-note?x=1', '/analysis?country=LK', '/data?_preview=token']) {
      expect(dataQueryRedirect(`${site}${path}`)).toBeNull()
    }
  })
})

describe('dataIndexView', () => {
  test('defaults to every available dataset', () => {
    const view = dataIndexView(payload, EMPTY_STATE)
    expect(view.visibleIds).toEqual(['a', 'b', 'c'])
    expect(view.totals).toEqual({ available: 3, missing: 1 })
    expect(view.themes).toEqual([{ id: 'ECON', count: 2 }, { id: 'ENER', count: 2 }, { id: 'HEAL', count: 0 }])
    expect(view.publisherTypes.map((type) => type.id)).toEqual(['government', 'international'])
    expect(view.filtersActive).toBe(false)
  })

  test('applies theme, publisher type and publisher together', () => {
    const view = dataIndexView(payload, { ...EMPTY_STATE, theme: 'ENER', publisherType: 'government' })
    expect(view.visibleIds).toEqual(['a'])
    expect(view.publishers.map((option) => option.id)).toEqual(['dcs', 'cbsl', 'moh'])
    expect(view.filtersActive).toBe(true)
  })

  test('ignores filter values that do not exist', () => {
    const view = dataIndexView(payload, { ...EMPTY_STATE, theme: 'NOPE', publisher: 'nobody' })
    expect(view.state.theme).toBe('')
    expect(view.state.publisher).toBe('')
    expect(view.visibleIds).toEqual(['a', 'b', 'c'])
  })

  test('searches each tab and ranks the active one', () => {
    const view = dataIndexView(payload, { ...EMPTY_STATE, q: 'electricity outages' })
    expect(view.visibleIds[0]).toBe('a')
    expect(view.fullMatches.missing).toBe(0)
    const missing = dataIndexView(payload, { ...EMPTY_STATE, tab: 'missing', q: 'hospital' })
    expect(missing.visibleIds).toEqual(['g'])
  })

  test('ranks the real catalogue the way the server did', () => {
    const real: DataIndexPayload = {
      ...payload,
      rows: datasetDocuments.map((document) => ({
        id: document.id, kind: 'available', themeIds: [], publisherTypeId: 'government', publisherId: 'x', publisherName: 'X',
      })),
      documents: datasetDocuments,
      synonyms: catalog.search.synonyms,
    }
    const view = dataIndexView(real, { ...EMPTY_STATE, q: 'school dropouts' })
    expect(view.visibleIds.length).toBeGreaterThan(0)
    expect(view.query?.text).toBe('school dropouts')
  })
})
