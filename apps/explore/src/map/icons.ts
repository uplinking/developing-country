// Map icon registry — the single source of truth for point-marker artwork.
//
// PROVENANCE: original artwork drawn for this project (no icon pack, no npm
// dependency, no runtime fetch). Every glyph is hand-authored SVG path data in
// one 24×29 pin box, one stroke weight (1.9) and round caps/joins, so the whole
// set reads as one family. Licence: same as this repo.
//
// Why paths and not an <img>/sprite sheet: `new Path2D(d)` parses SVG path
// syntax *synchronously*, so a marker can be rasterised onto a canvas and handed
// to `map.addImage()` in the same tick as `addLayer()`. Loading an <img> would
// be async and MapLibre would log "image not found" for every layer added before
// the decode landed. The same path data also renders as inline SVG in the layer
// panel legend, so the map and the legend can never drift.
//
// The house shape is a map pin: a coloured teardrop with a white ring, a hairline
// dark edge (so it separates on both the light and the dark basemap) and a white
// glyph in the head.

import type { Map as MapLibreMap } from 'maplibre-gl'

/**
 * Namespace for the image ids we put in the style.
 *
 * NOT cosmetic: the basemap sprite already ships images called `attraction`,
 * `museum`, `park`, `castle`… so an un-prefixed id makes `map.hasImage()` true
 * before we ever register, our idempotency guard skips the add, and the layer
 * silently draws the *basemap's* icon instead of ours. Always address a marker
 * through `iconId()`.
 */
export const ICON_PREFIX = 'fm-'
export const iconId = (key: string) => ICON_PREFIX + key

/** Look a marker up by the image id `iconId()` produced (bare keys also work). */
export const iconSpec = (id: string): IconSpec | undefined =>
  ICON_LOOKUP.get(id.startsWith(ICON_PREFIX) ? id.slice(ICON_PREFIX.length) : id)

/**
 * Every marker is a rounded-square BADGE (no teardrop tail anywhere). The glyph
 * says what it is, the fill colour says which/what state. A tail-less badge sits
 * with its base on the spot (icon-anchor 'bottom', same as the old pin tip), so
 * labels keep their offsets. Square 24×24, centre (12,12), corner r 5.5.
 */
export const MARKER_BOX = { w: 24, h: 24 } as const
export const MARKER_PATH =
  'M8 2.5h8a5.5 5.5 0 0 1 5.5 5.5v8a5.5 5.5 0 0 1-5.5 5.5h-8a5.5 5.5 0 0 1-5.5-5.5v-8a5.5 5.5 0 0 1 5.5-5.5z'
/** Glyphs are authored around (12, 10.6); nudge them to the badge centre (12,12). */
export const GLYPH_NUDGE = { x: 0, y: 1.4 } as const

/**
 * Glyph ink: white on a dark/saturated fill, near-black on a light fill (yellow).
 * A white glyph on a yellow badge is unreadable, so pick by the fill's relative
 * luminance — one rule that keeps every badge legible without a per-colour table.
 */
export function glyphInk(fill: string): string {
  const h = fill.replace('#', '')
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const r = parseInt(n.slice(0, 2), 16) / 255
  const g = parseInt(n.slice(2, 4), 16) / 255
  const b = parseInt(n.slice(4, 6), 16) / 255
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return lum > 0.6 ? '#1c1917' : '#ffffff'
}

/** Glyphs are authored inside the pin head: centre (12, 10.6), radius ≈ 5.5. */
export interface IconSpec {
  /** Human label — used by the legend and the "what am I looking at" copy. */
  label: string
  /** Pin body colour. This is the point palette; layers.ts consumes it too. */
  color: string
  /** Stroked glyph paths (white, 1.9 weight, round caps). */
  stroke?: string[]
  /** Filled glyph paths (white). */
  fill?: string[]
}

type IconRegistry = Record<string, IconSpec>
type DevelopmentGlyphRegistry = Record<string, { label: string } & Pick<IconSpec, 'stroke' | 'fill'>>
type IconColorRegistry = Record<string, string>

