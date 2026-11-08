// The tools/call result envelope: `content` (text the model reads),
// `structuredContent` (the MCP App's input; ChatGPT also shows it to the
// model). Both are bounded here so one heavy spatial answer cannot turn into a
// multi-megabyte JSON-RPC response that a host gives up on.
//
// Geometry is the only field that grows without bound in practice: a bbox
// include_geometry call on the metro walksheds is ~0.6–1 MB of compact
// coordinates, and pretty-printing it for the text block made it 3–5 MB. The
// model needs the feature rows, not the coordinates; the widget can rebuild the
// shapes from the public asset with the same selection (`geometry_ref`).

import type { JsonObject, JsonValue } from '../shared/json'
import { isJsonObject, isJsonString, jsonObjectFromSerializable } from '../shared/json'
import type { GeometryRef } from '../shared/bboxGeometry'
import { AGENT_PREVIEW_ROWS, UI_PREVIEW_ROWS, previewSavedResult } from './resultPreview'

/** Compact GeoJSON bytes the text block may carry. Larger shapes are described, not inlined. */
export const TEXT_GEOMETRY_MAX_BYTES = 48 * 1024
/** Compact GeoJSON bytes structuredContent may carry. Larger shapes go by reference. */
export const UI_GEOMETRY_MAX_BYTES = 192 * 1024
/** Hard ceiling for structuredContent after geometry handling; row lists are trimmed to fit. */
export const STRUCTURED_MAX_BYTES = 512 * 1024
/** Text bodies up to this size stay pretty-printed; larger ones are compact. */
const PRETTY_TEXT_MAX_BYTES = 32 * 1024

export interface ToolEnvelope {
  content: Array<{ type: 'text'; text: string }>
  structuredContent?: JsonObject
}

export interface EnvelopeOptions {
  /** Absolute app origin, for the asset URL an agent without the widget can fetch. */
  origin: string
  /** The selection a bbox include_geometry call ran; null when the call was not one. */
  geometrySource: Omit<GeometryRef, 'features' | 'bytes'> | null
}

function byteLength(value: JsonValue | JsonObject): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

function featureCount(geometry: JsonValue | undefined): number {
  return isJsonObject(geometry) && Array.isArray(geometry.features) ? geometry.features.length : 0
}

/** Drop rows from the end of `rows`/`features` until the body fits `maxBytes`. */
function fitRows(body: JsonObject, maxBytes: number): JsonObject {
  let size = byteLength(body)
  if (size <= maxBytes) return body
  const rows = Array.isArray(body.rows) ? body.rows : null
  const features = Array.isArray(body.features) ? body.features : null
  const total = Math.max(rows?.length ?? 0, features?.length ?? 0)
  if (total === 0) return body
  let keep = total
  let out = body
  while (size > maxBytes && keep > 0) {
    keep = Math.floor(keep * Math.min(0.9, maxBytes / size))
    out = { ...body }
    if (rows) out.rows = rows.slice(0, keep)
    if (features) out.features = features.slice(0, keep)
    out.truncated = true
    out.structured_rows_trimmed = {
      shown: keep,
      returned: total,
      note: `Trimmed to ${keep} of ${total} rows to keep the inline view small; the text result lists them.`,
    }
    size = byteLength(out)
  }
  return out
}

/**
 * Build the MCP tool result for one successful call. `rec` is the handler's
 * JSON body; `args` the call arguments.
 */
export function toolResultEnvelope(
  name: string,
  args: JsonObject,
  rec: JsonObject,
  options: EnvelopeOptions,
): ToolEnvelope {
  const { geometry, ...rest } = rec
  const wantsGeometry = args.include_geometry === true && geometry !== undefined
  let textBody: JsonObject = rest
  let uiBody: JsonObject = rest

  if (wantsGeometry) {
    const bytes = byteLength(geometry)
    const features = featureCount(geometry)
    const source = options.geometrySource
    const typedRef: GeometryRef | null = source ? { ...source, features, bytes } : null
    const ref = typedRef ? jsonObjectFromSerializable(typedRef) : null
    const omitted = {
      geometry_omitted: 'size_limit' as const,
      geometry_summary: { features, bytes },
    }
    if (bytes <= TEXT_GEOMETRY_MAX_BYTES) {
      textBody = rec
    } else {
      const hint = isJsonString(rec.result_url)
        ? `The saved snapshot at result_url holds every shape.`
        : 'Narrow bbox, add where filters or lower limit to inline the shapes.'
      textBody = { ...rest, ...omitted }
      if (ref) textBody.geometry_ref = { ...ref, url: `${options.origin}${typedRef?.path ?? ''}` }
      textBody.geometry_note =
        `${features} shapes (${Math.round(bytes / 1024)} KB of coordinates) are not inlined in this text; the feature rows above carry their properties. ` +
        (ref ? 'geometry_ref names the public GeoJSON asset and the exact selection that reproduces them. ' : '') +
        hint
    }
    if (bytes <= UI_GEOMETRY_MAX_BYTES) {
      uiBody = rec
    } else {
      uiBody = { ...rest, ...omitted }
      if (ref) uiBody.geometry_ref = ref
    }
  }

  // A saved view may hold thousands of rows; the agent gets a preview and the
  // view/result URLs, the inline MCP App keeps a 200-row bound.
  if (name === 'query_data') {
    textBody = previewSavedResult(textBody, AGENT_PREVIEW_ROWS)
    uiBody = previewSavedResult(uiBody, UI_PREVIEW_ROWS)
  }
  uiBody = fitRows(uiBody, STRUCTURED_MAX_BYTES)

  const compact = JSON.stringify(textBody)
  const text = compact.length <= PRETTY_TEXT_MAX_BYTES ? JSON.stringify(textBody, null, 2) : compact
  return {
    content: [{ type: 'text', text }],
    structuredContent: uiBody,
  }
}
