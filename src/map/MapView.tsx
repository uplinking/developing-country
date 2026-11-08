import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import maplibregl from 'maplibre-gl'
import { Protocol } from 'pmtiles'
import type { FeatureCollection } from 'geojson'
import 'maplibre-gl/dist/maplibre-gl.css'

import { BASEMAP_THEME, INITIAL_VIEW, MAP_MAX_BOUNDS, MAP_MAX_ZOOM, MAP_MIN_ZOOM, TILE_BASE } from '../config'
import { withBase } from '../base'
import { getBaseStyle, prefersDark } from './basemap'
import { onThemeChange as onAppThemeChange } from '../theme'
import {
  LAYER_GROUPS, groupUnits, isGroupAvailable, type LayerGroup,
  CLIMATE_VARIABLES, CLIMATE_SOURCE_ID, climateFillLayers, climateLayerId, isClimateAvailable,
  DEMOGRAPHICS_SOURCE_ID, POP_LEVELS, populationLayers, popLayerId, isDemographicsAvailable,
  type OverlaySource, type PopLevelId,
} from './layers'
import { registerMapIcons } from './icons'
import { formatFeature, formatClimate, formatPopulation } from './featureFormat'
import { cameraFromDeepLink } from './queryCamera'
import { loadApiLayer, type ApiLayerContext } from './apiLayers'
import { isMcpApp } from '../mcpMode'
import { initialGeoJsonData, loadLazyGeoJson } from './lazyGeoJson'
import { sunRays, sunRayAt, sunPositionAt, noonAzimuth } from './sun'
import type { ApiLayerStatus, ClimateState, FeatureInfo, LngLat, VisibilityState } from '../types'
import type { JsonFc } from '../shared/stage'
import type { MapHandle } from './stagePlayer'

type ClickFn = (info: FeatureInfo | null) => void
type ApiStatusFn = (id: string, status: ApiLayerStatus) => void
type ApiLayerGroup = LayerGroup & { source: Extract<OverlaySource, { type: 'api' }> }

declare global {
  interface Window {
    __map?: maplibregl.Map
  }
}

// Register the pmtiles:// protocol once for the whole app.
const protocol = new Protocol()
maplibregl.addProtocol('pmtiles', protocol.tile)

// Bottom -> top stacking order so relief/fills sit under the road/water lines.
// Climate fills are inserted just above hillshade (see the load handler).
const STACK_ORDER = [
  'hillshade',
  'land-cover-grid',
  'population-change',
  'parks',
  'sea-routes',
  'water',
  'roads',
  'expressways',
  'metro_catchment',
  'metro',
  'boi-zones',
  'developments',
  'trails',
  'cycling',
  'attractions',
  'waterfalls',
  'irrigation-gauges',
  'schools',
  'hospitals',
  'stepper',
  'analyses',
  'prospects',
]

function orderedGroups(): LayerGroup[] {
  const byId = new Map(LAYER_GROUPS.map((g) => [g.id, g]))
  return STACK_ORDER.map((id) => byId.get(id)).filter(
    (g): g is LayerGroup => !!g && isGroupAvailable(g),
  )
}

interface MapViewProps {
  visibility: VisibilityState
  climate: ClimateState
  /** Population choropleth level, or null = off. */
  population: PopLevelId | null
  terrain3D: boolean
  onFeatureClick: (info: FeatureInfo | null) => void
  sunActive: boolean
  sunPoint: LngLat | null
  sunDate: Date
  onSunPick: (p: LngLat) => void
  analyzeActive: boolean
  analyzePoint: LngLat | null
  onAnalyzePick: (p: LngLat) => void
  onApiLayerStatus: ApiStatusFn
  /** Bump to re-fetch API-backed layers (e.g. after sign-in/out). */
  reloadApiKey: number
  /** A Better Auth session exists; session-only layers are skipped without one. */
  signedIn: boolean
  /** Optional camera for small, reusable map embeds. */
  initialView?: Readonly<{ longitude: number; latitude: number; zoom: number }>
  /** Keep article embeds visually pure while preserving attribution. */
  showNavigation?: boolean
  ref?: Ref<MapHandle>
}