// --- Planned developments --------------------------------------------------
// Project pins carry TWO axes: the glyph says WHAT the project
// is (a port, an airport, a power project…), the colour says WHERE it stands
// (operational / under-construction / approved / proposed). Ids are
// `dev-<glyph>-<bucket>`; the match expression that picks one lives in layers.ts
// (developmentsIconMatch). This is the project icon pack — original artwork in
// the same 24×29 pin box and 1.9 stroke as the rest of the family.

/** Status → badge colour. Three stages, no purple: green = done, orange = in
 *  progress, yellow = proposed (approved folds into proposed). `nt` (neutral
 *  slate) is legend-only — the map never emits it; it lets the legend show a
 *  glyph as "a type" without implying a status. */
export const DEV_STATUS_COLORS = { op: '#16a34a', uc: '#f97316', pr: '#facc15' } as const
const DEV_ALL_COLORS = { ...DEV_STATUS_COLORS, nt: '#64748b' } satisfies IconColorRegistry

/** One glyph per project type. Authored inside the pin head (centre ≈ 12,10.6). */
export const DEV_GLYPHS = {
  // Anchor — a sea port / container terminal.
  port: {
    label: 'Port / terminal',
    stroke: [
      'M12 6.1a1.35 1.35 0 1 1 0 2.7 1.35 1.35 0 0 1 0-2.7z',
      'M12 8.8v6',
      'M9.3 10.3h5.4',
      'M7.6 11.8c0 2.7 2 4.8 4.4 4.8s4.4-2.1 4.4-4.8',
      'M6.5 12.2 7.6 11.8 8.1 12.9',
      'M17.5 12.2 16.4 11.8 15.9 12.9',
    ],
  },
  // Plane from above — an airport.
  airport: {
    label: 'Airport',
    fill: [
      'M12 5.3 12.85 9.0 17.3 11.5 17.2 12.7 12.95 11.4 12.65 14.2 14.1 15.1 14.0 16.0 12 15.4 10 16.0 9.9 15.1 11.35 14.2 11.05 11.4 6.8 12.7 6.7 11.5 11.15 9.0z',
    ],
  },
  // Locomotive face — rail / transit.
  rail: {
    label: 'Rail / transit',
    stroke: [
      'M9.7 6.7h4.6a1.5 1.5 0 0 1 1.5 1.5v5.0a1.4 1.4 0 0 1-1.4 1.4H9.6a1.4 1.4 0 0 1-1.4-1.4V8.2a1.5 1.5 0 0 1 1.5-1.5z',
      'M9.6 8.7h4.8v2.3H9.6z',
    ],
    fill: [
      'M10.3 12.3a.6.6 0 1 1 0 1.2.6.6 0 0 1 0-1.2z',
      'M13.7 12.3a.6.6 0 1 1 0 1.2.6.6 0 0 1 0-1.2z',
    ],
  },
  // Lightning bolt — power / energy.
  energy: {
    label: 'Energy / power',
    fill: ['M13.1 5.6 8.7 11.5h2.9l-1.1 4.3 4.8-6.2h-3.0l1.7-3.8z'],
  },
  // Skyline of towers — a special economic zone / financial district.
  sez: {
    label: 'Special economic zone',
    stroke: [
      'M7.6 15.3h8.8',
      'M8.2 15.1V9.7h2v5.4',
      'M10.9 15.1V6.8h2.2v8.3',
      'M13.9 15.1v-3.9h2v3.9',
    ],
  },
  // A bus — a transport hub / terminal.
  transport: {
    label: 'Transport hub',
    stroke: [
      'M8.5 8.1h7a.9.9 0 0 1 .9.9v4.3a.9.9 0 0 1-.9.9H8.5a.9.9 0 0 1-.9-.9V9a.9.9 0 0 1 .9-.9z',
      'M8.6 9.2h6.8v2.1H8.6z',
      'M12 9.2v2.1',
    ],
    fill: [
      'M9.7 14.1a.85.85 0 1 1 0 1.7.85.85 0 0 1 0-1.7z',
      'M14.3 14.1a.85.85 0 1 1 0 1.7.85.85 0 0 1 0-1.7z',
    ],
  },
  // An arched bridge / flyover — a road project.
  road: {
    label: 'Road / bridge',
    stroke: [
      'M6.7 10.3h10.6',
      'M7.4 13.9a4.6 4.6 0 0 1 9.2 0',
      'M9.4 10.3v2.1',
      'M12 10.3v2.9',
      'M14.6 10.3v2.1',
    ],
  },
  // Stacked waves — a canal / flood-mitigation / water project.
  flood: {
    label: 'Water / flood works',
    stroke: [
      'M6.9 9.4q1.55-1.45 3.1 0t3.1 0 3.1 0',
      'M6.9 11.9q1.55-1.45 3.1 0t3.1 0 3.1 0',
      'M6.9 14.4q1.55-1.45 3.1 0t3.1 0 3.1 0',
    ],
  },
  // A saw-tooth factory — an industrial zone.
  industry: {
    label: 'Industrial zone',
    fill: ['M7.3 15.2v-4.3l3 1.7v-1.7l3 1.7V9.7h2.9v5.5z'],
  },
  // A house + a taller block — a new / satellite town.
  newtown: {
    label: 'New / satellite town',
    stroke: ['M6.5 15.3h11', 'M7 15.1V10.4l2.6-2.2 2.6 2.2v4.7', 'M12.8 15.1V9.4h3.3v5.7'],
  },
  // A briefcase — a commercial / office / IT zone.
  commercial: {
    label: 'Commercial / IT zone',
    stroke: [
      'M7.5 9.6h9v4.9a.8.8 0 0 1-.8.8H8.3a.8.8 0 0 1-.8-.8z',
      'M10 9.6V8.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.1',
      'M10.8 11.5h2.4',
    ],
  },
  // A flag — a generic project (fallback).
  generic: {
    label: 'Project',
    stroke: ['M9.3 6.1v9.2'],
    fill: ['M9.3 6.5h6.2l-1.5 2 1.5 2H9.3z'],
  },
} satisfies DevelopmentGlyphRegistry

