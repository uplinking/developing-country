import { useEffect, useMemo, useState } from 'react'
import { acquireDataView, DataViewError, viewIdFromUrl, type LoadedDataView } from './dataView'
import { useFiguresConfig, type FiguresConfigInput } from './config'

export type DataViewState =
  | { status: 'loading'; data: null; error: null }
  | { status: 'ready'; data: LoadedDataView; error: null }
  | { status: 'error'; data: null; error: DataViewError }

const LOADING: DataViewState = { status: 'loading', data: null, error: null }

function errorState(error: unknown): DataViewState {
  const value = error instanceof DataViewError ? error : new DataViewError('network', 'The data view could not be loaded.')
  return { status: 'error', data: null, error: value }
}

interface Target {
  key: string
  id: string | null
  apiBase: string
  viewUrl: string
}

function target(viewUrl: string, origin: string, apiBase: string | undefined): Target {
  const id = viewIdFromUrl(viewUrl, origin)
  const base = apiBase ?? (id ? new URL(viewUrl).origin : '')
  return { key: `${base}|${id ?? ''}|${viewUrl}`, id, apiBase: base, viewUrl }
}

/**
 * Load one Data View by canonical URL. Invalid URLs fail closed without a
 * request; requests are shared and cached per view and aborted on unmount.
 */
export function useDataView(viewUrl: string | null | undefined, config?: FiguresConfigInput): DataViewState {
  const states = useDataViews(viewUrl ? [viewUrl] : [], config)
  return viewUrl ? states.get(viewUrl) ?? LOADING : LOADING
}

/** Load several views at once (scrolly steps), keyed by URL. */
export function useDataViews(viewUrls: readonly string[], config?: FiguresConfigInput): Map<string, DataViewState> {
  const { origin, apiBase } = useFiguresConfig(config)
  const key = viewUrls.join('\n')
  const unique = useMemo(() => [...new Set(key ? key.split('\n') : [])], [key])
  const targets = useMemo(() => unique.map((url) => target(url, origin, apiBase)), [unique, origin, apiBase])
  const [states, setStates] = useState<Map<string, DataViewState>>(() => new Map())

  useEffect(() => {
    let active = true
    const releases: Array<() => void> = []
    const initial = new Map<string, DataViewState>()
    for (const item of targets) {
      if (!item.id) {
        initial.set(item.viewUrl, errorState(new DataViewError('invalid-url', 'Not a canonical developing-country.org Data View URL.')))
        continue
      }
      initial.set(item.viewUrl, LOADING)
      const handle = acquireDataView({ id: item.id, apiBase: item.apiBase, viewUrl: item.viewUrl })
      releases.push(handle.release)
      handle.promise.then(
        (data) => {
          if (!active) return
          setStates((previous) => new Map(previous).set(item.viewUrl, { status: 'ready', data, error: null }))
        },
        (error: unknown) => {
          if (!active) return
          setStates((previous) => new Map(previous).set(item.viewUrl, errorState(error)))
        },
      )
    }
    setStates(initial)
    return () => {
      active = false
      for (const release of releases) release()
    }
  }, [targets])

  return states
}

/**
 * Load a view by id from an explicit API base (the explorer's own /views/ page,
 * which may be served under a base path and so has no canonical origin URL).
 */
export function useDataViewById(id: string, apiBase: string, viewUrl: string): DataViewState {
  const [state, setState] = useState<DataViewState>(LOADING)
  useEffect(() => {
    let active = true
    setState(LOADING)
    let handle: ReturnType<typeof acquireDataView>
    try {
      handle = acquireDataView({ id, apiBase, viewUrl })
    } catch (error) {
      setState(errorState(error))
      return
    }
    handle.promise.then(
      (data) => { if (active) setState({ status: 'ready', data, error: null }) },
      (error: unknown) => { if (active) setState(errorState(error)) },
    )
    return () => {
      active = false
      handle.release()
    }
  }, [id, apiBase, viewUrl])
  return state
}
