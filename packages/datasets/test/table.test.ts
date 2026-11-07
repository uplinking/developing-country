import { describe, expect, test } from 'bun:test'
import {
  DATASET_QUERY_LIMITS,
  DatasetContractError,
  parseIndicatorTable,
  selectRows,
  type IndicatorTableV1,
} from '../src'

function rawTable(): unknown {
  return {
    schema_version: 1,
    dataset_id: 'labour-force',
    country: 'LK',
    source_ids: ['dcs-labour-force'],
    vintage: '2025',
    title: 'Labour force indicators',
    description: 'Source-reported annual labour force indicators.',
    grain: 'One row per year and sex.',
    notes: ['Annual estimates.'],
    caveats: ['Values are not seasonally adjusted.'],
    primary_key: ['year', 'sex'],
    fields: [
      { id: 'year', role: 'dimension', type: 'year', label: 'Year' },
      { id: 'sex', role: 'dimension', type: 'string', label: 'Sex' },
      {
        id: 'unemployment_rate',
        role: 'measure',
        type: 'number',
        label: 'Unemployment rate',
        unit: 'percent',
        aggregation: 'none',
      },
      {
        id: 'unemployed_people',
        role: 'measure',
        type: 'integer',
        label: 'Unemployed people',
        unit: 'people',
        aggregation: 'sum',
      },
    ],
    rows: [
      { year: 2025, sex: 'Total', unemployment_rate: 4.4, unemployed_people: 379001 },
      { year: 2024, sex: 'Women', unemployment_rate: 6.8, unemployed_people: 201000 },
      { year: 2024, sex: 'Total', unemployment_rate: 4.7, unemployed_people: 401000 },
      { year: 2025, sex: 'Women', unemployment_rate: null, unemployed_people: null },
    ],
  }
}

function contractError(run: () => unknown): DatasetContractError {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(DatasetContractError)
    return error as DatasetContractError
  }
  throw new Error('expected a DatasetContractError')
}

describe('IndicatorTableV1', () => {
  test('accepts the canonical artifact and preserves descriptive metadata', () => {
    const table = parseIndicatorTable(rawTable())
    expect(table.schema_version).toBe(1)
    expect(table.dataset_id).toBe('labour-force')
    expect(table.title).toBe('Labour force indicators')
    expect(table.grain).toBe('One row per year and sex.')
    expect(table.rows[3]?.unemployment_rate).toBeNull()
  })

  test('rejects unknown fields, implicit missing values, invalid measures, and duplicate primary keys', () => {
    const invalid = rawTable() as Record<string, unknown>
    invalid.renderer = 'echarts'
    const fields = invalid.fields as Array<Record<string, unknown>>
    fields[2] = { ...fields[2], type: 'string', aggregation: 'average' }
    const rows = invalid.rows as Array<Record<string, unknown>>
    delete rows[0]?.unemployment_rate
    rows.push({ ...rows[1] })

    const error = contractError(() => parseIndicatorTable(invalid))
    expect(error.code).toBe('invalid_table')
    expect(error.issues).toContain('table contains unknown field: renderer')
    expect(error.issues).toContain('table.fields[2] measures must be number or integer fields')
    expect(error.issues).toContain('table.fields[2].aggregation must be none or sum for a measure')
    expect(error.issues).toContain(
      'table.rows[0].unemployment_rate is missing; use explicit null for missing observations',
    )
    expect(error.issues).toContain('table.rows[4] duplicates the primary key from table.rows[1]')
  })

  test('uses collision-safe canonical composite primary keys', () => {
    const table = {
      schema_version: 1,
      dataset_id: 'canonical-keys',
      country: 'LK',
      source_ids: ['test-source'],
      vintage: '2026',
      primary_key: ['left_key', 'right_key'],
      fields: [
        { id: 'left_key', role: 'dimension', type: 'string', label: 'Left' },
        { id: 'right_key', role: 'dimension', type: 'string', label: 'Right' },
        { id: 'value', role: 'measure', type: 'number', label: 'Value', aggregation: 'none' },
      ],
      rows: [
        { left_key: 'foo|string:bar', right_key: 'baz', value: 1 },
        { left_key: 'foo', right_key: 'bar|string:baz', value: 2 },
      ],
    }
    expect(parseIndicatorTable(table).rows).toHaveLength(2)
  })

  test('validates normalized periods and calendar dates', () => {
    const table = rawTable() as Record<string, unknown>
    table.primary_key = ['period', 'sex']
    const fields = table.fields as Array<Record<string, unknown>>
    fields[0] = { id: 'period', role: 'dimension', type: 'period', label: 'Period' }
    const rows = table.rows as Array<Record<string, unknown>>
    rows[0] = { ...rows[0], period: '2025-Q1' }
    rows[1] = { ...rows[1], period: '2024-02' }
    rows[2] = { ...rows[2], period: '2024-02-29' }
    rows[3] = { ...rows[3], period: '2025-02-29' }
    rows.forEach((row) => delete row.year)

    const error = contractError(() => parseIndicatorTable(table))
    expect(error.issues).toContain('table.rows[3].period must be YYYY-MM, YYYY-Qn, YYYY-MM-DD, or null')
  })
})

