import { runtimeVersion } from './scheduledData'
import { readTable, versionEvidence } from '../../packages/ingestion/src/storage'
// Bounded table queries. Artifact validation and row selection stay behind the
// @developing-country/datasets seam; this file only adapts ontology + ASSETS to
// the Worker result envelope used by Data Views.

import {
  DATASET_QUERY_LIMITS,
  DatasetContractError,
  parseIndicatorTable,
  selectRows,
  type IndicatorField,
  type IndicatorTableV1,
} from '@developing-country/datasets'
import { aggregateRows, parseAggregateQuery } from './queryAggregate'
import type { JsonObject } from '../shared/json'
import { loadJson } from './assets'
import { ApiError } from './errors'
import { ONTOLOGY, type Completeness, type EntityType, type Provenance } from './ontology'
import type { QuerySpatialResult } from './querySpatial'
import type { Env } from './types'

const DATASET_ID = /^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$/
const QUERY_KEYS = new Set([
  'op', 'dataset_id', 'fields', 'where', 'order_by', 'limit', 'version_id', 'group_by', 'aggregates',
])
/** Rows an agent may read back from a plain select. */
export const SELECT_MAX_ROWS = DATASET_QUERY_LIMITS.maxRows
/** Rows a select may return when the result is being saved as a Data View (still bounded by the snapshot byte cap). */
export const PRESENTATION_MAX_ROWS = 5_000
const PUBLIC_SITE_ORIGIN = 'https://developing-country.org'
const tableCache = new Map<string, IndicatorTableV1>()

interface TableStorage {
  kind: 'table'
  path: string
}

export interface QueryTableResult extends QuerySpatialResult {
  op: 'select'
  result_kind: 'table'
  dataset_id: string
  method: 'indicator_table_v1_select' | 'indicator_table_v1_aggregate'
  rows: JsonObject[]
  /** Transitional alias for the current Data View row reader. */
  features: JsonObject[]
  field_schema: IndicatorField[]
  total_count: number
}

function typed(status: number, body: JsonObject): never {
  throw new ApiError(status, JSON.stringify(body))
}

function tableStorageOf(entity: EntityType): TableStorage | null {
  const storage = entity.storage as unknown
  if (typeof storage !== 'object' || storage === null || Array.isArray(storage)) return null
  const candidate = storage as Record<string, unknown>
  if (candidate.kind !== 'table') return null
  if (
    typeof candidate.path !== 'string' ||
    !candidate.path.startsWith('/data/') ||
    !candidate.path.endsWith('.json') ||
    candidate.path.includes('..') ||
    candidate.path.includes('?') ||
    candidate.path.includes('#')
  ) {
    typed(500, { error: 'invalid_table_storage', entity: entity.id })
  }
  return { kind: 'table', path: candidate.path }
}

function datasetIdsOf(entity: EntityType): string[] {
  return entity.dataset_ids ?? [entity.layer_id ?? entity.catalog_id ?? entity.id]
}

function entityForDataset(datasetId: string): EntityType {
  const matches = ONTOLOGY.entities.filter((entity) => datasetIdsOf(entity).includes(datasetId))
  if (matches.length === 0) typed(400, { error: 'unknown_dataset', dataset_id: datasetId })
  const tableMatches = matches.filter((entity) => {
    const storage = entity.storage as unknown
    return typeof storage === 'object' && storage !== null && !Array.isArray(storage) &&
      (storage as Record<string, unknown>).kind === 'table'
  })
  if (tableMatches.length === 0) typed(400, { error: 'operator_unavailable', op: 'select', dataset_id: datasetId })
  if (tableMatches.length > 1) typed(500, { error: 'ambiguous_dataset_registration', dataset_id: datasetId })
  const entity = tableMatches[0]
  if (!entity) throw new Error('unreachable')
  if (!tableStorageOf(entity)) {
    typed(400, { error: 'operator_unavailable', op: 'select', dataset_id: datasetId })
  }
  return entity
}

