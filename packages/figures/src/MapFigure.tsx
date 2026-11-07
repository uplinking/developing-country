import { useEffect, useMemo, useRef, useState } from 'react'
import type { DataViewResultRow, MapCamera, MapLayerView, MapViewSpec } from '@developing-country/views'
import { defaultBasemap, useFiguresConfig, type FiguresConfigInput } from './config'
import { useFigureTokens, useNearViewport, useReducedMotion } from './hooks'
import { buildLegend, fieldStats, geometryRowsForLayer, layerRows, tooltipFor, type FieldStats } from './mapStyle'
import type { HoverInfo, MapEngine, MapSceneView } from './mapEngine'
import type { FigureTokens } from './tokens'
import { Legend } from './Legend'

export interface MapFigureProps {
  view: MapViewSpec
  rows: DataViewResultRow[]
  result: Record<string, unknown>
  /** Camera override (scrolly); defaults to the view's camera. */
  camera?: MapCamera
  /** Layer ids to show; null/undefined keeps the view's own visibility. */
  visibleLayers?: string[] | null
  /** Row ids (or tile-join keys) to emphasise. */
  highlight?: string[]
  /** `full` pans and zooms (cooperative gestures); `hover` only inspects (scrolly). */
  interaction?: 'full' | 'hover'
  /** Cross-fade when `view` changes (scrolly). */
  fade?: boolean
  /** Map views drawn beneath `view` in the same map, bottom first (dcFigure/step `underlay_urls`). */
  underlays?: MapSceneView[]
  config?: FiguresConfigInput
  className?: string
}

type EngineState = { status: 'loading' } | { status: 'ready' } | { status: 'error'; message: string }

const EMPTY: string[] = []
const NO_UNDERLAYS: MapSceneView[] = []

/** Legend entries for one view (stats from its own rows or result geometry). */
function legendFor(view: MapViewSpec, rows: DataViewResultRow[], result: Record<string, unknown>, tokens: FigureTokens, visible: string[] | null) {
  const layerIds = view.layers.map((layer) => layer.id)
  const stats: Record<string, Record<string, FieldStats | null>> = {}
  view.layers.forEach((layer, index) => {
    const own = layerRows(rows, layer, layerIds)
    const source = own.length > 0 || layer.join ? own : geometryRowsForLayer(result, layer, index, layerIds)
    const entry: Record<string, FieldStats | null> = {}
    for (const field of [layer.style?.colorBy?.field, layer.style?.radiusBy?.field]) {
      if (field) entry[field] = fieldStats(source, field)
    }
    stats[layer.id] = entry
  })
  const isShown = (layer: MapLayerView) => (visible === null ? layer.visible : visible.includes(layer.id))
  return buildLegend(view, tokens, stats, isShown)
}

