import {
  DEFAULT_DATA_VIEW_ORIGIN,
  isDataViewUrl,
  rowsFromViewResult,
  validateDataViewSpec,
  type DataViewResultRow,
  type DataViewSpec,
} from '@developing-country/views'

/**
 * Fetch a Data View and its content-addressed result snapshot. The snapshot URL
 * is derived from the validated view's checksum, never taken from the response,
 * so a document can only ever point at its own immutable result.
 */

export interface LoadedDataView {
  id: string
  view: DataViewSpec
  result: Record<string, unknown>
  rows: DataViewResultRow[]
  /** Canonical public URL used for "Open in explorer" links. */
  viewUrl: string
}

export type DataViewErrorKind = 'invalid-url' | 'not-found' | 'revoked' | 'network' | 'invalid'

export class DataViewError extends Error {
  readonly kind: DataViewErrorKind
  constructor(kind: DataViewErrorKind, message: string) {
    super(message)
    this.name = 'DataViewError'
    this.kind = kind
  }
}

const VIEW_ID = /^view_[a-z0-9]+$/

/** The Data View id in a canonical URL on `origin`, or null when it is not canonical. */
export function viewIdFromUrl(viewUrl: string, origin: string): string | null {
  // SAFETY: isDataViewUrl's origin parameter is typed as the default literal; any origin string is valid at runtime.
  if (!isDataViewUrl(viewUrl, origin as typeof DEFAULT_DATA_VIEW_ORIGIN)) return null
  const id = new URL(viewUrl).pathname.split('/').pop() ?? ''
  return VIEW_ID.test(id) ? id : null
}

export function dataViewEndpoints(id: string, apiBase: string): { document: string; snapshot: (checksum: string) => string } {
  if (!VIEW_ID.test(id)) throw new DataViewError('invalid-url', 'Not a Data View id.')
  const base = apiBase.replace(/\/+$/, '')
  const document = `${base}/api/views/${encodeURIComponent(id)}`
  return {
    document,
    snapshot: (checksum) => `${document}/result/${checksum.replace(/^sha256:/, '')}.json`,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export interface FetchDataViewOptions {
  id: string
  apiBase: string
  viewUrl: string
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}

export async function fetchDataView(options: FetchDataViewOptions): Promise<LoadedDataView> {
  const request = options.fetchImpl ?? fetch
  const endpoints = dataViewEndpoints(options.id, options.apiBase)
  let response: Response
  try {
    response = await request(endpoints.document, { signal: options.signal, headers: { accept: 'application/json' } })
  } catch (error) {
    if (options.signal?.aborted) throw error
    throw new DataViewError('network', 'The data view could not be reached.')
  }
  if (response.status === 404) throw new DataViewError('not-found', 'This data view was not found.')
  if (response.status === 410) throw new DataViewError('revoked', 'This data view has been revoked.')
  if (!response.ok) throw new DataViewError('network', `The data view could not be loaded (HTTP ${response.status}).`)
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new DataViewError('invalid', 'The data view response was not JSON.')
  }
  if (!isRecord(body)) throw new DataViewError('invalid', 'The data view response was malformed.')
  const checked = validateDataViewSpec(body.view)
  if (!checked.ok) throw new DataViewError('invalid', `The data view failed validation: ${checked.issues.slice(0, 3).join('; ')}`)
  const view = checked.value
  if (view.id !== options.id) throw new DataViewError('invalid', 'The data view id does not match the requested URL.')

  let result: Record<string, unknown> | null = isRecord(body.result) ? body.result : null
  if (!result) {
    let snapshot: Response
    try {
      snapshot = await request(endpoints.snapshot(view.data.resultChecksum), { signal: options.signal })
    } catch (error) {
      if (options.signal?.aborted) throw error
      throw new DataViewError('network', 'The saved result snapshot could not be reached.')
    }
    if (!snapshot.ok) throw new DataViewError('network', 'The saved result snapshot could not be loaded.')
    let snapshotBody: unknown
    try {
      snapshotBody = await snapshot.json()
    } catch {
      throw new DataViewError('invalid', 'The saved result snapshot was not JSON.')
    }
    if (!isRecord(snapshotBody)) throw new DataViewError('invalid', 'The saved result snapshot is malformed.')
    result = snapshotBody
  }
  return { id: view.id, view, result, rows: rowsFromViewResult(result), viewUrl: options.viewUrl }
}

interface CacheEntry {
  promise: Promise<LoadedDataView>
  controller: AbortController
  refs: number
  settled: boolean
}

const cache = new Map<string, CacheEntry>()

/**
 * Share one in-flight request per view across every figure on the page. Views
 * are immutable, so a settled success is kept; failures are evicted for retry.
 * When every subscriber releases an unsettled request, it is aborted.
 */
export function acquireDataView(options: Omit<FetchDataViewOptions, 'signal'>): { promise: Promise<LoadedDataView>; release: () => void } {
  const key = dataViewEndpoints(options.id, options.apiBase).document
  let entry = cache.get(key)
  if (!entry) {
    const controller = new AbortController()
    const created: CacheEntry = {
      controller,
      refs: 0,
      settled: false,
      promise: fetchDataView({ ...options, signal: controller.signal }),
    }
    created.promise.then(
      () => { created.settled = true },
      () => {
        created.settled = true
        if (cache.get(key) === created) cache.delete(key)
      },
    )
    cache.set(key, created)
    entry = created
  }
  const held = entry
  held.refs += 1
  let released = false
  return {
    promise: held.promise,
    release: () => {
      if (released) return
      released = true
      held.refs -= 1
      if (held.refs <= 0 && !held.settled) {
        held.controller.abort()
        if (cache.get(key) === held) cache.delete(key)
      }
    },
  }
}

/** Test seam: forget every cached view. */
export function clearDataViewCache(): void {
  cache.clear()
}