export default function MapView({
  visibility,
  climate,
  population,
  terrain3D,
  onFeatureClick,
  sunActive,
  sunPoint,
  sunDate,
  onSunPick,
  analyzeActive,
  analyzePoint,
  onAnalyzePick,
  onApiLayerStatus,
  reloadApiKey,
  signedIn,
  initialView,
  showNavigation = true,
  ref,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const readyRef = useRef(false)
  const [loading, setLoading] = useState(true)
  // Keep latest callbacks/flags without re-running the mount effect.
  const clickRef = useRef(onFeatureClick)
  clickRef.current = onFeatureClick
  const sunActiveRef = useRef(sunActive)
  sunActiveRef.current = sunActive
  const sunPickRef = useRef(onSunPick)
  sunPickRef.current = onSunPick
  const climateRef = useRef(climate)
  climateRef.current = climate
  const populationRef = useRef(population)
  populationRef.current = population
  const analyzeActiveRef = useRef(analyzeActive)
  analyzeActiveRef.current = analyzeActive
  const analyzePickRef = useRef(onAnalyzePick)
  analyzePickRef.current = onAnalyzePick
  const apiStatusRef = useRef(onApiLayerStatus)
  apiStatusRef.current = onApiLayerStatus
  const apiContextRef = useRef<ApiLayerContext>({ signedIn, mcpApp: false })
  apiContextRef.current = { signedIn, mcpApp: isMcpApp() }
  const visibilityRef = useRef(visibility)
  visibilityRef.current = visibility
  const readyWaiters = useRef<Array<() => void>>([])
  const flushReady = () => {
    readyRef.current = true
    const q = readyWaiters.current
    readyWaiters.current = []
    for (const w of q) w()
  }

  useImperativeHandle(ref, () => ({
    flyTo(lng, lat, zoom, durationMs) {
      const map = mapRef.current
      if (!map) return Promise.resolve()
      return new Promise((resolve) => {
        map.once('moveend', () => resolve())
        map.flyTo({ center: [lng, lat], zoom: zoom ?? map.getZoom(), duration: durationMs ?? 800 })
      })
    },
    setHighlight(layer, ids) {
      const map = mapRef.current
      if (!map) return
      const fill = popLayerId(layer)
      if (!map.getLayer(fill)) return
      if (ids.length === 0) {
        map.setFilter(fill, null)
        if (map.getLayer(`${fill}-line`)) map.setFilter(`${fill}-line`, null)
        return
      }
      // Current demographics.pmtiles omit properties.id — a matching filter
      // plus force-visible blanks the choropleth. No-op until tiles carry id.
      const sample = map.querySourceFeatures(DEMOGRAPHICS_SOURCE_ID, { sourceLayer: layer })
      const hasId = sample.some((f) => f.properties?.id != null && String(f.properties.id) !== '')
      if (!hasId) {
        console.warn('[map] GND highlight skipped: demographics tiles have no id property')
        return
      }
      const filter: maplibregl.FilterSpecification = ['in', ['get', 'id'], ['literal', ids]]
      map.setFilter(fill, filter)
      if (map.getLayer(`${fill}-line`)) map.setFilter(`${fill}-line`, filter)
      map.setLayoutProperty(fill, 'visibility', 'visible')
      if (map.getLayer(`${fill}-line`)) map.setLayoutProperty(`${fill}-line`, 'visibility', 'visible')
    },
    highlightStop(stopName) {
      const map = mapRef.current
      if (!map) return
      highlightStopCatchment(map, stopName)
    },
    setDraw(fc) {
      const map = mapRef.current
      if (!map) return
      geoJsonSource(map, 'agent-draw')?.setData(asFeatureCollection(fc ?? EMPTY_FC))
    },
    setIsochroneStreets(fc) {
      const map = mapRef.current
      if (!map) return
      geoJsonSource(map, 'agent-isochrone')?.setData(asFeatureCollection(fc ?? EMPTY_FC))
    },
    lastCenter() {
      const map = mapRef.current
      if (!map) return { lng: INITIAL_VIEW.longitude, lat: INITIAL_VIEW.latitude }
      const c = map.getCenter()
      return { lng: c.lng, lat: c.lat }
    },
    whenReady() {
      if (readyRef.current && mapRef.current) return Promise.resolve()
      return new Promise<void>((resolve) => {
        readyWaiters.current.push(resolve)
      })
    },
  }))

  // Bumped after the basemap style is swapped for a theme change. setStyle wipes
  // custom sources/layers, so buildOverlays re-adds them and this makes the
  // imperative sun / analyze / terrain effects re-apply their transient state.
  const [themeVersion, setThemeVersion] = useState(0)

  // --- Mount: create the map and add overlays once the base style loads -----
  useEffect(() => {
    if (!containerRef.current) return
    const camera = initialView ?? INITIAL_VIEW

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: getBaseStyle(),
      center: [camera.longitude, camera.latitude],
      zoom: camera.zoom,
      maxBounds: MAP_MAX_BOUNDS,
      minZoom: MAP_MIN_ZOOM,
      maxZoom: MAP_MAX_ZOOM,
      maxPitch: 75,
      // No cooperativeGestures: the map IS the page, so there is nothing behind
      // it to scroll past. Requiring ctrl/⌘+scroll to zoom was pure friction.
      cooperativeGestures: false,
      attributionControl: false,
    })
    mapRef.current = map
    // Expose the map for debugging/automation (harmless read handle).
    window.__map = map

    // Controls stack bottom-right in add order. The top strip belongs to the
    // centred chrome bar, and the bottom-LEFT belongs to the layer panel (which
    // is bottom-anchored so it collapses downward). The scale bar is the one
    // exception: a ruler reads best against the middle of the map, so it gets a
    // bottom-centre slot of its own (MapLibre has none).
    if (showNavigation) {
      map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right')
      const scaleSlot = document.createElement('div')
      scaleSlot.className = 'maplibregl-ctrl-bottom-center'
      scaleSlot.appendChild(new maplibregl.ScaleControl({ unit: 'metric', maxWidth: 140 }).onAdd(map))
      map.getContainer().querySelector('.maplibregl-control-container')?.appendChild(scaleSlot)
    }
    map.addControl(
      // Compact: collapsed behind an ⓘ. The contents are licence obligations
      // (ODbL et al) so they are trimmed and tucked, never dropped; per-dataset
      // provenance lives in each layer's "i" popover.
      new maplibregl.AttributionControl({ compact: true, customAttribution: 'developing-country.org' }),
      'bottom-right',
    )
    // MapLibre renders the compact attribution as a <details> and opens it
    // itself — on load and again on resize — so it fans the whole credit list
    // across the map. CSS can't win against a programmatically set `open`, so
    // close it here. The credits stay one click away (licence obligation); the
    // resting state is just "dc ⓘ".
    const collapseAttribution = () => {
      containerRef.current
        ?.querySelector('details.maplibregl-ctrl-attrib')
        ?.removeAttribute('open')
    }
    collapseAttribution()
    map.on('resize', collapseAttribution)

    map.on('load', () => {
      // Add every overlay source/layer and restore persistent state.
      buildOverlays(map, visibilityRef.current, climateRef.current, populationRef.current, apiStatusRef, apiContextRef)
      // Wire interactions ONCE — delegated (map.on('click', layerId, …)) handlers
      // survive a later setStyle, so a theme swap must not re-register them.
      wireInteractions(map, clickRef, sunActiveRef, analyzeActiveRef, climateRef, populationRef)
      // In sun / analyze mode, any map click picks the spot to read.
      map.on('click', (e) => {
        const p = { lng: e.lngLat.lng, lat: e.lngLat.lat }
        if (analyzeActiveRef.current) analyzePickRef.current(p)
        else if (sunActiveRef.current) sunPickRef.current(p)
      })
      // (buildOverlays already kicked off loadApiLayers to fill runtime sources.)
      // Deep-link: tool results (add_prospect / analyze) hand back
      // a canonical /?lat=&lng= URL. If present, recentre the map on that point so
      // the link actually lands somewhere. Just a camera move — no routing scheme.
      centerFromQuery(map)
      map.resize()
      map.once('idle', flushReady)
    })

    // Hide the loading overlay once tiles render, or after a max wait so a slow
    // basemap doesn't leave the spinner up indefinitely.
    map.once('idle', () => setLoading(false))
    const loadingFallback = setTimeout(() => setLoading(false), 4000)

    // Keep the canvas matched to its container (MapLibre only tracks window
    // resize by default, so a late layout leaves the canvas at its fallback size).
    const ro = new ResizeObserver(() => map.resize())
    ro.observe(containerRef.current)

    // Swallow tile-fetch errors (e.g. a pipeline layer whose PMTiles isn't
    // uploaded yet) so they don't spam the console or break the map.
    map.on('error', (e) => {
      const msg = e.error?.message ?? ''
      if (/pmtiles|\.pmtiles|Failed to fetch/i.test(msg)) return
      console.warn('[map]', msg)
    })

    // MCP hosts may change the applied theme while this view is open. In auto
    // mode, keep the basemap matched to that host theme. setStyle drops every
    // custom source/layer, so rebuild the overlays after the new style loads.
    const themeDriven = BASEMAP_THEME === 'auto'
    let appliedDark = prefersDark()
    const onThemeSwap = () => {
      // Attribute observers can report an applied value that resolves to the
      // same theme. setStyle is expensive and drops every overlay, so skip it.
      const nextDark = prefersDark()
      if (nextDark === appliedDark) return
      appliedDark = nextDark
      readyRef.current = false
      map.setStyle(getBaseStyle())
      map.once('style.load', () => {
        buildOverlays(map, visibilityRef.current, climateRef.current, populationRef.current, apiStatusRef, apiContextRef)
        map.once('idle', () => {
          flushReady()
          setThemeVersion((v) => v + 1)
        })
      })
    }
    // Subscribe to the host-applied theme rather than maintaining another
    // independent theme preference inside the explorer.
    const unsubscribeTheme = themeDriven ? onAppThemeChange(onThemeSwap) : null

    return () => {
      readyRef.current = false
      clearTimeout(loadingFallback)
      ro.disconnect()
      unsubscribeTheme?.()
      map.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --- Visibility toggles ---------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    applyVisibility(map, visibility)
  }, [visibility])

  // --- Re-fetch API-backed layers on auth change ----------------------------
  // reloadApiKey bumps when the signed-in identity changes; skip the initial
  // mount (the map's own load handler already does the first fetch).
  const didInitApiRef = useRef(false)
  useEffect(() => {
    if (!didInitApiRef.current) {
      didInitApiRef.current = true
      return
    }
    const map = mapRef.current
    if (!map || !readyRef.current) return
    void loadApiLayers(map, apiStatusRef, apiContextRef.current)
  }, [reloadApiKey])

  // --- Climate variable / month --------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    applyClimate(map, climate)
  }, [climate])

  // --- Population choropleth level ------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    applyPopulation(map, population)
  }, [population])

  // --- Sun rays + hillshade illumination ------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    const src = geoJsonSource(map, 'sun')
    const liveSrc = geoJsonSource(map, 'sun-live')
    const show = sunActive && sunPoint
    for (const id of ['sun-rays', 'sun-point', 'sun-shadow-live', 'sun-ray-live']) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', show ? 'visible' : 'none')
    }
    if (show && src) {
      // Faint sunrise/noon/sunset arc for context …
      src.setData(sunRays(sunPoint.lng, sunPoint.lat, sunDate))
      // … and the bright live ray + shadow at the current date-TIME.
      if (liveSrc) liveSrc.setData(sunRayAt(sunPoint.lng, sunPoint.lat, sunDate))
      // Light the hillshade from the live sun direction while it's up, else noon.
      if (map.getLayer('hillshade')) {
        const pos = sunPositionAt(sunPoint.lng, sunPoint.lat, sunDate)
        const az = pos.altitude > 0 ? pos.azimuth : noonAzimuth(sunPoint.lng, sunPoint.lat, sunDate)
        map.setPaintProperty('hillshade', 'hillshade-illumination-direction', Math.round(az))
      }
    }
    // themeVersion: re-apply after a theme swap rebuilt the sun layers.
  }, [sunActive, sunPoint, sunDate, themeVersion])

  // --- Analyze marker -------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    const src = geoJsonSource(map, 'analyze')
    const show = analyzeActive && analyzePoint
    for (const id of ['analyze-halo', 'analyze-point']) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', show ? 'visible' : 'none')
    }
    if (show && src) {
      src.setData({
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [analyzePoint.lng, analyzePoint.lat] } },
        ],
      })
    }
    // themeVersion: re-apply after a theme swap rebuilt the analyze layers.
  }, [analyzeActive, analyzePoint, themeVersion])

  // --- 3D terrain toggle ----------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    const apply = () => {
      if (terrain3D && map.getSource('hillshade')) {
        map.setTerrain({ source: 'hillshade', exaggeration: 1.4 })
        if (map.getPitch() < 20) map.easeTo({ pitch: 55, duration: 600 })
      } else {
        map.setTerrain(null)
        if (map.getPitch() > 0) map.easeTo({ pitch: 0, duration: 600 })
      }
    }
    if (map.isStyleLoaded()) apply()
    else map.once('idle', apply)
    // themeVersion: the new style dropped the terrain source — re-apply it.
  }, [terrain3D, themeVersion])

  return (
    <>
      <div ref={containerRef} className="map-root" />
      {loading && (
        <div className="map-loading">
          <span className="loading-mark">developing-country.org</span>
          <span className="loading-tape" aria-hidden="true" />
          <span>Loading map…</span>
        </div>
      )}
    </>
  )
}