/** Every project glyph × status colour, expanded into concrete pin icons. */
function devIcons() {
  const out: IconRegistry = {}
  for (const [g, glyph] of Object.entries(DEV_GLYPHS)) {
    for (const [b, color] of Object.entries(DEV_ALL_COLORS)) {
      out[`dev-${g}-${b}`] = { ...glyph, color }
    }
  }
  return out
}

// --- The set ---------------------------------------------------------------
// Keys are the image ids used by `icon-image` in the layer registry.

export const ICONS = {
  // Attractions (keys match the `category` property from scripts/fetch-explore.mjs)
  attraction: {
    label: 'Attraction',
    color: '#f43f5e',
    fill: [
      'M12 5.2 L13.35 8.74 L17.14 8.93 L14.19 11.31 L15.17 14.97 L12 12.9 L8.83 14.97 L9.81 11.31 L6.87 8.93 L10.65 8.74 Z',
    ],
  },
  viewpoint: {
    label: 'Viewpoint',
    color: '#0ea5e9',
    stroke: ['M6.7 10.6c2-3.2 8.6-3.2 10.6 0-2 3.2-8.6 3.2-10.6 0z'],
    fill: ['M12 8.9a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 0 1 0-3.4z'],
  },
  monument: {
    label: 'Monument',
    color: '#0d9488', // teal (was purple)
    stroke: ['M12 5.2 14.4 9v4.6H9.6V9z', 'M7.8 15.7h8.4'],
  },
  museum: {
    label: 'Museum',
    color: '#d97706',
    stroke: [
      'M6.6 9.5 12 5.7l5.4 3.8',
      'M8.7 10.6v3.9',
      'M12 10.6v3.9',
      'M15.3 10.6v3.9',
      'M6.9 15.7h10.2',
    ],
  },
  // A dug-up pot. Filled: a stroked outline closes into a ring at this size.
  archaeological_site: {
    label: 'Archaeological site',
    color: '#a16207',
    fill: [
      'M9.6 5.4h4.8l-.7 1.8c1.9 1.1 3 3 3 5 0 2.5-2.1 3.8-4.7 3.8s-4.7-1.3-4.7-3.8c0-2 1.1-3.9 3-5z',
    ],
  },
  ruins: {
    label: 'Ruins',
    color: '#78716c',
    stroke: ['M8.5 15.2V8.3h2.3v6.9', 'M13.2 15.2v-4.3h2.3v4.3', 'M6.9 15.9h10.2'],
  },
  zoo: {
    label: 'Zoo / wildlife',
    color: '#16a34a',
    fill: [
      'M12 10.5c2.4 0 4 1.6 4 3.1 0 1.3-1.5 1.9-4 1.9s-4-.6-4-1.9c0-1.5 1.6-3.1 4-3.1z',
      'M9 7.6a1.35 1.35 0 1 1 0 2.7 1.35 1.35 0 0 1 0-2.7z',
      'M11.2 6.3a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6z',
      'M13.6 6.3a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6z',
      'M15.8 7.6a1.35 1.35 0 1 1 0 2.7 1.35 1.35 0 0 1 0-2.7z',
    ],
  },
  theme_park: {
    label: 'Theme park',
    color: '#db2777',
    stroke: [
      'M12 5.8a4.6 4.6 0 1 1 0 9.2 4.6 4.6 0 0 1 0-9.2z',
      'M12 5.8v9.2',
      'M7.4 10.4h9.2',
      'M8.7 7.1l6.6 6.6',
      'M15.3 7.1l-6.6 6.6',
    ],
  },
  castle: {
    label: 'Castle',
    color: '#b45309', // bronze (was purple)
    // Two merlons and one wide notch: three merlons close up at 16px.
    stroke: ['M8.4 15.4V6.4h2.2v2h2.8v-2h2.2v9z'],
  },
  fort: {
    label: 'Fort',
    color: '#b45309',
    stroke: ['M6.8 15.4V8.4h1.6V6.9h1.6v1.5h4v-1.5h1.6v1.5h1.6v7z', 'M12 15.4v-3.6'],
  },

  // Explore
  waterfall: {
    label: 'Waterfall',
    color: '#06b6d4',
    stroke: [
      'M7.2 6.4h9.6',
      'M9.4 7.1v5.4',
      'M12 7.1v6.3',
      'M14.6 7.1v5.4',
      'M7.4 15.2q1.5-1.5 3-.1t3 0q1.5-1.4 3 .1',
    ],
  },
  trail: {
    label: 'Hiking route',
    color: '#15803d',
    stroke: ['M7.6 15.2c3.1 0 1-3.9 4.2-3.9s1.1-3.9 4.6-3.9'],
    fill: ['M15.4 5.4a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z'],
  },
  cycling: {
    label: 'Cycling route',
    color: '#ea580c',
    stroke: [
      'M8.6 9.8a2.9 2.9 0 1 1 0 5.8 2.9 2.9 0 0 1 0-5.8z',
      'M15.4 9.8a2.9 2.9 0 1 1 0 5.8 2.9 2.9 0 0 1 0-5.8z',
      'M8.6 12.7 11.5 8.2l3.9 4.5',
      'M11.5 8.2h2.6',
    ],
  },
  park: {
    label: 'Protected area',
    color: '#22c55e',
    stroke: ['M12 15.6v-3.4'],
    fill: ['M12 5.4a3.9 3.9 0 0 1 3.9 3.9c0 2.2-1.7 3.5-3.9 3.5s-3.9-1.3-3.9-3.5A3.9 3.9 0 0 1 12 5.4z'],
  },
  stepper: {
    label: 'Stepper spot',
    color: '#e11d48',
    fill: ['M9.9 6.9 15.9 10.6 9.9 14.3z'],
  },

  // Civic amenities (OSM osm_only — not MoE/MoH registers)
  school: {
    label: 'School',
    color: '#2563eb',
    stroke: [
      'M8 6.6c1.8.9 2.8.9 4 0v7.8c-1.2.9-2.2.9-4 0z',
      'M16 6.6c-1.8.9-2.8.9-4 0v7.8c1.2.9 2.2.9 4 0z',
    ],
  },
  hospital: {
    label: 'Hospital',
    color: '#dc2626',
    fill: ['M10.5 6.2h3v4.3h4.3v3h-4.3v4.3h-3v-4.3H6.2v-3h4.3z'],
  },
  clinic: {
    label: 'Clinic',
    color: '#0d9488',
    stroke: ['M7.6 7.4h8.8v8.2H7.6z', 'M12 9.4v4.2', 'M9.9 11.5h4.2'],
  },
  gauge: {
    label: 'River gauge',
    color: '#0e7490',
    stroke: [
      'M12 5.6v10.2',
      'M9.6 8.2h4.8',
      'M10.2 10.6h3.6',
      'M10.8 13h2.4',
      'M7.4 15.4q1.6-1.3 3.2 0t3.2 0q1.6-1.3 3.2 0',
    ],
  },

  // Community
  prospect: {
    label: 'Prospect',
    color: '#f59e0b',
    stroke: ['M6.9 11.1 12 6.2l5.1 4.9', 'M8.7 10.2v5.3h6.6v-5.3'],
  },
  analysis: {
    label: 'Analysis run',
    color: '#475569', // slate (was indigo)
    stroke: ['M10.9 6a3.4 3.4 0 1 1 0 6.8 3.4 3.4 0 0 1 0-6.8z', 'M13.4 12.1l2.9 3'],
  },

  // Planned developments — the project icon pack (see DEV_GLYPHS above).
  ...devIcons(),
} satisfies IconRegistry

