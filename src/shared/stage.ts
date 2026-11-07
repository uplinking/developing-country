// Closed stage vocabulary shared by the Worker (MCP/REST envelopes) and the SPA
// (player). No Worker types, no MapLibre types, no global GeoJSON namespace.

import type { JsonObject } from './json'

export type JsonPosition = number[]
export type JsonGeometry =
  | { type: 'Point'; coordinates: JsonPosition }
  | { type: 'LineString'; coordinates: JsonPosition[] }
  | { type: 'Polygon'; coordinates: JsonPosition[][] }
  | { type: 'MultiPoint'; coordinates: JsonPosition[] }
  | { type: 'MultiLineString'; coordinates: JsonPosition[][] }
  | { type: 'MultiPolygon'; coordinates: JsonPosition[][][] }
  | { type: 'GeometryCollection'; geometries: JsonGeometry[] }

export type JsonFeature = {
  type: 'Feature'
  geometry: JsonGeometry | null
  properties: JsonObject | null
  id?: string | number
}

export type JsonFc = { type: 'FeatureCollection'; features: JsonFeature[] }

export type PopLevel = 'province' | 'district' | 'dsd' | 'gnd'
export type ClimateVariable = 'rainfall' | 'temperature' | 'humidity'
export type HighlightSource = 'gnd' | 'dsd' | 'district' | 'school' | 'hospital' | 'metro_stop'
export type HighlightStyle = 'pulse' | 'gap' | 'outline'
export type NarrateKind = 'info' | 'gap' | 'warn' | 'missing'

export type StageEvent =
  | { t: 'seq'; i: number; of?: number }
  | { t: 'flyTo'; lng: number; lat: number; zoom?: number; duration_ms?: number }
  | { t: 'setVisibility'; ids: string[]; visible: boolean }
  | { t: 'setPopulation'; level: PopLevel | null }
  | { t: 'setClimate'; variable: ClimateVariable | null; month?: number }
  | { t: 'pulse'; lng: number; lat: number }
  | {
      t: 'highlight'
      source: HighlightSource
      ids: string[]
      style: HighlightStyle
    }
  | { t: 'highlightStop'; stopName: string | null }
  | {
      t: 'draw'
      id: string
      geojson: JsonFeature | JsonFc
      paint?: { color?: string; opacity?: number; label?: string }
    }
  | {
      t: 'isochrone'
      origin: { lat: number; lng: number }
      minutes: 5 | 10
      mode: 'walk'
    }
  | { t: 'narrate'; title: string; body: string; kind?: NarrateKind }
  | { t: 'openSheet'; mode: 'narrate' | 'feature' }
  | { t: 'clear'; what: 'highlights' | 'draw' | 'isochrone' | 'all' }

/** What appendStage broadcasts on the live WS. Streets live on `geometry`, not on the isochrone event. */
export type StageEnvelope = { tool: string; events: StageEvent[]; geometry?: JsonFc }

export type IsochroneHull = { type: 'Polygon'; coordinates: number[][][] }