function equalIds(left: string[], right: string[]): boolean {
  const a = [...left].sort()
  const b = [...right].sort()
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function selectedFields(fields: IndicatorField[], ids: string[]): IndicatorField[] {
  const byId = new Map(fields.map((field) => [field.id, field]))
  return ids.map((id) => byId.get(id)).filter((field): field is IndicatorField => field !== undefined)
}

function queryInput(args: JsonObject): JsonObject {
  const out: JsonObject = {}
  for (const key of ['fields', 'where', 'order_by', 'limit'] as const) {
    if (args[key] !== undefined) out[key] = args[key]
  }
  return out
}

async function loadTable(env: Env, storage: TableStorage, datasetId: string): Promise<IndicatorTableV1> {
  const cached = tableCache.get(storage.path)
  if (cached) return cached
  const raw = await loadJson<object>(env, storage.path)
  if (!raw) typed(503, { error: 'dataset_unavailable', dataset_id: datasetId })
  try {
    const table = parseIndicatorTable(raw)
    tableCache.set(storage.path, table)
    return table
  } catch (error) {
    if (error instanceof DatasetContractError) {
      typed(500, { error: 'invalid_dataset_artifact', dataset_id: datasetId, issues: [...error.issues] })
    }
    throw error
  }
}

export interface QueryDataOptions {
  /** Row ceiling for this call: SELECT_MAX_ROWS, or PRESENTATION_MAX_ROWS when a view is saved. */
  maxRows?: number
}

function assertRowLimit(args: JsonObject, maxRows: number): void {
  const limit = args.limit
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit <= maxRows) return
  typed(400, {
    error: 'row_limit_exceeded',
    limit,
    max_rows: maxRows,
    max_rows_without_presentation: SELECT_MAX_ROWS,
    max_rows_with_presentation: PRESENTATION_MAX_ROWS,
    message: maxRows < PRESENTATION_MAX_ROWS
      ? `select returns at most ${SELECT_MAX_ROWS} rows; add a presentation to save up to ${PRESENTATION_MAX_ROWS} rows as a Data View, or aggregate with group_by`
      : `a saved select is capped at ${PRESENTATION_MAX_ROWS} rows; aggregate with group_by or narrow the where clause`,
  })
}

