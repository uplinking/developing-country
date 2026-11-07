import type { MapCamera } from '@developing-country/views'
import { parseIdList, parseUnderlayUrls, type ScrollyStep } from '@developing-country/emdash-blocks/figure-blocks'

/** Presentation overrides one scroll step applies to its view. */
export interface StepState {
  text: string
  viewUrl: string
  camera: { center?: [number, number]; zoom?: number } | null
  /** Layer ids to show; null keeps the view's own visibility. */
  show: string[] | null
  highlight: string[]
  /** Map views drawn beneath this step's view, bottom first. */
  underlays: string[]
}

/** CMS number inputs arrive as numbers, numeric strings, or '' for "unset". */
export function optionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** Parse one stored step; invalid coordinates are ignored rather than guessed. */
export function parseScrollyStep(step: Partial<ScrollyStep> | Record<string, unknown>): StepState {
  const record = step as Record<string, unknown>
  const lng = optionalNumber(record.center_lng)
  const lat = optionalNumber(record.center_lat)
  const zoom = optionalNumber(record.zoom)
  const center: [number, number] | undefined = lng !== undefined && lat !== undefined && Math.abs(lng) <= 180 && Math.abs(lat) <= 90
    ? [lng, lat]
    : undefined
  const validZoom = zoom !== undefined && zoom >= 0 && zoom <= 24 ? zoom : undefined
  const show = parseIdList(typeof record.show === 'string' ? record.show : undefined)
  return {
    text: text(record.text),
    viewUrl: text(record.view_url),
    camera: center || validZoom !== undefined
      ? { ...(center ? { center } : {}), ...(validZoom !== undefined ? { zoom: validZoom } : {}) }
      : null,
    show: show.length > 0 ? show : null,
    highlight: parseIdList(typeof record.highlight === 'string' ? record.highlight : undefined),
    underlays: parseUnderlayUrls(record.underlay_urls).filter((url) => url !== text(record.view_url)),
  }
}

export function resolveStepCamera(base: MapCamera, override: StepState['camera']): MapCamera {
  if (!override) return base
  return { ...base, ...(override.center ? { center: override.center } : {}), ...(override.zoom !== undefined ? { zoom: override.zoom } : {}) }
}

/** Split step prose into paragraphs (multiline CMS text). */
export function stepParagraphs(value: string): string[] {
  return value.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean)
}

/**
 * Where a step becomes active. Side by side (desktop) that is the viewport's
 * middle. Stacked (phone) the figure is pinned above the steps and covers
 * them, so the line sits halfway down the strip left visible beneath it.
 */
export function stepTriggerLine(viewportHeight: number, figureBottom: number | null, stacked: boolean): number {
  if (!stacked || figureBottom === null) return viewportHeight / 2
  return figureBottom + Math.max(0, viewportHeight - figureBottom) / 2
}

/**
 * The active scrolly step: the last one whose top has passed the trigger line
 * (the viewport's middle on desktop) (step 0 until the first one does). Pure, so it is testable and cannot
 * be skipped by a fast scroll the way an IntersectionObserver band can.
 */
export function activeStepIndex(stepTops: Array<number | null>, middle: number): number {
  let active = 0
  stepTops.forEach((top, index) => {
    if (top !== null && top <= middle) active = index
  })
  return active
}
