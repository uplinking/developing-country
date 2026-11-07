export type IndicatorScalar = string | number | boolean | null
export type IndicatorFieldRole = 'dimension' | 'measure'
export type IndicatorFieldType = 'string' | 'number' | 'integer' | 'year' | 'period' | 'boolean'
export type IndicatorAggregation = 'none' | 'sum'

export interface IndicatorField {
  id: string
  role: IndicatorFieldRole
  type: IndicatorFieldType
  label: string
  unit?: string
  aggregation?: IndicatorAggregation
}

export type IndicatorRow = Record<string, IndicatorScalar>

export interface IndicatorTableV1 {
  schema_version: 1
  dataset_id: string
  country: string
  source_ids: string[]
  vintage: string
  title?: string
  description?: string
  grain?: string
  notes?: string[]
  caveats?: string[]
  primary_key: string[]
  fields: IndicatorField[]
  rows: IndicatorRow[]
}

export type SelectFilter =
  | { field: string; op: 'eq' | 'gte' | 'lte'; value: IndicatorScalar }
  | { field: string; op: 'in'; value: IndicatorScalar[] }

export interface SelectOrder {
  field: string
  direction: 'asc' | 'desc'
}

export interface SelectRowsInput {
  fields: string[]
  where?: SelectFilter[]
  order_by?: SelectOrder[]
  limit?: number
}

/**
 * Caller-owned bounds. `maxRows` lets a trusted adapter (the Worker saving a
 * Data View snapshot) raise the default row ceiling; it never lowers validation.
 */
export interface SelectRowsOptions {
  maxRows?: number
}

export interface SelectRowsResult {
  rows: IndicatorRow[]
  total: number
  truncated: boolean
}

export const DATASET_QUERY_LIMITS = Object.freeze({
  defaultRows: 50,
  maxRows: 200,
  maxPredicates: 8,
  maxInValues: 500,
  maxOrderFields: 8,
})

type DatasetContractErrorCode = 'invalid_table' | 'invalid_query'

export class DatasetContractError extends Error {
  readonly code: DatasetContractErrorCode
  readonly issues: readonly string[]

  constructor(code: DatasetContractErrorCode, issues: string[]) {
    super(`${code}: ${issues.join('; ')}`)
    this.name = 'DatasetContractError'
    this.code = code
    this.issues = issues
  }
}

const ROOT_KEYS = new Set([
  'schema_version',
  'dataset_id',
  'country',
  'source_ids',
  'vintage',
  'title',
  'description',
  'grain',
  'notes',
  'caveats',
  'primary_key',
  'fields',
  'rows',
])
const REQUIRED_ROOT_KEYS = [
  'schema_version',
  'dataset_id',
  'country',
  'source_ids',
  'vintage',
  'primary_key',
  'fields',
  'rows',
] as const
const FIELD_KEYS = new Set(['id', 'role', 'type', 'label', 'unit', 'aggregation'])
const QUERY_KEYS = new Set(['fields', 'where', 'order_by', 'limit'])
const FILTER_KEYS = new Set(['field', 'op', 'value'])
const ORDER_KEYS = new Set(['field', 'direction'])
const FIELD_ROLES = new Set<IndicatorFieldRole>(['dimension', 'measure'])
const FIELD_TYPES = new Set<IndicatorFieldType>([
  'string',
  'number',
  'integer',
  'year',
  'period',
  'boolean',
])
const AGGREGATIONS = new Set<IndicatorAggregation>(['none', 'sum'])
const DATASET_ID = /^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$/
const FIELD_ID = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/
const COUNTRY = /^[A-Z]{2}$/
const PERIOD = /^(?:\d{4}-(?:0[1-9]|1[0-2])|\d{4}-Q[1-4]|\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01]))$/
const MAX_ISSUES = 100
const MAX_TEXT = 2_000
const MAX_CELL_TEXT = 4_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function addIssue(issues: string[], issue: string): void {
  if (issues.length < MAX_ISSUES) issues.push(issue)
}

function unknownKeys(value: Record<string, unknown>, allowed: Set<string>, path: string, issues: string[]): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) addIssue(issues, `${path} contains unknown field: ${key}`)
  }
}

function requiredKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  path: string,
  issues: string[],
): void {
  for (const key of required) {
    if (!Object.hasOwn(value, key)) addIssue(issues, `${path}.${key} is required`)
  }
}

function boundedString(value: unknown, path: string, issues: string[], max = MAX_TEXT): value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    addIssue(issues, `${path} must be a non-empty string`)
    return false
  }
  if (value.length > max) {
    addIssue(issues, `${path} must be at most ${max} characters`)
    return false
  }
  return true
}

function optionalText(value: Record<string, unknown>, key: string, issues: string[]): void {
  if (Object.hasOwn(value, key) && value[key] !== undefined) boundedString(value[key], `table.${key}`, issues)
}

function optionalTextList(value: Record<string, unknown>, key: string, issues: string[]): void {
  if (!Object.hasOwn(value, key) || value[key] === undefined) return
  const list = value[key]
  if (!Array.isArray(list) || list.length > 50) {
    addIssue(issues, `table.${key} must be an array of at most 50 strings`)
    return
  }
  list.forEach((entry, index) => boundedString(entry, `table.${key}[${index}]`, issues))
}

function validDate(value: string): boolean {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value
}

function valueMatchesType(value: unknown, field: IndicatorField): boolean {
  if (value === null) return true
  if (field.type === 'string') return typeof value === 'string' && value.length <= MAX_CELL_TEXT
  if (field.type === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (field.type === 'integer') return typeof value === 'number' && Number.isSafeInteger(value)
  if (field.type === 'year') return typeof value === 'number' && Number.isInteger(value) && value >= 1000 && value <= 9999
  if (field.type === 'period') {
    return typeof value === 'string' && PERIOD.test(value) && (!value.includes('-') || value.length !== 10 || validDate(value))
  }
  return typeof value === 'boolean'
}

function valueTypeDescription(field: IndicatorField): string {
  if (field.type === 'year') return 'a four-digit integer year or null'
  if (field.type === 'period') return 'YYYY-MM, YYYY-Qn, YYYY-MM-DD, or null'
  if (field.type === 'integer') return 'a safe integer or null'
  if (field.type === 'number') return 'a finite number or null'
  return `${field.type} or null`
}

function canonicalScalar(value: IndicatorScalar): string {
  if (value === null) return 'null:'
  if (typeof value === 'number') return `number:${Object.is(value, -0) ? 0 : value}`
  return `${typeof value}:${String(value)}`
}

function canonicalPrimaryKey(row: Record<string, unknown>, primaryKey: string[]): string {
  return JSON.stringify(primaryKey.map((field) => canonicalScalar(row[field] as IndicatorScalar)))
}

function parseFields(raw: unknown, issues: string[]): IndicatorField[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    addIssue(issues, 'table.fields must be a non-empty array')
    return []
  }
  const fields: IndicatorField[] = []
  const seen = new Set<string>()
  raw.forEach((entry, index) => {
    const path = `table.fields[${index}]`
    if (!isRecord(entry)) {
      addIssue(issues, `${path} must be an object`)
      return
    }
    unknownKeys(entry, FIELD_KEYS, path, issues)
    requiredKeys(entry, ['id', 'role', 'type', 'label'], path, issues)
    const id = entry.id
    const role = entry.role
    const type = entry.type
    const label = entry.label
    if (typeof id !== 'string' || !FIELD_ID.test(id)) addIssue(issues, `${path}.id must be snake_case`)
    if (typeof id === 'string' && seen.has(id)) addIssue(issues, `${path}.id is duplicated: ${id}`)
    if (typeof id === 'string') seen.add(id)
    if (typeof role !== 'string' || !FIELD_ROLES.has(role as IndicatorFieldRole)) {
      addIssue(issues, `${path}.role must be dimension or measure`)
    }
    if (typeof type !== 'string' || !FIELD_TYPES.has(type as IndicatorFieldType)) {
      addIssue(issues, `${path}.type is unsupported`)
    }
    boundedString(label, `${path}.label`, issues, 160)
    if (entry.unit !== undefined) boundedString(entry.unit, `${path}.unit`, issues, 80)
    if (role === 'measure') {
      if (type !== 'number' && type !== 'integer') addIssue(issues, `${path} measures must be number or integer fields`)
      if (typeof entry.aggregation !== 'string' || !AGGREGATIONS.has(entry.aggregation as IndicatorAggregation)) {
        addIssue(issues, `${path}.aggregation must be none or sum for a measure`)
      }
    } else if (entry.aggregation !== undefined) {
      addIssue(issues, `${path}.aggregation is only valid for measures`)
    }
    if (
      typeof id === 'string' && FIELD_ID.test(id) &&
      typeof role === 'string' && FIELD_ROLES.has(role as IndicatorFieldRole) &&
      typeof type === 'string' && FIELD_TYPES.has(type as IndicatorFieldType) &&
      typeof label === 'string'
    ) {
      fields.push({
        id,
        role: role as IndicatorFieldRole,
        type: type as IndicatorFieldType,
        label,
        ...(typeof entry.unit === 'string' ? { unit: entry.unit } : {}),
        ...(typeof entry.aggregation === 'string'
          ? { aggregation: entry.aggregation as IndicatorAggregation }
          : {}),
      })
    }
  })
  if (!fields.some((field) => field.role === 'measure')) addIssue(issues, 'table.fields must declare at least one measure')
  return fields
}

