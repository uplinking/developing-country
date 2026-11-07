// Single source of truth for overlay layers: each group declares its data
// source, the MapLibre style layers to render, and a legend. MapView consumes
// this to add sources/layers; LayerPanel consumes it to render toggles+legends.
// Keeping both off one config means the map and the legend can never drift.

import type { ExpressionSpecification, FilterSpecification, LayerSpecification } from 'maplibre-gl'
import { AVAILABLE_TILES, TERRAIN_TILES } from '../config'
import { iconSpec, DEV_STATUS_COLORS, DEV_GLYPHS, iconId } from './icons'
import registryIds from '../shared/registry-ids.json' with { type: 'json' }

export type LayerCategory =
  | 'infrastructure'
  | 'environment'
  | 'planning'
  | 'demographics'
  | 'explore'
  | 'community'

export interface LegendItem {
  swatch: string
  label: string
  style?: 'solid' | 'dashed' | 'dotted' | 'fill'
  /** Id from map/icons.ts — draws the *same* marker the map draws, instead of a
   *  colour chip, so the panel and the map can't drift. Colour comes from the
   *  icon spec, so `swatch` is ignored when this is set. */
  icon?: string
}

/** Metadata attached to a render layer when a group is split into per-layer toggles. */
export interface UnitMeta {
  label: string
  legend?: LegendItem
}

/** Data provenance shown in the per-layer "i" popover. */
export interface SourceInfo {
  /** Who publishes it. */
  source: string
  /** One line on what it is / how it was derived. */
  detail?: string
  /** Vintage of the data (e.g. "Census 2012", "normals 1970–2000", "live"). */
  year?: string
  url?: string
}

export type OverlaySource =
  | { type: 'geojson'; url: string; /** Add an empty source, then fetch only when first shown. */ lazy?: boolean }
  | { type: 'vector-pmtiles'; file: string }
  | { type: 'raster-dem'; tiles: string; encoding: 'terrarium' }
  // Runtime-fetched from a same-origin API endpoint. MapView adds an empty
  // GeoJSON source on load, then fills it from `endpoint` (adapted to a
  // FeatureCollection in map/apiLayers.ts). If the fetch fails the layer is
  // simply empty — the card stays toggleable and shows an "unavailable" state.
  | { type: 'api'; endpoint: string }

// A render layer is a normal MapLibre layer spec minus `source` (MapView wires
// that up). `source-layer` stays here since it's per-layer for vector tiles.
// Distributive Omit so per-variant keys (filter, source-layer) survive.
type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never
export type RenderLayer = DistributiveOmit<LayerSpecification, 'source' | 'metadata'> & {
  metadata?: { unit?: UnitMeta }
}

export interface LayerGroup {
  id: string
  label: string
  blurb: string
  category: LayerCategory
  defaultVisible: boolean
  /** Data comes from data/pipeline.sh and isn't shipped in the repo. */
  requiresPipeline?: boolean
  /** Render each layer as its own independent toggle (e.g. road tiers). */
  perLayerToggle?: boolean
  source: OverlaySource
  render: RenderLayer[]
  legend: LegendItem[]
  /** Clicking a feature in these layers opens the detail sheet. */
  interactive?: boolean
  attribution?: string
  /** Data provenance shown in the "i" popover. */
  info: SourceInfo
}

/** An independently toggleable unit — a whole group, or one layer within a
 *  perLayerToggle group. Keyed by id in VisibilityState. */
export interface ToggleUnit {
  id: string
  label: string
  groupId: string
  layerIds: string[]
  legend: LegendItem[]
  defaultVisible: boolean
}

const ROAD_TIERS = [
  { tier: 'expressway', label: 'Expressway', color: '#d62728', w: [2, 8] },
  { tier: 'A', label: 'A — National', color: '#ef6c00', w: [1.5, 6] },
  { tier: 'B', label: 'B — Provincial', color: '#f9a825', w: [1, 4] },
  { tier: 'C', label: 'C — Local', color: '#9e9d24', w: [0.6, 2.5] },
  { tier: 'other', label: 'Other', color: '#9ca3af', w: [0.4, 1.5] },
] as const

const roadTierLayers: RenderLayer[] = ROAD_TIERS.map((t) => ({
  id: `roads-${t.tier}`,
  type: 'line',
  'source-layer': 'roads',
  filter: ['==', ['get', 'tier'], t.tier],
  layout: { 'line-cap': 'round', 'line-join': 'round' },
  paint: {
    'line-color': t.color,
    'line-width': ['interpolate', ['linear'], ['zoom'], 7, t.w[0], 14, t.w[1]],
  },
  metadata: { unit: { label: t.label, legend: { swatch: t.color, label: t.label, style: 'solid' } } },
}))

export const EXPRESSWAY_COLORS = {
  open: '#2563eb',
  construction: '#f97316', // in progress → orange
  proposed: '#facc15', // proposed / planned → yellow (was purple)
}

// --- Point markers ----------------------------------------------------------
// Every point layer renders as a pin from the icon registry (map/icons.ts),
// which owns both the glyph and the colour, so a marker's look is one edit in
// one file. These aliases just read the palette back out of it.

const iconColor = (id: string) => iconSpec(id)?.color ?? '#64748b'

type ExpressionSource = Array<string | number | boolean | ExpressionSpecification | string[]>

function asExpression(value: ExpressionSource): ExpressionSpecification {
  const expression: ExpressionSpecification = JSON.parse(JSON.stringify(value))
  return expression
}

/** Attraction categories that have their own pin. Must stay in sync with the
 *  `category` values emitted by scripts/fetch-explore.mjs — an unknown category
 *  falls back to the generic `attraction` pin. */
export const ATTRACTION_CATEGORIES = [
  'attraction', 'monument', 'viewpoint', 'museum', 'zoo',
  'archaeological_site', 'ruins', 'castle', 'theme_park', 'fort',
] as const

/** category → pin colour, read straight off the icon registry. */
export const ATTRACTION_COLORS: Record<string, string> = Object.fromEntries(
  ATTRACTION_CATEGORIES.map((c) => [c, iconColor(c)]),
)

/** Icon ids are the category names, so this is an identity match with a fallback. */
const attractionIconMatch = asExpression([
  'match',
  ['get', 'category'],
  ...ATTRACTION_CATEGORIES.flatMap((c) => [c, iconId(c)]),
  iconId('attraction'),
])

// Planned-development pins: glyph = project type, colour = status. Maps a
// feature's `type` to a glyph and its `status` to a colour bucket. Image ids are `dev-<glyph>-<bucket>` (see map/icons.ts).
const DEV_TYPE_GLYPH: [string, string][] = [
  ['special-economic-zone', 'sez'],
  ['port-terminal', 'port'],
  ['airport', 'airport'],
  ['rail', 'rail'],
  ['energy', 'energy'],
  ['transport-hub', 'transport'],
  ['road', 'road'],
  ['flood-mitigation', 'flood'],
  ['industrial-zone', 'industry'],
  ['new-town', 'newtown'],
  ['satellite-town', 'newtown'],
  ['commercial-zone', 'commercial'],
]
const devGlyphMatch = (bucket: string) => asExpression([
  'match',
  ['get', 'type'],
  ...DEV_TYPE_GLYPH.flatMap(([t, g]) => [t, iconId(`dev-${g}-${bucket}`)]),
  iconId(`dev-generic-${bucket}`),
])
const developmentsIconMatch = asExpression([
  'match',
  ['get', 'status'],
  ['operational', 'completed', 'existing'], devGlyphMatch('op'),
  'under-construction', devGlyphMatch('uc'),
  // approved folds into proposed (both yellow) — funded-but-not-started reads as
  // "planned" for the three-stage green/orange/yellow scheme.
  ['approved', 'proposed', 'planned'], devGlyphMatch('pr'),
  devGlyphMatch('pr'), // anything else
])

// BOI economic zones share the three-stage status scheme. The centroid badge
// reuses the existing industry (factory) glyph icons; the fill/outline colour is
// the same green/orange/yellow.
const boiZonesIconMatch = asExpression([
  'match',
  ['get', 'status'],
  ['operational', 'completed', 'existing'], iconId('dev-industry-op'),
  'under-construction', iconId('dev-industry-uc'),
  iconId('dev-industry-pr'), // proposed / approved / planned
])
const boiStatusColor: ExpressionSpecification = [
  'match',
  ['get', 'status'],
  ['operational', 'completed', 'existing'], DEV_STATUS_COLORS.op,
  'under-construction', DEV_STATUS_COLORS.uc,
  DEV_STATUS_COLORS.pr,
]

/** Sea routes: cyan cargo lanes (distinct from motorway blues / metro), emerald
 *  for the passenger ferry. */
const SEA_ROUTE_COLOR = '#06b6d4'
const SEA_FERRY_COLOR = '#34d399'

const EXPLORE_COLORS = {
  waterfall: iconColor('waterfall'),
  trail: iconColor('trail'),
  cycling: iconColor('cycling'),
  park: iconColor('park'),
  stepper: iconColor('stepper'),
}

/** ESA WorldCover's official categorical colours, limited to classes observed
 * in the Sri Lanka-derived grid. These are categories, not an ordered
 * low-to-high scale. */
export const LAND_COVER_CLASSES = [
  { code: 10, label: 'Tree cover', color: '#006400', vegetated: true },
  { code: 20, label: 'Shrubland', color: '#ffbb22', vegetated: true },
  { code: 30, label: 'Grassland', color: '#ffff4c', vegetated: true },
  { code: 40, label: 'Cropland', color: '#f096ff', vegetated: true },
  { code: 50, label: 'Built-up', color: '#fa0000', vegetated: false },
  { code: 60, label: 'Bare / sparse vegetation', color: '#b4b4b4', vegetated: false },
  { code: 80, label: 'Permanent water bodies', color: '#0064c8', vegetated: false },
  { code: 90, label: 'Herbaceous wetland', color: '#0096a0', vegetated: true },
  { code: 95, label: 'Mangroves', color: '#00cf75', vegetated: true },
] as const

