import type { JsonFc, JsonFeature, StageEnvelope, StageEvent } from '../shared/stage'
import type { FeatureInfo, LngLat } from '../types'
import type { PopLevelId } from './layers'
import type { ClimateVariableId } from '../types'

export type MapHandle = {
  flyTo: (lng: number, lat: number, zoom?: number, durationMs?: number) => Promise<void>
  setHighlight: (layer: 'gnd' | 'dsd' | 'district', ids: string[]) => void
  highlightStop: (stopName: string | null) => void
  setDraw: (fc: JsonFc | null) => void
  setIsochroneStreets: (fc: JsonFc | null) => void
  lastCenter: () => { lng: number; lat: number }
  whenReady: () => Promise<void>
}

export function hullToFc(hull: { type: 'Polygon'; coordinates: number[][][] }): JsonFc {
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: hull, properties: { kind: 'hull' } }],
  }
}

export function narrateToFeatureInfo(
  e: Extract<StageEvent, { t: 'narrate' }>,
  lngLat: LngLat,
): FeatureInfo {
  return {
    groupId: 'agent-narrate',
    groupLabel: e.kind === 'gap' ? 'Gap' : 'Agent',
    title: e.title,
    rows: [],
    blurb: e.body,
    lngLat,
  }
}

export interface StagePlayerHost {
  map: MapHandle
  setVisibility: (ids: string[], visible: boolean) => void
  setPopulation: (level: PopLevelId | null) => void
  setClimate: (variable: ClimateVariableId | null, month?: number) => void
  setAnalyzeActive: (on: boolean) => void
  setSunActive: (on: boolean) => void
  setFeature: (info: FeatureInfo | null) => void
  onAgentLive: () => void
}

function isFc(g: JsonFeature | JsonFc): g is JsonFc {
  return g.type === 'FeatureCollection'
}

export async function playEnvelope(
  host: StagePlayerHost,
  env: StageEnvelope & { hull?: { type: 'Polygon'; coordinates: number[][][] } },
  opts: { instant?: boolean } = {},
): Promise<void> {
  let lastFly: LngLat = host.map.lastCenter()
  host.onAgentLive()
  for (const e of env.events) {
    const instant = opts.instant && e.t !== 'flyTo'
    switch (e.t) {
      case 'seq':
        break
      case 'flyTo': {
        lastFly = { lng: e.lng, lat: e.lat }
        await host.map.flyTo(e.lng, e.lat, e.zoom, instant ? 0 : e.duration_ms)
        break
      }
      case 'setVisibility':
        host.setVisibility(e.ids, e.visible)
        break
      case 'setPopulation':
        host.setPopulation(e.level)
        break
      case 'setClimate':
        host.setClimate(e.variable, e.month)
        break
      case 'pulse':
        lastFly = { lng: e.lng, lat: e.lat }
        break
      case 'highlight':
        if (e.source === 'gnd' || e.source === 'dsd' || e.source === 'district') {
          host.map.setHighlight(e.source, e.ids)
        }
        break
      case 'highlightStop':
        host.map.highlightStop(e.stopName)
        break
      case 'draw':
        host.map.setDraw(isFc(e.geojson) ? e.geojson : { type: 'FeatureCollection', features: [e.geojson] })
        break
      case 'isochrone':
        if (env.geometry) host.map.setIsochroneStreets(env.geometry)
        else if (env.hull) host.map.setDraw(hullToFc(env.hull))
        else host.map.setIsochroneStreets(null)
        break
      case 'narrate':
        host.setAnalyzeActive(false)
        host.setSunActive(false)
        host.setFeature(narrateToFeatureInfo(e, lastFly))
        break
      case 'openSheet':
        if (e.mode === 'narrate') {
          host.setAnalyzeActive(false)
          host.setSunActive(false)
        }
        break
      case 'clear':
        if (e.what === 'highlights' || e.what === 'all') host.map.setHighlight('gnd', [])
        if (e.what === 'draw' || e.what === 'all') host.map.setDraw(null)
        if (e.what === 'isochrone' || e.what === 'all') host.map.setIsochroneStreets(null)
        break
      default:
        break
    }
  }
}