function parseStringIds(
  raw: unknown,
  path: string,
  pattern: RegExp,
  issues: string[],
): string[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    addIssue(issues, `${path} must be a non-empty array`)
    return []
  }
  const values: string[] = []
  const seen = new Set<string>()
  raw.forEach((entry, index) => {
    if (typeof entry !== 'string' || !pattern.test(entry)) {
      addIssue(issues, `${path}[${index}] has an invalid identifier`)
      return
    }
    if (seen.has(entry)) addIssue(issues, `${path}[${index}] is duplicated: ${entry}`)
    seen.add(entry)
    values.push(entry)
  })
  return values
}

function validateRows(
  raw: unknown,
  fields: IndicatorField[],
  primaryKey: string[],
  issues: string[],
): void {
  if (!Array.isArray(raw)) {
    addIssue(issues, 'table.rows must be an array')
    return
  }
  const fieldById = new Map(fields.map((field) => [field.id, field]))
  const fieldIds = new Set(fieldById.keys())
  const primaryKeys = new Map<string, number>()
  raw.forEach((entry, index) => {
    const path = `table.rows[${index}]`
    if (!isRecord(entry)) {
      addIssue(issues, `${path} must be an object`)
      return
    }
    for (const key of Object.keys(entry)) {
      if (!fieldIds.has(key)) addIssue(issues, `${path} contains unregistered field: ${key}`)
    }
    for (const field of fields) {
      if (!Object.hasOwn(entry, field.id)) {
        addIssue(issues, `${path}.${field.id} is missing; use explicit null for missing observations`)
        continue
      }
      const value = entry[field.id]
      if (!valueMatchesType(value, field)) {
        addIssue(issues, `${path}.${field.id} must be ${valueTypeDescription(field)}`)
        continue
      }
    }
    for (const key of primaryKey) {
      if (entry[key] === null || entry[key] === undefined) addIssue(issues, `${path}.${key} cannot be null in the primary key`)
    }
    const validPrimaryKey = primaryKey.every((key) => {
      const field = fieldById.get(key)
      return field !== undefined && entry[key] !== null && valueMatchesType(entry[key], field)
    })
    if (validPrimaryKey) {
      const canonical = canonicalPrimaryKey(entry, primaryKey)
      const duplicate = primaryKeys.get(canonical)
      if (duplicate !== undefined) addIssue(issues, `${path} duplicates the primary key from table.rows[${duplicate}]`)
      else primaryKeys.set(canonical, index)
    }
  })
}

