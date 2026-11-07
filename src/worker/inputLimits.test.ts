import { describe, expect, mock, test } from 'bun:test'

mock.module('cloudflare:workers', () => ({
  DurableObject: class {},
}))

const {
  JsonBodyTooLargeError,
  MAX_JSON_BODY_BYTES,
  readJsonBodyLimited,
} = await import('./requestBody')
const { MAX_MCP_BATCH_ITEMS, mcpBatchLengthRejection, mcpToolBatchRejection } =
  await import('./mcp')

function post(body: BodyInit, headers?: HeadersInit): Request {
  return new Request('https://developing-country.org/mcp', {
    method: 'POST',
    headers,
    body,
  })
}

describe('bounded JSON request bodies', () => {
  test('rejects an oversized declared Content-Length before reading the body', async () => {
    let bodyAccessed = false
    const request = new Proxy(
      post('{}', { 'Content-Length': String(MAX_JSON_BODY_BYTES + 1) }),
      {
        get(target, property) {
          if (property === 'headers') return target.headers
          if (property === 'body') {
            bodyAccessed = true
            return target.body
          }
          return undefined
        },
      },
    )

    await expect(readJsonBodyLimited(request)).rejects.toBeInstanceOf(JsonBodyTooLargeError)
    expect(bodyAccessed).toBe(false)
  })

  test('rejects an oversized unknown-length stream', async () => {
    const chunk = new Uint8Array(64 * 1024)
    let emitted = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(chunk)
        emitted += chunk.byteLength
        if (emitted > MAX_JSON_BODY_BYTES) controller.close()
      },
    })

    await expect(readJsonBodyLimited(post(stream))).rejects.toBeInstanceOf(JsonBodyTooLargeError)
  })

  test('parses a valid unknown-length JSON body at the limit seam', async () => {
    const value = { method: 'ping', padding: 'x'.repeat(1024) }
    await expect(readJsonBodyLimited(post(JSON.stringify(value)))).resolves.toEqual(value)
  })

  test('fails closed on a malformed Content-Length', async () => {
    const request = post('{}', { 'Content-Length': 'unknown' })
    await expect(readJsonBodyLimited(request)).rejects.toBeInstanceOf(JsonBodyTooLargeError)
  })
})

describe('MCP batch limits', () => {
  test('keeps the batch cardinality deliberately small', () => {
    expect(MAX_MCP_BATCH_ITEMS).toBe(16)
    expect(mcpBatchLengthRejection(MAX_MCP_BATCH_ITEMS)).toBeNull()
    expect(mcpBatchLengthRejection(MAX_MCP_BATCH_ITEMS + 1)).toContain('exceeds 16')
  })

  test('rejects expensive and write tools in a batch', () => {
    for (const name of [
      'analyze_location',
      'search_places',
      'add_prospect',
      'update_prospect',
      'report_issue',
      'contribute',
      'query_spatial',
    ]) {
      expect(
        mcpToolBatchRejection({ jsonrpc: '2.0', method: 'tools/call', params: { name } }),
      ).toContain(name)
    }
  })

  test('allows only explicitly bounded reads and ping in a batch', () => {
    for (const name of ['list_prospects', 'list_issues', 'get_layer_catalog']) {
      expect(
        mcpToolBatchRejection({ jsonrpc: '2.0', method: 'tools/call', params: { name } }),
      ).toBeNull()
    }
    expect(
      mcpToolBatchRejection({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { name: 'future_tool' },
      }),
    ).toContain('unknown tool')
    expect(mcpToolBatchRejection({ jsonrpc: '2.0', method: 'ping' })).toBeNull()
    expect(mcpToolBatchRejection({ jsonrpc: '2.0', method: 'initialize' })).toContain('initialize')
    expect(mcpToolBatchRejection({ jsonrpc: '2.0', method: 'resources/read' })).toContain('resources/read')
  })
})
