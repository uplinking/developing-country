import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useApp, useHostStyleVariables } from '@modelcontextprotocol/ext-apps/react'
import type { App as McpApp, McpUiHostContext } from '@modelcontextprotocol/ext-apps'
import FeatureSheet from './ui/FeatureSheet'
import LayerPanel from './ui/LayerPanel'
import AnalyzeSheet from './ui/AnalyzeSheet'
import { playEnvelope, type MapHandle, type StagePlayerHost } from './map/stagePlayer'
import { useMapEngine } from './useMapEngine'
import type { AnalyzeResult } from './map/analyzeClient'
import { withBase } from './base'
import { bodyFromResult, mcpBeacon, modelContextFromFeature, type ToolBody } from './mcpResult'
import type { JsonObject } from './shared/json'
import { isJsonNumber, isJsonObject, jsonObjectFromSerializable } from './shared/json'
import { MCP_APP_VERSION } from './shared/mcpApp'
import { BrandMark } from '@developing-country/ui/BrandMark'
import { dataPanelKind, expectsMap, rawFromResult } from './mcpData'
import { inlineHeight, safeAreaVars } from './mcpLayout'
import { canRequestFullscreen, extensionMaxHeight, openExternalLink, requestDisplayMode } from './hostExtensions'
import './App.css'
import type { DataViewSpec } from '@developing-country/views'

// MapLibre, its style and tiles are the heaviest part of the frame. Data
// answers never touch them, so the map chunk loads only when a result needs it.
const loadMapView = () => import('./map/MapView')
const MapView = lazy(loadMapView)
const LiveChart = lazy(() => import('./views/LiveChart'))
const McpDataPanel = lazy(() => import('./ui/McpDataPanel'))

function applyTheme(ctx: McpUiHostContext | undefined) {
  if (!ctx?.theme) return
  document.documentElement.setAttribute('data-theme', ctx.theme)
}

function applySafeArea(ctx: McpUiHostContext | undefined) {
  const style = document.documentElement.style
  for (const [name, value] of safeAreaVars(ctx)) style.setProperty(name, value)
}

