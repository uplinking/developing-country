import { describe, expect, mock, test } from 'bun:test'
import type { Env } from './types'
import type { JsonObject } from '../shared/json'
import { MCP_UI_RESOURCE_URI } from '../shared/mcpApp'
import { STATUS_TEXT_MAX, TOOL_PRESENTATION, type ToolAnnotations } from './mcpToolMeta'

mock.module('cloudflare:workers', () => ({ DurableObject: class {} }))

// The tool budget is one tool per intent and at most ten tools (ADR / docs/MCP.md).
const TOOL_BUDGET = 10

const ENV: Partial<Env> = {
  DEV_AUTH: '1',
  BETTER_AUTH_SECRET: 'test-secret-that-is-long-enough-for-better-auth',
  BETTER_AUTH_URL: 'https://explore.developing-country.org',
}

const HINTS = ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'] as const

interface ListedTool {
  name: string
  title?: string
  annotations?: Partial<ToolAnnotations>
  _meta?: JsonObject
}

async function rpc(method: string, params: JsonObject = {}) {
  const { handleMcp } = await import('./mcp')
  const response = await handleMcp(
    new Request('https://explore.developing-country.org/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }),
    // SAFETY: the dev-auth path reads only the string vars above; tools/list touches no binding.
    ENV as Env,
  )
  return { response, body: await response.json() }
}

async function listTools(params: JsonObject = {}): Promise<ListedTool[]> {
  const { body } = await rpc('tools/list', params)
  return body.result.tools
}

describe('tool presentation for hosts', () => {
  test('every advertised tool has a title and all four annotation hints', async () => {
    const tools = await listTools()
    expect(tools.length).toBeLessThanOrEqual(TOOL_BUDGET)
    for (const tool of tools) {
      expect(TOOL_PRESENTATION.has(tool.name)).toBe(true)
      expect(tool.title).toBeString()
      expect(tool.annotations?.title).toBe(tool.title!)
      for (const hint of HINTS) {
        expect([true, false]).toContain(tool.annotations?.[hint])
      }
    }
  })

  test('no tool claims read-only while it can write', () => {
    for (const [name, { annotations }] of TOOL_PRESENTATION) {
      if (annotations.readOnlyHint) {
        expect({ name, destructive: annotations.destructiveHint }).toEqual({ name, destructive: false })
      }
    }
    // Tools whose handlers insert or update rows: never read-only.
    for (const name of ['analyze_location', 'add_prospect', 'update_prospect', 'report_issue', 'contribute', 'query_data']) {
      expect(TOOL_PRESENTATION.get(name)?.annotations.readOnlyHint).toBe(false)
    }
    for (const name of ['search_places', 'list_prospects', 'list_issues', 'get_layer_catalog']) {
      expect(TOOL_PRESENTATION.get(name)?.annotations.readOnlyHint).toBe(true)
    }
  })

  test('status lines fit the host limit', () => {
    for (const { invoking, invoked } of TOOL_PRESENTATION.values()) {
      expect(invoking.length).toBeGreaterThan(0)
      expect(invoked.length).toBeGreaterThan(0)
      expect(invoking.length).toBeLessThanOrEqual(STATUS_TEXT_MAX)
      expect(invoked.length).toBeLessThanOrEqual(STATUS_TEXT_MAX)
    }
  })
})

describe('tool descriptor _meta', () => {
  const UI_CAPABILITY: JsonObject = {
    extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } },
  }

  test('every tool carries its status lines for hosts that show them', async () => {
    for (const tool of await listTools()) {
      const presentation = TOOL_PRESENTATION.get(tool.name)
      expect(tool._meta?.['openai/toolInvocation/invoking']).toBe(presentation?.invoking ?? '')
      expect(tool._meta?.['openai/toolInvocation/invoked']).toBe(presentation?.invoked ?? '')
    }
  })

  test('without the UI extension no tool advertises the app', async () => {
    for (const tool of await listTools()) expect(tool._meta?.ui).toBeUndefined()
  })

  test('a client that negotiates the UI extension gets the app on the two painting tools only', async () => {
    const { response } = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: UI_CAPABILITY })
    const sessionId = response.headers.get('Mcp-Session-Id')
    expect(sessionId).toBeString()
    const { handleMcp } = await import('./mcp')
    const listed = await handleMcp(
      new Request('https://explore.developing-country.org/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Mcp-Session-Id': sessionId ?? '' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
      }),
      // SAFETY: the dev-auth path reads only the string vars above; tools/list touches no binding.
      ENV as Env,
    )
    const tools: ListedTool[] = (await listed.json()).result.tools
    const painting = tools.filter((tool) => tool._meta?.ui !== undefined).map((tool) => tool.name).sort()
    expect(painting).toEqual(['analyze_location', 'query_data'])
    for (const tool of tools.filter((candidate) => painting.includes(candidate.name))) {
      expect(tool._meta?.ui).toEqual({ resourceUri: MCP_UI_RESOURCE_URI })
    }
  })
})
