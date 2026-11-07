import { createContext, useContext, useMemo } from 'react'
import type { StyleSpecification } from 'maplibre-gl'
import { DEFAULT_DATA_VIEW_ORIGIN } from '@developing-country/views'

export const DEFAULT_TILE_BASE = 'https://tiles.developing-country.org'

/** Basemap style for the resolved theme. The explorer passes its own; figures default to a light key-less style. */
export type BasemapResolver = (theme: 'light' | 'dark') => string | StyleSpecification

/**
 * Serializable figure settings (Astro islands receive these as props), plus an
 * optional basemap resolver that only same-bundle hosts such as the explorer use.
 */
export interface FiguresConfig {
  /** Canonical Data View origin; every view URL must be canonical on it. */
  origin: string
  /** Where `/api/views/…` is fetched from; defaults to the view URL's origin. */
  apiBase?: string
  /** Origin (or origin + path) that serves demographics.pmtiles for tile joins. */
  tileBase: string
  basemap?: BasemapResolver
}

export type FiguresConfigInput = Partial<FiguresConfig>

export const DEFAULT_FIGURES_CONFIG: FiguresConfig = {
  origin: DEFAULT_DATA_VIEW_ORIGIN,
  tileBase: DEFAULT_TILE_BASE,
}

const FiguresContext = createContext<FiguresConfigInput>({})

export const FiguresProvider = FiguresContext.Provider

function defined<T extends object>(value: T | undefined): Partial<T> {
  if (!value) return {}
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== '')) as Partial<T>
}

/** Context (explorer) < explicit props (Astro islands); empty strings never override. */
export function useFiguresConfig(input?: FiguresConfigInput): FiguresConfig {
  const context = useContext(FiguresContext)
  const merged: FiguresConfig = { ...DEFAULT_FIGURES_CONFIG, ...defined(context), ...defined(input) }
  const { origin, apiBase, tileBase, basemap } = merged
  // Islands pass fresh object literals each render; identity follows the values.
  return useMemo(() => ({ origin, apiBase, tileBase, basemap }), [origin, apiBase, tileBase, basemap])
}

const OPENFREEMAP_LIGHT = 'https://tiles.openfreemap.org/styles/positron'
const OPENFREEMAP_DARK = 'https://tiles.openfreemap.org/styles/dark'

/** The same key-less hosted styles the explorer uses in production (src/map/basemap.ts). */
export const defaultBasemap: BasemapResolver = (theme) => (theme === 'dark' ? OPENFREEMAP_DARK : OPENFREEMAP_LIGHT)
