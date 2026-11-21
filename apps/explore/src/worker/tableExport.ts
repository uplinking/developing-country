// Public, unauthenticated bulk export of Indicator Tables.
//
//   GET /api/tables                 every Indicator Table, with its CSV and metadata URLs
//   GET /api/tables/{id}            metadata sidecar: fields, sources, reuse terms, citation
//   GET /api/tables/{id}.csv        the table as CSV (one line in R or pandas)
//
// Rows come from queryData — the same bounded select the MCP tool and Data
// Views use — so export never reads tables through a second path. The CSV body
// is plain (no comment lines) so read.csv(url) and pandas.read_csv(url) work
// with no arguments; source, licence and version travel in the metadata
// sidecar and in Link / X- response headers.

import {
  datasetPublisher,
  datasetReuseTerms,
  type DatasetReuseTerms,
  type IndicatorField,
  type IndicatorScalar,
} from '@developing-country/datasets'
import type { JsonObject, JsonValue } from '@developing-country/domain/json'
import { ApiError } from './errors'
import { catalogEntries, type CatalogEntry } from './ontology'
import { EXPORT_MAX_ROWS, queryData, type QueryTableResult } from './queryData'
import type { Env } from './types'

export const PUBLIC_EXPLORER_ORIGIN = 'https://explore.developing-country.org'
const PUBLIC_SITE_ORIGIN = 'https://developing-country.org'
const DATASET_ID = /^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$/
/** Query parameters with a fixed meaning; every other parameter filters a field. */
const RESERVED_PARAMS = new Set(['fields', 'order_by', 'version'])
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Expose-Headers': 'Content-Disposition, Link, X-Dataset-Version, X-Licence-Status, X-Row-Count',
}

interface TableListing {
  dataset_id: string
  title: string
  description: string
  publisher: string
  reuse: DatasetReuseTerms | null
  csv_url: string
  metadata_url: string
  web_url: string
}

/** Indicator Tables as the ontology registers them: entities whose storage is a table. */
function tableEntries(): CatalogEntry[] {
  return catalogEntries().filter((entry) => entry.storage.kind === 'table')
}

function tableEntry(datasetId: string): CatalogEntry {
  const entry = tableEntries().find((candidate) => candidate.dataset_ids.includes(datasetId))
  if (!entry) throw new ApiError(404, JSON.stringify({ error: 'unknown_table', dataset_id: datasetId, list: `${PUBLIC_EXPLORER_ORIGIN}/api/tables` }))
  return entry
}

function publisherName(datasetId: string, entry: CatalogEntry): string {
  try {
    return datasetPublisher(datasetId).name
  } catch {
    return entry.sources[0]?.publisher ?? entry.source
  }
}

function urls(origin: string, datasetId: string) {
  const id = encodeURIComponent(datasetId)
  return {
    csv_url: `${origin}/api/tables/${id}.csv`,
    metadata_url: `${origin}/api/tables/${id}`,
    web_url: `${PUBLIC_SITE_ORIGIN}/data/${id}`,
  }
}

export function listTables(origin = PUBLIC_EXPLORER_ORIGIN) {
  const tables = tableEntries().flatMap((entry) => entry.dataset_ids.map((datasetId): TableListing => ({
    dataset_id: datasetId,
    title: entry.title,
    description: entry.description,
    publisher: publisherName(datasetId, entry),
    reuse: datasetReuseTerms(datasetId),
    ...urls(origin, datasetId),
  })))
  tables.sort((a, b) => a.dataset_id.localeCompare(b.dataset_id))
  return { count: tables.length, tables, docs: `${PUBLIC_SITE_ORIGIN}/api` }
}

function coerce(field: IndicatorField, raw: string): IndicatorScalar {
  if (raw === '') return null
  if (field.type === 'number' || field.type === 'integer' || field.type === 'year') {
    const value = Number(raw)
    if (!Number.isFinite(value)) throw new ApiError(400, JSON.stringify({ error: 'invalid_filter', field: field.id, value: raw, expected: field.type }))
    return value
  }
  if (field.type === 'boolean') {
    if (raw === 'true') return true
    if (raw === 'false') return false
    throw new ApiError(400, JSON.stringify({ error: 'invalid_filter', field: field.id, value: raw, expected: 'true or false' }))
  }
  return raw
}