describe('selectRows', () => {
  const table = parseIndicatorTable(rawTable())

  test('filters, projects, and defaults to deterministic primary-key order', () => {
    expect(
      selectRows(table, {
        fields: ['year', 'unemployment_rate'],
        where: [{ field: 'sex', op: 'eq', value: 'Total' }],
      }),
    ).toEqual({
      rows: [
        { year: 2024, unemployment_rate: 4.7 },
        { year: 2025, unemployment_rate: 4.4 },
      ],
      total: 2,
      truncated: false,
    })
  })

  test('supports bounded in/range filters and appends primary keys as sort tie-breakers', () => {
    expect(
      selectRows(table, {
        fields: ['year', 'sex', 'unemployed_people'],
        where: [
          { field: 'sex', op: 'in', value: ['Total', 'Women'] },
          { field: 'year', op: 'gte', value: 2024 },
          { field: 'year', op: 'lte', value: 2025 },
        ],
        order_by: [{ field: 'unemployed_people', direction: 'desc' }],
        limit: 3,
      }),
    ).toEqual({
      rows: [
        { year: 2024, sex: 'Total', unemployed_people: 401000 },
        { year: 2025, sex: 'Total', unemployed_people: 379001 },
        { year: 2024, sex: 'Women', unemployed_people: 201000 },
      ],
      total: 4,
      truncated: true,
    })
  })

  test('rejects unregistered fields, unsafe operators, and every query bound', () => {
    const cases: unknown[] = [
      { fields: ['not_a_field'] },
      { fields: ['year'], expression: 'process.exit()' },
      { fields: ['year'], where: [{ field: 'sex', op: 'gte', value: 'A' }] },
      { fields: ['year'], where: [{ field: 'year', op: 'gte', value: null }] },
      {
        fields: ['year'],
        where: Array.from({ length: DATASET_QUERY_LIMITS.maxPredicates + 1 }, () => ({
          field: 'year',
          op: 'eq',
          value: 2025,
        })),
      },
      {
        fields: ['year'],
        where: [{
          field: 'year',
          op: 'in',
          value: Array.from({ length: DATASET_QUERY_LIMITS.maxInValues + 1 }, (_, index) => 1900 + index),
        }],
      },
      { fields: ['year'], limit: DATASET_QUERY_LIMITS.maxRows + 1 },
    ]
    for (const input of cases) expect(contractError(() => selectRows(table, input)).code).toBe('invalid_query')
  })

  test('a trusted caller may raise the row ceiling without loosening validation', () => {
    const limit = DATASET_QUERY_LIMITS.maxRows + 1
    expect(contractError(() => selectRows(table, { fields: ['year'], limit })).code).toBe('invalid_query')
    expect(selectRows(table, { fields: ['year'], limit }, { maxRows: limit }).truncated).toBe(false)
    expect(contractError(() => selectRows(table, { fields: ['year'], limit: limit + 1 }, { maxRows: limit })).issues)
      .toEqual([`query.limit must be an integer from 1 to ${limit}`])
    expect(() => selectRows(table, { fields: ['year'] }, { maxRows: 0 })).toThrow(RangeError)
  })

  test('returns explicit nulls in projections', () => {
    const result = selectRows(table, {
      fields: ['year', 'sex', 'unemployment_rate'],
      where: [
        { field: 'year', op: 'eq', value: 2025 },
        { field: 'sex', op: 'eq', value: 'Women' },
      ],
    })
    expect(result.rows).toEqual([{ year: 2025, sex: 'Women', unemployment_rate: null }])
  })
})

test('the typed shape is reusable without widening row values', () => {
  const table: IndicatorTableV1 = parseIndicatorTable(rawTable())
  expect(table.rows[0]?.year).toBe(2025)
})
