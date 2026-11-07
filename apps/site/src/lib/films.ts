import type { FilmKey } from './cameraFilm'

type Point = readonly [x: number, y: number]

/** A still of the explorer (rail on the left, readout sheet on the right) and the points worth visiting on it. */
export interface ExplorerShot {
  /** Basename under /films; `-<width>.webp` variants are served at the large and small widths. */
  name: string
  /** Layout size of the capture in CSS pixels, before the 2× device scale it was taken at. */
  width: number
  height: number
  /** Widths of the encoded variants: the large one for wide screens, the small one for phones. */
  large: number
  small: number
  /** The layer's legend in the rail, the selected feature, and the readout it opened. */
  legend: Point
  feature: Point
  sheet: Point
}

/** Where the active layer's card title sits: the rail is scrolled to put it at the top before capture. */
const RAIL_CARD: Point = [150, 135]

/**
 * The same tour on every explorer still: read the layer card, run down its legend, swing across
 * the map to the selected feature, land on its readout, then pull back to the whole frame.
 */
export function explorerTour(shot: ExplorerShot): FilmKey[] {
  const at = ([x, y]: Point) => ({ target: { selector: '[data-film-shot]' }, ax: x / shot.width, ay: y / shot.height })
  const centre: Point = [shot.width * 0.53, shot.height * 0.52]
  return [
    { ...at(RAIL_CARD), zoom: 2.6, tilt: 40, turn: 16 },
    { ...at(shot.legend), after: 4, zoom: 2.4, tilt: 46, turn: -8 },
    { ...at(shot.feature), after: 4.5, zoom: 2.2, tilt: 50, turn: -26 },
    { ...at(shot.sheet), after: 4.5, zoom: 2.6, tilt: 34, turn: 10 },
    { ...at(centre), after: 4.5, zoom: 1.12, tilt: 18, turn: -4, still: true },
    { ...at(centre), after: 1.6, zoom: 1.08, tilt: 16, turn: -5 },
  ]
}

export const filmSrc = (shot: ExplorerShot, width: number) => `/films/${shot.name}-${width}.webp`

/** Colombo with Metro Bus, walking coverage, schools and hospitals on; a street's walking readout open. */
export const COLOMBO_SHOT: ExplorerShot = {
  name: 'explorer-colombo', width: 1440, height: 900, large: 2160, small: 1440,
  legend: [170, 300], feature: [690, 330], sheet: [1240, 160],
}

const chapterShot = (name: string, legend: Point, feature: Point, sheet: Point): ExplorerShot => ({
  name: `explorer-${name}`, width: 1200, height: 750, large: 1800, small: 1200, legend, feature, sheet,
})

/** One still per landing chapter, captured from the production explorer at 1200 × 750, 2×. */
export const CHAPTER_SHOTS = {
  developments: chapterShot('developments', [170, 330], [725, 295], [1010, 210]),
  demographics: chapterShot('demographics', [170, 280], [520, 283], [1010, 190]),
  metro_catchment: chapterShot('metro-catchment', [170, 230], [853, 509], [1010, 166]),
  schools: chapterShot('schools', [170, 190], [762, 271], [1010, 160]),
  hospitals: chapterShot('hospitals', [170, 210], [584, 332], [1010, 160]),
} as const satisfies Record<string, ExplorerShot>
