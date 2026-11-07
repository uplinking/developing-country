// Frame sizing for the MCP App, from the host context alone so it is testable
// without a DOM. Host-neutral: every field read here is MCP Apps standard
// (containerDimensions, platform, safeAreaInsets) and optional.

import type { McpUiHostContext } from '@modelcontextprotocol/ext-apps'

const INLINE_HEIGHT_DESKTOP = 480
const INLINE_HEIGHT_MOBILE = 360
// Tables, cards and charts need more room than the map: the chart engine
// reserves ~360px of its own for title, axes and rotated period labels.
const DATA_HEIGHT_DESKTOP = 640
const DATA_HEIGHT_MOBILE = 560
const MOBILE_MAX_WIDTH = 520

/**
 * The inline frame height to request. A host's maxHeight always wins: the MCP
 * host context's, else one the host publishes as an extension.
 */
export function inlineHeight(
  ctx: McpUiHostContext | undefined,
  data: boolean,
  fallbackWidth: number,
  fallbackMaxHeight?: number,
): number {
  const dimensions = ctx?.containerDimensions
  const width = dimensions && 'width' in dimensions ? dimensions.width : fallbackWidth
  const mobile = ctx?.platform === 'mobile' || width <= MOBILE_MAX_WIDTH
  const wanted = data
    ? mobile ? DATA_HEIGHT_MOBILE : DATA_HEIGHT_DESKTOP
    : mobile ? INLINE_HEIGHT_MOBILE : INLINE_HEIGHT_DESKTOP
  // A host that caps inline height (phones do) gets a frame that fits rather
  // than one it has to clip or scroll.
  const cap = (dimensions && 'maxHeight' in dimensions ? dimensions.maxHeight : undefined) ?? fallbackMaxHeight
  return cap !== undefined && Number.isFinite(cap) && cap > 0 ? Math.min(wanted, cap) : wanted
}

const SAFE_AREA_SIDES = ['top', 'right', 'bottom', 'left'] as const

/**
 * CSS custom properties for the host's safe-area insets (notch, home
 * indicator). Empty when the host reports none, so the stylesheet's 0px
 * fallback stands.
 */
export function safeAreaVars(ctx: McpUiHostContext | undefined): Array<[string, string]> {
  const insets = ctx?.safeAreaInsets
  if (!insets) return []
  return SAFE_AREA_SIDES.map((side) => {
    const value = insets[side]
    return [`--mcp-safe-${side}`, `${Number.isFinite(value) && value > 0 ? Math.round(value) : 0}px`]
  })
}