// --- helpers ---------------------------------------------------------------

// Add every overlay source/layer onto the current style and restore the state
// that lives in props (visibility, climate) plus the runtime-fetched data.
// Run on first load AND after a theme swap, since setStyle discards custom
// sources/layers. Each add* is guarded on getSource, so it's safe either way.
// Deliberately does NOT wire interactions — those handlers survive setStyle and
// re-registering them would fire clicks twice.
function buildOverlays(
  map: maplibregl.Map,
  visibility: VisibilityState,
  climate: ClimateState,
  population: PopLevelId | null,
  apiStatusRef: { current: ApiStatusFn },
  apiContextRef: { current: ApiLayerContext },
) {
  // Marker artwork FIRST: setStyle drops images along with sources and layers,
  // so every rebuild must re-register them, and it must happen before addLayer
  // or MapLibre logs "image not found" for every icon-image it can't resolve.
  // registerMapIcons is synchronous (Path2D + canvas), so this ordering holds.
  registerMapIcons(map)
  for (const group of orderedGroups()) {
    addGroup(map, group)
    // Climate fills sit just above the relief, under demographics/roads.
    if (group.id === 'hillshade') addClimate(map)
  }
  // If hillshade wasn't in the stack for some reason, still add climate.
  addClimate(map)
  addDemographics(map)
  addCatchmentHighlight(map)
  applyVisibility(map, visibility)
  applyClimate(map, climate)
  applyPopulation(map, population)
  addSunLayers(map)
  addAnalyzeLayers(map)
  addAgentLayers(map)
  // Runtime-fetched layers (stepper / prospects / issues / analyses): fill their
  // empty sources, reporting count/ok back so the panel can badge them.
  void loadApiLayers(map, apiStatusRef, apiContextRef.current)
}

