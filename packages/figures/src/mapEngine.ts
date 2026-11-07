import maplibregl, {
  type LayerSpecification,
  type Map as MapLibreMap,
  type MapMouseEvent,
  type Marker,
  type SourceSpecification,
  type StyleSpecification,
} from 'maplibre-gl'
import { Protocol } from 'pmtiles'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { DataViewResultRow, MapCamera, MapLayerView, MapViewSpec } from '@developing-country/views'
import type { BasemapResolver } from './config'
import {
  FEATURE_ID_PROPERTY,
  OPACITY_PROPERTIES,
  TILE_ID_PROPERTY,
  featuresFromRows,
  fieldStats,
  geometryRowsForLayer,
  joinLabelExpr,
  joinStates,
  planLayer,
  layerRows,
  rowId,
  type FieldStats,
  type GeoFeature,
  type LayerPlan,
} from './mapStyle'
import type { FigureTokens } from './tokens'

/**
 * Imperative MapLibre controller behind <MapFigure>. Loaded lazily (this module
 * statically imports MapLibre, so only its dynamic import pulls the library).
 * One map instance serves a sequence of scenes. Every view in a scene (the
 * main view and its underlays) is mounted by id: a view present in both the
 * old and new scene stays mounted (no flicker), views that leave fade out,
 * views that arrive fade in, and the stack is re-ordered so underlays sit
 * beneath the main view in their listed order (first = lowest).
 */

/** One saved map view's data, as drawn in a scene. */
export interface MapSceneView {
  view: MapViewSpec
  rows: DataViewResultRow[]
  result: Record<string, unknown>
}

export interface MapScene extends MapSceneView {
  /** Main-view layer ids to show; null keeps each layer's own `visible`. Underlays keep their own. */
  visible: string[] | null
  /** Main-view row ids (or tile-join keys) to emphasise. */
  highlight: string[]
  /** Map views drawn beneath the main view, bottom first. */
  underlays?: MapSceneView[]
}

interface MountSpec extends MapSceneView {
  visible: string[] | null
  highlight: string[]
  main: boolean
}

export interface HoverInfo {
  x: number
  y: number
  layer: MapLayerView | undefined
  row: DataViewResultRow
  pinned: boolean
}

export interface MapEngineOptions {
  container: HTMLElement
  camera: MapCamera
  tokens: FigureTokens
  basemap: BasemapResolver
  tileBase: string
  interactive: 'full' | 'hover'
  reducedMotion: boolean
  onHover: (info: HoverInfo | null) => void
}

export interface MapEngine {
  setScene(scene: MapScene, options?: { fade?: boolean }): void
  setCamera(camera: MapCamera, animate: boolean): void
  setTokens(tokens: FigureTokens): void
  setReducedMotion(reduced: boolean): void
  resize(): void
  destroy(): void
}

const FADE_MS = 360
const STYLE_TIMEOUT_MS = 9000
const FALLBACK_GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf'

let protocolRegistered = false
function registerPmtiles(): void {
  if (protocolRegistered) return
  maplibregl.addProtocol('pmtiles', new Protocol().tile)
  protocolRegistered = true
}

interface LayerLookup {
  layer: MapLayerView
  joined: boolean
  rowsByKey: Map<string, DataViewResultRow>
}

interface Mounted {
  spec: MountSpec
  prefix: string
  plans: Array<{ layer: MapLayerView; plan: LayerPlan; sourceId: string; sourceLayer?: string; joined: boolean }>
  sources: string[]
  markers: Marker[]
  lookups: Map<string, LayerLookup>
  stats: Record<string, Record<string, FieldStats | null>>
  highlighted: Array<{ source: string; sourceLayer?: string; id: string }>
}

