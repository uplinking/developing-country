import type { MapSceneView } from './mapEngine'
import type { DataViewState } from './useDataView'

export interface UnderlayStatus {
  url: string
  title?: string
  state: 'loading' | 'ready' | 'error' | 'ignored'
  message?: string
}

export interface ResolvedUnderlays {
  /** Ready map views, bottom first, in listed order. */
  views: MapSceneView[]
  statuses: UnderlayStatus[]
}

const warned = new Set<string>()

/** Dev-only console warning, once per message. Vite replaces `import.meta.env` in browser builds. */
export function devWarn(message: string): void {
  if (!import.meta.env?.DEV || warned.has(message)) return
  warned.add(message)
  console.warn(`[figures] ${message}`)
}

/**
 * Underlays are map views drawn beneath a map's main view. They never replace
 * the main view's camera, highlight or tooltips. A chart underlay is ignored
 * (with a dev warning); a failed one is reported in the caption, never faked.
 */
export function resolveUnderlays(urls: readonly string[], states: Map<string, DataViewState>, mainUrl: string): ResolvedUnderlays {
  const views: MapSceneView[] = []
  const statuses: UnderlayStatus[] = []
  for (const url of new Set(urls)) {
    if (url === mainUrl) continue
    const state = states.get(url)
    if (!state || state.status === 'loading') {
      statuses.push({ url, state: 'loading' })
      continue
    }
    if (state.status === 'error') {
      statuses.push({ url, state: 'error', message: state.error.message })
      continue
    }
    const { view, rows, result } = state.data
    if (view.kind !== 'map') {
      devWarn(`underlay ${url} is a chart view; underlays must be map views and it was ignored.`)
      statuses.push({ url, title: view.title, state: 'ignored', message: 'Chart views cannot be underlays.' })
      continue
    }
    views.push({ view, rows, result })
    statuses.push({ url, title: view.title, state: 'ready' })
  }
  return { views, statuses }
}
