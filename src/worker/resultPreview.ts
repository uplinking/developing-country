// A saved Data View can hold up to 5,000 rows; the agent that saved it needs
// the view_url, counts and `publication` block, not every row in its context.
// The complete, checksummed snapshot stays at result_url.

import type { JsonObject } from '../shared/json'

/** Rows echoed in the MCP text content after a view is saved. */
export const AGENT_PREVIEW_ROWS = 50
/** Rows kept in structuredContent (the MCP App's inline render) after a view is saved. */
export const UI_PREVIEW_ROWS = 200

/**
 * Trim `rows`/`features` of a SAVED query_data result to `maxRows`, recording
 * what was omitted. Unsaved results are returned unchanged: they are already
 * capped at 200 rows and have no result_url to fetch the remainder from.
 */
export function previewSavedResult(body: JsonObject, maxRows: number): JsonObject {
  if (typeof body.view_url !== 'string') return body
  const rows = Array.isArray(body.rows) ? body.rows : null
  const features = Array.isArray(body.features) ? body.features : null
  const returned = Math.max(rows?.length ?? 0, features?.length ?? 0)
  if (returned <= maxRows) return body
  const out: JsonObject = { ...body }
  if (rows) out.rows = rows.slice(0, maxRows)
  if (features) out.features = features.slice(0, maxRows)
  out.rows_preview = {
    shown: maxRows,
    saved: returned,
    total_matching: typeof body.total_count === 'number' ? body.total_count : returned,
    note:
      `Showing the first ${maxRows} of ${returned} saved rows to keep context small. ` +
      'The view renders every saved row; fetch result_url for the complete checksummed snapshot.',
  }
  return out
}