const landCoverColor = asExpression([
  'match',
  ['get', 'class_code'],
  ...LAND_COVER_CLASSES.flatMap((entry) => [entry.code, entry.color]),
  '#d6d3d1',
])

/** Sequential ramp for district percent change 2012→2024. All 25 districts grew;
 *  the scale is how much, not growth versus decline. */
const popChangeColor = asExpression([
  'interpolate',
  ['linear'],
  [
    '*',
    [
      '/',
      ['-', ['to-number', ['get', 'pop']], ['to-number', ['get', 'pop_2012']]],
      ['to-number', ['get', 'pop_2012']],
    ],
    100,
  ],
  0, '#f7fcf5',
  3, '#c7e9c0',
  7, '#74c476',
  12, '#31a354',
  20, '#006d2c',
  33, '#00441b',
])

const hospitalIconMatch = asExpression([
  'match',
  ['get', 'kind'],
  'clinic', iconId('clinic'),
  iconId('hospital'),
])

const COMMUNITY_COLORS = {
  prospect: iconColor('prospect'),
  analysis: iconColor('analysis'),
}

/**
 * Declare a point marker layer. This is the one true path for giving a layer a
 * pin: pick (or add) an id in map/icons.ts, then call this from `render`.
 *
 * - `icon` is an image id, or a MapLibre expression choosing one per feature.
 * - `size` is icon-size at z7 → z13, so pins shrink sensibly when zoomed out.
 *   Shrink hard at the low end: that is what keeps a dense layer readable at
 *   island zoom, because collision can't (see below).
 * - `collide` opts *in* to MapLibre's collision detection. Off by default, and
 *   that is deliberate: symbol placement runs bottom-up through the style, so
 *   the basemap's own POI icons, road shields and place labels are placed
 *   first and win — with collision on, an overlay layer over a busy town can be
 *   suppressed down to *nothing*. Overlay pins are the reason the user opened
 *   the layer, so they always draw. They still act as obstacles
 *   (`icon-ignore-placement: false`), so the basemap's labels move out of their
 *   way instead of printing through them.
 *   Turn it on only where the data itself produces duplicates — route layers.
 * - `placement: 'line-center'` drops one pin at the middle of each line feature
 *   (route layers); polygons get one at the centroid with the default 'point'.
 * - `padding` is the collision box margin in px, and only bites with `collide`.
 *   Routes arrive as many short segments, so one pin per feature would be a
 *   chain of duplicates — a fat padding thins them to one per stretch of map.
 */
export function pinLayer(opts: {
  id: string
  icon: string | ExpressionSpecification
  size?: [number, number]
  collide?: boolean
  minzoom?: number
  filter?: FilterSpecification
  placement?: 'point' | 'line-center'
  padding?: number
}): RenderLayer {
  const [small, large] = opts.size ?? [0.5, 1]
  const layer: RenderLayer = {
    id: opts.id,
    type: 'symbol',
    layout: {
      'icon-image': opts.icon,
      'icon-size': ['interpolate', ['linear'], ['zoom'], 7, small, 13, large],
      // Tail-less badge: its base sits on the spot (like the old pin tip), so
      // labels keep their offsets. Always upright, even on a rotated/pitched map.
      'icon-anchor': 'bottom',
      'icon-rotation-alignment': 'viewport',
      'icon-pitch-alignment': 'viewport',
      'symbol-placement': opts.placement ?? 'point',
      'icon-allow-overlap': !opts.collide,
      'icon-ignore-placement': false,
      'icon-padding': opts.padding ?? 2,
    },
  }
  if (opts.minzoom != null) layer.minzoom = opts.minzoom
  if (opts.filter) layer.filter = opts.filter
  return layer
}

