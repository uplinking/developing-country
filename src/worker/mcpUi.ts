// MCP Apps (SEP-1865) constants + initialize capability stash.
// Hand-rolled: we do not use @modelcontextprotocol/ext-apps on the server.

import type { JsonObject, JsonValue } from '../shared/json'
import { isJsonObject } from '../shared/json'
import { MCP_UI_RESOURCE_URI } from '../shared/mcpApp'

export const UI_RESOURCE_URI = MCP_UI_RESOURCE_URI
export const UI_RESOURCE_MIME = 'text/html;profile=mcp-app'
export const UI_EXTENSION_ID = 'io.modelcontextprotocol/ui'

const SESSION_TTL_MS = 60 * 60 * 1000
const CACHE_NAME = 'dc-mcp-ui-sessions'

type Session = { ui: boolean; exp: number }

const memory = new Map<string, Session>()

export type UiCsp = {
  resourceDomains: string[]
  connectDomains: string[]
}

export function uiCsp(env: { BASE_PATH?: string; BETTER_AUTH_URL?: string; PUBLIC_VIEW_ORIGIN?: string }) {
  const resourceDomains = [
    'https://explore.developing-country.org',
    'https://tiles.developing-country.org',
    'https://tiles.openfreemap.org',
  ]
  const connectDomains = [
    'https://explore.developing-country.org',
    'https://tiles.developing-country.org',
    'https://tiles.openfreemap.org',
  ]
  for (const value of [env.BETTER_AUTH_URL, env.PUBLIC_VIEW_ORIGIN]) {
    if (!value?.trim()) continue
    try {
      const origin = new URL(value).origin
      if (!resourceDomains.includes(origin)) resourceDomains.push(origin)
      if (!connectDomains.includes(origin)) connectDomains.push(origin)
    } catch {
      // Deployment validation owns malformed environment URLs. A bad value is
      // never copied into an MCP App CSP.
    }
  }
  if (!env.BASE_PATH?.trim()) {
    for (const origin of ['http://localhost:8787', 'http://127.0.0.1:8787']) {
      resourceDomains.push(origin)
      connectDomains.push(origin)
    }
  }
  return { csp: { resourceDomains, connectDomains }, prefersBorder: true }
}

// Display modes the app handles: inline, plus fullscreen for maps and the
// dataset browser. Mirrors appCapabilities.availableDisplayModes in AppMcp.
export const UI_DISPLAY_MODES = ['inline', 'fullscreen'] as const

/**
 * Resource-contents `_meta` for the app. `ui` is the MCP Apps standard block
 * every host reads. The `openai/*` keys are ChatGPT's resource hints (display
 * modes known before the frame loads; a one-line summary for the model so it
 * does not re-narrate the frame); other hosts ignore them.
 */
export function uiResourceMeta(env: { BASE_PATH?: string; BETTER_AUTH_URL?: string; PUBLIC_VIEW_ORIGIN?: string }) {
  return {
    ui: uiCsp(env),
    'openai/ui': { availableDisplayModes: [...UI_DISPLAY_MODES] },
    'openai/widgetDescription':
      'Interactive developing-country.org view of this result: a map, chart, table or dataset browser with sources. The user can pan, open datasets and save a live view, so do not restate every value it shows.',
  }
}

export function clientOffersUi(capabilities: JsonValue | undefined): boolean {
  if (!isJsonObject(capabilities)) return false
  const ext = capabilities.extensions
  if (!isJsonObject(ext)) return false
  const ui = ext[UI_EXTENSION_ID]
  if (!isJsonObject(ui)) return false
  const mimeTypes = ui.mimeTypes
  if (!Array.isArray(mimeTypes)) return false
  return mimeTypes.includes(UI_RESOURCE_MIME)
}

export function requestOffersUi(params: JsonObject | undefined): boolean {
  if (!params) return false
  const meta = params._meta
  if (isJsonObject(meta)) {
    if (clientOffersUi(meta)) return true
    const nested = meta['io.modelcontextprotocol/clientCapabilities']
    if (clientOffersUi(nested)) return true
  }
  return false
}

function prune() {
  const now = Date.now()
  for (const [k, v] of memory) {
    if (v.exp < now) memory.delete(k)
  }
}

export function newSessionId(): string {
  return crypto.randomUUID()
}

export async function stashSession(id: string, ui: boolean): Promise<void> {
  prune()
  const rec: Session = { ui, exp: Date.now() + SESSION_TTL_MS }
  memory.set(id, rec)
  try {
    const cache = await caches.open(CACHE_NAME)
    await cache.put(
      `https://mcp.internal/session/${id}`,
      new Response(JSON.stringify({ ui }), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': `max-age=${SESSION_TTL_MS / 1000}`,
        },
      }),
    )
  } catch {
    /* Cache API unavailable in some test harnesses */
  }
}

export async function sessionOffersUi(sessionId: string | null): Promise<boolean> {
  if (!sessionId) return false
  prune()
  const hit = memory.get(sessionId)
  if (hit && hit.exp >= Date.now()) return hit.ui
  try {
    const cache = await caches.open(CACHE_NAME)
    const res = await cache.match(`https://mcp.internal/session/${sessionId}`)
    if (!res) return false
    const rec: JsonValue = await res.json()
    const ui = isJsonObject(rec) && rec.ui === true
    memory.set(sessionId, { ui, exp: Date.now() + SESSION_TTL_MS })
    return ui
  } catch {
    return false
  }
}

export const UI_TOOL_META = { ui: { resourceUri: UI_RESOURCE_URI } } as const

// Only tools whose result is something to look at carry the app, so one answer
// paints one frame. The dataset browser opens inside that frame ("All
// datasets" calls get_layer_catalog through the host), not as its own paint.
export const UI_TOOLS: ReadonlySet<string> = new Set(['analyze_location', 'query_data'])
