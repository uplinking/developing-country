// MCP-facing projection of the query_data contract.
//
// fixtures/query-spatial.schema.json is the strict per-operator contract: a
// top-level `oneOf` with one closed branch per op. Tool-use hosts (Claude
// included) do not accept `oneOf`/`anyOf`/`allOf` at the top level of a tool
// input schema; they degrade it to a bare `{type:"object"}`, the model loses
// every parameter type, and arrays such as `fields` arrive as JSON strings.
// So the advertised schema is one flat object: `op` is an enum, every other
// property is the union across branches with the ops that accept it named in
// its description. The server still validates each op strictly.

import type { JsonObject, JsonValue } from '../shared/json'
import { isJsonObject, isJsonString } from '../shared/json'

interface OneOfSchema {
  // `| undefined`: TypeScript widens a JSON import's branch union with absent keys.
  oneOf: Array<{ required?: string[]; properties: Record<string, JsonValue | undefined> }>
  $defs?: JsonObject
}

// Branches that share a key: identical shapes pass through; enums union (gap and
// overlay both take `method`); anything else keeps the first shape minus its
// `default`, since a default that holds for one op is a lie for another.
function mergeProperty(left: JsonValue, right: JsonValue): JsonValue {
  if (JSON.stringify(left) === JSON.stringify(right)) return left
  if (!isJsonObject(left) || !isJsonObject(right)) return left
  if (Array.isArray(left.enum) && Array.isArray(right.enum)) {
    const values = [...left.enum]
    for (const value of right.enum) if (!values.includes(value)) values.push(value)
    return { ...left, enum: values }
  }
  const { default: _default, ...rest } = left
  return rest
}

function scalarType(value: JsonValue): string {
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number'
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value === 'object' ? 'object' : typeof value
}

// Directory scans (and some hosts) read a property's own `type` and flag one
// that only has `$ref`, `enum`, `const` or `oneOf`. Infer it from those, so the
// advertised property says what it is without changing what validates.
function inferTypes(value: JsonValue, defs: JsonObject | undefined, seen: Set<string> = new Set()): string[] {
  if (!isJsonObject(value)) return []
  if (isJsonString(value.type)) return [value.type]
  if (Array.isArray(value.type)) return value.type.filter(isJsonString)
  if (Array.isArray(value.enum)) return [...new Set(value.enum.map(scalarType))]
  if ('const' in value && value.const !== undefined) return [scalarType(value.const)]
  if (isJsonString(value.$ref) && value.$ref.startsWith('#/$defs/')) {
    const name = value.$ref.slice('#/$defs/'.length)
    if (seen.has(name) || !defs) return []
    return inferTypes(defs[name] ?? null, defs, new Set([...seen, name]))
  }
  const branches = Array.isArray(value.oneOf) ? value.oneOf : Array.isArray(value.anyOf) ? value.anyOf : null
  if (!branches) return []
  const types = branches.map((branch) => inferTypes(branch, defs, seen))
  if (types.some((t) => t.length === 0)) return []
  return [...new Set(types.flat())]
}

export function flattenOperatorSchema(schema: OneOfSchema, opDescriptions: Record<string, string>): JsonObject {
  const ops: string[] = []
  const usedBy = new Map<string, string[]>()
  const requiredBy = new Map<string, string[]>()
  const properties: Record<string, JsonValue> = {}

  for (const branch of schema.oneOf) {
    const opSchema = branch.properties.op
    const op = isJsonObject(opSchema) && isJsonString(opSchema.const) ? opSchema.const : null
    if (!op) throw new Error('every query_data branch must pin op with const')
    ops.push(op)
    for (const [key, value] of Object.entries(branch.properties)) {
      if (key === 'op' || value === undefined) continue
      usedBy.set(key, [...(usedBy.get(key) ?? []), op])
      properties[key] = key in properties ? mergeProperty(properties[key], value) : value
    }
    for (const key of branch.required ?? []) {
      if (key !== 'op') requiredBy.set(key, [...(requiredBy.get(key) ?? []), op])
    }
  }

  for (const [key, value] of Object.entries(properties)) {
    const used = usedBy.get(key) ?? []
    const required = requiredBy.get(key) ?? []
    const scope = used.length === ops.length ? 'All ops.' : `Ops: ${used.join(', ')}.`
    const need = required.length ? ` Required for ${required.join(', ')}.` : ''
    const own = isJsonObject(value) && isJsonString(value.description) ? ` ${value.description}` : ''
    const described: JsonObject = isJsonObject(value) ? { ...value } : {}
    if (!('type' in described)) {
      const types = inferTypes(value, schema.$defs)
      if (types.length) described.type = types.length === 1 ? types[0] : types
    }
    described.description = `${scope}${need}${own}`
    properties[key] = described
  }

  const flat: JsonObject = {
    type: 'object',
    properties: {
      op: {
        type: 'string',
        enum: ops,
        description: ops.map((op) => `${op}: ${opDescriptions[op] ?? ''}`.trim()).join(' | '),
      },
      ...properties,
    },
    required: ['op'],
  }
  if (schema.$defs) flat.$defs = schema.$defs
  return flat
}

// Structured arguments a degraded host may still send as JSON text. Parsing is
// lenient only in shape (string → array/object); the parsed value then meets
// the same strict validation as a native one.
const STRUCTURED_KEYS = ['fields', 'where', 'order_by', 'group_by', 'aggregates', 'origin', 'within', 'bbox', 'inside', 'presentation'] as const

export function coerceStructuredArgs(args: JsonObject): JsonObject {
  let out: JsonObject | null = null
  for (const key of STRUCTURED_KEYS) {
    const value = args[key]
    if (!isJsonString(value)) continue
    const text = value.trim()
    let parsed: JsonValue | undefined
    if (text.startsWith('[') || text.startsWith('{')) {
      try {
        const decoded: JsonValue = JSON.parse(text)
        parsed = decoded
      } catch {
        parsed = undefined
      }
    } else if ((key === 'fields' || key === 'group_by') && text) {
      // "year, value" — the comma list a model writes when it has no type hint.
      parsed = text.split(',').map((part) => part.trim()).filter(Boolean)
    }
    if (parsed === undefined) continue
    out ??= { ...args }
    out[key] = parsed
  }
  return out ?? args
}
