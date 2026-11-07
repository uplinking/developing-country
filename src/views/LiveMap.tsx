import { useMemo } from 'react'
import { rowsFromViewResult, type MapViewSpec } from '@developing-country/views'
import { MapFigure, type FiguresConfigInput } from '@developing-country/figures'
import '@developing-country/figures/styles.css'
import 'maplibre-gl/dist/maplibre-gl.css'

import { getBaseStyle } from '../map/basemap'
import { TILE_BASE } from '../config'

interface LiveMapProps {
  view: MapViewSpec
  result: Record<string, unknown>
}

// The explorer's own basemap (protomaps or OpenFreeMap) and tile origin; both
// basemap.ts and the figure read the theme from <html data-theme>.
const basemap = () => getBaseStyle()

/** Saved map views render with their layer styles, joins, legend and annotations. */
export default function LiveMap({ view, result }: LiveMapProps) {
  const rows = useMemo(() => rowsFromViewResult(result), [result])
  // TILE_BASE may be app-relative (`/tiles`); PMTiles needs an absolute URL.
  const tileBase = new URL(TILE_BASE, window.location.href).href.replace(/\/$/, '')
  const config = useMemo<FiguresConfigInput>(() => ({ basemap, tileBase }), [tileBase])
  return (
    <MapFigure
      view={view}
      rows={rows}
      result={result}
      config={config}
      className="live-map"
    />
  )
}
