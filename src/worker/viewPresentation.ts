// Presentation intent → saved Data View fields. The contract and its structural
// validators live in @developing-country/views; this file checks the intent
// against the ACTUAL result (layer ids, joined row keys, styled fields,
// highlighted categories) so a saved view can never reference data it lacks.

import type {
  DataViewPresentation,
  MapAnnotation,
  MapCamera,
  MapLayerPresentation,
  MapLayerStyle,
  MapLayerView,
} from '@developing-country/views'
import { rowsFromViewResult, type DataViewResultRow } from '@developing-country/views'
import type { JsonObject } from '../shared/json'
import { ApiError } from './errors'
import type { QuerySpatialResult } from './querySpatial'

type MapPresentation = Extract<DataViewPresentation, { kind: 'map' }>
type ChartPresentation = Extract<DataViewPresentation, { kind: 'chart' }>

function typed(status: number, body: JsonObject): never {
  throw new ApiError(status, JSON.stringify(body))
}

/** The Indicator Table id when the result came from op=select, else null. */
export function tableDatasetId(result: QuerySpatialResult): string | null {
  const candidate = result as QuerySpatialResult & { result_kind?: unknown; dataset_id?: unknown }
  return candidate.result_kind === 'table' && typeof candidate.dataset_id === 'string' ? candidate.dataset_id : null
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isPointRow(row: DataViewResultRow): boolean {
  return finite(row.lng) && finite(row.lat) && Math.abs(row.lng) <= 180 && Math.abs(row.lat) <= 90
}

/** True when every row carries numeric `lng` and `lat` — renderable as a circle layer. */
export function hasPointRows(rows: DataViewResultRow[]): boolean {
  return rows.length > 0 && rows.every(isPointRow)
}

function styleFields(style: MapLayerStyle): string[] {
  return [style.colorBy?.field, style.radiusBy?.field, style.labelField].filter(
    (field): field is string => typeof field === 'string',
  )
}

function assertFieldsExist(layerId: string, style: MapLayerStyle, rows: DataViewResultRow[]): void {
  const missing = styleFields(style).filter((field) => !rows.some((row) => Object.hasOwn(row, field)))
  if (missing.length > 0) {
    typed(422, { error: 'unknown_style_field', layer: layerId, fields: missing, available: Object.keys(rows[0] ?? {}) })
  }
  const numeric = [style.radiusBy?.field, style.colorBy && style.colorBy.scale !== 'categorical' ? style.colorBy.field : undefined]
    .filter((field): field is string => typeof field === 'string')
  for (const field of numeric) {
    if (!rows.some((row) => finite(row[field]))) {
      typed(422, { error: 'style_field_not_numeric', layer: layerId, field })
    }
  }
}

function assertJoin(layer: MapLayerPresentation, rows: DataViewResultRow[], warnings: string[]): void {
  const join = layer.join
  if (!join) return
  const keyed = rows.filter((row) => typeof row[join.rowKey] === 'string' || finite(row[join.rowKey]))
  if (keyed.length === 0) {
    typed(422, {
      error: 'join_row_key_missing',
      layer: layer.id,
      row_key: join.rowKey,
      message: `no result row has a string or numeric ${join.rowKey}; select the field that holds the ${join.sourceLayer} id`,
      available: Object.keys(rows[0] ?? {}),
    })
  }
  const seen = new Set<string>()
  for (const row of keyed) {
    const key = String(row[join.rowKey])
    if (seen.has(key)) {
      typed(422, {
        error: 'join_row_key_not_unique',
        layer: layer.id,
        row_key: join.rowKey,
        duplicate: key,
        message: 'a tile join needs one row per feature; filter to one period/category or aggregate with group_by',
      })
    }
    seen.add(key)
  }
  if (keyed.length < rows.length) {
    warnings.push(`${rows.length - keyed.length} of ${rows.length} rows have no ${join.rowKey} and will not be drawn`)
  }
}

/**
 * Merge presentation layers onto the result's own layers by id. Spatial results
 * expose one layer per entity; an Indicator Table select exposes one layer named
 * by its dataset id, which must be drawable (lng/lat rows or a tile join).
 */
export function composeMapLayers(
  result: QuerySpatialResult,
  presentation: MapPresentation,
  warnings: string[],
): MapLayerView[] {
  const rows = rowsFromViewResult(result)
  const tableId = tableDatasetId(result)
  const baseIds = tableId ? [tableId] : [...result.entities]
  const requested = new Map<string, MapLayerPresentation>()
  for (const layer of presentation.layers ?? []) {
    if (requested.has(layer.id)) typed(422, { error: 'duplicate_presentation_layer', layer: layer.id })
    if (!baseIds.includes(layer.id)) {
      typed(422, { error: 'unknown_presentation_layer', layer: layer.id, valid_layer_ids: baseIds })
    }
    requested.set(layer.id, layer)
  }

  if (tableId) {
    const layer = requested.get(tableId)
    if (!layer?.join && !hasPointRows(rows)) {
      typed(422, {
        error: 'map_requires_points_or_join',
        dataset_id: tableId,
        message:
          `an Indicator Table becomes a map when every row has numeric lng and lat, or when presentation.layers ` +
          `has { id: "${tableId}", join: { tileset: "demographics", sourceLayer, rowKey } }`,
      })
    }
    if (result.truncated) {
      warnings.push(
        `map saved ${result.count} of ${(result as { total_count?: number }).total_count ?? 'more'} matching rows; ` +
          'raise limit (up to 5000 with a presentation) to draw every unit',
      )
    }
  }

  return baseIds.map((id) => {
    const layer = requested.get(id)
    const isRowLayer = id === tableId || layer?.join !== undefined
    const style: MapLayerStyle | undefined =
      layer?.style ?? (id === tableId ? { geometry: layer?.join ? 'fill' : 'circle' } : undefined)
    if (layer) assertJoin(layer, rows, warnings)
    if (style && isRowLayer && rows.length > 0) assertFieldsExist(id, style, rows)
    const out: MapLayerView = { id, visible: layer?.visible ?? true }
    if (layer?.label) out.label = layer.label
    if (layer?.filter) out.filter = layer.filter
    if (style) out.style = style
    if (layer?.join) out.join = layer.join
    if (layer?.legend !== undefined) out.legend = layer.legend
    return out
  })
}

export function checkedAnnotations(presentation: MapPresentation): MapAnnotation[] | undefined {
  const annotations = presentation.annotations
  if (!annotations || annotations.length === 0) return undefined
  const ids = new Set<string>()
  for (const annotation of annotations) {
    if (ids.has(annotation.id)) typed(422, { error: 'duplicate_annotation', id: annotation.id })
    ids.add(annotation.id)
  }
  return annotations.map((annotation) => ({ ...annotation }))
}

export function checkedHighlight(presentation: ChartPresentation, result: QuerySpatialResult): string[] | undefined {
  const highlight = presentation.highlight
  if (!highlight || highlight.length === 0) return undefined
  const values = new Set(rowsFromViewResult(result).map((row) => String(row[presentation.dimension.field] ?? '')))
  const unknown = highlight.filter((value) => !values.has(value))
  if (unknown.length > 0) {
    typed(422, {
      error: 'unknown_highlight',
      dimension: presentation.dimension.field,
      values: unknown,
      message: 'highlight values must equal dimension values present in the result',
    })
  }
  return [...new Set(highlight)]
}

/** Fit a camera to point rows when the agent did not supply one. */
export function cameraForPoints(rows: DataViewResultRow[]): MapCamera | null {
  if (!hasPointRows(rows)) return null
  const lngs = rows.map((row) => row.lng as number)
  const lats = rows.map((row) => row.lat as number)
  const west = Math.min(...lngs)
  const east = Math.max(...lngs)
  const south = Math.min(...lats)
  const north = Math.max(...lats)
  const span = Math.max(east - west, north - south, 0.005)
  const zoom = Math.min(14, Math.max(5, Math.log2(360 / span) - 1.5))
  return { center: [(west + east) / 2, (south + north) / 2], zoom: Math.round(zoom * 10) / 10 }
}
