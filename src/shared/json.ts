export type JsonPrimitive = string | number | boolean | null
export type JsonAsset = JsonPrimitive | object
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[]
export type JsonObject = { [key: string]: JsonValue | undefined }

const tag = Object.prototype.toString

export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return value !== undefined && tag.call(value) === '[object Object]'
}

export function isJsonString(value: JsonValue | undefined): value is string {
  return tag.call(value) === '[object String]'
}

export function isJsonNumber(value: JsonValue | undefined): value is number {
  return tag.call(value) === '[object Number]' && Number.isFinite(value)
}

export function jsonObjectFromSerializable<T extends object>(value: T): JsonObject | null {
  try {
    const parsed: JsonValue = JSON.parse(JSON.stringify(value))
    return isJsonObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function parseJsonObject(text: string): JsonObject | null {
  try {
    const parsed: JsonValue = JSON.parse(text)
    return isJsonObject(parsed) ? parsed : null
  } catch {
    return null
  }
}