export function parseIndicatorTable(value: unknown): IndicatorTableV1 {
  const issues: string[] = []
  if (!isRecord(value)) throw new DatasetContractError('invalid_table', ['table must be an object'])
  unknownKeys(value, ROOT_KEYS, 'table', issues)
  requiredKeys(value, REQUIRED_ROOT_KEYS, 'table', issues)

  if (value.schema_version !== 1) addIssue(issues, 'table.schema_version must be 1')
  if (typeof value.dataset_id !== 'string' || !DATASET_ID.test(value.dataset_id)) {
    addIssue(issues, 'table.dataset_id has an invalid identifier')
  }
  if (typeof value.country !== 'string' || !COUNTRY.test(value.country)) {
    addIssue(issues, 'table.country must be an uppercase ISO 3166-1 alpha-2 code')
  }
  boundedString(value.vintage, 'table.vintage', issues, 160)
  optionalText(value, 'title', issues)
  optionalText(value, 'description', issues)
  optionalText(value, 'grain', issues)
  optionalTextList(value, 'notes', issues)
  optionalTextList(value, 'caveats', issues)

  parseStringIds(value.source_ids, 'table.source_ids', DATASET_ID, issues)
  const fields = parseFields(value.fields, issues)
  const primaryKey = parseStringIds(value.primary_key, 'table.primary_key', FIELD_ID, issues)
  const fieldsById = new Map(fields.map((field) => [field.id, field]))
  for (const key of primaryKey) {
    const field = fieldsById.get(key)
    if (!field) addIssue(issues, `table.primary_key references an unregistered field: ${key}`)
    else if (field.role !== 'dimension') addIssue(issues, `table.primary_key field must be a dimension: ${key}`)
  }
  validateRows(value.rows, fields, primaryKey, issues)

  if (issues.length > 0) throw new DatasetContractError('invalid_table', issues)
  // SAFETY: Every root, metadata, field, row, scalar, and cross-reference invariant is checked above.
  return value as unknown as IndicatorTableV1
}

function queryError(issue: string): never {
  throw new DatasetContractError('invalid_query', [issue])
}

function assertQueryScalar(value: unknown, field: IndicatorField, path: string, allowNull: boolean): IndicatorScalar {
  if (value === null && !allowNull) queryError(`${path} cannot be null for this operator`)
  if (!valueMatchesType(value, field)) queryError(`${path} must be ${valueTypeDescription(field)}`)
  return value as IndicatorScalar
}

function parseQuery(table: IndicatorTableV1, input: unknown, maxRows: number): Required<SelectRowsInput> {
  if (!isRecord(input)) queryError('query must be an object')
  const extra = Object.keys(input).find((key) => !QUERY_KEYS.has(key))
  if (extra) queryError(`query contains unknown field: ${extra}`)
  const fieldsById = new Map(table.fields.map((field) => [field.id, field]))

  if (!Array.isArray(input.fields) || input.fields.length === 0) queryError('query.fields must be a non-empty array')
  const fields: string[] = []
  const selected = new Set<string>()
  for (const [index, entry] of input.fields.entries()) {
    if (typeof entry !== 'string' || !fieldsById.has(entry)) queryError(`query.fields[${index}] is not a registered field`)
    if (selected.has(entry)) queryError(`query.fields contains duplicate field: ${entry}`)
    selected.add(entry)
    fields.push(entry)
  }

  const rawWhere = input.where ?? []
  if (!Array.isArray(rawWhere)) queryError('query.where must be an array')
  if (rawWhere.length > DATASET_QUERY_LIMITS.maxPredicates) {
    queryError(`query.where supports at most ${DATASET_QUERY_LIMITS.maxPredicates} predicates`)
  }
  const where: SelectFilter[] = rawWhere.map((entry, index) => {
    const path = `query.where[${index}]`
    if (!isRecord(entry)) queryError(`${path} must be an object`)
    const extraKey = Object.keys(entry).find((key) => !FILTER_KEYS.has(key))
    if (extraKey) queryError(`${path} contains unknown field: ${extraKey}`)
    if (typeof entry.field !== 'string') queryError(`${path}.field must be a string`)
    const field = fieldsById.get(entry.field)
    if (!field) queryError(`${path}.field is not registered: ${entry.field}`)
    if (entry.op === 'in') {
      if (!Array.isArray(entry.value) || entry.value.length === 0 || entry.value.length > DATASET_QUERY_LIMITS.maxInValues) {
        queryError(`${path}.value must contain 1-${DATASET_QUERY_LIMITS.maxInValues} values for in`)
      }
      return {
        field: entry.field,
        op: 'in',
        value: entry.value.map((candidate, valueIndex) =>
          assertQueryScalar(candidate, field, `${path}.value[${valueIndex}]`, true),
        ),
      }
    }
    if (entry.op !== 'eq' && entry.op !== 'gte' && entry.op !== 'lte') {
      queryError(`${path}.op must be eq, in, gte, or lte`)
    }
    if ((entry.op === 'gte' || entry.op === 'lte') && (field.type === 'boolean' || field.type === 'string')) {
      queryError(`${path}.op ${entry.op} is not supported for ${field.type} fields`)
    }
    return {
      field: entry.field,
      op: entry.op,
      value: assertQueryScalar(entry.value, field, `${path}.value`, entry.op === 'eq'),
    }
  })

  const rawOrder = input.order_by ?? []
  if (!Array.isArray(rawOrder)) queryError('query.order_by must be an array')
  if (rawOrder.length > DATASET_QUERY_LIMITS.maxOrderFields) {
    queryError(`query.order_by supports at most ${DATASET_QUERY_LIMITS.maxOrderFields} fields`)
  }
  const ordered = new Set<string>()
  const order_by: SelectOrder[] = rawOrder.map((entry, index) => {
    const path = `query.order_by[${index}]`
    if (!isRecord(entry)) queryError(`${path} must be an object`)
    const extraKey = Object.keys(entry).find((key) => !ORDER_KEYS.has(key))
    if (extraKey) queryError(`${path} contains unknown field: ${extraKey}`)
    if (typeof entry.field !== 'string' || !fieldsById.has(entry.field)) queryError(`${path}.field is not registered`)
    if (ordered.has(entry.field)) queryError(`query.order_by contains duplicate field: ${entry.field}`)
    ordered.add(entry.field)
    if (entry.direction !== 'asc' && entry.direction !== 'desc') queryError(`${path}.direction must be asc or desc`)
    return { field: entry.field, direction: entry.direction }
  })

  const limit = input.limit ?? DATASET_QUERY_LIMITS.defaultRows
  if (!Number.isInteger(limit) || typeof limit !== 'number' || limit < 1 || limit > maxRows) {
    queryError(`query.limit must be an integer from 1 to ${maxRows}`)
  }
  return { fields, where, order_by, limit }
}