export const LAYER_GROUPS: LayerGroup[] = [
  // ---- Infrastructure -----------------------------------------------------
  {
    id: 'expressways',
    info: {
      source: 'OpenStreetMap + Road Development Authority',
      detail: 'Live expressway network via Overpass. Proposed routes not yet in OSM are digitised (indicative) and drawn dotted: the Central Expressway Kandy Link (CEP Section 3), the Ruwanpura Expressway and the Kurunegala–Dambulla Expressway — each carrying budget, status and a stage timeline on tap.',
      year: 'OSM live · RDA programme 2026',
      url: 'https://www.openstreetmap.org/',
    },
    label: 'Highways & projected expressways',
    blurb: 'Motorways that are open, being built, or still on paper. Tap one to see where it stands.',
    category: 'infrastructure',
    defaultVisible: true,
    interactive: true,
    attribution: '© OpenStreetMap contributors',
    source: { type: 'geojson', url: '/data/expressways.geojson' },
    render: [
      {
        id: 'expressways-open',
        type: 'line',
        filter: ['==', ['get', 'status'], 'open'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': EXPRESSWAY_COLORS.open,
          'line-width': ['interpolate', ['linear'], ['zoom'], 6, 2, 14, 6],
        },
      },
      {
        id: 'expressways-construction',
        type: 'line',
        filter: ['==', ['get', 'status'], 'construction'],
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: {
          'line-color': EXPRESSWAY_COLORS.construction,
          'line-width': ['interpolate', ['linear'], ['zoom'], 6, 2.5, 14, 6.5],
          'line-dasharray': [2, 1.5],
        },
      },
      {
        id: 'expressways-proposed',
        type: 'line',
        filter: ['all', ['==', ['get', 'status'], 'proposed'], ['!=', ['get', 'type'], 'interchange']],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': EXPRESSWAY_COLORS.proposed,
          'line-width': ['interpolate', ['linear'], ['zoom'], 6, 2, 14, 5],
          'line-dasharray': [0.5, 2],
        },
      },
      {
        id: 'expressway-interchanges',
        type: 'circle',
        filter: ['==', ['get', 'type'], 'interchange'],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 2.5, 13, 5.5],
          // Match the exit dot to its road's status (open / building / on paper).
          'circle-color': [
            'match', ['get', 'status'],
            'open', EXPRESSWAY_COLORS.open,
            'construction', EXPRESSWAY_COLORS.construction,
            EXPRESSWAY_COLORS.proposed,
          ],
          'circle-stroke-width': 1.6,
          'circle-stroke-color': '#ffffff',
        },
      },
      {
        id: 'expressway-interchange-labels',
        type: 'symbol',
        filter: ['==', ['get', 'type'], 'interchange'],
        minzoom: 9.5,
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 10.5,
          'text-offset': [0, 1],
          'text-anchor': 'top',
          'text-optional': true,
        },
        paint: { 'text-color': '#334155', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
      },
    ],
    legend: [
      { swatch: EXPRESSWAY_COLORS.open, label: 'Open', style: 'solid' },
      { swatch: EXPRESSWAY_COLORS.construction, label: 'Under construction', style: 'dashed' },
      { swatch: EXPRESSWAY_COLORS.proposed, label: 'Proposed / planned', style: 'dotted' },
      { swatch: EXPRESSWAY_COLORS.open, label: 'Interchange / exit (● by status)', style: 'fill' },
    ],
  },
  {
    id: 'roads',
    info: {
      source: 'OpenStreetMap',
      detail: 'Road network classified by tier (A/B/C/local). Widths are estimated from road class where OSM lacks a surveyed value.',
      year: 'live',
      url: 'https://www.openstreetmap.org/',
    },
    label: 'Roads by tier',
    blurb: 'Main highways down to local lanes, coloured by class. Tap one for its width.',
    category: 'infrastructure',
    defaultVisible: false,
    requiresPipeline: true,
    perLayerToggle: true,
    interactive: true,
    attribution: '© OpenStreetMap contributors',
    source: { type: 'vector-pmtiles', file: 'roads.pmtiles' },
    render: roadTierLayers,
    legend: ROAD_TIERS.map((t) => ({ swatch: t.color, label: t.label, style: 'solid' as const })),
  },
  {
    id: 'water',
    info: {
      source: 'OpenStreetMap',
      detail: 'Rivers, canals, reservoirs / tanks (wewa) and lagoons.',
      year: 'live',
      url: 'https://www.openstreetmap.org/',
    },
    label: 'Water bodies',
    blurb: 'Rivers, canals, lagoons, reservoirs and village tanks (wewa).',
    category: 'infrastructure',
    defaultVisible: false,
    requiresPipeline: true,
    interactive: true,
    attribution: '© OpenStreetMap contributors',
    source: { type: 'vector-pmtiles', file: 'water.pmtiles' },
    render: [
      {
        id: 'water-fill',
        type: 'fill',
        'source-layer': 'water',
        paint: { 'fill-color': '#38bdf8', 'fill-opacity': 0.45 },
      },
      {
        id: 'waterways-line',
        type: 'line',
        'source-layer': 'waterways',
        paint: {
          'line-color': '#0ea5e9',
          'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.4, 14, 2.5],
        },
      },
    ],
    legend: [
      { swatch: '#38bdf8', label: 'Reservoir / tank / lagoon', style: 'fill' },
      { swatch: '#0ea5e9', label: 'River / canal', style: 'solid' },
    ],
  },
  {
    id: 'metro',
    info: {
      source: 'Lanka Metro Transit, compiled by nuuuwan/lk_metro (MIT)',
      detail: 'The seven "CM" Metro Bus lines for the Colombo region — official codes, colours, distances and surveyed stops from nuuuwan/lk_metro. LMT has not published route polylines, so corridors are snapped to roads via OSRM (OpenStreetMap): the drawn line is an approximate corridor, but the stops and the distance shown are the surveyed figures.',
      year: '2026-08',
      url: 'https://github.com/nuuuwan/lk_metro',
    },
    label: 'Colombo Metro Bus',
    blurb: 'The new Lanka Metro Transit bus lines (CM01–CM08), each in its own colour. Tap a line for its route, or a stop for the lines it serves. Refresh: bun scripts/fetch-metro.mjs',
    category: 'infrastructure',
    defaultVisible: true,
    interactive: true,
    attribution: 'Lanka Metro Transit',
    source: { type: 'geojson', url: '/data/metro.geojson' },
    render: [
      {
        id: 'metro-line',
        type: 'line',
        filter: ['==', ['get', 'kind'], 'line'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 9, 2.5, 14, 5.5],
        },
      },
      // Ordinary (single-line) stops: a small tick dot, only once you're zoomed in.
      {
        id: 'metro-stops',
        type: 'circle',
        filter: ['all', ['==', ['get', 'kind'], 'stop'], ['==', ['get', 'route_count'], 1]],
        minzoom: 11.5,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11.5, 2.2, 15, 4.5],
          'circle-color': '#ffffff',
          'circle-stroke-color': '#334155',
          'circle-stroke-width': 1.4,
        },
      },
      // Interchanges (2+ lines) are the identifiable nodes — a bigger "station"
      // hub dot (dark disc, white ring), shown earlier than ordinary stops.
      {
        id: 'metro-interchange',
        type: 'circle',
        filter: ['all', ['==', ['get', 'kind'], 'stop'], ['>=', ['get', 'route_count'], 2]],
        minzoom: 9.5,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 9.5, 3.5, 15, 8],
          'circle-color': '#1e293b',
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2.2,
        },
      },
      // Repeating CM0x route bullet along each line, in the line's own colour —
      // this is what lets you tell overlapping corridors apart at a glance.
      {
        id: 'metro-line-labels',
        type: 'symbol',
        filter: ['==', ['get', 'kind'], 'line'],
        minzoom: 10.5,
        layout: {
          'symbol-placement': 'line',
          'symbol-spacing': 220,
          'text-field': ['get', 'code'],
          'text-size': 11,
          'text-font': ['Noto Sans Bold', 'Open Sans Bold', 'Noto Sans Regular'],
          'text-letter-spacing': 0.04,
          'text-optional': true,
        },
        paint: {
          'text-color': ['get', 'color'],
          'text-halo-color': '#ffffff',
          'text-halo-width': 2,
        },
      },
      {
        id: 'metro-interchange-labels',
        type: 'symbol',
        filter: ['all', ['==', ['get', 'kind'], 'stop'], ['>=', ['get', 'route_count'], 2]],
        minzoom: 11,
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 11,
          'text-offset': [0, 0.9],
          'text-anchor': 'top',
          'text-optional': true,
          'text-max-width': 8,
        },
        paint: { 'text-color': '#1e293b', 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 },
      },
      {
        id: 'metro-stop-labels',
        type: 'symbol',
        filter: ['all', ['==', ['get', 'kind'], 'stop'], ['==', ['get', 'route_count'], 1]],
        minzoom: 13,
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 10,
          'text-offset': [0, 0.7],
          'text-anchor': 'top',
          'text-optional': true,
          'text-max-width': 8,
        },
        paint: { 'text-color': '#475569', 'text-halo-color': '#ffffff', 'text-halo-width': 1.4 },
      },
    ],
    legend: [
      { swatch: '#0070a8', label: 'CM01 · Makumbura – Pettah', style: 'solid' },
      { swatch: '#ffd400', label: 'CM02 · Millennium City – Fort', style: 'solid' },
      { swatch: '#8a0f45', label: 'CM03 · Kadawatha – Makumbura', style: 'solid' },
      { swatch: '#f57c00', label: 'CM04 · Dematagoda – Panadura', style: 'solid' },
      { swatch: '#6f2dbd', label: 'CM05 · Battaramulla – Ekala', style: 'solid' },
      { swatch: '#72b043', label: 'CM06 · Kollupitiya circular', style: 'solid' },
      { swatch: '#006b3f', label: 'CM08 · Kesbewa – Pettah', style: 'solid' },
      { swatch: '#1e293b', label: 'Interchange (2+ lines)', style: 'fill' },
      { swatch: '#ffffff', label: 'Stop', style: 'fill' },
    ],
  },
  {
    id: 'metro_catchment',
    info: {
      source: 'OpenStreetMap walking network (Overpass) — walkshed computed by developing-country.org',
      detail: 'Pedestrian catchment as a flood-fill of the streets you can actually reach on foot from a stop in 5 min (≈400 m) and 10 min (≈800 m), following the real network — the standard transit catchment, which circles overestimate. Built by Dijkstra over the OSM foot network.',
      year: '2026-10 · ODbL',
      url: 'https://www.openstreetmap.org/',
    },
    label: 'Metro walk coverage',
    blurb: 'The streets you can reach on foot from a metro stop — bright = within 5 min, dim = within 10. Lit streets are served; dark ones aren’t. Click a stop for just its own reach. Refresh: bun scripts/build-metro-catchment.mjs',
    category: 'infrastructure',
    defaultVisible: false,
    interactive: true,
    attribution: '© OpenStreetMap contributors',
    source: { type: 'geojson', url: '/data/metro_catchment.geojson' },
    render: [
      {
        id: 'metro-cover-10',
        type: 'line',
        filter: ['all', ['==', ['get', 'kind'], 'stop'], ['>', ['get', 'd'], 400]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#0f766e',
          'line-opacity': 0.85,
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.6, 15, 2.4],
        },
      },
      {
        id: 'metro-cover-5',
        type: 'line',
        filter: ['all', ['==', ['get', 'kind'], 'stop'], ['<=', ['get', 'd'], 400]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#2dd4bf',
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.9, 15, 3],
        },
      },
      {
        // The overview camera necessarily makes the walkshed streets thin.
        // Keep a wider, visually transparent target above them so the embedded
        // detail interaction remains comfortable with a mouse or finger.
        id: 'metro-cover-hit',
        type: 'line',
        filter: ['==', ['get', 'kind'], 'stop'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#2dd4bf',
          'line-opacity': 0.01,
          'line-width': 12,
        },
      },
    ],
    legend: [
      { swatch: '#2dd4bf', label: '5-min walk streets (≈400 m)', style: 'solid' },
      { swatch: '#0f766e', label: '10-min walk streets (≈800 m)', style: 'solid' },
    ],
  },
  {
    id: 'metro_walksheds',
    info: {
      source: 'developing-country.org analysis of lk_metro stops (MIT), the OpenStreetMap walking network (ODbL), Census 2024 GN population and gig-data GN boundaries (MIT)',
      detail: 'Areas within a 5- and 10-minute walk (400 m / 800 m at 80 m/min) of the Colombo Metro Bus stops, following the real street network: every reached street buffered 50 m either side and unioned, per stop, per line and for the network. The dashed outline is the conventional 800 m straight-line circle — the gap between the two is what circles overstate. Population per area assumes even density within each GN division; residents only.',
      year: '2026-10 · ODbL',
      url: 'https://github.com/nuuuwan/lk_metro',
    },
    label: 'Metro walksheds',
    blurb: 'The area within a 5- and 10-minute walk of a Colombo Metro Bus stop, versus the 800 m circle planners usually draw. Line outlines use each route’s colour. Refresh: bun scripts/build-metro-coverage.mjs',
    category: 'infrastructure',
    defaultVisible: false,
    interactive: false,
    attribution: '© OpenStreetMap contributors · lk_metro · gig-data',
    source: { type: 'geojson', url: '/data/metro_walksheds.geojson' },
    render: [
      {
        id: 'metro-walkshed-10',
        type: 'fill',
        filter: ['all', ['==', ['get', 'kind'], 'network'], ['==', ['get', 'method'], 'network'], ['==', ['get', 'minutes'], 10]],
        paint: { 'fill-color': '#0f766e', 'fill-opacity': 0.22 },
      },
      {
        id: 'metro-walkshed-5',
        type: 'fill',
        filter: ['all', ['==', ['get', 'kind'], 'network'], ['==', ['get', 'method'], 'network'], ['==', ['get', 'minutes'], 5]],
        paint: { 'fill-color': '#2dd4bf', 'fill-opacity': 0.35 },
      },
      {
        // Each line's 10-min walkshed outlined in its own CM route colour.
        id: 'metro-walkshed-lines',
        type: 'line',
        filter: ['all', ['==', ['get', 'kind'], 'line'], ['==', ['get', 'method'], 'network'], ['==', ['get', 'minutes'], 10]],
        paint: {
          'line-color': ['get', 'color'],
          'line-opacity': 0.85,
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.6, 15, 1.6],
        },
      },
      {
        id: 'metro-walkshed-circle',
        type: 'line',
        filter: ['all', ['==', ['get', 'kind'], 'network'], ['==', ['get', 'method'], 'circle_800m']],
        paint: {
          'line-color': '#475569',
          'line-dasharray': [2, 2],
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.8, 15, 1.6],
        },
      },
    ],
    legend: [
      { swatch: '#2dd4bf', label: 'Within a 5-min walk (≈400 m)', style: 'fill' },
      { swatch: '#0f766e', label: 'Within a 10-min walk (≈800 m)', style: 'fill' },
      { swatch: '#475569', label: '800 m straight-line circles', style: 'dashed' },
    ],
  },
  {
    id: 'metro-gap-clusters',
    info: {
      source: 'developing-country.org analysis of Census 2024 GN population, gig-data GN boundaries (MIT), the OpenStreetMap walking network (ODbL) and lk_metro stops (MIT)',
      detail: 'Contiguous groups of dense GN divisions — at least 10,000 residents per km² (tier 1), or at least 5,000 per km² away from any tier-1 cluster (tier 2) — where less than 10% of the area is within a 10-minute walk of a Colombo Metro Bus stop. Only clusters with at least 15,000 residents beyond the walk are drawn. Population is spread evenly within each division; residents only.',
      year: '2026-10 · Census 2024',
      url: 'https://developing-country.org/data/metro-gap-clusters',
    },
    label: 'Metro gap clusters',
    blurb: 'Dense neighbourhoods near the Metro Bus lines where almost nobody lives within a 10-minute walk of a stop. Refresh: bun scripts/build-metro-alternatives.mjs',
    category: 'infrastructure',
    defaultVisible: false,
    interactive: false,
    attribution: '© OpenStreetMap contributors · gig-data · DCS Census 2024',
    source: { type: 'geojson', url: '/data/metro-gap-clusters.geojson' },
    render: [
      {
        id: 'metro-gap-fill',
        type: 'fill',
        paint: { 'fill-color': '#b91c1c', 'fill-opacity': ['match', ['get', 'tier'], 1, 0.16, 0.08] },
      },
      {
        id: 'metro-gap-outline',
        type: 'line',
        filter: ['==', ['get', 'tier'], 1],
        paint: { 'line-color': '#b91c1c', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.2, 15, 2.4] },
      },
      {
        id: 'metro-gap-outline-tier2',
        type: 'line',
        filter: ['==', ['get', 'tier'], 2],
        paint: {
          'line-color': '#b91c1c',
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.2, 15, 2.4],
          'line-dasharray': [3, 2],
        },
      },
      {
        id: 'metro-gap-labels',
        type: 'symbol',
        minzoom: 11,
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 11,
          'text-optional': true,
          'text-max-width': 10,
        },
        paint: { 'text-color': '#7f1d1d', 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 },
      },
    ],
    legend: [
      { swatch: '#b91c1c', label: 'Tier 1 gap (≥ 10,000 per km²)', style: 'solid' },
      { swatch: '#b91c1c', label: 'Tier 2 gap (≥ 5,000 per km²)', style: 'dashed' },
    ],
  },
  {
    id: 'metro-route-candidates',
    info: {
      source: 'developing-country.org analysis on OpenStreetMap main roads (ODbL), lk_metro stops (MIT) and the metro coverage model',
      detail: 'Illustrative links and extensions generated by a fixed rule: from each gap cluster to the nearest interchange stop, and from the nearest line terminus within 10 km, along OSM trunk to tertiary roads, with a new stop about every kilometre (the median CM stop spacing). Scored only on residents, offices, schools and hospitals newly within a walk — no demand, capacity, operations or cost. Not recommendations.',
      year: '2026-10 · ODbL',
      url: 'https://developing-country.org/data/metro-route-candidates',
    },
    label: 'Route candidates (illustrative)',
    blurb: 'Rule-generated links and extensions into the gap clusters, drawn dashed in their own colours, with proposed stops. Illustrations of a coverage rule, not plans. Refresh: bun scripts/build-metro-alternatives.mjs',
    category: 'infrastructure',
    defaultVisible: false,
    interactive: false,
    attribution: '© OpenStreetMap contributors · lk_metro',
    source: { type: 'geojson', url: '/data/metro-route-candidates.geojson' },
    render: [
      {
        id: 'metro-candidate-lines',
        type: 'line',
        filter: ['==', ['get', 'part'], 'route'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 15, 4],
          'line-dasharray': [2, 1.5],
        },
      },
      {
        id: 'metro-candidate-stops',
        type: 'circle',
        filter: ['==', ['get', 'part'], 'stop'],
        minzoom: 11,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 15, 5],
          'circle-color': '#ffffff',
          'circle-stroke-color': ['get', 'color'],
          'circle-stroke-width': 2,
        },
      },
    ],
    legend: [
      { swatch: '#e11d48', label: 'Candidate route (each in its own colour)', style: 'dashed' },
      { swatch: '#ffffff', label: 'Proposed stop', style: 'fill' },
    ],
  },
  // ---- Planned developments ----------------------------------------------
  {
    id: 'developments',
    info: {
      source: 'Sri Lankan government plans, ministries & operators (compiled)',
      detail: 'Ongoing and planned projects of national significance — ports, airports, expressways, rail/transit, energy and new towns/SEZs — compiled from official announcements and Sri Lankan media (2025–2026), plus the UDA Kandy Development Plan. Each pin carries its own source, a stage timeline with rough dates, investment where public, and links to the source and latest news. Last-checked date is per project. Provenance catalogue: scripts/data-sources.json.',
      year: '2025–2035',
      url: 'https://www.uda.gov.lk/',
    },
    label: 'Planned developments',
    blurb: 'Major projects reshaping Sri Lanka — Colombo Port City & port terminals, the BIA expansion, the light rail, the Hambantota refinery and more. Icon shows the type, colour the status. Tap one for status, money and timeline. (Expressways live in the Highways layer.)',
    category: 'planning',
    defaultVisible: false,
    interactive: true,
    attribution: 'UDA Kandy Development Plan',
    source: { type: 'geojson', url: '/data/developments.geojson' },
    render: [
      // Glyph = project type, colour = status (see developmentsIconMatch).
      pinLayer({ id: 'dev-points', icon: developmentsIconMatch, size: [0.5, 1.15] }),
      {
        id: 'dev-labels',
        type: 'symbol',
        filter: ['==', ['geometry-type'], 'Point'],
        minzoom: 9.5,
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 11,
          'text-offset': [0, 1.15],
          'text-anchor': 'top',
          'text-optional': true,
        },
        paint: { 'text-color': '#334155', 'text-halo-color': '#ffffff', 'text-halo-width': 1.4 },
      },
    ],
    // Two-axis legend: colour = status (three stages), glyph = what the project is.
    legend: [
      { swatch: DEV_STATUS_COLORS.op, label: 'Operational', style: 'fill' },
      { swatch: DEV_STATUS_COLORS.uc, label: 'Under construction', style: 'fill' },
      { swatch: DEV_STATUS_COLORS.pr, label: 'Proposed / planned', style: 'fill' },
      { swatch: '#64748b', label: DEV_GLYPHS.port.label, icon: iconId('dev-port-nt') },
      { swatch: '#64748b', label: DEV_GLYPHS.airport.label, icon: iconId('dev-airport-nt') },
      { swatch: '#64748b', label: DEV_GLYPHS.rail.label, icon: iconId('dev-rail-nt') },
      { swatch: '#64748b', label: DEV_GLYPHS.energy.label, icon: iconId('dev-energy-nt') },
      { swatch: '#64748b', label: DEV_GLYPHS.sez.label, icon: iconId('dev-sez-nt') },
      { swatch: '#64748b', label: DEV_GLYPHS.industry.label, icon: iconId('dev-industry-nt') },
      { swatch: '#64748b', label: DEV_GLYPHS.road.label, icon: iconId('dev-road-nt') },
      { swatch: '#64748b', label: DEV_GLYPHS.newtown.label, icon: iconId('dev-newtown-nt') },
    ],
  },
  // ---- BOI economic zones -------------------------------------------------
  {
    id: 'boi-zones',
    category: 'infrastructure',
    label: 'BOI economic zones',
    blurb:
      'Board of Investment Export Processing Zones & Industrial Parks. Refresh: bun scripts/build-boi-zones.mjs',
    defaultVisible: false,
    interactive: true,
    attribution: 'BOI Sri Lanka',
    source: { type: 'geojson', url: '/data/boi-zones.geojson' },
    info: {
      source: 'Board of Investment of Sri Lanka',
      detail:
        'Operational BOI Export Processing Zones & Industrial Parks (plus new/proposed zones). Boundaries are indicative — hand-placed to each zone’s published extent.',
      year: '2026 · curated',
      url: 'https://investsrilanka.com/',
    },
    render: [
      { id: 'boi-fill', type: 'fill', paint: { 'fill-color': boiStatusColor, 'fill-opacity': 0.18 } },
      { id: 'boi-outline', type: 'line', paint: { 'line-color': boiStatusColor, 'line-width': 1.6 } },
      // Factory badge at the zone centroid, coloured by status (reuses dev icons).
      pinLayer({ id: 'boi-badge', icon: boiZonesIconMatch, size: [0.34, 0.9], minzoom: 8 }),
      {
        id: 'boi-labels',
        type: 'symbol',
        minzoom: 9.5,
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 11,
          'text-offset': [0, 1.1],
          'text-anchor': 'top',
          'text-optional': true,
        },
        paint: { 'text-color': '#334155', 'text-halo-color': '#ffffff', 'text-halo-width': 1.4 },
      },
    ],
    legend: [
      { swatch: DEV_STATUS_COLORS.op, label: 'Operational', style: 'fill' },
      { swatch: DEV_STATUS_COLORS.uc, label: 'Under construction', style: 'fill' },
      { swatch: DEV_STATUS_COLORS.pr, label: 'Proposed', style: 'fill' },
    ],
  },
  // ---- Sea routes ---------------------------------------------------------
  {
    id: 'sea-routes',
    category: 'infrastructure',
    label: 'Sea routes',
    blurb:
      'Colombo container-shipping lanes + every real ferry in Sri Lanka (OSM). Refresh: bun scripts/build-sea-routes.mjs',
    defaultVisible: false,
    interactive: true,
    attribution: 'Eurostat marnet',
    source: { type: 'geojson', url: '/data/sea-routes.geojson' },
    info: {
      source: 'Eurostat marnet (searoute) · OpenStreetMap',
      detail:
        'Cargo lanes from Colombo are sea-routed over a global marine network (realistic corridors around land, not AIS-surveyed lanes). Ferries are the real routes from OpenStreetMap (route=ferry): the KKS↔Nagapattinam international ferry, the Jaffna lagoon islands, Trincomalee↔Mutur, and the river/lake crossings. Each route carries its distance.',
      year: '2026 · marnet + OSM',
      url: 'https://github.com/eurostat/searoute',
    },
    render: [
      {
        id: 'sea-routes-trunk',
        type: 'line',
        filter: ['==', ['get', 'service'], 'trunk'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': SEA_ROUTE_COLOR,
          'line-width': ['interpolate', ['linear'], ['zoom'], 3, 1.8, 8, 3.4],
          'line-opacity': 0.92,
        },
      },
      {
        id: 'sea-routes-feeder',
        type: 'line',
        filter: ['==', ['get', 'service'], 'feeder'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': SEA_ROUTE_COLOR,
          'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.9, 8, 2],
          'line-opacity': 0.85,
          'line-dasharray': [2.5, 2],
        },
      },
      {
        id: 'sea-routes-ferry',
        type: 'line',
        filter: ['==', ['get', 'service'], 'ferry'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': SEA_FERRY_COLOR,
          // International ferry a touch heavier than the local lagoon/river hops.
          'line-width': [
            'interpolate', ['linear'], ['zoom'],
            5, ['case', ['==', ['get', 'ferry_class'], 'international'], 2.2, 1.4],
            11, ['case', ['==', ['get', 'ferry_class'], 'international'], 3.8, 3],
          ],
          'line-opacity': 0.95,
        },
      },
      {
        id: 'sea-routes-labels',
        type: 'symbol',
        minzoom: 4,
        layout: {
          'symbol-placement': 'line',
          'text-field': ['get', 'to'],
          'text-size': 11,
          'symbol-spacing': 350,
          'text-optional': true,
        },
        paint: { 'text-color': '#0891b2', 'text-halo-color': '#ffffff', 'text-halo-width': 1.3 },
      },
    ],
    legend: [
      { swatch: SEA_ROUTE_COLOR, label: 'Trunk lane (hub ports)', style: 'solid' },
      { swatch: SEA_ROUTE_COLOR, label: 'Feeder route (regional)', style: 'dashed' },
      { swatch: SEA_FERRY_COLOR, label: 'Ferry route (OSM)', style: 'solid' },
    ],
  },
  // ---- Demographics -------------------------------------------------------
  // Population is NOT a generic group — it's the multi-level choropleth with a
  // level slider (province → district → division → GN), handled like climate.
  // See the "Population (multi-level)" section near the bottom of this file.
  // ---- Environment --------------------------------------------------------
  {
    id: 'hillshade',
    info: {
      source: 'NASA SRTM via AWS Terrain Tiles',
      detail: '~30 m elevation model rendered as shaded relief; also drives the 3D terrain view.',
      year: 'SRTM 2000',
      url: 'https://registry.opendata.aws/terrain-tiles/',
    },
    label: 'Terrain / elevation',
    blurb: 'Shaded hills and valleys, so you can read the slope of a plot at a glance.',
    category: 'environment',
    defaultVisible: false,
    attribution: 'AWS Terrain Tiles',
    source: { type: 'raster-dem', tiles: TERRAIN_TILES, encoding: 'terrarium' },
    render: [
      {
        id: 'hillshade',
        type: 'hillshade',
        paint: {
          'hillshade-exaggeration': 0.6,
          'hillshade-shadow-color': '#4a3b2a',
          'hillshade-highlight-color': '#ffffff',
        },
      },
    ],
    legend: [{ swatch: 'linear-gradient(90deg,#4a3b2a,#fff)', label: 'Low → high relief', style: 'fill' }],
  },
  {
    id: 'land-cover-grid',
    info: {
      source: 'European Space Agency · WorldCover consortium',
      detail: 'ESA WorldCover 2021 v200 modeled at 10 m, summarized here into an approximately 5 km grid. Each cell shows its dominant class. “Vegetated” groups land-cover classes; it is not NDVI, live greenness, or vegetation condition. Global overall accuracy is 76.7%; local accuracy varies.',
      year: '2021 v200 · CC BY 4.0',
      url: 'https://esa-worldcover.org/en/data-access',
    },
    label: 'Land cover',
    blurb: 'The dominant modeled class in each ~5 km cell—not a live satellite or greenness reading.',
    category: 'environment',
    defaultVisible: false,
    interactive: true,
    attribution: '© ESA WorldCover project 2021 · Contains modified Copernicus Sentinel data (2021)',
    source: { type: 'geojson', url: '/data/land-cover-grid.geojson', lazy: true },
    render: [
      {
        id: 'land-cover-grid-fill',
        type: 'fill',
        paint: {
          'fill-color': landCoverColor,
          'fill-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.62, 10, 0.72],
          // A hairline makes the coarse analytical grid legible without the
          // detached card/shadow treatment used nowhere else in the explorer.
          'fill-outline-color': 'rgba(255,255,255,0.22)',
        },
      },
    ],
    legend: LAND_COVER_CLASSES.map((entry) => ({
      swatch: entry.color,
      label: entry.label,
      style: 'fill' as const,
    })),
  },
  {
    id: 'population-change',
    info: {
      source: 'Dept. of Census & Statistics via nuuuwan/lk_census_2024 + gig-data',
      detail: 'Percent change in resident population between Census 2012 and Census 2024 for the 25 districts. District join is 100%. 2012 counts are the gig-data geometry attribute and differ from Final Report Table 6.1.11 in four districts. This is not a DSD or GN change map — those codes were recoded in several districts.',
      year: 'Census 2012 and Census 2024',
      url: 'https://www.statistics.gov.lk/Population/StaticalInformation/CPH2024',
    },
    label: 'Population change',
    blurb: 'How much each district grew between Census 2012 and Census 2024. Every district grew; deeper green grew more.',
    category: 'demographics',
    defaultVisible: false,
    interactive: true,
    attribution: 'Census 2012 & 2024, Department of Census and Statistics',
    source: { type: 'geojson', url: '/data/demographics.geojson', lazy: true },
    render: [
      {
        id: 'population-change-fill',
        type: 'fill',
        paint: {
          'fill-color': popChangeColor,
          'fill-opacity': 0.55,
          'fill-outline-color': 'rgba(11, 31, 58, 0.35)',
        },
      },
    ],
    legend: [
      { swatch: '#c7e9c0', label: '< 5%', style: 'fill' },
      { swatch: '#74c476', label: '~7% (island-wide)', style: 'fill' },
      { swatch: '#31a354', label: '~15%', style: 'fill' },
      { swatch: '#006d2c', label: '> 25%', style: 'fill' },
    ],
  },
  // ---- Explore: nature & tourism -----------------------------------------
  {
    id: 'attractions',
    info: {
      source: 'OpenStreetMap',
      detail: 'Temples, forts, museums, viewpoints, archaeological sites and other points of interest, coloured by category.',
      year: '2026-10 · ODbL',
      url: 'https://www.openstreetmap.org/',
    },
    label: 'Attractions',
    blurb: 'Temples, forts, museums and viewpoints across the island.',
    category: 'explore',
    defaultVisible: false,
    interactive: true,
    attribution: '© OpenStreetMap contributors',
    source: { type: 'geojson', url: '/data/attractions.geojson' },
    render: [
      // 1129 points across the island: the pin shrinks to a coloured dot at
      // island zoom and blooms into a legible glyph as you come in.
      pinLayer({ id: 'attractions-points', icon: attractionIconMatch, size: [0.3, 0.95] }),
      {
        id: 'attractions-labels',
        type: 'symbol',
        minzoom: 11,
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 11,
          'text-offset': [0, 0.6],
          'text-anchor': 'top',
          'text-optional': true,
          'text-max-width': 8,
        },
        paint: { 'text-color': '#334155', 'text-halo-color': '#ffffff', 'text-halo-width': 1.4 },
      },
    ],
    legend: [
      { swatch: ATTRACTION_COLORS.attraction, label: 'Attraction', icon: iconId('attraction') },
      { swatch: ATTRACTION_COLORS.viewpoint, label: 'Viewpoint', icon: iconId('viewpoint') },
      { swatch: ATTRACTION_COLORS.monument, label: 'Monument', icon: iconId('monument') },
      { swatch: ATTRACTION_COLORS.museum, label: 'Museum', icon: iconId('museum') },
      { swatch: ATTRACTION_COLORS.archaeological_site, label: 'Archaeological site', icon: iconId('archaeological_site') },
      { swatch: ATTRACTION_COLORS.ruins, label: 'Ruins / fort / castle', icon: iconId('ruins') },
      { swatch: ATTRACTION_COLORS.zoo, label: 'Zoo / wildlife', icon: iconId('zoo') },
    ],
  },
  {
    id: 'waterfalls',
    info: {
      source: 'OpenStreetMap',
      detail: 'Waterfalls mapped across the island.',
      year: '2026-10 · ODbL',
      url: 'https://www.openstreetmap.org/',
    },
    label: 'Waterfalls',
    blurb: 'Waterfalls across the wet zone and hill country.',
    category: 'explore',
    defaultVisible: false,
    interactive: true,
    attribution: '© OpenStreetMap contributors',
    source: { type: 'geojson', url: '/data/waterfalls.geojson' },
    render: [
      pinLayer({ id: 'waterfalls-points', icon: iconId('waterfall'), size: [0.34, 1] }),
      {
        id: 'waterfalls-labels',
        type: 'symbol',
        minzoom: 10,
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 11,
          'text-offset': [0, 0.6],
          'text-anchor': 'top',
          'text-optional': true,
          'text-max-width': 8,
        },
        paint: { 'text-color': '#0e7490', 'text-halo-color': '#ffffff', 'text-halo-width': 1.4 },
      },
    ],
    legend: [{ swatch: EXPLORE_COLORS.waterfall, label: 'Waterfall', icon: iconId('waterfall') }],
  },
  {
    id: 'irrigation-gauges',
    info: {
      source: 'Irrigation Department of Sri Lanka via nuuuwan/lk_irrigation',
      detail: 'Forty hydrology stations with published alert, minor-flood and major-flood levels. This is a static station list, not a live flood bulletin and not a flood-hazard zonation map.',
      year: '2026-09 · thresholds as compiled',
      url: 'https://www.irrigation.gov.lk/web/index.php?option=com_content&view=article&id=27&Itemid=128&lang=en',
    },
    label: 'River gauges',
    blurb: 'Irrigation Department river stations and their published flood thresholds. Live water levels are not in this layer.',
    category: 'environment',
    defaultVisible: false,
    interactive: true,
    attribution: 'Irrigation Department of Sri Lanka · compiled by nuuuwan/lk_irrigation',
    source: { type: 'geojson', url: '/data/irrigation-gauges.geojson' },
    render: [
      pinLayer({ id: 'irrigation-gauges-points', icon: iconId('gauge'), size: [0.4, 1] }),
      {
        id: 'irrigation-gauges-labels',
        type: 'symbol',
        minzoom: 8,
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 11,
          'text-offset': [0, 0.6],
          'text-anchor': 'top',
          'text-optional': true,
          'text-max-width': 8,
        },
        paint: { 'text-color': '#0e7490', 'text-halo-color': '#ffffff', 'text-halo-width': 1.4 },
      },
    ],
    legend: [{ swatch: iconColor('gauge'), label: 'River gauge', icon: iconId('gauge') }],
  },
  {
    id: 'trails',
    info: {
      source: 'OpenStreetMap (route=hiking)',
      detail: 'Hiking route relations, including the 22 Pekoe Trail stages, Knuckles and Horton Plains trails.',
      year: '2026-10 · ODbL',
      url: 'https://www.openstreetmap.org/',
    },
    label: 'Hiking trails',
    blurb: 'Hiking routes, including every stage of the Pekoe Trail.',
    category: 'explore',
    defaultVisible: false,
    interactive: true,
    attribution: '© OpenStreetMap contributors',
    source: { type: 'geojson', url: '/data/trails.geojson' },
    render: [
      {
        id: 'trails-line',
        type: 'line',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': EXPLORE_COLORS.trail,
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1.5, 14, 4],
          'line-dasharray': [2, 1],
        },
      },
      {
        id: 'trails-labels',
        type: 'symbol',
        minzoom: 10,
        layout: {
          'symbol-placement': 'line',
          'text-field': ['get', 'name'],
          'text-size': 11,
          'text-optional': true,
        },
        paint: { 'text-color': '#166534', 'text-halo-color': '#ffffff', 'text-halo-width': 1.4 },
      },
      // One boot pin at the middle of each route, so a line layer still gets a
      // recognisable marker without cluttering the whole path.
      pinLayer({
        id: 'trails-marker',
        icon: iconId('trail'),
        size: [0.45, 0.9],
        minzoom: 8,
        placement: 'line-center',
        collide: true,
        padding: 60,
      }),
    ],
    legend: [
      { swatch: EXPLORE_COLORS.trail, label: 'Hiking route', style: 'dashed' },
      { swatch: EXPLORE_COLORS.trail, label: 'Route marker', icon: iconId('trail') },
    ],
  },
  {
    id: 'cycling',
    info: {
      source: 'OpenStreetMap (route=bicycle)',
      detail: 'Mapped cycling route relations.',
      year: '2026-10 · ODbL',
      url: 'https://www.openstreetmap.org/',
    },
    label: 'Cycling routes',
    blurb: 'Mapped bicycle routes.',
    category: 'explore',
    defaultVisible: false,
    interactive: true,
    attribution: '© OpenStreetMap contributors',
    source: { type: 'geojson', url: '/data/cycling.geojson' },
    render: [
      {
        id: 'cycling-line',
        type: 'line',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': EXPLORE_COLORS.cycling,
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1.5, 14, 4],
        },
      },
      pinLayer({
        id: 'cycling-marker',
        icon: iconId('cycling'),
        size: [0.45, 0.9],
        minzoom: 8,
        placement: 'line-center',
        collide: true,
        padding: 60,
      }),
    ],
    legend: [
      { swatch: EXPLORE_COLORS.cycling, label: 'Cycling route', style: 'solid' },
      { swatch: EXPLORE_COLORS.cycling, label: 'Route marker', icon: iconId('cycling') },
    ],
  },
  {
    id: 'parks',
    info: {
      source: 'OpenStreetMap (protected areas)',
      detail: 'National parks, nature reserves and protected areas (boundary polygons).',
      year: '2026-10 · ODbL',
      url: 'https://www.openstreetmap.org/',
    },
    label: 'Parks & reserves',
    blurb: 'National parks, nature reserves and protected areas.',
    category: 'explore',
    defaultVisible: false,
    interactive: true,
    attribution: '© OpenStreetMap contributors',
    source: { type: 'geojson', url: '/data/parks.geojson' },
    render: [
      {
        id: 'parks-fill',
        type: 'fill',
        paint: { 'fill-color': EXPLORE_COLORS.park, 'fill-opacity': 0.22 },
      },
      {
        id: 'parks-outline',
        type: 'line',
        paint: { 'line-color': '#15803d', 'line-width': 1, 'line-opacity': 0.7 },
      },
      {
        id: 'parks-labels',
        type: 'symbol',
        minzoom: 9,
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 11,
          'text-optional': true,
          'text-max-width': 9,
        },
        paint: { 'text-color': '#166534', 'text-halo-color': '#ffffff', 'text-halo-width': 1.4 },
      },
      // A polygon source still places a symbol layer at each feature's centroid.
      pinLayer({ id: 'parks-marker', icon: iconId('park'), size: [0.45, 0.9], minzoom: 8 }),
    ],
    legend: [
      { swatch: EXPLORE_COLORS.park, label: 'Protected area', style: 'fill' },
      { swatch: EXPLORE_COLORS.park, label: 'Park marker', icon: iconId('park') },
    ],
  },
  {
    id: 'stepper',
    info: {
      source: 'steppermap.com by @Stepper9210',
      detail: 'Hand-picked spots — waterfalls, hikes, cultural sites and food stops — fetched live from steppermap.com. Shared with permission; all content © @Stepper9210, and each pin links to his YouTube / Instagram.',
      year: 'live',
      url: 'https://steppermap.com/',
    },
    label: 'Stepper spots',
    blurb: 'Hand-picked spots, each with a video. Waterfalls, hikes, ruins and food stops.',
    category: 'explore',
    defaultVisible: false,
    interactive: true,
    attribution: 'steppermap.com',
    source: { type: 'api', endpoint: '/api/stepper' },
    render: [
      // A curated feed of ~dozens of spots, each with a video: one house glyph
      // (the play triangle) so they read as a single creator layer at a glance,
      // rather than a second, mismatched emoji family sitting on the pin. The
      // feed's own emoji still leads the label and the detail sheet, so the
      // data's character survives where there's room to read it.
      pinLayer({ id: 'stepper-points', icon: iconId('stepper'), size: [0.5, 1] }),
      {
        id: 'stepper-labels',
        type: 'symbol',
        minzoom: 10,
        layout: {
          'text-field': ['concat', ['coalesce', ['get', 'emoji'], ''], ' ', ['get', 'name']],
          'text-size': 11,
          'text-offset': [0, 0.6],
          'text-anchor': 'top',
          'text-optional': true,
          'text-max-width': 8,
        },
        paint: { 'text-color': '#9f1239', 'text-halo-color': '#ffffff', 'text-halo-width': 1.4 },
      },
    ],
    legend: [{ swatch: EXPLORE_COLORS.stepper, label: 'Stepper spot', icon: iconId('stepper') }],
  },
  // ---- Community: your prospects -----------------------------------------
  {
    id: 'prospects',
    info: {
      source: 'Your portfolio (developing-country.org)',
      detail: 'Properties you (or your AI assistant) have registered. Private to you by default; public ones shared by other users also appear here.',
      year: 'live',
      url: 'https://explore.developing-country.org',
    },
    label: 'My prospects',
    blurb: 'Properties you saved, as gold pins. Only you can see them.',
    category: 'community',
    defaultVisible: false,
    interactive: true,
    source: { type: 'api', endpoint: '/api/prospects' },
    render: [
      // A handful of user-owned pins — never let collision hide one.
      pinLayer({ id: 'prospects-points', icon: iconId('prospect'), size: [0.6, 1.1] }),
      {
        id: 'prospects-labels',
        type: 'symbol',
        minzoom: 9,
        layout: {
          'text-field': ['get', 'title'],
          'text-size': 11,
          'text-offset': [0, 0.6],
          'text-anchor': 'top',
          'text-optional': true,
          'text-max-width': 9,
        },
        paint: { 'text-color': '#92400e', 'text-halo-color': '#ffffff', 'text-halo-width': 1.4 },
      },
    ],
    legend: [{ swatch: COMMUNITY_COLORS.prospect, label: 'Prospect', icon: iconId('prospect') }],
  },
  {
    id: 'analyses',
    info: {
      source: 'developing-country.org — your own analysis runs',
      detail: 'Every place you (or your AI assistant) ran a location analysis on — from Analyze mode here or the analyze_location MCP tool. Private to you.',
      year: '2026 · live',
      url: 'https://explore.developing-country.org',
    },
    label: 'My analyses',
    blurb: 'Places you analysed, as violet pins. Only you can see them. Send your AI assistant a listing link and it lands here.',
    category: 'community',
    defaultVisible: false,
    interactive: true,
    source: { type: 'api', endpoint: '/api/analyses' },
    render: [
      pinLayer({ id: 'analyses-points', icon: iconId('analysis'), size: [0.6, 1.1] }),
      {
        id: 'analyses-labels',
        type: 'symbol',
        minzoom: 9,
        layout: {
          'text-field': ['coalesce', ['get', 'title'], ['get', 'summary'], 'Analysis'],
          'text-size': 11,
          'text-offset': [0, 0.6],
          'text-anchor': 'top',
          'text-optional': true,
          'text-max-width': 9,
        },
        paint: { 'text-color': '#334155', 'text-halo-color': '#ffffff', 'text-halo-width': 1.4 },
      },
    ],
    legend: [{ swatch: COMMUNITY_COLORS.analysis, label: 'Analysis run', icon: iconId('analysis') }],
  },
  {
    id: 'schools',
    info: {
      source: 'OpenStreetMap',
      detail: 'Named schools, colleges, universities and kindergartens (amenity=school|college|university|kindergarten). osm_only — not a Ministry of Education register.',
      year: '2026-10 · ODbL',
      url: 'https://www.openstreetmap.org/',
    },
    label: 'Schools',
    blurb: 'OSM schools, colleges and universities. Not an MoE register. Refresh: bun scripts/fetch-civic-poi.mjs',
    category: 'infrastructure',
    defaultVisible: false,
    interactive: true,
    attribution: '© OpenStreetMap contributors',
    source: { type: 'geojson', url: '/data/schools.geojson' },
    render: [
      pinLayer({ id: 'schools-points', icon: iconId('school'), size: [0.28, 0.9] }),
      {
        id: 'schools-labels',
        type: 'symbol',
        minzoom: 12,
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 11,
          'text-offset': [0, 0.6],
          'text-anchor': 'top',
          'text-optional': true,
          'text-max-width': 8,
        },
        paint: { 'text-color': '#1e3a8a', 'text-halo-color': '#ffffff', 'text-halo-width': 1.4 },
      },
    ],
    legend: [{ swatch: iconColor('school'), label: 'School / college / university', icon: iconId('school') }],
  },
  {
    id: 'hospitals',
    info: {
      source: 'OpenStreetMap',
      detail: 'Named hospitals and clinics (amenity=hospital|clinic). osm_only — not a Ministry of Health register. OSM clinics are not the MoH clinic class.',
      year: '2026-10 · ODbL',
      url: 'https://www.openstreetmap.org/',
    },
    label: 'Hospitals & clinics',
    blurb: 'OSM hospitals and clinics. Not an MoH register. Refresh: bun scripts/fetch-civic-poi.mjs',
    category: 'infrastructure',
    defaultVisible: false,
    interactive: true,
    attribution: '© OpenStreetMap contributors',
    source: { type: 'geojson', url: '/data/hospitals.geojson' },
    render: [
      pinLayer({ id: 'hospitals-points', icon: hospitalIconMatch, size: [0.3, 0.95] }),
      {
        id: 'hospitals-labels',
        type: 'symbol',
        minzoom: 12,
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 11,
          'text-offset': [0, 0.6],
          'text-anchor': 'top',
          'text-optional': true,
          'text-max-width': 8,
        },
        paint: { 'text-color': '#7f1d1d', 'text-halo-color': '#ffffff', 'text-halo-width': 1.4 },
      },
    ],
    legend: [
      { swatch: iconColor('hospital'), label: 'Hospital', icon: iconId('hospital') },
      { swatch: iconColor('clinic'), label: 'Clinic', icon: iconId('clinic') },
    ],
  },
  {
    id: 'workplaces',
    info: {
      source: 'Overture Maps Foundation — Places (release 2026-09-23.1)',
      detail: 'Office listings around the Colombo Metro Bus lines: corporate and business offices, government offices, banks and financial services, professional, real-estate, media, design and B2B logistics services. Listings with confidence below 0.5 or marked closed are dropped, and only rows whose sources are CDLA-Permissive-2.0, Apache-2.0 or CC0 are kept. These are listings, not jobs: no headcount or floor area, and coverage is uneven.',
      year: '2026-09-23.1 · CDLA-Permissive-2.0',
      url: 'https://docs.overturemaps.org/guides/places/',
    },
    label: 'Offices',
    blurb: 'Where Colombo’s offices are, from Overture Maps listings — colour shows government, corporate, financial and professional offices. Listings, not job counts. Refresh: uvx --with duckdb python -I scripts/fetch-overture-places.py && bun scripts/build-workplaces.mjs',
    category: 'infrastructure',
    defaultVisible: false,
    interactive: false,
    attribution: '© Overture Maps Foundation (CDLA-Permissive-2.0)',
    source: { type: 'geojson', url: '/data/workplaces.geojson' },
    render: [
      {
        id: 'workplaces-points',
        type: 'circle',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 1.6, 15, 5],
          'circle-color': [
            'match',
            ['get', 'office_type'],
            'government', '#1d4ed8',
            'corporate', '#7c3aed',
            'financial', '#047857',
            'professional', '#b45309',
            '#64748b',
          ],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 10, 0, 14, 1],
          'circle-opacity': 0.85,
        },
      },
      {
        id: 'workplaces-labels',
        type: 'symbol',
        minzoom: 15,
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 10,
          'text-offset': [0, 0.7],
          'text-anchor': 'top',
          'text-optional': true,
          'text-max-width': 8,
        },
        paint: { 'text-color': '#334155', 'text-halo-color': '#ffffff', 'text-halo-width': 1.4 },
      },
    ],
    legend: [
      { swatch: '#1d4ed8', label: 'Government office', style: 'fill' },
      { swatch: '#7c3aed', label: 'Corporate office', style: 'fill' },
      { swatch: '#047857', label: 'Bank or financial service', style: 'fill' },
      { swatch: '#b45309', label: 'Professional service', style: 'fill' },
      { swatch: '#64748b', label: 'Real estate, media, design, logistics', style: 'fill' },
    ],
  },
]

