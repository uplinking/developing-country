export interface LngLat {
  lng: number
  lat: number
}

export interface FeatureRow {
  label: string
  value: string
}

export interface TimelineStep {
  label: string
  state: 'done' | 'current' | 'future'
  /** Optional rough date for this stage (e.g. "2019", "2041 (target)"). */
  date?: string
}

export interface FeatureLink {
  label: string
  url: string
}

/** One sectioned block in a composite readout (used by Analyze mode). */
export interface FeatureSection {
  title: string
  /** Provenance tag shown small under the section title. */
  source?: string
  rows: FeatureRow[]
  /** Empty-state line shown when the section has no rows. */
  empty?: string
}

export interface FeatureInfo {
  groupId: string
  groupLabel: string
  title: string
  /** Admin / OSM / GND id when the click has one (MCP Apps model context). */
  id?: string
  rows: FeatureRow[]
  /** Optional project-status timeline (e.g. planned developments). */
  timeline?: TimelineStep[]
  /** Optional external link (e.g. "read the source PDF"). */
  link?: { label: string; url: string }
  /** Optional set of external links (e.g. website / Wikipedia / OSM). */
  links?: FeatureLink[]
  /** Optional preview image (e.g. a listing's og:image). */
  image?: string
  /** Optional free-text blurb shown under the title (e.g. Stepper's desc). */
  blurb?: string
  /** Optional attribution line (e.g. creator-layer credit). */
  attribution?: FeatureLink
  /** Optional composite sections (Analyze mode). */
  sections?: FeatureSection[]
  lngLat: { lng: number; lat: number }
}

/** Runtime status of an API-backed layer (stepper / prospects / issues). */
export interface ApiLayerStatus {
  loading: boolean
  ok: boolean
  count: number
}

export type ApiLayerStatusMap = Record<string, ApiLayerStatus>

/** id -> visible? for every layer group. */
export type VisibilityState = Record<string, boolean>

export type ClimateVariableId = 'rainfall' | 'temperature' | 'humidity'

/** Shared climate selection: which variable (or none) and which timestep. */
export interface ClimateState {
  /** null = climate off. */
  variable: ClimateVariableId | null
  /** 0 = annual mean, 1..12 = Jan..Dec. */
  month: number
}
