import { describe, expect, test } from 'bun:test'
import queryDataSchema from './fixtures/query-spatial.schema.json' with { type: 'json' }
import { coerceStructuredArgs, flattenOperatorSchema } from './mcpSchema'
import type { JsonObject } from '../shared/json'

const flat = flattenOperatorSchema(queryDataSchema, {})
const props = flat.properties as Record<string, JsonObject>

describe('query_data advertised schema', () => {
  test('has no top-level combinator, so tool-use hosts keep parameter types', () => {
    expect(flat.type).toBe('object')
    expect(flat.oneOf).toBeUndefined()
    expect(flat.anyOf).toBeUndefined()
    expect(flat.allOf).toBeUndefined()
    expect(flat.required).toEqual(['op'])
  })

  test('enumerates every operator from the strict contract', () => {
    const ops = queryDataSchema.oneOf.map((branch) => branch.properties.op.const)
    expect(props.op.enum).toEqual(ops)
  })

  test('keeps fields typed as an array and names which op needs it', () => {
    expect(props.fields.type).toBe('array')
    // select needs fields unless it aggregates with group_by/aggregates instead.
    expect(String(props.fields.description)).toContain('Ops: select')
    expect(String(props.fields.description)).toContain('Required unless aggregates is given')
  })

  test('unions enums for a key that branches type differently', () => {
    expect(props.method.enum).toEqual(['centroid_in_polygon', 'point_in_polygon', 'centroid_distance', 'street_intersect'])
  })

  test('gives every parameter its own type, inferred through $ref, enum and const', () => {
    for (const [key, value] of Object.entries(props)) expect([key, value.type !== undefined]).toEqual([key, true])
    expect(props.country.type).toBe('string')
    expect(props.presentation.type).toBe('object')
    expect(props.presentation.$ref).toBe('#/$defs/presentation')
    expect(props.within.type).toBe('object')
    expect(props.mode.type).toBe('string')
    expect(props.minutes.type).toBe('integer')
  })

  test('drops a default that only one op owns', () => {
    expect(props.limit.default).toBeUndefined()
  })
})

describe('coerceStructuredArgs', () => {
  test('parses JSON-text arrays and objects from a degraded host', () => {
    const out = coerceStructuredArgs({
      op: 'select',
      fields: '["year","value"]',
      where: '[{"field":"year","op":"gte","value":2017}]',
      origin: '{"lat":6.93,"lng":79.84}',
    })
    expect(out.fields).toEqual(['year', 'value'])
    expect(out.where).toEqual([{ field: 'year', op: 'gte', value: 2017 }])
    expect(out.origin).toEqual({ lat: 6.93, lng: 79.84 })
  })

  test('splits a comma list of fields', () => {
    expect(coerceStructuredArgs({ fields: 'year, value' }).fields).toEqual(['year', 'value'])
  })

  test('parses group_by and aggregates sent as text by a host with a stale schema', () => {
    const out = coerceStructuredArgs({
      group_by: '["dsd"]',
      aggregates: '[{"fn":"sum","field":"pop_2024","as":"residents"}]',
    })
    expect(out.group_by).toEqual(['dsd'])
    expect(out.aggregates).toEqual([{ fn: 'sum', field: 'pop_2024', as: 'residents' }])
    expect(coerceStructuredArgs({ group_by: 'dsd, district' }).group_by).toEqual(['dsd', 'district'])
  })

  test('leaves native values and unparseable text for strict validation', () => {
    const native = { op: 'select', fields: ['year'] }
    expect(coerceStructuredArgs(native)).toBe(native)
    expect(coerceStructuredArgs({ where: '[not json' }).where).toBe('[not json')
    expect(coerceStructuredArgs({ dataset_id: '["x"]' }).dataset_id).toBe('["x"]')
  })
})