export const CATEGORIES: { id: LayerCategory; label: string }[] = [
  { id: 'infrastructure', label: 'Infrastructure' },
  { id: 'planning', label: 'Planned developments' },
  { id: 'demographics', label: 'Demographics' },
  { id: 'environment', label: 'Environment' },
  { id: 'explore', label: 'Explore — nature & tourism' },
  { id: 'community', label: 'Community' },
]

/**
 * A group is available if it doesn't need the pipeline, or its PMTiles file has
 * been generated + uploaded (listed in VITE_TILES). Lets us ship roads/water
 * before climate without the climate toggle appearing active-but-empty.
 */
export function isGroupAvailable(g: LayerGroup): boolean {
  if (!g.requiresPipeline) return true
  return g.source.type === 'vector-pmtiles' && AVAILABLE_TILES.has(g.source.file)
}

/** The independently-toggleable units for a group (one, or one per render layer). */
export function groupUnits(g: LayerGroup): ToggleUnit[] {
  if (g.perLayerToggle) {
    return g.render.map((l) => {
      const meta = l.metadata?.unit
      return {
        id: l.id,
        label: meta?.label ?? l.id,
        groupId: g.id,
        layerIds: [l.id],
        legend: meta?.legend ? [meta.legend] : [],
        defaultVisible: g.defaultVisible,
      }
    })
  }
  return [
    {
      id: g.id,
      label: g.label,
      groupId: g.id,
      layerIds: g.render.map((l) => l.id),
      legend: g.legend,
      defaultVisible: g.defaultVisible,
    },
  ]
}

