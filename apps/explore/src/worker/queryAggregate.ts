// Grouped aggregation over ONE Indicator Table — the closed `group_by` +
// `aggregates` extension of query_data op=select. Row filtering stays behind
// the @developing-country/datasets seam (selectRows validates `where`); this
// file only groups the already-filtered rows, so there is still exactly one
// predicate implementation.

import {
  DatasetContractError,
  selectRows,
  type IndicatorField,
  type IndicatorRow,
  type IndicatorScalar,
  type IndicatorTableV1,
} from '@developing-country/datasets'

export type AggregateFn = 'sum' | 'mean' | 'min' | 'max' | 'count'

export interface AggregateSpec {
  fn: AggregateFn
  /** Required for sum/mean/min/max; optional for count (counts non-null values). */
  field?: string
  /** Output column name. */
  as: string
}

export interface AggregateQuery {
  group_by: string[]
  aggregates: AggregateSpec[]
  where?: unknown
  order_by: Array<{ field: string; direction: 'asc' | 'desc' }>
  limit: number
}

export interface AggregateResult {
  rows: Record<string, IndicatorScalar>[]
  total: number
  truncated: boolean
  fields: IndicatorField[]
}

export const AGGREGATE_LIMITS = Object.freeze({
  maxGroupBy: 4,
  maxAggregates: 8,
  maxOrderFields: 8,
})

const FIELD_ID = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/
const FNS = new Set<AggregateFn>(['sum', 'mean', 'min', 'max', 'count'])
const NUMERIC = new Set(['number', 'integer', 'year'])
const AGG_KEYS = new Set(['fn', 'field', 'as'])

function queryError(issue: string): never {
  throw new DatasetContractError('invalid_query', [issue])
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Parse the agent-supplied aggregation clause against the table's registered fields. */
export function parseAggregateQuery(
  table: IndicatorTableV1,
  input: { group_by?: unknown; aggregates?: unknown; where?: unknown; order_by?: unknown; limit?: unknown },
  defaultLimit: number,
  maxRows: number,
): AggregateQuery {
  const fields = new Map(table.fields.map((field) => [field.id, field]))
  const rawGroup = input.group_by ?? []
  if (!Array.isArray(rawGroup)) queryError('query.group_by must be an array')
  if (rawGroup.length > AGGREGATE_LIMITS.maxGroupBy) {
    queryError(`query.group_by supports at most ${AGGREGATE_LIMITS.maxGroupBy} fields`)
  }
  const groupBy: string[] = []
  for (const [index, id] of rawGroup.entries()) {
    if (typeof id !== 'string' || !fields.has(id)) queryError(`query.group_by[${index}] is not a registered field`)
    if (fields.get(id)?.role !== 'dimension') queryError(`query.group_by[${index}] must be a dimension field`)
    if (groupBy.includes(id)) queryError(`query.group_by contains duplicate field: ${id}`)
    groupBy.push(id)
  }

  const rawAggs = input.aggregates
  if (!Array.isArray(rawAggs) || rawAggs.length === 0) queryError('query.aggregates must be a non-empty array')
  if (rawAggs.length > AGGREGATE_LIMITS.maxAggregates) {
    queryError(`query.aggregates supports at most ${AGGREGATE_LIMITS.maxAggregates} entries`)
  }
  const outputs = new Set(groupBy)
  const aggregates: AggregateSpec[] = rawAggs.map((entry, index) => {
    const path = `query.aggregates[${index}]`
    if (!isRecord(entry)) queryError(`${path} must be an object`)
    const extra = Object.keys(entry).find((key) => !AGG_KEYS.has(key))
    if (extra) queryError(`${path} contains unknown field: ${extra}`)
    if (typeof entry.fn !== 'string' || !FNS.has(entry.fn as AggregateFn)) {
      queryError(`${path}.fn must be sum, mean, min, max or count`)
    }
    const fn = entry.fn as AggregateFn
    if (typeof entry.as !== 'string' || !FIELD_ID.test(entry.as)) queryError(`${path}.as must be a snake_case output name`)
    if (outputs.has(entry.as)) queryError(`${path}.as duplicates another output column: ${entry.as}`)
    outputs.add(entry.as)
    if (entry.field === undefined) {
      if (fn !== 'count') queryError(`${path}.field is required for ${fn}`)
      return { fn, as: entry.as }
    }
    if (typeof entry.field !== 'string' || !fields.has(entry.field)) queryError(`${path}.field is not a registered field`)
    const field = fields.get(entry.field)!
    if (fn !== 'count' && !NUMERIC.has(field.type)) queryError(`${path}.field must be numeric for ${fn}`)
    // The table contract says whether summing is meaningful (rates, shares and
    // long-format mixed-unit `value` columns are not). Fail closed.
    if (fn === 'sum' && field.aggregation !== 'sum') {
      queryError(`${path}: ${entry.field} is not declared summable (aggregation: ${field.aggregation ?? 'none'}); use mean, min, max or count`)
    }
    return { fn, field: entry.field, as: entry.as }
  })

  const rawOrder = input.order_by ?? []
  if (!Array.isArray(rawOrder)) queryError('query.order_by must be an array')
  if (rawOrder.length > AGGREGATE_LIMITS.maxOrderFields) {
    queryError(`query.order_by supports at most ${AGGREGATE_LIMITS.maxOrderFields} fields`)
  }
  const ordered = new Set<string>()
  const orderBy = rawOrder.map((entry, index) => {
    const path = `query.order_by[${index}]`
    if (!isRecord(entry)) queryError(`${path} must be an object`)
    if (typeof entry.field !== 'string' || !outputs.has(entry.field)) {
      queryError(`${path}.field must be a group_by field or an aggregate output name`)
    }
    if (ordered.has(entry.field)) queryError(`query.order_by contains duplicate field: ${entry.field}`)
    ordered.add(entry.field)
    if (entry.direction !== 'asc' && entry.direction !== 'desc') queryError(`${path}.direction must be asc or desc`)
    return { field: entry.field, direction: entry.direction as 'asc' | 'desc' }
  })

  const limit = input.limit ?? defaultLimit
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > maxRows) {
    queryError(`query.limit must be an integer from 1 to ${maxRows}`)
  }
  return { group_by: groupBy, aggregates, where: input.where, order_by: orderBy, limit }
}

