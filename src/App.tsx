import { SiteHeader } from '@developing-country/ui/SiteHeader'
import { appUrl } from './base'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import MapView from './map/MapView'
import { connectStageSocket } from './map/sessionClient'
import type { StagePlayerHost } from './map/stagePlayer'
import LayerPanel from './ui/LayerPanel'
import FeatureSheet from './ui/FeatureSheet'
import SunSheet from './ui/SunSheet'
import AnalyzeSheet from './ui/AnalyzeSheet'
import CoverageSheet from './ui/CoverageSheet'
import AccountControl from './auth/AccountControl'
import AuthModal from './auth/AuthModal'
import PlaceSearch, { type PlaceHit } from './ui/PlaceSearch'
import McpConnect from './ui/McpConnect'
import { useSession } from './auth/client'
import { useMapEngine } from './useMapEngine'
import { datasetEmbedConfig } from './datasetEmbed'
import './App.css'

export default function App() {
  const e = useMapEngine()
  const { data: session } = useSession()
  const signedIn = !!session?.user
  const requestedSignIn = useRef(new URLSearchParams(window.location.search).get('signin') === '1')
  const [embedConfig] = useState(() => datasetEmbedConfig(window.location.search))
  const embedded = embedConfig.embedded
  const publicSiteUrl =
    window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost'
      ? 'http://127.0.0.1:4321'
      : 'https://developing-country.org'
  const [authOpen, setAuthOpen] = useState(() => {
    try {
      const query = new URLSearchParams(window.location.search)
      return query.has('error') || query.get('signin') === '1'
    } catch {
      return false
    }
  })
  const [reloadApiKey, setReloadApiKey] = useState(0)
  const lastIdentity = useRef<string | null>(null)
  useEffect(() => {
    const who = session?.user?.email ?? null
    if (lastIdentity.current !== who) {
      lastIdentity.current = who
      setReloadApiKey((k) => k + 1)
    }
  }, [session?.user?.email])

  useEffect(() => {
    if (requestedSignIn.current && signedIn) setAuthOpen(false)
  }, [signedIn])

  const onPlacePick = (hit: PlaceHit) => {
    if (hit.lat == null || hit.lng == null || !Number.isFinite(hit.lat) || !Number.isFinite(hit.lng)) return
    const group =
      hit.layer === 'metro_stop' || hit.layer === 'metro_line'
        ? 'metro'
        : hit.layer === 'boi_zone'
          ? 'boi-zones'
          : hit.layer
    if (hit.layer === 'gnd' || hit.layer === 'dsd' || hit.layer === 'district') {
      e.setPopLevel(hit.layer)
      if (hit.id) e.mapHandle.current?.setHighlight(hit.layer, [hit.id])
    } else {
      e.setVisibility((v) => ({ ...v, [group]: true }))
    }
    void e.mapHandle.current?.flyTo(hit.lng, hit.lat, 13, 900)
    e.setFeature({
      groupId: group,
      groupLabel: hit.layer.replace(/_/g, ' '),
      title: hit.name,
      rows: [{ label: 'Kind', value: hit.layer.replace(/_/g, ' ') }],
      lngLat: { lng: hit.lng, lat: hit.lat },
    })
  }
  const [agentLive, setAgentLive] = useState(false)
  const agentLiveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [coverageOpen, setCoverageOpen] = useState(false)

  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    if (embedded) {
      e.setVisibility((current) => {
        const next = { ...current }
        for (const key of Object.keys(next)) next[key] = embedConfig.layerIds.includes(key)
        return next
      })
    } else if (embedConfig.layerIds.length > 0) {
      e.setMany(embedConfig.layerIds, true)
    }
    if (embedConfig.population) e.setPopLevel(embedConfig.population)
    if (q.get('view') === 'coverage') setCoverageOpen(true)
    if (q.has('signin') || q.has('connect')) {
      q.delete('signin')
      q.delete('connect')
      const query = q.toString()
      const next = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`
      history.replaceState(null, '', next)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!signedIn) return
    const host: StagePlayerHost = {
      map: {
        flyTo: (lng, lat, zoom, ms) => e.mapHandle.current?.flyTo(lng, lat, zoom, ms) ?? Promise.resolve(),
        setHighlight: (layer, ids) => e.mapHandle.current?.setHighlight(layer, ids),
        highlightStop: (name) => e.mapHandle.current?.highlightStop(name),
        setDraw: (fc) => e.mapHandle.current?.setDraw(fc),
        setIsochroneStreets: (fc) => e.mapHandle.current?.setIsochroneStreets(fc),
        lastCenter: () => e.mapHandle.current?.lastCenter() ?? { lng: 80.7, lat: 7.85 },
        whenReady: () => e.mapHandle.current?.whenReady() ?? Promise.resolve(),
      },
      setVisibility: e.setMany,
      setPopulation: e.setPopLevel,
      setClimate: (variable, month) => e.setClimate((c) => ({ variable, month: month ?? c.month })),
      setAnalyzeActive: e.setAnalyzeActive,
      setSunActive: (on) => {
        e.setSunActive(on)
        if (!on) e.setSunPlaying(false)
      },
      setFeature: e.setFeature,
      onAgentLive: () => {
        setAgentLive(true)
        if (agentLiveTimer.current) clearTimeout(agentLiveTimer.current)
        agentLiveTimer.current = setTimeout(() => setAgentLive(false), 60_000)
      },
    }
    return connectStageSocket(host, () => host.onAgentLive())
    // setters from useMapEngine are stable; reconnect only on identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn])

  return (
    <div className={embedded ? 'app app--dataset-embed' : 'app'}>
      {!embedded && <div className="explorer-chrome">
        <SiteHeader siteUrl={publicSiteUrl} explorerUrl={appUrl('/')} inAppActions />
        <div className="explorer-toolbar" role="region" aria-label="Map controls">
          <PlaceSearch onPick={onPlacePick} />
            <div className="nb-actions">
              <McpConnect
                initialOpen={new URLSearchParams(window.location.search).get('connect') === '1'}
                live={agentLive}
                onCoverage={() => {
                  setCoverageOpen(true)
                  const url = new URL(window.location.href)
                  url.searchParams.set('view', 'coverage')
                  history.replaceState(null, '', url)
                }}
              />
              <AccountControl onSignIn={() => setAuthOpen(true)} />
            </div>
        </div>
      </div>}

      <MapView
        ref={e.mapHandle}
        visibility={e.visibility}
        climate={e.climate}
        population={e.popLevel}
        terrain3D={e.terrain3D}
        onFeatureClick={e.setFeature}
        sunActive={e.sunActive}
        sunPoint={e.sunPoint}
        sunDate={e.sunDate}
        onSunPick={e.setSunPoint}
        analyzeActive={e.analyzeActive}
        analyzePoint={e.analyzePoint}
        onAnalyzePick={e.onAnalyzePick}
        onApiLayerStatus={e.onApiLayerStatus}
        reloadApiKey={reloadApiKey}
        initialView={embedConfig.initialView}
        showNavigation={!embedded}
      />

      {embedded && embedConfig.selectionLabel && (
        <aside className="dataset-embed-selection" aria-label={`Selected data: ${embedConfig.selectionLabel}`}>
          <header>
            <span className="dataset-embed-selection__mark" aria-hidden="true" />
            <span>
              <small>Selected data</small>
              <strong>{embedConfig.selectionLabel}</strong>
            </span>
          </header>
          {embedConfig.legend.length > 0 && (
            <ul aria-label="Legend">
              {embedConfig.legend.map((item) => (
                <li key={item.label}>
                  <span
                    className={`dataset-embed-selection__swatch dataset-embed-selection__swatch--${item.style ?? 'solid'}`}
                    style={{ '--swatch': item.swatch } as CSSProperties}
                    aria-hidden="true"
                  />
                  <span>{item.label}</span>
                </li>
              ))}
            </ul>
          )}
        </aside>
      )}

      {embedded && (
        <FeatureSheet info={e.feature} onClose={() => e.setFeature(null)} />
      )}

      {!embedded && <LayerPanel
        visibility={e.visibility}
        onToggle={e.toggle}
        onSetMany={e.setMany}
        climate={e.climate}
        onClimateVariable={e.setClimateVariable}
        onClimateMonth={e.setClimateMonth}
        population={e.popLevel}
        onPopulationLevel={e.setPopLevel}
        animating={e.animating}
        onToggleAnimate={() => e.setAnimating((a) => !a)}
        terrain3D={e.terrain3D}
        onToggle3D={() => e.setTerrain3D((t) => !t)}
        sunActive={e.sunActive}
        onToggleSun={e.toggleSun}
        analyzeActive={e.analyzeActive}
        onToggleAnalyze={e.toggleAnalyze}
        apiStatus={e.apiStatus}
        signedIn={signedIn}
        onRequestSignIn={() => setAuthOpen(true)}
        yieldTo={Boolean(e.feature) || e.analyzeActive || coverageOpen}
      />}

      {!embedded && (coverageOpen ? (
        <CoverageSheet
          onClose={() => {
            setCoverageOpen(false)
            const url = new URL(window.location.href)
            url.searchParams.delete('view')
            history.replaceState(null, '', url)
          }}
        />
      ) : e.analyzeActive ? (
        <AnalyzeSheet
          point={e.analyzePoint}
          result={e.analyzeResult}
          loading={e.analyzeLoading}
          error={e.analyzeError}
          onClose={e.toggleAnalyze}
        />
      ) : e.sunActive ? (
        <SunSheet
          point={e.sunPoint}
          date={e.sunDate}
          onDate={e.setSunDateManual}
          playing={e.sunPlaying}
          onTogglePlay={e.toggleSunPlay}
          onClose={e.toggleSun}
        />
      ) : (
        <FeatureSheet info={e.feature} onClose={() => e.setFeature(null)} />
      ))}

      {!embedded && authOpen && <AuthModal onClose={() => setAuthOpen(false)} />}
    </div>
  )
}