/** A Data View map: styled layers, tile joins, annotations, legend and tooltips. */
export function MapFigure({
  view,
  rows,
  result,
  camera,
  visibleLayers = null,
  highlight = EMPTY,
  interaction = 'full',
  fade = false,
  underlays = NO_UNDERLAYS,
  config,
  className = '',
}: MapFigureProps) {
  const settings = useFiguresConfig(config)
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<MapEngine | null>(null)
  const tokens = useFigureTokens(rootRef)
  const reducedMotion = useReducedMotion()
  const [engineState, setEngineState] = useState<EngineState>({ status: 'loading' })
  const [hover, setHover] = useState<HoverInfo | null>(null)
  const targetCamera = camera ?? view.camera
  const tokensRef = useRef(tokens)
  tokensRef.current = tokens
  const cameraRef = useRef(targetCamera)
  cameraRef.current = targetCamera

  // Create the map once it nears the viewport; MapLibre is fetched only then.
  const near = useNearViewport(canvasRef)
  useEffect(() => {
    const container = canvasRef.current
    if (!container || !near) return
    let cancelled = false
    let engine: MapEngine | null = null
    void import('./mapEngine')
      .then(({ createMapEngine }) => {
        if (cancelled) return null
        return createMapEngine({
          container,
          camera: cameraRef.current,
          tokens: tokensRef.current,
          basemap: settings.basemap ?? defaultBasemap,
          tileBase: settings.tileBase,
          interactive: interaction,
          reducedMotion,
          onHover: setHover,
        })
      })
      .then((created) => {
        if (!created) return
        if (cancelled) {
          created.destroy()
          return
        }
        engine = created
        engineRef.current = created
        setEngineState({ status: 'ready' })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        const message = error instanceof Error && /webgl/i.test(error.message)
          ? 'This browser could not start WebGL, so the map cannot be drawn.'
          : 'The map could not be started.'
        setEngineState({ status: 'error', message })
      })
    const resize = new ResizeObserver(() => engineRef.current?.resize())
    resize.observe(container)
    return () => {
      cancelled = true
      resize.disconnect()
      engine?.destroy()
      engineRef.current = null
    }
    // The engine follows prop changes through the effects below.
  }, [settings.basemap, settings.tileBase, interaction, near])

  const visibleKey = visibleLayers ? visibleLayers.join('\n') : null
  const highlightKey = highlight.join('\n')
  // Underlays arrive as fresh arrays from parents; the scene follows their view ids.
  const underlaysRef = useRef(underlays)
  underlaysRef.current = underlays
  const underlayKey = underlays.map((entry) => entry.view.id).join('\n')
  useEffect(() => {
    if (engineState.status !== 'ready') return
    engineRef.current?.setScene(
      {
        view,
        rows,
        result,
        visible: visibleKey === null ? null : visibleKey ? visibleKey.split('\n') : [],
        highlight: highlightKey ? highlightKey.split('\n') : [],
        underlays: underlaysRef.current,
      },
      { fade },
    )
  }, [engineState.status, view, rows, result, visibleKey, highlightKey, fade, underlayKey])

  const cameraKey = JSON.stringify(targetCamera)
  const firstCamera = useRef(true)
  useEffect(() => {
    if (engineState.status !== 'ready') return
    const animate = !firstCamera.current
    firstCamera.current = false
    engineRef.current?.setCamera(JSON.parse(cameraKey) as MapCamera, animate)
  }, [engineState.status, cameraKey])

  useEffect(() => {
    if (engineState.status === 'ready') engineRef.current?.setTokens(tokens)
  }, [engineState.status, tokens])

  useEffect(() => {
    engineRef.current?.setReducedMotion(reducedMotion)
  }, [reducedMotion])

  const legend = useMemo(
    () => legendFor(view, rows, result, tokens, visibleKey === null ? null : visibleKey.split('\n')),
    [view, rows, result, tokens, visibleKey],
  )
  const underlayLegends = useMemo(
    () => underlaysRef.current
      .map((entry) => ({ id: entry.view.id, title: entry.view.title, entries: legendFor(entry.view, entry.rows, entry.result, tokens, null) }))
      .filter((group) => group.entries.length > 0)
      .reverse(),
    [underlayKey, tokens],
  )

  const tooltip = hover ? tooltipFor(hover.row, hover.layer) : null

  return (
    <div ref={rootRef} className={`dcf dcf-map ${className}`.trim()} data-state={engineState.status}>
      <div ref={canvasRef} className="dcf-map__canvas" role="img" aria-label={`Map: ${view.title}`} />
      {engineState.status === 'loading' ? <div className="dcf-map__veil" aria-hidden="true"><span className="dcf-lamp" />Loading map</div> : null}
      {engineState.status === 'error' ? <div className="dcf-map__veil dcf-map__veil--error" role="alert">{engineState.message}</div> : null}
      {legend.length > 0 || underlayLegends.length > 0 ? <Legend entries={legend} secondary={underlayLegends} /> : null}
      {tooltip && hover ? (
        <div
          className={`dcf-tooltip${hover.pinned ? ' is-pinned' : ''}`}
          style={{ left: hover.x, top: hover.y }}
          role="status"
        >
          <strong>{tooltip.title}</strong>
          {tooltip.rows.length > 0 ? (
            <dl>
              {tooltip.rows.map((row) => (
                <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>
              ))}
            </dl>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export default MapFigure