function syncInlineSize(app: McpApp, data = false) {
  const ctx = app.getHostContext()
  if (ctx?.displayMode && ctx.displayMode !== 'inline') return
  void app.sendSizeChanged({ height: inlineHeight(ctx, data, window.innerWidth, extensionMaxHeight()) })
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function isAnalyzeBody(body: ToolBody): body is ToolBody & AnalyzeResult {
  return Boolean(body.location && (body.district_demographics !== undefined || body.summary))
}

export default function AppMcp() {
  const {
    mapHandle,
    visibility,
    toggle,
    setMany,
    climate,
    setClimate,
    setClimateVariable,
    setClimateMonth,
    animating,
    setAnimating,
    popLevel,
    setPopLevel,
    feature,
    setFeature,
    sunDate,
    analyzePoint,
    setAnalyzePoint,
    analyzeResult,
    setAnalyzeResult,
    analyzeLoading,
    setAnalyzeLoading,
    analyzeError,
    setAnalyzeError,
    exitAnalyze,
    apiStatus,
    onApiLayerStatus,
  } = useMapEngine()
  const [webUrl, setWebUrl] = useState(withBase('/'))
  const [dataView, setDataView] = useState<DataViewSpec | null>(null)
  const [chartRows, setChartRows] = useState<JsonObject[]>([])
  // Dataset browser / Indicator Table results own the whole view.
  const [dataResult, setDataResult] = useState<{ raw: JsonObject; args: JsonObject } | null>(null)
  const [canFullscreen, setCanFullscreen] = useState(false)
  const [displayMode, setDisplayMode] = useState<string>('inline')
  // The map mounts on the first result that needs it and then stays (hidden
  // under data answers) so a later spatial result plays without a reload.
  const [needsMap, setNeedsMap] = useState(false)
  const [mapMounted] = useState(deferred)
  const attachMap = useCallback((handle: MapHandle | null) => {
    mapHandle.current = handle
    if (handle) mapMounted.resolve()
  }, [mapHandle, mapMounted])
  const dataModeRef = useRef(false)
  dataModeRef.current = dataResult !== null
  const lastArgsRef = useRef<JsonObject>({})
  const appRef = useRef<McpApp | null>(null)
  const hostRef = useRef<StagePlayerHost | null>(null)
  const readyOnce = useRef(false)

  useEffect(() => {
    hostRef.current = {
      map: {
        flyTo: (lng, lat, zoom, ms) =>
          mapHandle.current?.flyTo(lng, lat, zoom, ms) ?? Promise.resolve(),
        setHighlight: (layer, ids) => mapHandle.current?.setHighlight(layer, ids),
        highlightStop: (name) => mapHandle.current?.highlightStop(name),
        setDraw: (fc) => mapHandle.current?.setDraw(fc),
        setIsochroneStreets: (fc) => mapHandle.current?.setIsochroneStreets(fc),
        lastCenter: () => mapHandle.current?.lastCenter() ?? { lng: 80.7, lat: 7.85 },
        whenReady: async () => {
          await mapMounted.promise
          await mapHandle.current?.whenReady()
        },
      },
      setVisibility: setMany,
      setPopulation: setPopLevel,
      setClimate: (variable, month) =>
        setClimate((current) => ({ variable, month: month ?? current.month })),
      setAnalyzeActive: () => {},
      setSunActive: () => {},
      setFeature,
      onAgentLive: () => {},
    }
    return () => {
      hostRef.current = null
    }
  }, [mapHandle, mapMounted, setMany, setPopLevel, setClimate, setFeature])

  const playResult = useCallback((body: ToolBody, args: JsonObject) => {
    void (async () => {
      setDataView(body.view ?? null)
      if (body.view?.kind !== 'chart') setChartRows([])
      if (body.view_url) setWebUrl(body.view_url)
      if (body.view?.kind === 'chart') {
        setChartRows(body.features?.length ? body.features : body.aggregates ? [body.aggregates] : [])
        return
      }
      const host = hostRef.current
      if (!host) return
      setNeedsMap(true)
      await host.map.whenReady()
      if (body.web_url) setWebUrl(body.web_url)
      if (body.error) {
        setFeature({
          groupId: 'agent-narrate',
          groupLabel: 'Miss',
          title: String(body.error),
          rows: body.entity ? [{ label: 'Entity', value: String(body.entity) }] : [],
          blurb: String(body.note ?? body.summary ?? ''),
          lngLat: host.map.lastCenter(),
        })
        return
      }
      if (isAnalyzeBody(body)) {
        setAnalyzeResult(body)
        setAnalyzePoint(body.location)
        setAnalyzeError(null)
        setAnalyzeLoading(false)
        setFeature(null)
      }
      const events = Array.isArray(body.stage) ? body.stage : []
      if (events.length) {
        await playEnvelope(host, {
          tool: String(body.op ?? 'query_data'),
          events,
          geometry: body.geometry,
          hull: body.hull,
        })
      } else if (body.location) {
        await host.map.flyTo(body.location.lng, body.location.lat, 13, 700)
      }
      if (body.op === 'isochrone' && !body.geometry) {
        const iso = events.find((ev) => ev.t === 'isochrone')
        const argOrigin = isJsonObject(args.origin) ? args.origin : null
        const origin =
          argOrigin && isJsonNumber(argOrigin.lat) && isJsonNumber(argOrigin.lng)
            ? { lat: argOrigin.lat, lng: argOrigin.lng }
            : iso?.origin ?? body.location
        const minutes = args.minutes ?? iso?.minutes
        const app = appRef.current
        if (origin && minutes && app) {
          mcpBeacon('geometry_fetch')
          try {
            const extra = await app.callServerTool({
              name: 'query_data',
              arguments: { op: 'isochrone', origin, mode: 'walk', minutes, include_geometry: true },
            })
            const geom = bodyFromResult(extra).geometry
            if (geom) host.map.setIsochroneStreets(geom)
          } catch {
            /* host may deny */
          }
        }
      }
    })()
  }, [setAnalyzeError, setAnalyzeLoading, setAnalyzePoint, setAnalyzeResult, setFeature])

  const toggleFullscreen = useCallback(() => {
    const current = appRef.current
    const shown = current?.getHostContext()?.displayMode ?? displayMode
    void requestDisplayMode(current, shown === 'fullscreen' ? 'inline' : 'fullscreen').then((granted) => {
      if (granted) setDisplayMode(granted)
    })
  }, [displayMode])

  const { app, isConnected } = useApp({
    appInfo: { name: 'developing-country.org', version: MCP_APP_VERSION },
    capabilities: { availableDisplayModes: ['inline', 'fullscreen'] },
    // A map fills the host viewport and has no intrinsic document height. The
    // SDK's content-driven auto-resize therefore feeds the iframe's current
    // height back to the host and can collapse inline views to 150px.
    autoResize: false,
    onAppCreated: (created) => {
      appRef.current = created
      created.ontoolinput = (params) => {
        lastArgsRef.current = jsonObjectFromSerializable(params.arguments ?? {}) ?? {}
        // Warm the chunk only; the map mounts (style, tiles) when the result needs it.
        if (expectsMap(lastArgsRef.current, created.getHostContext()?.toolInfo?.tool.name)) void loadMapView()
      }
      created.ontoolresult = (result) => {
        const raw = rawFromResult(result)
        if (!result.isError && dataPanelKind(raw)) {
          setDataResult({ raw: raw!, args: lastArgsRef.current })
          syncInlineSize(created, true)
          return
        }
        if (dataModeRef.current) syncInlineSize(created, false)
        setDataResult(null)
        playResult(bodyFromResult(result), lastArgsRef.current)
      }
      created.onhostcontextchanged = (ctx) => {
        applyTheme(ctx)
        const merged = created.getHostContext()
        applySafeArea(merged)
        syncInlineSize(created, dataModeRef.current)
        setCanFullscreen(canRequestFullscreen(created))
        setDisplayMode(merged?.displayMode ?? 'inline')
      }
      created.onteardown = async () => ({})
    },
  })

  useHostStyleVariables(app, app?.getHostContext())

  useEffect(() => {
    if (!isConnected || readyOnce.current) return
    const ctx = app?.getHostContext()
    applyTheme(ctx)
    applySafeArea(ctx)
    if (app) syncInlineSize(app)
    setCanFullscreen(canRequestFullscreen(app ?? null))
    setDisplayMode(ctx?.displayMode ?? 'inline')
    readyOnce.current = true
    mcpBeacon('ready')
  }, [isConnected, app])

  useEffect(() => {
    document.documentElement.setAttribute('data-mcp-app', '1')
  }, [])

  return (
    <div className={`app mcp-app${dataView?.kind === 'chart' && !dataResult ? ' has-chart' : ''}${dataResult ? ' has-data' : ''}`}>
      {needsMap ? (
        <Suspense fallback={<div className="live-view-state"><p>Loading map…</p></div>}>
          <MapView
            ref={attachMap}
            visibility={visibility}
            climate={climate}
            population={popLevel}
            terrain3D={false}
            onFeatureClick={(info) => {
              setFeature(info)
              if (info) {
                void appRef.current?.updateModelContext({
                  content: [{ type: 'text', text: modelContextFromFeature(info) }],
                })
                mcpBeacon('select')
              }
            }}
            sunActive={false}
            sunPoint={null}
            sunDate={sunDate}
            onSunPick={() => {}}
            analyzeActive={false}
            analyzePoint={analyzePoint}
            onAnalyzePick={() => {}}
            onApiLayerStatus={onApiLayerStatus}
            reloadApiKey={0}
          />
        </Suspense>
      ) : !dataResult && dataView?.kind !== 'chart' ? (
        <div className="live-view-state"><p>Waiting for the answer…</p></div>
      ) : null}
      {needsMap && !dataResult && dataView?.kind !== 'chart' ? (
        <LayerPanel
          variant="overlay"
          tools={false}
          visibility={visibility}
          onToggle={toggle}
          onSetMany={setMany}
          climate={climate}
          onClimateVariable={setClimateVariable}
          onClimateMonth={setClimateMonth}
          population={popLevel}
          onPopulationLevel={setPopLevel}
          animating={animating}
          onToggleAnimate={() => setAnimating((a) => !a)}
          terrain3D={false}
          onToggle3D={() => {}}
          sunActive={false}
          onToggleSun={() => {}}
          analyzeActive={false}
          onToggleAnalyze={() => {}}
          apiStatus={apiStatus}
          signedIn
          onRequestSignIn={() => {}}
          yieldTo={Boolean(feature) || Boolean(analyzeResult)}
        />
      ) : null}
      {dataResult ? (
        <Suspense fallback={<div className="live-view-state"><p>Preparing data…</p></div>}>
          <McpDataPanel
            app={appRef.current}
            initial={dataResult}
            onOpenLink={(url) => {
              mcpBeacon('open_link')
              void openExternalLink(appRef.current, url)
            }}
            onFullscreen={canFullscreen ? toggleFullscreen : undefined}
          />
        </Suspense>
      ) : dataView?.kind === 'chart' ? (
        <div className="mcp-chart-shell">
          <Suspense fallback={<div className="live-view-state"><p>Preparing chart…</p></div>}>
            <LiveChart view={dataView} rows={chartRows} />
          </Suspense>
        </div>
      ) : feature ? (
        <FeatureSheet info={feature} onClose={() => setFeature(null)} />
      ) : analyzeResult || analyzeLoading || analyzeError ? (
        <AnalyzeSheet
          point={analyzePoint}
          result={analyzeResult}
          loading={analyzeLoading}
          error={analyzeError}
          onClose={exitAnalyze}
        />
      ) : null}
      <div className="mcp-actions">
        <button
          type="button"
          className="btn mcp-open-full"
          onClick={() => {
            mcpBeacon('open_link')
            void openExternalLink(appRef.current, webUrl)
          }}
        >
          {dataView ? 'Open live view' : 'Open full map'}
        </button>
        {canFullscreen && needsMap && !dataResult && dataView?.kind !== 'chart' ? (
          <button
            type="button"
            className="btn mcp-expand"
            aria-pressed={displayMode === 'fullscreen'}
            onClick={toggleFullscreen}
          >
            {displayMode === 'fullscreen' ? 'Exit full screen' : 'Full screen'}
          </button>
        ) : null}
      </div>
      <BrandMark
        className="mcp-brand"
        onOpen={(url) => {
          mcpBeacon('open_link')
          void openExternalLink(appRef.current, url)
        }}
      />
    </div>
  )
}