// --- Per-stop walk catchment reveal -----------------------------------------
// Clicking a metro stop reveals ITS OWN 5/10-min walkshed + last-mile ring,
// independent of the "Metro walk coverage" blanket toggle. These highlight
// layers live on the metro_catchment source but outside the group/visibility
// model (like sun/analyze) — they're driven by clicks, filtered to one stop.

const CATCHMENT_NONE = ' none ' // a stop name nothing matches

/** Filter for one stop's highlight layer. Streets are selected by walk band
 *  (via `d` = metres-from-stop); `lastmile` is the feeder ring. */
function hlFilter(stop: string, part: 'walk5' | 'walk10' | 'lastmile'): maplibregl.FilterSpecification {
  if (part === 'lastmile') return ['all', ['==', ['get', 'kind'], 'lastmile'], ['==', ['get', 'stop'], stop]]
  const dCond: maplibregl.ExpressionSpecification =
    part === 'walk5' ? ['<=', ['get', 'd'], 400] : ['>', ['get', 'd'], 400]
  return ['all', ['==', ['get', 'kind'], 'stop'], ['==', ['get', 'stop'], stop], dCond]
}

function addCatchmentHighlight(map: maplibregl.Map) {
  if (!map.getSource('metro_catchment') || map.getLayer('metro-hl-last')) return
  const none = CATCHMENT_NONE
  map.addLayer({
    id: 'metro-hl-last', type: 'line', source: 'metro_catchment', filter: hlFilter(none, 'lastmile'),
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#f59e0b', 'line-width': 1.6, 'line-dasharray': [2, 2], 'line-opacity': 0.9 },
  })
  // The selected stop's streets, brighter + wider than the blanket so they pop.
  map.addLayer({
    id: 'metro-hl-10', type: 'line', source: 'metro_catchment', filter: hlFilter(none, 'walk10'),
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#0d9488', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1.4, 15, 3.5], 'line-opacity': 0.95 },
  })
  map.addLayer({
    id: 'metro-hl-5', type: 'line', source: 'metro_catchment', filter: hlFilter(none, 'walk5'),
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#5eead4', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1.8, 15, 4.2] },
  })
}

