/**
 * @developing-country/figures — the one renderer for Data Views (ADR 0002, 0009).
 * Used by the explorer's /views pages and, as Astro islands, by article blocks.
 * MapLibre and ECharts load lazily, only when a figure mounts.
 */
export { Figure, FigureFrame, FigureStage, ConfigScope, type FigureProps, type FigureSize } from './Figure'
export { MapFigure, type MapFigureProps } from './MapFigure'
export { ChartFigure, type ChartFigureProps } from './ChartFigure'
export { Scrolly, type ScrollyProps } from './Scrolly'
export { Guess, type GuessProps } from './Guess'
export { BoundStat, type BoundStatProps } from './BoundStat'
export { Explorer, type ExplorerProps } from './Explorer'
export { Legend } from './Legend'
export {
  DEFAULT_FIGURES_CONFIG,
  DEFAULT_TILE_BASE,
  FiguresProvider,
  defaultBasemap,
  useFiguresConfig,
  type BasemapResolver,
  type FiguresConfig,
  type FiguresConfigInput,
} from './config'
export { useDataView, useDataViews, useDataViewById, type DataViewState } from './useDataView'
export {
  DataViewError,
  acquireDataView,
  dataViewEndpoints,
  fetchDataView,
  viewIdFromUrl,
  type DataViewErrorKind,
  type LoadedDataView,
} from './dataView'
export { provenanceOf, provenanceText, type Provenance } from './provenance'
export { readGuess, writeGuess, useGuess } from './guessStore'
export { readTokens, type FigureTokens } from './tokens'