/**
 * Translate URL parameters into the select grammar queryData already validates:
 *   ?district=Colombo            eq
 *   ?district=Colombo,Gampaha    in
 *   ?year.gte=2020&year.lte=2024 range
 *   ?fields=year,district,value  column subset, in that order
 *   ?order_by=-year,district     sort ("-" for descending)
 *   ?version=dsv_…               pin a Dataset Version (scheduled sources)
 */
export function selectArgs(datasetId: string, params: URLSearchParams, fields: IndicatorField[]): JsonObject {
  const byId = new Map(fields.map((field) => [field.id, field]))
  const where: JsonObject[] = []
  for (const [key, raw] of params) {
    if (RESERVED_PARAMS.has(key)) continue
    const match = /^([a-z][a-z0-9_]*)(?:\.(eq|gte|lte|in))?$/.exec(key)
    const field = match ? byId.get(match[1]!) : undefined
    if (!match || !field) {
      throw new ApiError(400, JSON.stringify({
        error: 'unknown_parameter',
        parameter: key,
        valid_fields: fields.map((f) => f.id),
        reserved: [...RESERVED_PARAMS],
      }))
    }
    const op = match[2] ?? (raw.includes(',') ? 'in' : 'eq')
    if (op === 'in') where.push({ field: field.id, op, value: raw.split(',').map((part) => coerce(field, part.trim())) })
    else where.push({ field: field.id, op, value: coerce(field, raw) })
  }
  const args: JsonObject = { op: 'select', dataset_id: datasetId, limit: EXPORT_MAX_ROWS }
  const fieldList = params.get('fields')
  if (fieldList) args.fields = fieldList.split(',').map((id) => id.trim()).filter(Boolean)
  if (where.length) args.where = where
  const order = params.get('order_by')
  if (order) {
    args.order_by = order.split(',').map((part) => part.trim()).filter(Boolean).map((part) => (
      part.startsWith('-') ? { field: part.slice(1), direction: 'desc' } : { field: part, direction: 'asc' }
    ))
  }
  const version = params.get('version')
  if (version) args.version_id = version
  return args
}

function csvCell(value: JsonValue | undefined): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\r\n]/.test(text) || text !== text.trim() ? `"${text.replace(/"/g, '""')}"` : text
}

/** RFC 4180 CSV: header of field ids, CRLF line ends, empty cell for null. */
export function toCsv(fields: readonly IndicatorField[], rows: readonly JsonObject[]): string {
  const lines = [fields.map((field) => csvCell(field.id)).join(',')]
  for (const row of rows) lines.push(fields.map((field) => csvCell(row[field.id])).join(','))
  return `${lines.join('\r\n')}\r\n`
}

export function citation(input: { title: string; publisher: string; datasetId: string; versionId?: string; accessed: string }): string {
  const version = input.versionId ? ` Dataset version ${input.versionId}.` : ''
  return `${input.publisher}. ${input.title}. Distributed by developing-country.org.${version} ${PUBLIC_SITE_ORIGIN}/data/${input.datasetId} (accessed ${input.accessed}).`
}

async function fullTable(env: Env, datasetId: string, params: URLSearchParams): Promise<{ entry: CatalogEntry; result: QueryTableResult }> {
  const entry = tableEntry(datasetId)
  // Field schema first (one row), so URL filters can be typed and checked.
  // Archived (scheduled) tables need their report_date window even here.
  const probeArgs: JsonObject = { op: 'select', dataset_id: datasetId, limit: 1 }
  if (params.get('version')) probeArgs.version_id = params.get('version')!
  const dateWindow = [...params].flatMap(([key, value]): JsonObject[] => {
    const match = /^report_date(?:\.(eq|gte|lte|in))?$/.exec(key)
    if (!match) return []
    const op = match[1] ?? (value.includes(',') ? 'in' : 'eq')
    return [{ field: 'report_date', op, value: op === 'in' ? value.split(',') : value }]
  })
  if (dateWindow.length) probeArgs.where = dateWindow
  const probe = await queryData(env, probeArgs, { maxRows: EXPORT_MAX_ROWS, bulkExport: true })
  const args = selectArgs(datasetId, params, probe.field_schema)
  const result = await queryData(env, args, { maxRows: EXPORT_MAX_ROWS, bulkExport: true })
  if (result.truncated) {
    throw new ApiError(413, JSON.stringify({ error: 'export_too_large', total_count: result.total_count, max_rows: EXPORT_MAX_ROWS, hint: 'Filter rows with ?field=value or ?field.gte=…' }))
  }
  return { entry, result }
}

