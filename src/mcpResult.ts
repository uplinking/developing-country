import type { JsonFc, StageEvent } from './shared/stage'
import type { JsonObject, JsonValue } from './shared/json'
import {
  isJsonNumber,
  isJsonObject,
  isJsonString,
  jsonObjectFromSerializable,
  parseJsonObject,
} from './shared/json'
import { withBase } from './base'
import type { DataViewSpec } from '@developing-country/views'
import { validateDataViewSpec } from '@developing-country/views'

export type ToolBody = {
  op?: string
  entities?: string[]
  method?: string
  summary?: string
  count?: number
  truncated?: boolean
  features?: JsonObject[]
  aggregates?: JsonObject
  hull?: { type: 'Polygon'; coordinates: number[][][] }
  geometry?: JsonFc
  geometry_omitted?: 'storage_limit'
  web_url?: string
  stage?: StageEvent[]
  location?: { lat: number; lng: number; radius_km?: number }
  error?: string
  note?: string
  entity?: string
  district_demographics?: JsonValue
  view?: DataViewSpec
  view_url?: string
}

export function bodyFromResult(result: {
  structuredContent?: object
  content?: Array<{ type: string; text?: string }>
}): ToolBody {
  const structured = result.structuredContent
    ? jsonObjectFromSerializable(result.structuredContent)
    : null
  if (structured) return toolBodyFromObject(structured)
  const block = result.content?.find((c) => c.type === 'text' && c.text !== undefined)
  if (!block?.text) return {}
  const parsed = parseJsonObject(block.text)
  return parsed ? toolBodyFromObject(parsed) : { summary: block.text }
}

function stringArray(value: JsonValue | undefined): string[] | undefined {
  if (!Array.isArray(value) || !value.every(isJsonString)) return undefined
  return value
}

function toolBodyFromObject(value: JsonObject): ToolBody {
  const locationValue = isJsonObject(value.location) ? value.location : null
  const location =
    locationValue && isJsonNumber(locationValue.lat) && isJsonNumber(locationValue.lng)
      ? {
          lat: locationValue.lat,
          lng: locationValue.lng,
          ...(isJsonNumber(locationValue.radius_km) ? { radius_km: locationValue.radius_km } : {}),
        }
      : undefined
  const features = Array.isArray(value.features) ? value.features.filter(isJsonObject) : undefined
  const stageValue = Array.isArray(value.stage) ? value.stage : undefined
  const geometryValue = isJsonObject(value.geometry) ? value.geometry : undefined
  const hullValue = isJsonObject(value.hull) ? value.hull : undefined
  const checkedView = value.view === undefined ? null : validateDataViewSpec(value.view)

  // SAFETY: These payloads are emitted by the platform worker from the shared closed stage/GeoJSON contracts.
  const stage = stageValue as StageEvent[] | undefined
  // SAFETY: The worker only assigns a shared JsonFc to the `geometry` envelope field.
  const geometry = geometryValue as JsonFc | undefined
  // SAFETY: The worker constructs `hull` from the typed IsochroneHull contract.
  const hull = hullValue as ToolBody['hull']

  return {
    op: isJsonString(value.op) ? value.op : undefined,
    entities: stringArray(value.entities),
    method: isJsonString(value.method) ? value.method : undefined,
    summary: isJsonString(value.summary) ? value.summary : undefined,
    count: isJsonNumber(value.count) ? value.count : undefined,
    truncated: value.truncated === true ? true : undefined,
    features,
    aggregates: isJsonObject(value.aggregates) ? value.aggregates : undefined,
    hull,
    geometry,
    geometry_omitted: value.geometry_omitted === 'storage_limit' ? 'storage_limit' : undefined,
    web_url: isJsonString(value.web_url) ? value.web_url : undefined,
    stage,
    location,
    error: isJsonString(value.error) ? value.error : undefined,
    note: isJsonString(value.note) ? value.note : undefined,
    entity: isJsonString(value.entity) ? value.entity : undefined,
    district_demographics: value.district_demographics,
    view: checkedView?.ok ? checkedView.value : undefined,
    view_url:
      (value.view === undefined || checkedView?.ok) && isJsonString(value.view_url)
        ? value.view_url
        : undefined,
  }
}

export function modelContextFromFeature(info: {
  id?: string
  title: string
  groupId: string
  rows: Array<{ label: string; value: string }>
}): string {
  const popRow = info.rows.find((r) => /pop/i.test(r.label))
  const popRaw = popRow?.value?.replace(/[^\d.-]/g, '')
  const pop = popRaw ? Number(popRaw) : undefined
  return JSON.stringify({
    gnd: info.id ?? '',
    name: info.title,
    pop: Number.isFinite(pop) ? pop : undefined,
    layer: info.groupId,
  })
}

const mount = crypto.randomUUID()

export function mcpBeacon(event: 'select' | 'hover' | 'open_link' | 'ready' | 'geometry_fetch'): void {
  void fetch(withBase('/api/evt'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mount, event }),
  }).catch(() => {
    /* sandbox / offline */
  })
}
