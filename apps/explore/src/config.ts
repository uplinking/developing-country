// App-wide configuration. Values can be overridden at build time via Vite env
// vars (VITE_*) so the same code runs against dev (hosted basemap, seed data)
// and prod (self-hosted Protomaps basemap + pipeline-generated PMTiles on R2).

import type { LngLatBoundsLike } from 'maplibre-gl'
import { getCountryProfile } from '@developing-country/countries'
import { withBase } from './base'

export const ACTIVE_COUNTRY = getCountryProfile(import.meta.env.VITE_COUNTRY)

// Regional bounding box [west, south, east, north]: Sri Lanka + southern India
// (Tamil Nadu + Kerala, up to ~13.5°N). Drives map panning limits and the data
// pipeline's clip extent.
export const REGION_BBOX: [number, number, number, number] = [...ACTIVE_COUNTRY.dataBounds]

export const REGION_BOUNDS: LngLatBoundsLike = [
  [REGION_BBOX[0], REGION_BBOX[1]],
  [REGION_BBOX[2], REGION_BBOX[3]],
]

// How far the camera may roam. Deliberately much wider than REGION_BBOX:
// maxBounds also caps zoom-out (MapLibre stops you before the viewport can
// exceed the bounds), so clamping the camera to the data extent made the map
// feel walled in — you couldn't pull back far enough to see Sri Lanka in the
// context of southern India and the Indian Ocean, and a wide desktop window ran
// out of room to the east first. Pan limits and the data clip extent are
// separate concerns; only the pipeline cares about REGION_BBOX.
export const MAP_MAX_BOUNDS: LngLatBoundsLike = [
  [ACTIVE_COUNTRY.mapBounds[0], ACTIVE_COUNTRY.mapBounds[1]],
  [ACTIVE_COUNTRY.mapBounds[2], ACTIVE_COUNTRY.mapBounds[3]],
]

// In practice MAP_MAX_BOUNDS sets the real zoom-out floor (~4.1 on a wide
// window — MapLibre stops once the viewport fills the bounds), which lands on
// the whole subcontinent and the ocean around it. This is only a backstop for
// narrow/tall windows, where the bounds allow pulling back further.
export const MAP_MIN_ZOOM = 3.5
export const MAP_MAX_ZOOM = 17

// Initial view still centres on Sri Lanka.
export const INITIAL_VIEW = ACTIVE_COUNTRY.initialView

// Base for pipeline-generated PMTiles. Production points directly at the R2
// custom domain so Range reads do not spend a Worker invocation or CPU time;
// local development can still override it with a local folder/Worker route.
export const TILE_BASE: string = import.meta.env.VITE_TILE_BASE ?? withBase('/tiles')

// Which basemap to use: 'openfreemap' (hosted, no key, works immediately) or
// 'protomaps' (self-hosted basemap.pmtiles — needs the data pipeline).
const basemap = import.meta.env.VITE_BASEMAP
export const BASEMAP: 'openfreemap' | 'protomaps' = basemap === 'protomaps' ? basemap : 'openfreemap'

// Basemap colour theme. 'auto' follows the OS prefers-color-scheme (matching the
// panel UI, which is also OS-driven — see App.css), showing a muted light map in
// light mode and a dark map in dark mode. 'light'/'dark' pin one regardless.
// A muted (grayscale/positron) light basemap keeps data overlays — the point of
// the app — reading loud against a quiet base.
const basemapTheme = import.meta.env.VITE_BASEMAP_THEME
export const BASEMAP_THEME: 'auto' | 'light' | 'dark' =
  basemapTheme === 'light' || basemapTheme === 'dark' ? basemapTheme : 'auto'

// Which pipeline-generated PMTiles are actually available (uploaded to R2).
// Comma-separated filenames, e.g. VITE_TILES="roads.pmtiles,water.pmtiles".
// Layers whose tileset isn't listed are shown as "needs data pipeline".
export const AVAILABLE_TILES: ReadonlySet<string> = new Set(
  (import.meta.env.VITE_TILES ?? '')
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean),
)

// Free, key-less terrain tiles (SRTM-derived) from AWS Open Data. Drives the
// hillshade layer and optional 3D terrain.
export const TERRAIN_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