/** All toggle units across every group — used to seed VisibilityState. */
export function allUnits(): ToggleUnit[] {
  return LAYER_GROUPS.flatMap(groupUnits)
}

// --- Climate (rainfall / temperature / humidity, annual + 12 months) --------
// Climate is handled outside the generic group/unit model: one shared time
// dimension (annual + Jan..Dec) drives whichever variable is picked. The data
// ships as 39 contour layers in climate.pmtiles (`<var>_00` = annual, `_01..12`
// = months), so month scrubbing is just a visibility swap — no refetch.

/** month index 0..12 -> short label (0 = annual mean). */
export const CLIMATE_MONTHS = [
  'Annual', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const

export interface ClimateVariable {
  id: 'rainfall' | 'temperature' | 'humidity'
  label: string
  short: string
  unit: string
  blurb: string
  /** interpolate stops [value,color,…] — rainfall differs a lot annual vs monthly. */
  rampAnnual: (number | string)[]
  rampMonthly: (number | string)[]
  legendAnnual: LegendItem[]
  legendMonthly: LegendItem[]
}

export const CLIMATE_VARIABLES: ClimateVariable[] = [
  {
    id: 'rainfall',
    label: 'Rainfall',
    short: 'Rain',
    unit: 'mm',
    blurb: 'Where the rain falls, and how hard the monsoon swings through the year.',
    rampAnnual: [500, '#fff5eb', 1000, '#fdd0a2', 1500, '#74c476', 2500, '#2171b5', 4000, '#08306b'],
    rampMonthly: [10, '#fff5eb', 60, '#fdd0a2', 150, '#74c476', 300, '#2171b5', 550, '#08306b'],
    legendAnnual: [
      { swatch: '#fdd0a2', label: '< 1000 mm/yr (dry)', style: 'fill' },
      { swatch: '#74c476', label: '~1500 mm/yr', style: 'fill' },
      { swatch: '#2171b5', label: '~2500 mm/yr', style: 'fill' },
      { swatch: '#08306b', label: '> 4000 mm/yr (wet)', style: 'fill' },
    ],
    legendMonthly: [
      { swatch: '#fdd0a2', label: '< 60 mm/mo (dry)', style: 'fill' },
      { swatch: '#74c476', label: '~150 mm/mo', style: 'fill' },
      { swatch: '#2171b5', label: '~300 mm/mo', style: 'fill' },
      { swatch: '#08306b', label: '> 550 mm/mo (monsoon)', style: 'fill' },
    ],
  },
  {
    id: 'temperature',
    label: 'Temperature',
    short: 'Temp',
    unit: '°C',
    blurb: 'Where it stays cool and where it runs hot.',
    rampAnnual: [16, '#2166ac', 20, '#67a9cf', 24, '#fddbc7', 28, '#ef8a62', 32, '#b2182b'],
    rampMonthly: [16, '#2166ac', 20, '#67a9cf', 24, '#fddbc7', 28, '#ef8a62', 32, '#b2182b'],
    legendAnnual: [
      { swatch: '#2166ac', label: '~16°C (highlands)', style: 'fill' },
      { swatch: '#fddbc7', label: '~24°C', style: 'fill' },
      { swatch: '#b2182b', label: '~32°C (dry zone)', style: 'fill' },
    ],
    legendMonthly: [
      { swatch: '#2166ac', label: '~16°C (highlands)', style: 'fill' },
      { swatch: '#fddbc7', label: '~24°C', style: 'fill' },
      { swatch: '#b2182b', label: '~32°C (dry zone)', style: 'fill' },
    ],
  },
  {
    id: 'humidity',
    label: 'Humidity',
    short: 'Humid',
    unit: '% RH',
    blurb: 'How muggy it gets, month by month.',
    rampAnnual: [55, '#fee08b', 70, '#d9ef8b', 80, '#66bd63', 92, '#1a9850'],
    rampMonthly: [55, '#fee08b', 70, '#d9ef8b', 80, '#66bd63', 92, '#1a9850'],
    legendAnnual: [
      { swatch: '#fee08b', label: '~60% RH (dry)', style: 'fill' },
      { swatch: '#66bd63', label: '~80% RH', style: 'fill' },
      { swatch: '#1a9850', label: '~90% RH (humid)', style: 'fill' },
    ],
    legendMonthly: [
      { swatch: '#fee08b', label: '~60% RH (dry)', style: 'fill' },
      { swatch: '#66bd63', label: '~80% RH', style: 'fill' },
      { swatch: '#1a9850', label: '~90% RH (humid)', style: 'fill' },
    ],
  },
]

export const CLIMATE_SOURCE_ID = 'climate'

/** Two-digit timestep suffix used in the pmtiles source-layer names. */
export const climateStep = (month: number) => String(month).padStart(2, '0')

/** id of the fill layer for a given (variable, month). */
export const climateLayerId = (variable: string, month: number) =>
  `climate-${variable}-${climateStep(month)}`

/** All 39 fill layers (every variable × timestep), added hidden; MapView shows one. */
export function climateFillLayers(): RenderLayer[] {
  const layers: RenderLayer[] = []
  for (const v of CLIMATE_VARIABLES) {
    for (let m = 0; m <= 12; m++) {
      layers.push({
        id: climateLayerId(v.id, m),
        type: 'fill',
        'source-layer': `${v.id}_${climateStep(m)}`,
        layout: { visibility: 'none' },
        paint: {
          'fill-opacity': 0.6,
          'fill-color': ['interpolate', ['linear'], ['get', 'value'], ...(m === 0 ? v.rampAnnual : v.rampMonthly)],
        },
      })
    }
  }
  return layers
}

export const climateLegend = (v: ClimateVariable, month: number): LegendItem[] =>
  month === 0 ? v.legendAnnual : v.legendMonthly

/** climate.pmtiles present (listed in VITE_TILES)? */
export const isClimateAvailable = (): boolean => AVAILABLE_TILES.has('climate.pmtiles')

export const CLIMATE_INFO: SourceInfo = {
  source: 'WorldClim 2.1',
  detail: 'Gridded climate normals (2.5 arc-min): precipitation & mean temperature; humidity derived from vapour pressure. Annual mean + 12 monthly means.',
  year: 'normals 1970–2000',
  url: 'https://www.worldclim.org/',
}

// --- Population (multi-level choropleth) ------------------------------------
// One demographics.pmtiles with four source-layers; a level slider picks which.
// Like climate, this is handled outside the generic group model (its own control
// in the panel + imperative visibility in MapView). Coloured by density so the
// question "does the route touch the crowded areas?" reads at a glance.

export const DEMOGRAPHICS_SOURCE_ID = 'demographics'

export const POP_LEVELS = [
  { id: 'province', label: 'Province', short: 'Province', blurb: 'Population density by province (9).' },
  { id: 'district', label: 'District', short: 'District', blurb: 'Population density by district (25).' },
  { id: 'dsd', label: 'Division', short: 'Division', blurb: 'Density by Divisional Secretariat (331) — town / suburb level.' },
  { id: 'gnd', label: 'GN division', short: 'GN', blurb: 'Density by Grama Niladhari division (~14,000) — the finest census unit.' },
] as const
export type PopLevelId = (typeof POP_LEVELS)[number]['id']

// One ramp spanning rural (~200) to inner-Colombo GND (~50k /km²); coarse levels
// top out around the mid stops, fine levels use the full range. A warm "heat"
// ramp (crowded = hot) — reads on both the light and the dark basemap, unlike a
// blue ramp whose dark end vanishes on the dark map.
const POP_RAMP: (number | string)[] = [
  100, '#ffffb2', 600, '#fed976', 2000, '#feb24c', 5000, '#fd8d3c', 12000, '#fc4e2a', 25000, '#e31a1c', 45000, '#b10026',
]

export const popLayerId = (level: string) => `pop-${level}`

/** One hidden fill + outline per level; MapView shows the selected one. */
export function populationLayers(): RenderLayer[] {
  const out: RenderLayer[] = []
  for (const l of POP_LEVELS) {
    out.push({
      id: popLayerId(l.id),
      type: 'fill',
      'source-layer': l.id,
      layout: { visibility: 'none' },
      // Translucent so the basemap + metro/road lines read through the choropleth.
      paint: { 'fill-opacity': 0.4, 'fill-color': ['interpolate', ['linear'], ['get', 'dens'], ...POP_RAMP] },
    })
    out.push({
      id: `${popLayerId(l.id)}-line`,
      type: 'line',
      'source-layer': l.id,
      layout: { visibility: 'none' },
      paint: { 'line-color': '#0b1f3a', 'line-width': l.id === 'gnd' ? 0.2 : 0.5, 'line-opacity': 0.35 },
    })
  }
  return out
}

export const POP_LEGEND: LegendItem[] = [
  { swatch: '#fed976', label: '< 600 /km²', style: 'fill' },
  { swatch: '#feb24c', label: '~2k /km²', style: 'fill' },
  { swatch: '#fc4e2a', label: '~12k /km²', style: 'fill' },
  { swatch: '#b10026', label: '> 25k /km² (inner Colombo)', style: 'fill' },
]

export const isDemographicsAvailable = (): boolean => AVAILABLE_TILES.has('demographics.pmtiles')

export const DEMOGRAPHICS_INFO: SourceInfo = {
  source: 'Dept. of Census & Statistics via nuuuwan/lk_census_2024 + gig-data (MIT)',
  detail: 'Resident population + density at four levels — province, district, division (DSD), and GN division (~14,000). Choropleth tiles and the GND index join Census 2024 Person-Sex on gig-data id (97.4% GND match; unmatched units keep Census 2012 pop and stamp vintage 2012). Every unit has properties.id so gap highlight can match.',
  year: 'Census 2024',
  url: 'https://github.com/nuuuwan/lk_census_2024',
}

export const SUN_INFO: SourceInfo = {
  source: 'Computed on-device (SunCalc)',
  detail: 'Solar geometry from date + coordinates — astronomical, not weather. No external dataset or network call.',
  url: 'https://github.com/mourner/suncalc',
}

// Dual SSOT with src/shared/registry-ids.json (ontology + check-ontology.mjs).
// Throw at module load so a paint-only layer cannot ship without an ontology row.
function assertIdList(got: readonly string[], want: readonly string[], label: string) {
  if (got.length === want.length && got.every((id, i) => id === want[i])) return
  const missing = want.filter((id) => !got.includes(id))
  const extra = got.filter((id) => !want.includes(id))
  throw new Error(
    `${label} drifted from src/shared/registry-ids.json` +
      (missing.length ? `; missing ${missing.join(', ')}` : '') +
      (extra.length ? `; extra ${extra.join(', ')}` : '') +
      (missing.length === 0 && extra.length === 0 ? '; order differs' : ''),
  )
}
assertIdList(
  LAYER_GROUPS.map((g) => g.id),
  registryIds.layer_groups,
  'LAYER_GROUPS',
)
assertIdList(
  POP_LEVELS.map((l) => l.id),
  registryIds.pop_levels,
  'POP_LEVELS',
)
assertIdList(
  CLIMATE_VARIABLES.map((v) => v.id),
  registryIds.climate_variables,
  'CLIMATE_VARIABLES',
)
