import type { JsonValue } from '../shared/json'

export const MAX_JSON_BODY_BYTES = 256 * 1024

export class JsonBodyTooLargeError extends Error {
  constructor() {
    super(`JSON body exceeds ${MAX_JSON_BODY_BYTES} bytes`)
    this.name = 'JsonBodyTooLargeError'
  }
}

/** Stream and cap JSON before parsing so unknown-length bodies stay bounded. */
export async function readJsonBodyLimited(
  request: Request,
  maxBytes = MAX_JSON_BODY_BYTES,
): Promise<JsonValue> {
  const contentLength = request.headers.get('content-length')
  if (contentLength !== null) {
    const value = contentLength.trim()
    if (!/^\d+$/.test(value) || Number(value) > maxBytes) {
      throw new JsonBodyTooLargeError()
    }
  }

  const reader = request.body?.getReader()
  if (!reader) throw new SyntaxError('empty JSON body')

  const chunks: Uint8Array[] = []
  let totalBytes = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    totalBytes += value.byteLength
    if (totalBytes > maxBytes) {
      await reader.cancel().catch(() => undefined)
      throw new JsonBodyTooLargeError()
    }
    chunks.push(value)
  }

  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)
  const parsed: JsonValue = JSON.parse(text)
  return parsed
}