/** Reveal one stop's catchment streets + last-mile ring, or clear (stop === null). */
function highlightStopCatchment(map: maplibregl.Map, stop: string | null) {
  const s = stop ?? CATCHMENT_NONE
  for (const [id, part] of [
    ['metro-hl-last', 'lastmile'],
    ['metro-hl-10', 'walk10'],
    ['metro-hl-5', 'walk5'],
  ] as const) {
    if (map.getLayer(id)) map.setFilter(id, hlFilter(s, part))
  }
}

// Apply per-unit visibility (a unit is a whole group, or one tier within a
// perLayerToggle group like roads).
function applyVisibility(map: maplibregl.Map, visibility: VisibilityState) {
  for (const group of LAYER_GROUPS) {
    if (!isGroupAvailable(group)) continue
    const units = groupUnits(group)
    if (
      group.source.type === 'geojson' &&
      group.source.lazy &&
      units.some((unit) => visibility[unit.id] ?? unit.defaultVisible)
    ) {
      void materializeLazyGroup(map, group)
    }
    for (const unit of units) {
      const visible = visibility[unit.id] ?? unit.defaultVisible
      for (const id of unit.layerIds) {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none')
      }
    }
  }
}

// Add the climate source + all 39 fill layers (hidden). applyClimate shows one.
function addClimate(map: maplibregl.Map) {
  if (!isClimateAvailable() || map.getSource(CLIMATE_SOURCE_ID)) return
  map.addSource(CLIMATE_SOURCE_ID, {
    type: 'vector',
    url: `pmtiles://${TILE_BASE}/climate.pmtiles`,
    attribution: 'WorldClim 2.1',
  })
  for (const layer of climateFillLayers()) {
    map.addLayer(withSource(layer, CLIMATE_SOURCE_ID))
  }
}