function metadata(origin: string, datasetId: string, entry: CatalogEntry, result: QueryTableResult) {
  const publisher = publisherName(datasetId, entry)
  const version = result.dataset_versions?.[0]
  const accessed = new Date().toISOString().slice(0, 10)
  return {
    dataset_id: datasetId,
    title: entry.title,
    description: entry.description,
    publisher,
    reuse: datasetReuseTerms(datasetId),
    citation: citation({ title: entry.title, publisher, datasetId, versionId: version?.versionId, accessed }),
    vintage: entry.vintage,
    refreshed_at: entry.refreshed_at ?? null,
    row_count: result.total_count,
    fields: result.field_schema.map((field) => ({
      id: field.id,
      label: field.label,
      role: field.role,
      type: field.type,
      unit: field.unit ?? null,
    })),
    sources: entry.sources.map((source) => ({
      id: source.id,
      name: source.name,
      publisher: source.publisher,
      url: source.url,
      licence: source.licence,
      licence_status: source.licence_status,
      vintage: source.vintage,
    })),
    dataset_versions: result.dataset_versions ?? [],
    ...urls(origin, datasetId),
    filters: 'Add ?field=value (comma-separate for several values), ?field.gte= / ?field.lte= for ranges, ?fields=a,b for columns and ?order_by=-field to sort.',
  }
}

function jsonResponse(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
  })
}

/** ApiError messages are either a JSON object (typed errors) or plain text. */
function errorBody(error: ApiError): string {
  return error.message.startsWith('{') ? error.message : JSON.stringify({ error: error.message })
}

function errorResponse(error: ApiError): Response {
  return new Response(errorBody(error), {
    status: error.status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

export async function serveTables(request: Request, env: Env, path: string): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS })
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { ...CORS_HEADERS, Allow: 'GET, HEAD, OPTIONS' } })
  }
  const url = new URL(request.url)
  const origin = url.origin
  try {
    const trimmed = path.replace(/\/+$/, '')
    if (trimmed === '/api/tables') return jsonResponse(listTables(origin))
    const match = /^\/api\/tables\/([^/]+?)(\.csv|\.json)?$/.exec(trimmed)
    const datasetId = match ? decodeURIComponent(match[1]!) : ''
    if (!match || !DATASET_ID.test(datasetId)) return errorResponse(new ApiError(404, JSON.stringify({ error: 'not_found', list: `${origin}/api/tables` })))
    const { entry, result } = await fullTable(env, datasetId, url.searchParams)
    if (match[2] !== '.csv') return jsonResponse(metadata(origin, datasetId, entry, result))

    const reuse = datasetReuseTerms(datasetId)
    const version = result.dataset_versions?.[0]?.versionId
    const links = [`<${urls(origin, datasetId).metadata_url}>; rel="describedby"; type="application/json"`]
    if (reuse?.licence) links.push(`<${reuse.licence.url}>; rel="license"`)
    else if (reuse) links.push(`<${reuse.terms_url}>; rel="terms-of-service"`)
    const headers = new Headers({
      ...CORS_HEADERS,
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${datasetId}.csv"`,
      'Cache-Control': 'public, max-age=300',
      Link: links.join(', '),
      'X-Row-Count': String(result.count),
    })
    if (reuse) headers.set('X-Licence-Status', reuse.status)
    if (version) headers.set('X-Dataset-Version', version)
    const body = toCsv(result.field_schema, result.rows)
    return new Response(request.method === 'HEAD' ? null : body, { status: 200, headers })
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error)
    console.error('table_export_failed', error)
    return errorResponse(new ApiError(500, JSON.stringify({ error: 'export_failed' })))
  }
}