function compareScalar(a: IndicatorScalar, b: IndicatorScalar): number {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  return a < b ? -1 : 1
}

/** Twelve significant digits: stable across engines, free of float summation noise. */
function tidy(value: number): number {
  return Number(value.toPrecision(12))
}

function aggregateField(spec: AggregateSpec, source: IndicatorField | undefined): IndicatorField {
  const label = source
    ? `${spec.fn === 'count' ? 'Count of' : spec.fn[0]!.toUpperCase() + spec.fn.slice(1)} ${source.label}`
    : 'Row count'
  const out: IndicatorField = {
    id: spec.as,
    role: 'measure',
    type: spec.fn === 'count' ? 'integer' : 'number',
    label,
    aggregation: spec.fn === 'count' || spec.fn === 'sum' ? 'sum' : 'none',
  }
  if (source?.unit && spec.fn !== 'count') out.unit = source.unit
  return out
}

/**
 * Filter with the shared predicate engine, group deterministically (rows arrive
 * in primary-key order), aggregate, then order by the requested outputs with
 * the group keys as ascending tie-breakers. Nulls sort last, as in selectRows.
 */
export function aggregateRows(table: IndicatorTableV1, query: AggregateQuery): AggregateResult {
  const sourceFields = [...new Set([
    ...query.group_by,
    ...query.aggregates.flatMap((spec) => spec.field ? [spec.field] : []),
  ])]
  const projection = sourceFields.length > 0 ? sourceFields : [table.primary_key[0] ?? table.fields[0]!.id]
  const filtered = selectRows(
    table,
    {
      fields: projection,
      ...(query.where !== undefined ? { where: query.where } : {}),
      limit: Math.max(1, table.rows.length),
    },
    { maxRows: Math.max(1, table.rows.length) },
  ).rows

  const groups = new Map<string, { key: IndicatorScalar[]; rows: IndicatorRow[] }>()
  for (const row of filtered) {
    const key = query.group_by.map((field) => row[field] ?? null)
    const id = JSON.stringify(key)
    const group = groups.get(id) ?? { key, rows: [] }
    group.rows.push(row)
    groups.set(id, group)
  }
  // A global aggregate (no group_by) over zero rows still answers with one row.
  if (query.group_by.length === 0 && groups.size === 0) groups.set('[]', { key: [], rows: [] })

  const rows = [...groups.values()].map(({ key, rows: members }) => {
    const out: Record<string, IndicatorScalar> = {}
    query.group_by.forEach((field, index) => { out[field] = key[index] ?? null })
    for (const spec of query.aggregates) {
      if (spec.fn === 'count') {
        out[spec.as] = spec.field ? members.filter((row) => (row[spec.field!] ?? null) !== null).length : members.length
        continue
      }
      const values = members
        .map((row) => row[spec.field!])
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
      if (values.length === 0) {
        out[spec.as] = null
        continue
      }
      if (spec.fn === 'sum') out[spec.as] = tidy(values.reduce((sum, value) => sum + value, 0))
      else if (spec.fn === 'mean') out[spec.as] = tidy(values.reduce((sum, value) => sum + value, 0) / values.length)
      else if (spec.fn === 'min') out[spec.as] = Math.min(...values)
      else out[spec.as] = Math.max(...values)
    }
    return out
  })

  const order = [
    ...query.order_by,
    ...query.group_by
      .filter((field) => !query.order_by.some((entry) => entry.field === field))
      .map((field) => ({ field, direction: 'asc' as const })),
  ]
  rows.sort((left, right) => {
    for (const item of order) {
      const a = left[item.field] ?? null
      const b = right[item.field] ?? null
      if (a === null && b !== null) return 1
      if (a !== null && b === null) return -1
      const comparison = compareScalar(a, b)
      if (comparison !== 0) return item.direction === 'asc' ? comparison : -comparison
    }
    return 0
  })

  const byId = new Map(table.fields.map((field) => [field.id, field]))
  const fields = [
    ...query.group_by.map((id) => byId.get(id)!),
    ...query.aggregates.map((spec) => aggregateField(spec, spec.field ? byId.get(spec.field) : undefined)),
  ]
  const page = rows.slice(0, query.limit)
  return { rows: page, total: rows.length, truncated: rows.length > page.length, fields }
}