function compareScalar(a: IndicatorScalar, b: IndicatorScalar): number {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  return a < b ? -1 : 1
}

function matches(row: IndicatorRow, filter: SelectFilter): boolean {
  const value = row[filter.field] ?? null
  if (filter.op === 'eq') return canonicalScalar(value) === canonicalScalar(filter.value)
  if (filter.op === 'in') {
    const canonical = canonicalScalar(value)
    return filter.value.some((candidate) => canonicalScalar(candidate) === canonical)
  }
  if (value === null || filter.value === null) return false
  const comparison = compareScalar(value, filter.value)
  return filter.op === 'gte' ? comparison >= 0 : comparison <= 0
}

function deterministicOrder(table: IndicatorTableV1, requested: SelectOrder[]): SelectOrder[] {
  const ordered = new Set(requested.map((entry) => entry.field))
  return [
    ...requested,
    ...table.primary_key.filter((field) => !ordered.has(field)).map((field) => ({ field, direction: 'asc' as const })),
  ]
}

export function selectRows(
  table: IndicatorTableV1,
  input: unknown,
  options: SelectRowsOptions = {},
): SelectRowsResult {
  const maxRows = options.maxRows ?? DATASET_QUERY_LIMITS.maxRows
  if (!Number.isInteger(maxRows) || maxRows < 1) throw new RangeError('selectRows maxRows must be a positive integer')
  const query = parseQuery(table, input, maxRows)
  const order = deterministicOrder(table, query.order_by)
  const matched = table.rows.filter((row) => query.where.every((filter) => matches(row, filter)))
  matched.sort((left, right) => {
    for (const item of order) {
      const leftValue = left[item.field] ?? null
      const rightValue = right[item.field] ?? null
      if (leftValue === null && rightValue !== null) return 1
      if (leftValue !== null && rightValue === null) return -1
      const comparison = compareScalar(leftValue, rightValue)
      if (comparison !== 0) return item.direction === 'asc' ? comparison : -comparison
    }
    return 0
  })
  const rows = matched.slice(0, query.limit).map((row) =>
    Object.fromEntries(query.fields.map((field) => [field, row[field] ?? null])),
  )
  return { rows, total: matched.length, truncated: matched.length > rows.length }
}
