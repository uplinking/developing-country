// Builds the base map style. Two modes (see config BASEMAP):
//  - 'openfreemap': a hosted, key-less vector style. Works immediately, no
//    data pipeline needed. Good for development and first-run.
//  - 'protomaps': a self-hosted style built from a Sri Lanka basemap.pmtiles
//    extract served off Cloudflare R2 — fully key-less and self-contained.
//
// Both modes are theme-aware (see config BASEMAP_THEME): a muted light map in
// light mode, a dark map in dark mode. The public explorer is light; an MCP
// host can supply dark mode through <html data-theme>. Colours come entirely from the
// basemap style — MapLibre just renders whichever style we hand it — so the look
// is a style choice, not a library dependency.

import { layers, namedFlavor } from '@protomaps/basemaps'
import type { StyleSpecification } from 'maplibre-gl'
import { BASEMAP, BASEMAP_THEME, TILE_BASE } from '../config'
import { resolveTheme } from '../theme'

// OpenFreeMap hosted styles (key-less). 'positron' is the muted CARTO-Positron
// look; 'dark' its dark counterpart. Both resolve at tiles.openfreemap.org.
const OPENFREEMAP_LIGHT = 'https://tiles.openfreemap.org/styles/positron'
const OPENFREEMAP_DARK = 'https://tiles.openfreemap.org/styles/dark'

// Protomaps basemap flavours. Light mode uses the muted 'grayscale' flavour so
// data overlays pop; dark mode uses 'dark'. The sprite URL must match the
// flavour name, or POI icons render from the wrong sheet.
const PROTOMAPS_LIGHT_FLAVOR = 'grayscale'
const PROTOMAPS_DARK_FLAVOR = 'dark'
const PROTOMAPS_SPRITE_BASE = 'https://protomaps.github.io/basemaps-assets/sprites/v4'
const PROTOMAPS_GLYPHS = 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf'

// True when the BASEMAP should render dark. A build-time BASEMAP_THEME of
// 'light'/'dark' pins it; otherwise it follows <html data-theme>.
export function prefersDark(): boolean {
  if (BASEMAP_THEME === 'dark') return true
  if (BASEMAP_THEME === 'light') return false
  return resolveTheme() === 'dark'
}

function protomapsStyle(dark: boolean): StyleSpecification {
  const flavorName = dark ? PROTOMAPS_DARK_FLAVOR : PROTOMAPS_LIGHT_FLAVOR
  const flavor = namedFlavor(flavorName)
  return {
    version: 8,
    glyphs: PROTOMAPS_GLYPHS,
    sprite: `${PROTOMAPS_SPRITE_BASE}/${flavorName}`,
    sources: {
      protomaps: {
        type: 'vector',
        url: `pmtiles://${TILE_BASE}/basemap.pmtiles`,
        attribution: '© OpenStreetMap contributors, © Protomaps',
      },
    },
    // SAFETY: Protomaps and MapLibre consume the same v8 style layer schema; the
    // helper's bundled style-spec copy is structurally compatible at runtime.
    layers: layers('protomaps', flavor, { lang: 'en' }) as StyleSpecification['layers'],
  }
}

// Resolve the current base style for the active BASEMAP + theme. Called on mount
// and again whenever the OS theme flips (see MapView), so it must read the theme
// fresh each time rather than caching it.
export function getBaseStyle(): string | StyleSpecification {
  const dark = prefersDark()
  if (BASEMAP === 'protomaps') return protomapsStyle(dark)
  return dark ? OPENFREEMAP_DARK : OPENFREEMAP_LIGHT
}