const ICON_LOOKUP: ReadonlyMap<string, IconSpec> = new Map(Object.entries(ICONS))

// --- Rasterisation ---------------------------------------------------------

/** Cap the DPR: a 3× marker is already past what the eye resolves, and every
 *  extra step is GPU texture we upload for ~40 images. */
const MAX_DPR = 3

function devicePixelRatioSafe(): number {
  const dpr = window.devicePixelRatio || 1
  return Math.min(Math.max(dpr, 1), MAX_DPR)
}

/** Body: hairline dark edge → white ring → colour fill (outside-in), so the
 *  marker separates on both the light and dark basemap. */
function drawBody(ctx: CanvasRenderingContext2D, path: Path2D, color: string): void {
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.3)'
  ctx.lineWidth = 3.4
  ctx.stroke(path)
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 2.2
  ctx.stroke(path)
  ctx.fillStyle = color
  ctx.fill(path)
}

/** Glyph, inked for contrast against the fill (white on dark, near-black on
 *  yellow) — so we never need a per-theme icon set. */
function drawGlyph(ctx: CanvasRenderingContext2D, spec: IconSpec): void {
  const ink = glyphInk(spec.color)
  ctx.fillStyle = ink
  ctx.strokeStyle = ink
  ctx.lineWidth = 1.9
  for (const d of spec.fill ?? []) ctx.fill(new Path2D(d))
  for (const d of spec.stroke ?? []) ctx.stroke(new Path2D(d))
}

