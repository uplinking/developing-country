import { describe, expect, test } from 'bun:test'
import { createPlugin, PUBLICATION_CONTRACT } from '../src'

describe('publication requirements MCP tool', () => {
  test('is a read-only authenticated content-writer tool', async () => {
    const plugin = createPlugin()
    const tool = plugin.mcp.tools.publication_requirements
    const route = plugin.routes[tool.route]

    expect(tool.destructive).toBe(false)
    expect(route?.permission).toBe('content:write')
    expect(route?.public).not.toBe(true)
    expect(await route?.handler({} as never)).toEqual(PUBLICATION_CONTRACT)
  })
})
