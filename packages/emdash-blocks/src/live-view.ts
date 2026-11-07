export interface LiveViewNode {
  view_url?: string
  url?: string
  id?: string
  title?: string
  caption?: string
}

/**
 * EmDash reserves `url` on unknown Portable Text blocks and may round-trip it
 * as `id`. New blocks use `view_url`; the aliases keep existing drafts intact.
 */
export function liveViewUrlFromNode(node: LiveViewNode): string {
  return node.view_url?.trim() || node.url?.trim() || node.id?.trim() || ''
}