function newCanvasCtx(w: number, h: number, pixelRatio: number): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(w * pixelRatio)
  canvas.height = Math.ceil(h * pixelRatio)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no 2d context')
  ctx.scale(pixelRatio, pixelRatio)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  return ctx
}

/** Draw one rounded-square badge — the universal marker. Anchor 'bottom'; the
 *  glyph is nudged from where it's authored to the badge centre. */
function rasterizeMarker(spec: IconSpec, pixelRatio: number): ImageData {
  const ctx = newCanvasCtx(MARKER_BOX.w, MARKER_BOX.h, pixelRatio)
  drawBody(ctx, new Path2D(MARKER_PATH), spec.color)
  ctx.save()
  ctx.translate(GLYPH_NUDGE.x, GLYPH_NUDGE.y)
  drawGlyph(ctx, spec)
  ctx.restore()
  return ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height)
}

/**
 * Add every marker image to the style. Idempotent (guards on hasImage), and
 * synchronous, so layers referencing an icon can be added straight after.
 *
 * MUST be called wherever overlays are built: `map.setStyle()` (the OS
 * light/dark swap) throws away images along with custom sources and layers.
 */
export function registerMapIcons(map: MapLibreMap): void {
  const pixelRatio = devicePixelRatioSafe()
  for (const [key, spec] of Object.entries(ICONS)) {
    const id = iconId(key)
    if (map.hasImage(id)) continue
    const image = rasterizeMarker(spec, pixelRatio)
    try {
      map.addImage(id, image, { pixelRatio })
    } catch (e) {
      console.warn('[icons] could not register', id, e)
    }
  }
}