// Show only the fill layer matching the selected variable + month; hide the rest.
function applyClimate(map: maplibregl.Map, climate: ClimateState) {
  for (const v of CLIMATE_VARIABLES) {
    for (let m = 0; m <= 12; m++) {
      const id = climateLayerId(v.id, m)
      if (!map.getLayer(id)) continue
      const visible = climate.variable === v.id && climate.month === m
      map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none')
    }
  }
}

// --- Population choropleth (demographics.pmtiles, one layer per level) -------
function addDemographics(map: maplibregl.Map) {
  if (!isDemographicsAvailable() || map.getSource(DEMOGRAPHICS_SOURCE_ID)) return
  // Serve via the pmtiles protocol (Range GETs) — the same proven path roads /
  // water / climate use. An earlier optimisation pointed this at the per-tile
  // /xyz endpoint for pan-caching; those tiles are valid MVT, but MapLibre parsed
  // ZERO features from them, so the choropleth silently never rendered. pmtiles://
  // parses correctly. Zoom range comes from the archive metadata (z4–14, now
  // contiguous after the tile-join --no-tile-size-limit fix).
  map.addSource(DEMOGRAPHICS_SOURCE_ID, {
    type: 'vector',
    url: `pmtiles://${TILE_BASE}/demographics.pmtiles`,
    attribution: 'Census 2024 · DCS via nuuuwan/lk_census_2024 + gig-data',
    promoteId: 'id',
  })
  for (const layer of populationLayers()) {
    map.addLayer(withSource(layer, DEMOGRAPHICS_SOURCE_ID))
  }
}

// Show only the selected level's fill + outline; hide the rest.
function applyPopulation(map: maplibregl.Map, level: PopLevelId | null) {
  for (const l of POP_LEVELS) {
    const on = level === l.id
    for (const id of [popLayerId(l.id), `${popLayerId(l.id)}-line`]) {
      if (!map.getLayer(id)) continue
      if (!on) map.setFilter(id, null)
      map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
    }
  }
}