function blankStyle(tokens: FigureTokens): StyleSpecification {
  return {
    version: 8,
    glyphs: FALLBACK_GLYPHS,
    sources: {},
    layers: [{ id: 'dcf-background', type: 'background', paint: { 'background-color': tokens.paper } }],
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Saved context geometry that belongs to no view layer: query hulls and stage drawings. */
function contextFeatures(result: Record<string, unknown>): GeoFeature[] {
  const features: GeoFeature[] = []
  const hull = result.hull
  if (isRecord(hull) && typeof hull.type === 'string') {
    features.push({ type: 'Feature', geometry: hull as GeoFeature['geometry'], properties: { label: 'Saved query boundary' } })
  }
  if (Array.isArray(result.stage)) {
    for (const event of result.stage) {
      if (!isRecord(event) || event.t !== 'draw' || !isRecord(event.geojson)) continue
      const geojson = event.geojson
      const items = geojson.type === 'FeatureCollection' && Array.isArray(geojson.features) ? geojson.features : [geojson]
      for (const item of items) {
        if (isRecord(item) && isRecord(item.geometry) && typeof item.geometry.type === 'string') {
          features.push({ type: 'Feature', geometry: item.geometry as GeoFeature['geometry'], properties: {} })
        }
      }
    }
  }
  return features
}

export async function createMapEngine(options: MapEngineOptions): Promise<MapEngine> {
  registerPmtiles()
  let tokens = options.tokens
  let reducedMotion = options.reducedMotion
  let theme: 'light' | 'dark' = tokens.dark ? 'dark' : 'light'
  const interactive = options.interactive === 'full'
  const map: MapLibreMap = new maplibregl.Map({
    container: options.container,
    style: options.basemap(theme),
    center: options.camera.center,
    zoom: options.camera.zoom,
    bearing: options.camera.bearing ?? 0,
    pitch: options.camera.pitch ?? 0,
    attributionControl: false,
    cooperativeGestures: interactive,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    scrollZoom: interactive,
    dragPan: interactive,
    boxZoom: false,
    doubleClickZoom: interactive,
    touchZoomRotate: interactive,
    keyboard: interactive,
    fadeDuration: 0,
  })
  if (interactive) map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')

  let styleReady = false
  let destroyed = false
  const mounted = new Map<string, Mounted>()
  let mainId: string | null = null
  let lastScene: MapScene | null = null
  let pendingScene: MapScene | null = null
  let pinned = false
  const retiring = new Set<Mounted>()

  // Credits stay (ODbL), but collapsed: MapLibre opens compact attribution itself.
  let attributionTouched = false
  options.container.addEventListener('click', (event) => {
    if ((event.target as Element | null)?.closest?.('.maplibregl-ctrl-attrib-button')) attributionTouched = true
  })
  const closeAttribution = () => {
    if (attributionTouched) return
    for (const element of options.container.querySelectorAll('.maplibregl-ctrl-attrib')) {
      element.classList.remove('maplibregl-compact-show')
      element.removeAttribute('open')
    }
  }

  const styleTimeout = window.setTimeout(() => {
    if (!styleReady && !destroyed) map.setStyle(blankStyle(tokens))
  }, STYLE_TIMEOUT_MS)

  const fadeMs = () => (reducedMotion ? 0 : FADE_MS)

  function addPlan(entry: Mounted['plans'][number], startHidden: boolean): void {
    const paint = { ...entry.plan.paint }
    if (startHidden) for (const key of OPACITY_PROPERTIES[entry.plan.type]) paint[key] = 0
    const spec = {
      id: entry.plan.id,
      type: entry.plan.type,
      source: entry.sourceId,
      ...(entry.sourceLayer ? { 'source-layer': entry.sourceLayer } : {}),
      paint,
      layout: entry.plan.layout,
      ...(entry.plan.filter === undefined ? {} : { filter: entry.plan.filter }),
    }
    // SAFETY: planLayer emits valid MapLibre paint/layout/filter values; its unit tests pin the shapes.
    map.addLayer(spec as unknown as LayerSpecification)
  }

  function restoreOpacity(entry: Mounted['plans'][number]): void {
    for (const key of OPACITY_PROPERTIES[entry.plan.type]) {
      const value = entry.plan.paint[key]
      if (value !== undefined && map.getLayer(entry.plan.id)) map.setPaintProperty(entry.plan.id, key, value)
    }
  }

  function isVisible(spec: MountSpec, layer: MapLayerView): boolean {
    return spec.visible ? spec.visible.includes(layer.id) : layer.visible
  }

  function buildPlans(scene: MountSpec, prefix: string, stats: Mounted['stats'], fade: number | undefined, joinLabels: Map<string, unknown>): Mounted['plans'] {
    const dimOthers = scene.highlight.length > 0
    const plans: Mounted['plans'] = []
    scene.view.layers.forEach((layer, index) => {
      const joined = Boolean(layer.join)
      const sourceId = `${prefix}:${joined ? 'tiles' : 'geo'}:${layer.id}`
      for (const plan of planLayer({
        prefix: `${prefix}:${layer.id}`,
        layer,
        index,
        source: joined ? 'feature-state' : 'property',
        tokens,
        stats: stats[layer.id] ?? {},
        dimOthers,
        visible: isVisible(scene, layer),
        fadeMs: fade,
        ...(joinLabels.has(layer.id) ? { labelExpr: joinLabels.get(layer.id) as never } : {}),
      })) {
        plans.push({ layer, plan, sourceId, joined, ...(layer.join ? { sourceLayer: layer.join.sourceLayer } : {}) })
      }
    })
    return plans
  }

  function addMarkers(spec: MountSpec): Marker[] {
    // Only the main view speaks; underlay annotations would compete with it.
    if (!spec.main) return []
    const markers: Marker[] = []
    for (const annotation of spec.view.annotations ?? []) {
      const element = document.createElement('div')
      element.className = `dcf-callout dcf-callout--${annotation.anchor ?? 'top'}`
      const text = document.createElement('span')
      text.textContent = annotation.text
      element.append(text)
      const anchor = ({ top: 'bottom', bottom: 'top', left: 'right', right: 'left' } as const)[annotation.anchor ?? 'top']
      markers.push(new maplibregl.Marker({ element, anchor }).setLngLat(annotation.coordinates).addTo(map))
    }
    return markers
  }

  function mount(scene: MountSpec, fadeIn: boolean): Mounted {
    const prefix = `dcf:${scene.view.id}`
    const layerIds = scene.view.layers.map((layer) => layer.id)
    const stats: Mounted['stats'] = {}
    const lookups = new Map<string, LayerLookup>()
    const sources: string[] = []
    const joinLabels = new Map<string, unknown>()
    const joinStateBySource: Array<{ source: string; sourceLayer: string; states: ReturnType<typeof joinStates> }> = []

    scene.view.layers.forEach((layer, index) => {
      const rows = layerRows(scene.rows, layer, layerIds)
      const geometry = layer.join ? [] : geometryRowsForLayer(scene.result, layer, index, layerIds)
      const style = layer.style
      const layerStats: Record<string, FieldStats | null> = {}
      for (const field of [style?.colorBy?.field, style?.radiusBy?.field]) {
        if (field) layerStats[field] = fieldStats(rows.length > 0 ? rows : geometry, field)
      }
      stats[layer.id] = layerStats
      if (layer.join) {
        const sourceId = `${prefix}:tiles:${layer.id}`
        const source: SourceSpecification = {
          type: 'vector',
          url: `pmtiles://${options.tileBase.replace(/\/+$/, '')}/${layer.join.tileset}.pmtiles`,
          promoteId: { [layer.join.sourceLayer]: TILE_ID_PROPERTY },
        }
        map.addSource(sourceId, source)
        sources.push(sourceId)
        const states = joinStates(rows, layer.join.rowKey, style)
        joinStateBySource.push({ source: sourceId, sourceLayer: layer.join.sourceLayer, states })
        const rowsByKey = new Map<string, DataViewResultRow>()
        for (const row of rows) {
          const key = row[layer.join.rowKey]
          if (typeof key === 'string' || typeof key === 'number') rowsByKey.set(String(key), row)
        }
        const labels = joinLabelExpr(rows, layer.join.rowKey, style?.labelField)
        if (labels !== undefined) joinLabels.set(layer.id, labels)
        lookups.set(layer.id, { layer, joined: true, rowsByKey })
      } else {
        const sourceId = `${prefix}:geo:${layer.id}`
        // Rows that have detailed geometry are drawn as that geometry, not also as a point.
        const idOf = (row: DataViewResultRow) => (typeof row.id === 'string' || typeof row.id === 'number' ? String(row.id) : null)
        const shaped = new Set(geometry.map(idOf).filter((id): id is string => id !== null))
        const allRows = [...geometry, ...rows.filter((row) => !shaped.has(idOf(row) ?? '\u0000'))]
        const features = featuresFromRows(allRows)
        map.addSource(sourceId, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features } as never,
          promoteId: FEATURE_ID_PROPERTY,
        })
        sources.push(sourceId)
        const rowsByKey = new Map<string, DataViewResultRow>()
        allRows.forEach((row, rowIndex) => rowsByKey.set(rowId(row, rowIndex), row))
        lookups.set(layer.id, { layer, joined: false, rowsByKey })
      }
    })

    const context = contextFeatures(scene.result)
    if (context.length > 0) {
      const sourceId = `${prefix}:context`
      map.addSource(sourceId, { type: 'geojson', data: { type: 'FeatureCollection', features: context } as never })
      sources.push(sourceId)
      map.addLayer({ id: `${sourceId}:fill`, type: 'fill', source: sourceId, filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': tokens.ink, 'fill-opacity': 0.05 } })
      map.addLayer({ id: `${sourceId}:line`, type: 'line', source: sourceId, paint: { 'line-color': tokens.ink, 'line-width': 1.4, 'line-dasharray': [2, 2], 'line-opacity': 0.7 } })
    }

    const plans = buildPlans(scene, prefix, stats, fadeMs(), joinLabels)
    // A fade restores opacity on the next frame; reduced motion and hidden
    // pages (no animation frames) get the layer at full opacity immediately.
    const fade = fadeIn && !reducedMotion && document.visibilityState === 'visible'
    for (const entry of plans) addPlan(entry, fade)
    if (fade) {
      requestAnimationFrame(() => {
        if (!destroyed) for (const entry of plans) restoreOpacity(entry)
      })
    }
    for (const { source, sourceLayer, states } of joinStateBySource) {
      for (const [id, state] of states) map.setFeatureState({ source, sourceLayer, id }, state)
    }

    const created: Mounted = { spec: scene, prefix, plans, sources, markers: addMarkers(scene), lookups, stats, highlighted: [] }
    applyHighlight(created, scene.highlight)
    return created
  }

  function applyHighlight(target: Mounted, ids: string[]): void {
    clearHighlight(target)
    if (ids.length === 0) return
    const wanted = new Set(ids)
    for (const [layerId, lookup] of target.lookups) {
      const layer = lookup.layer
      const source = `${target.prefix}:${lookup.joined ? 'tiles' : 'geo'}:${layerId}`
      for (const [key, row] of lookup.rowsByKey) {
        const ownId = typeof row.id === 'string' || typeof row.id === 'number' ? String(row.id) : null
        if (!wanted.has(key) && !(ownId && wanted.has(ownId))) continue
        const sourceLayer = lookup.joined && layer.join ? layer.join.sourceLayer : undefined
        map.setFeatureState({ source, ...(sourceLayer ? { sourceLayer } : {}), id: key }, { hl: true })
        target.highlighted.push({ source, ...(sourceLayer ? { sourceLayer } : {}), id: key })
      }
    }
  }

  function clearHighlight(mounted: Mounted): void {
    for (const target of mounted.highlighted) {
      if (map.getSource(target.source)) {
        map.setFeatureState({ source: target.source, ...(target.sourceLayer ? { sourceLayer: target.sourceLayer } : {}), id: target.id }, { hl: false })
      }
    }
    mounted.highlighted = []
  }

  function update(mounted: Mounted, scene: MountSpec): void {
    const highlightChanged = mounted.spec.highlight.join('\n') !== scene.highlight.join('\n')
    const roleChanged = mounted.spec.main !== scene.main
    mounted.spec = scene
    if (roleChanged) {
      for (const marker of mounted.markers) marker.remove()
      mounted.markers = addMarkers(scene)
    }
    if (highlightChanged) {
      // Dim-others changes the opacity expressions; re-plan and re-apply them.
      const replanned = buildPlans(scene, mounted.prefix, mounted.stats, fadeMs(), new Map())
      for (const entry of replanned) {
        if (!map.getLayer(entry.plan.id)) continue
        for (const key of OPACITY_PROPERTIES[entry.plan.type]) {
          const value = entry.plan.paint[key]
          if (value !== undefined) map.setPaintProperty(entry.plan.id, key, value)
        }
      }
      applyHighlight(mounted, scene.highlight)
    }
    for (const entry of mounted.plans) {
      if (!map.getLayer(entry.plan.id)) continue
      map.setLayoutProperty(entry.plan.id, 'visibility', isVisible(scene, entry.layer) ? 'visible' : 'none')
    }
  }

  function unmount(mounted: Mounted, fadeOut: boolean): void {
    if (!fadeOut || fadeMs() === 0) {
      // Without a fade (reduced motion, theme or token changes) the view goes
      // now; leaving its sources would make the next mount of it throw.
      removeNow(mounted)
      return
    }
    for (const marker of mounted.markers) marker.remove()
    retiring.add(mounted)
    for (const entry of mounted.plans) {
      if (!map.getLayer(entry.plan.id)) continue
      for (const key of OPACITY_PROPERTIES[entry.plan.type]) map.setPaintProperty(entry.plan.id, key, 0)
    }
    window.setTimeout(() => {
      // The same view may have been mounted again (same layer-id prefix) while
      // this one faded out; that remount already removed it from `retiring`,
      // so this late timer must not delete the new layers.
      if (!retiring.has(mounted)) return
      retiring.delete(mounted)
      if (!destroyed) removeNow(mounted)
    }, fadeMs() + 60)
  }

  /** Main view first, then underlays top to bottom: tooltips prefer the main view. */
  function hoverOrder(): Mounted[] {
    const order = lastScene ? [lastScene.view.id, ...[...(lastScene.underlays ?? [])].reverse().map((entry) => entry.view.id)] : []
    return order.map((id) => mounted.get(id)).filter((entry): entry is Mounted => entry !== undefined)
  }

  function hoverAt(event: MapMouseEvent, pin: boolean): void {
    for (const owner of hoverOrder()) {
      const layers = owner.plans.filter((entry) => entry.plan.role === 'main' && map.getLayer(entry.plan.id)).map((entry) => entry.plan.id)
      if (layers.length === 0) continue
      for (const feature of map.queryRenderedFeatures(event.point, { layers })) {
        const plan = owner.plans.find((entry) => entry.plan.id === feature.layer.id)
        if (!plan) continue
        const lookup = owner.lookups.get(plan.layer.id)
        if (!lookup) continue
        const props = feature.properties ?? {}
        const key = String(lookup.joined ? props[TILE_ID_PROPERTY] : props[FEATURE_ID_PROPERTY])
        const row = lookup.rowsByKey.get(key)
        if (!row) continue
        map.getCanvas().style.cursor = 'pointer'
        pinned = pin
        options.onHover({ x: event.point.x, y: event.point.y, layer: plan.layer, row, pinned: pin })
        return
      }
    }
    map.getCanvas().style.cursor = ''
    if (pin || !pinned) {
      pinned = false
      options.onHover(null)
    }
  }

  function removeNow(old: Mounted): void {
    for (const marker of old.markers) marker.remove()
    for (const layer of map.getStyle()?.layers ?? []) if (layer.id.startsWith(`${old.prefix}:`)) map.removeLayer(layer.id)
    for (const source of old.sources) if (map.getSource(source)) map.removeSource(source)
  }

  function specsOf(scene: MapScene): MountSpec[] {
    const seen = new Set<string>([scene.view.id])
    const underlays: MountSpec[] = []
    for (const entry of scene.underlays ?? []) {
      if (seen.has(entry.view.id)) continue
      seen.add(entry.view.id)
      underlays.push({ ...entry, visible: null, highlight: [], main: false })
    }
    return [...underlays, { view: scene.view, rows: scene.rows, result: scene.result, visible: scene.visible, highlight: scene.highlight, main: true }]
  }

  function applyScene(scene: MapScene, fade: boolean): void {
    const specs = specsOf(scene)
    const wanted = new Set(specs.map((spec) => spec.view.id))
    for (const [id, entry] of [...mounted]) {
      if (wanted.has(id)) continue
      mounted.delete(id)
      unmount(entry, fade)
    }
    for (const spec of specs) {
      const existing = mounted.get(spec.view.id)
      if (existing) {
        update(existing, spec)
        continue
      }
      // A view returning while it still fades out is removed first (ids collide).
      for (const old of [...retiring]) {
        if (old.prefix === `dcf:${spec.view.id}`) {
          retiring.delete(old)
          removeNow(old)
        }
      }
      mounted.set(spec.view.id, mount(spec, fade))
    }
    // Stack bottom → top: each move to the top keeps the relative order within a view.
    const styleLayers = map.getStyle()?.layers ?? []
    for (const spec of specs) {
      const prefix = `dcf:${spec.view.id}:`
      for (const layer of styleLayers) if (layer.id.startsWith(prefix)) map.moveLayer(layer.id)
    }
    if (mainId !== scene.view.id) options.onHover(null)
    mainId = scene.view.id
    lastScene = scene
  }

  map.on('mousemove', (event) => hoverAt(event, false))
  map.on('click', (event) => hoverAt(event, true))
  map.on('mouseout', () => {
    if (!pinned) options.onHover(null)
  })
  for (const event of ['resize', 'styledata', 'sourcedata', 'idle'] as const) map.on(event, closeAttribution)
  map.on('style.load', () => {
    window.clearTimeout(styleTimeout)
    styleReady = true
    closeAttribution()
    const scene = pendingScene ?? lastScene
    pendingScene = null
    mounted.clear()
    retiring.clear()
    mainId = null
    if (scene) applyScene(scene, false)
  })

  return {
    setScene(scene, sceneOptions) {
      if (!styleReady) {
        pendingScene = scene
        return
      }
      applyScene(scene, sceneOptions?.fade === true && fadeMs() > 0)
    },
    setCamera(camera, animate) {
      const target = { center: camera.center, zoom: camera.zoom, bearing: camera.bearing ?? 0, pitch: camera.pitch ?? 0 }
      if (animate && !reducedMotion) map.flyTo({ ...target, duration: 1500, essential: true, curve: 1.3 })
      else map.jumpTo(target)
    },
    setTokens(next) {
      const nextTheme = next.dark ? 'dark' : 'light'
      tokens = next
      if (nextTheme !== theme) {
        theme = nextTheme
        styleReady = false
        if (lastScene) pendingScene = lastScene
        map.setStyle(options.basemap(theme), { diff: false })
        return
      }
      if (styleReady && lastScene) {
        const scene = lastScene
        for (const entry of mounted.values()) unmount(entry, false)
        mounted.clear()
        applyScene(scene, false)
      }
    },
    setReducedMotion(reduced) {
      reducedMotion = reduced
    },
    resize() {
      map.resize()
    },
    destroy() {
      destroyed = true
      window.clearTimeout(styleTimeout)
      map.remove()
    },
  }
}