export async function queryData(env: Env, args: JsonObject, options: QueryDataOptions = {}): Promise<QueryTableResult> {
  const maxRows = Math.min(options.maxRows ?? SELECT_MAX_ROWS, PRESENTATION_MAX_ROWS)
  const op = args.op
  if (op !== 'select') typed(400, { error: 'unknown_op', op: typeof op === 'string' ? op : null, known: ['select'] })
  const extra = Object.keys(args).find((key) => !QUERY_KEYS.has(key))
  if (extra) typed(400, { error: 'unknown_key', key: extra })
  const datasetId = args.dataset_id
  if (typeof datasetId !== 'string' || !DATASET_ID.test(datasetId)) {
    typed(400, { error: 'invalid_dataset_id' })
  }

  const aggregating = args.aggregates !== undefined || args.group_by !== undefined
  if (aggregating && args.fields !== undefined) {
    typed(400, {
      error: 'invalid_query',
      issues: ['query.fields must be omitted with aggregates; output columns are group_by plus each aggregate `as` name'],
    })
  }
  assertRowLimit(args, maxRows)

  const entity = entityForDataset(datasetId)
  const storage = tableStorageOf(entity)
  if (!storage) throw new Error('unreachable')
  if (args.version_id !== undefined && typeof args.version_id !== 'string') typed(400, { error: 'invalid_version_id' })
  const version = await runtimeVersion(env, datasetId, args.version_id as string | undefined)
  if (args.version_id && !version) typed(400, { error: 'version_selection_unavailable' })
  let dates: string[] | undefined
  if (version) {
    // Validate query syntax against one partition before pruning the archive.
    const schema = await readTable(env.DATASETS!, version, [version.partitions.at(-1)!.date])
    try {
      if (aggregating) parseAggregateQuery(schema, args, DATASET_QUERY_LIMITS.defaultRows, maxRows)
      else selectRows(schema, queryInput(args), { maxRows })
    } catch (error) {
      typed(400, { error: 'invalid_query', ...(error instanceof DatasetContractError ? { issues: [...error.issues] } : {}) })
    }
    const predicates = Array.isArray(args.where) ? args.where as JsonObject[] : []
    dates = version.partitions.map(p => p.date).filter(date => predicates.every(p => {
      if (p.field !== 'report_date') return true
      if (p.op === 'eq') return date === p.value
      if (p.op === 'gte') return date >= String(p.value)
      if (p.op === 'lte') return date <= String(p.value)
      if (p.op === 'in') return Array.isArray(p.value) && p.value.includes(date)
      return true
    }))
    if (dates.length > 31) typed(400, { error: 'date_range_required', message: 'Filter report_date to at most 31 archived dates.' })
  }
  const table = version ? await readTable(env.DATASETS!, version, dates) : await loadTable(env, storage, datasetId)
  if (table.dataset_id !== datasetId) {
    typed(500, {
      error: 'dataset_artifact_mismatch',
      dataset_id: datasetId,
      artifact_dataset_id: table.dataset_id,
    })
  }
  if (table.country !== ONTOLOGY.country) {
    typed(500, {
      error: 'dataset_country_mismatch',
      dataset_id: datasetId,
      expected: ONTOLOGY.country,
      actual: table.country,
    })
  }
  if (!equalIds(table.source_ids, entity.source_ids)) {
    typed(500, {
      error: 'dataset_sources_mismatch',
      dataset_id: datasetId,
      expected: entity.source_ids,
      actual: table.source_ids,
    })
  }

  let selected: { rows: object[]; total: number; truncated: boolean }
  let fieldSchema: IndicatorField[]
  try {
    if (aggregating) {
      const aggregate = aggregateRows(table, parseAggregateQuery(table, args, DATASET_QUERY_LIMITS.defaultRows, maxRows))
      selected = aggregate
      fieldSchema = aggregate.fields
    } else {
      selected = selectRows(table, queryInput(args), { maxRows })
      fieldSchema = selectedFields(table.fields, args.fields as string[])
    }
  } catch (error) {
    if (error instanceof DatasetContractError && error.code === 'invalid_query') {
      typed(400, { error: 'invalid_query', issues: [...error.issues] })
    }
    throw error
  }
  const rows = selected.rows as JsonObject[]
  const noun = aggregating ? (selected.total === 1 ? 'group' : 'groups') : selected.total === 1 ? 'row' : 'rows'
  return {
    ...(version ? { dataset_versions: [versionEvidence(version)] } : {}),
    op: 'select',
    result_kind: 'table',
    dataset_id: datasetId,
    entities: [entity.id],
    method: aggregating ? 'indicator_table_v1_aggregate' : 'indicator_table_v1_select',
    generated_at: new Date().toISOString(),
    provenance: [version ? { ...entity.provenance, vintage: version.vintage, refreshed: version.refreshedAt.slice(0, 10) } : entity.provenance] as Provenance[],
    completeness: [version ? { status: 'partial', coverage: null, coverage_note: versionEvidence(version).completeness.coverageNote, known_gaps: [] } : entity.completeness] as Completeness[],
    summary: `${rows.length} of ${selected.total} matching ${noun} from ${table.title ?? datasetId}`,
    count: rows.length,
    total_count: selected.total,
    truncated: selected.truncated,
    rows,
    features: rows,
    field_schema: fieldSchema,
    web_url: `${PUBLIC_SITE_ORIGIN}/data/${encodeURIComponent(datasetId)}`,
    stage: [],
    saved: null,
  }
}