// Sun-path rays + the analysed point (driven imperatively from the sun effect).
function addSunLayers(map: maplibregl.Map) {
  if (map.getSource('sun')) return
  map.addSource('sun', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  // Second source: the live (animated) ray + shadow at the current time.
  map.addSource('sun-live', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  // The shadow sits at the bottom — a dark, wide, semi-transparent streak.
  map.addLayer({
    id: 'sun-shadow-live',
    type: 'line',
    source: 'sun-live',
    filter: ['==', ['get', 'kind'], 'shadow'],
    layout: { visibility: 'none', 'line-cap': 'round' },
    paint: { 'line-width': 9, 'line-color': '#0b1220', 'line-opacity': 0.35, 'line-blur': 2 },
  })
  // Faint sunrise/noon/sunset arc, now just context under the live ray.
  map.addLayer({
    id: 'sun-rays',
    type: 'line',
    source: 'sun',
    filter: ['==', ['geometry-type'], 'LineString'],
    layout: { visibility: 'none', 'line-cap': 'round' },
    paint: {
      'line-width': ['match', ['get', 'kind'], 'noon', 3, 2],
      'line-color': ['match', ['get', 'kind'], 'sunrise', '#fb923c', 'noon', '#f59e0b', 'sunset', '#ef4444', '#f59e0b'],
      'line-opacity': 0.3,
      'line-dasharray': [2, 2],
    },
  })
  // The bright live sun ray — teal --brand — pointing at the sun right now.
  map.addLayer({
    id: 'sun-ray-live',
    type: 'line',
    source: 'sun-live',
    filter: ['==', ['get', 'kind'], 'sun'],
    layout: { visibility: 'none', 'line-cap': 'round' },
    paint: { 'line-width': 3.5, 'line-color': '#14b8a6', 'line-opacity': 0.95 },
  })
  map.addLayer({
    id: 'sun-point',
    type: 'circle',
    source: 'sun',
    filter: ['==', ['geometry-type'], 'Point'],
    layout: { visibility: 'none' },
    paint: { 'circle-radius': 5, 'circle-color': '#111827', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' },
  })
}

// Analyze marker: a pulsing halo + a dark pin at the point being analysed.
const EMPTY_FC: JsonFc = { type: 'FeatureCollection', features: [] }

function addAgentLayers(map: maplibregl.Map) {
  if (map.getSource('agent-draw')) return
  map.addSource('agent-draw', { type: 'geojson', data: asFeatureCollection(EMPTY_FC) })
  map.addSource('agent-isochrone', { type: 'geojson', data: asFeatureCollection(EMPTY_FC) })
  map.addLayer({
    id: 'agent-draw-fill',
    type: 'fill',
    source: 'agent-draw',
    paint: { 'fill-color': '#0f766e', 'fill-opacity': 0.12 },
  })
  map.addLayer({
    id: 'agent-draw-line',
    type: 'line',
    source: 'agent-draw',
    paint: { 'line-color': '#0f766e', 'line-width': 2, 'line-opacity': 0.9 },
  })
  map.addLayer({
    id: 'agent-isochrone-10',
    type: 'line',
    source: 'agent-isochrone',
    filter: ['>', ['coalesce', ['get', 'd'], 0], 400],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#0f766e',
      'line-opacity': 0.85,
      'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.6, 15, 2.4],
    },
  })
  map.addLayer({
    id: 'agent-isochrone-5',
    type: 'line',
    source: 'agent-isochrone',
    filter: ['<=', ['coalesce', ['get', 'd'], 0], 400],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#2dd4bf',
      'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.9, 15, 3],
    },
  })
}

function addAnalyzeLayers(map: maplibregl.Map) {
  if (map.getSource('analyze')) return
  map.addSource('analyze', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  map.addLayer({
    id: 'analyze-halo',
    type: 'circle',
    source: 'analyze',
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 14, 13, 26],
      'circle-color': '#0f766e',
      'circle-opacity': 0.15,
    },
  })
  map.addLayer({
    id: 'analyze-point',
    type: 'circle',
    source: 'analyze',
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': 6,
      'circle-color': '#0f766e',
      'circle-stroke-width': 3,
      'circle-stroke-color': '#ffffff',
    },
  })
}

// Fetch every api-backed group's data and push it into the (already-added)
// empty GeoJSON source. Never throws — reports ok/count per layer instead.
async function loadApiLayers(map: maplibregl.Map, statusRef: { current: ApiStatusFn }, context: ApiLayerContext) {
  const apiGroups = LAYER_GROUPS.filter(isApiLayerGroup)
  await Promise.all(
    apiGroups.map(async (g) => {
      statusRef.current(g.id, { loading: true, ok: false, count: 0 })
      const result = await loadApiLayer(g.id, g.source, context)
      const src = geoJsonSource(map, g.id)
      if (src) src.setData(result.data)
      statusRef.current(g.id, { loading: false, ok: result.ok, count: result.count, reason: result.reason, stale: result.stale })
    }),
  )
}

// Recentre from a ?lat=&lng= deep-link (optional &z= zoom). No-op when absent or
// malformed. Kept deliberately tiny — it's a camera hint, not a router.
function centerFromQuery(map: maplibregl.Map) {
  const camera = cameraFromDeepLink(window.location.search)
  if (!camera) return
  map.flyTo({ center: [camera.longitude, camera.latitude], zoom: camera.zoom, duration: 0 })
}

function addGroup(map: maplibregl.Map, group: LayerGroup) {
  const src = group.source
  if (map.getSource(group.id)) return

  if (src.type === 'geojson') {
    // A default-off multi-megabyte artifact must not compete with the basemap
    // during first paint. Lazy groups begin empty; applyVisibility materializes
    // one only after the user (or an explicit embed state) turns it on.
    map.addSource(group.id, {
      type: 'geojson',
      data: initialGeoJsonData(withBase(src.url), src.lazy === true),
      attribution: group.attribution,
    })
    if (src.lazy) lazyMaterialized.get(map)?.delete(group.id)
  } else if (src.type === 'api') {
    // Empty for now; loadApiLayers() fills it after fetching the endpoint.
    map.addSource(group.id, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      attribution: group.attribution,
    })
  } else if (src.type === 'vector-pmtiles') {
    map.addSource(group.id, {
      type: 'vector',
      url: `pmtiles://${TILE_BASE}/${src.file}`,
      attribution: group.attribution,
    })
  } else if (src.type === 'raster-dem') {
    map.addSource(group.id, {
      type: 'raster-dem',
      tiles: [src.tiles],
      encoding: src.encoding,
      tileSize: 256,
      maxzoom: 13,
      attribution: group.attribution,
    })
  }

  for (const layer of group.render) {
    // Add hidden; applyVisibility() sets the correct state right after.
    const spec = withSource({
      ...layer,
      layout: { ...(layer.layout ?? {}), visibility: 'none' },
    }, group.id)
    map.addLayer(spec)
  }
}

