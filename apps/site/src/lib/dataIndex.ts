// The /data catalogue's filter and search state, computed in the browser.
//
// The page renders every dataset and data gap once, so /data is a single cached
// document. Filters and search live in the URL fragment (/data#theme=ENER&q=…),
// which never reaches the server: crawlers cannot multiply the page into
// thousands of query-string variants, each a Worker render and a full CMS read.
// Old /data?… links are redirected to the fragment form by the Worker.

import { parseQuery, search, type SearchDocument, type SearchQuery, type SynonymMap } from '@developing-country/datasets/search'

export type DataTab = 'available' | 'missing'

export interface DataIndexRow {
  id: string
  kind: DataTab
  themeIds: string[]
  publisherTypeId: string
  publisherId: string
  publisherName: string
}

export interface DataIndexPayload {
  rows: DataIndexRow[]
  documents: SearchDocument[]
  synonyms: SynonymMap
  themeIds: string[]
  publisherTypeIds: string[]
}

export interface DataIndexState {
  tab: DataTab
  q: string
  theme: string
  publisherType: string
  publisher: string
}

const PARAMS = { q: 'q', tab: 'tab', theme: 'theme', publisherType: 'publisher_type', publisher: 'publisher' } as const

export const EMPTY_STATE: DataIndexState = { tab: 'available', q: '', theme: '', publisherType: '', publisher: '' }

/** Read state from a fragment ("#tab=missing") or a query string ("?tab=missing"). */
export function parseState(raw: string): DataIndexState {
  const params = new URLSearchParams(raw.replace(/^[#?]/, ''))
  return {
    tab: params.get(PARAMS.tab) === 'missing' ? 'missing' : 'available',
    q: (params.get(PARAMS.q) ?? '').slice(0, 200),
    theme: params.get(PARAMS.theme) ?? '',
    publisherType: params.get(PARAMS.publisherType) ?? '',
    publisher: params.get(PARAMS.publisher) ?? '',
  }
}

/** The fragment for a state, without the leading '#'; empty for the default view. */
export function stateFragment(state: DataIndexState): string {
  const params = new URLSearchParams()
  if (state.q.trim()) params.set(PARAMS.q, state.q.trim())
  if (state.tab === 'missing') params.set(PARAMS.tab, 'missing')
  if (state.theme) params.set(PARAMS.theme, state.theme)
  if (state.publisherType) params.set(PARAMS.publisherType, state.publisherType)
  if (state.publisher) params.set(PARAMS.publisher, state.publisher)
  return params.toString()
}

/** Where a /data request carrying a query string should go instead: the same state as a fragment. */
export function dataQueryRedirect(requestUrl: string): string | null {
  const url = new URL(requestUrl)
  if (url.pathname !== '/data' || !url.search || url.searchParams.has('_preview')) return null
  const fragment = stateFragment(parseState(url.search))
  return `${url.origin}/data${fragment ? `#${fragment}` : ''}`
}

export interface PublisherOption {
  id: string
  name: string
  count: number
}

export interface DataIndexView {
  state: DataIndexState
  query: SearchQuery | null
  /** Rows to show, in display order. */
  visibleIds: string[]
  /** Rows in the tab matching the search, before filters. */
  activeCount: number
  /** All rows in the tab. */
  tabCount: number
  partial: boolean
  /** Rows per tab that match every search word (0 when only partial matches), for the tab badges. */
  fullMatches: Record<DataTab, number>
  totals: Record<DataTab, number>
  themes: { id: string; count: number }[]
  publisherTypes: { id: string; count: number }[]
  publishers: PublisherOption[]
  filtersActive: boolean
}

/** Everything the page shows for a state; mirrors the rules the server used to apply per request. */
export function dataIndexView(payload: DataIndexPayload, requested: DataIndexState): DataIndexView {
  const { rows } = payload
  const documents = new Map(payload.documents.map((document) => [document.id, document]))
  const query = parseQuery(requested.q, payload.synonyms)
  const tab = requested.tab

  const searchTab = (kind: DataTab) => {
    const tabRows = rows.filter((row) => row.kind === kind)
    if (!query) return { rows: tabRows, partial: false }
    const result = search(tabRows.flatMap((row) => documents.get(row.id) ?? []), query)
    const byId = new Map(tabRows.map((row) => [row.id, row]))
    return { rows: result.hits.flatMap((hit) => byId.get(hit.id) ?? []), partial: result.partial }
  }
  const results = { available: searchTab('available'), missing: searchTab('missing') }
  const fullMatches = (kind: DataTab) => results[kind].partial ? 0 : results[kind].rows.length
  const activeRows = results[tab].rows

  const themeIds = payload.themeIds.filter((id) => rows.some((row) => row.themeIds.includes(id)))
  const theme = themeIds.includes(requested.theme) ? requested.theme : ''
  const publisherTypeIds = payload.publisherTypeIds.filter((id) => rows.some((row) => row.publisherTypeId === id))
  const publisherType = publisherTypeIds.includes(requested.publisherType) ? requested.publisherType : ''
  const publishers = [...new Map(
    rows
      .filter((row) => !publisherType || row.publisherTypeId === publisherType)
      .map((row) => [row.publisherId, row.publisherName]),
  ).entries()]
    .map(([id, name]) => ({ id, name, count: activeRows.filter((row) => row.publisherId === id).length }))
    .sort((left, right) => left.name.localeCompare(right.name))
  const publisher = publishers.some((option) => option.id === requested.publisher) ? requested.publisher : ''

  const visible = activeRows.filter((row) =>
    (!theme || row.themeIds.includes(theme))
    && (!publisherType || row.publisherTypeId === publisherType)
    && (!publisher || row.publisherId === publisher),
  )

  return {
    state: { tab, q: query?.text ?? '', theme, publisherType, publisher },
    query,
    visibleIds: visible.map((row) => row.id),
    activeCount: activeRows.length,
    tabCount: rows.filter((row) => row.kind === tab).length,
    partial: results[tab].partial,
    fullMatches: { available: fullMatches('available'), missing: fullMatches('missing') },
    totals: {
      available: rows.filter((row) => row.kind === 'available').length,
      missing: rows.filter((row) => row.kind === 'missing').length,
    },
    themes: themeIds.map((id) => ({ id, count: activeRows.filter((row) => row.themeIds.includes(id)).length })),
    publisherTypes: publisherTypeIds.map((id) => ({ id, count: activeRows.filter((row) => row.publisherTypeId === id).length })),
    publishers,
    filtersActive: Boolean(theme || publisherType || publisher),
  }
}

export function noun(kind: DataTab, count: number): string {
  return kind === 'missing'
    ? (count === 1 ? 'data gap' : 'data gaps')
    : (count === 1 ? 'dataset' : 'datasets')
}