const lazyMaterialized = new WeakMap<maplibregl.Map, Set<string>>()

async function materializeLazyGroup(map: maplibregl.Map, group: LayerGroup) {
  const src = group.source
  if (src.type !== 'geojson' || !src.lazy) return
  let loaded = lazyMaterialized.get(map)
  if (!loaded) {
    loaded = new Set()
    lazyMaterialized.set(map, loaded)
  }
  if (loaded.has(group.id)) return
  loaded.add(group.id)
  try {
    const data = await loadLazyGeoJson(withBase(src.url))
    // The map can disappear or swap styles while the request is in flight.
    // Only write when this style still owns the expected GeoJSON source.
    geoJsonSource(map, group.id)?.setData(data)
  } catch (error) {
    loaded.delete(group.id)
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[map] ${group.label} unavailable: ${message}`)
  }
}

function isApiLayerGroup(group: LayerGroup): group is ApiLayerGroup {
  return group.source.type === 'api'
}

function geoJsonSource(map: maplibregl.Map, id: string): maplibregl.GeoJSONSource | undefined {
  const source = map.getSource(id)
  return source instanceof maplibregl.GeoJSONSource ? source : undefined
}

function asFeatureCollection(value: JsonFc): FeatureCollection {
  const collection: FeatureCollection = JSON.parse(JSON.stringify(value))
  return collection
}

function withSource(layer: import('./layers').RenderLayer, source: string): maplibregl.LayerSpecification {
  const specification: maplibregl.LayerSpecification = JSON.parse(JSON.stringify({ ...layer, source }))
  return specification
}

function wireInteractions(
  map: maplibregl.Map,
  clickRef: { current: ClickFn },
  sunActiveRef: { current: boolean },
  analyzeActiveRef: { current: boolean },
  climateRef: { current: ClimateState },
  populationRef: { current: PopLevelId | null },
) {
  const interactiveLayerIds: { layerId: string; group: LayerGroup }[] = []
  for (const group of LAYER_GROUPS) {
    if (!group.interactive || !isGroupAvailable(group)) continue
    for (const layer of group.render) interactiveLayerIds.push({ layerId: layer.id, group })
  }

  for (const { layerId, group } of interactiveLayerIds) {
    map.on('click', layerId, (e) => {
      // sun / analyze mode: clicks pick the point to read, not features
      if (sunActiveRef.current || analyzeActiveRef.current) return
      const f = e.features?.[0]
      if (!f) return
      // Clicking a metro stop reveals its walk catchment; any other feature clears it.
      const p = f.properties ?? {}
      highlightStopCatchment(map, group.id === 'metro' && p.kind === 'stop' ? String(p.name) : null)
      clickRef.current?.(formatFeature(group.id, group.label, p, e.lngLat))
    })
    map.on('mouseenter', layerId, () => (map.getCanvas().style.cursor = 'pointer'))
    map.on('mouseleave', layerId, () => (map.getCanvas().style.cursor = ''))
  }

  // General click: if nothing higher-priority was hit, read the climate value
  // under the cursor (if a climate layer is showing), else close the sheet.
  map.on('click', (e) => {
    if (sunActiveRef.current || analyzeActiveRef.current) return
    const groupHits = map.queryRenderedFeatures(e.point, {
      layers: interactiveLayerIds.map((l) => l.layerId).filter((id) => map.getLayer(id)),
    })
    if (groupHits.length > 0) return // handled by the per-layer handler above
    highlightStopCatchment(map, null) // empty-map click clears any revealed catchment

    // Population choropleth: read the division under the cursor.
    const level = populationRef.current
    if (level) {
      const id = popLayerId(level)
      const hit = map.getLayer(id) ? map.queryRenderedFeatures(e.point, { layers: [id] })[0] : undefined
      if (hit) {
        clickRef.current?.(formatPopulation(level, hit.properties ?? {}, e.lngLat))
        return
      }
    }

    const { variable, month } = climateRef.current
    if (variable) {
      const id = climateLayerId(variable, month)
      const hit = map.getLayer(id)
        ? map.queryRenderedFeatures(e.point, { layers: [id] })[0]
        : undefined
      if (hit) {
        clickRef.current?.(formatClimate(variable, month, hit.properties ?? {}, e.lngLat))
        return
      }
    }
    clickRef.current?.(null)
  })
}
