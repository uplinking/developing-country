import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import type { ApiLayerContext, ApiLayerSource } from './apiLayers'

// apiLayers runs in the browser: it reads Vite's BASE_URL at import and
// window.location per request. The fake window is removed again afterwards
// because other test files in this process check `typeof window`.
process.env.BASE_URL ??= '/'
const { loadApiLayer, shouldFetchApiLayer } = await import('./apiLayers')
beforeAll(() => Reflect.set(globalThis, 'window', { location: { origin: 'https://example.org' } }))
afterAll(() => Reflect.deleteProperty(globalThis, 'window'))

const WEB_SIGNED_IN: ApiLayerContext = { signedIn: true, mcpApp: false }
const WEB_SIGNED_OUT: ApiLayerContext = { signedIn: false, mcpApp: false }
const MCP_APP: ApiLayerContext = { signedIn: false, mcpApp: true }

let sessionSources: Array<{ id: string; source: ApiLayerSource }> = []
beforeAll(async () => {
  const { LAYER_GROUPS } = await import('./layers')
  sessionSources = LAYER_GROUPS.flatMap((g) => (g.source.type === 'api' ? [{ id: g.id, source: g.source }] : []))
})

describe('session-only API layers', () => {
  test('prospects and analyses are marked session-only; stepper is public', () => {
    const auth = Object.fromEntries(sessionSources.map(({ id, source }) => [id, source.auth ?? 'public']))
    expect(auth).toEqual({ stepper: 'public', prospects: 'session', analyses: 'session' })
  })

  test('are fetched only on the web with a session', () => {
    const prospects = { endpoint: '/api/prospects', auth: 'session' } as const
    expect(shouldFetchApiLayer(prospects, WEB_SIGNED_IN)).toBe(true)
    expect(shouldFetchApiLayer(prospects, WEB_SIGNED_OUT)).toBe(false)
    expect(shouldFetchApiLayer(prospects, MCP_APP)).toBe(false)
    // Even if a host frame somehow reported a session, it has no cookie to send.
    expect(shouldFetchApiLayer(prospects, { signedIn: true, mcpApp: true })).toBe(false)
    expect(shouldFetchApiLayer({ endpoint: '/api/stepper' }, MCP_APP)).toBe(true)
  })
})

describe('loadApiLayer', () => {
  const realFetch = globalThis.fetch
  let requested: string[] = []
  let respond: (url: string) => Response = () => new Response('{}')

  beforeEach(() => {
    requested = []
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL) => {
        const url = String(input)
        requested.push(url)
        return respond(url)
      },
      { preconnect: realFetch.preconnect },
    )
  })
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  test('in an MCP App, never requests /api/prospects or /api/analyses', async () => {
    respond = () => Response.json({ type: 'FeatureCollection', features: [] })
    const results = await Promise.all(sessionSources.map(({ id, source }) => loadApiLayer(id, source, MCP_APP)))
    expect(requested).toEqual(['/api/stepper'])
    expect(results.map((r) => r.reason)).toEqual([undefined, 'sign-in', 'sign-in'])
    expect(results[1].data.features).toEqual([])
  })

  test('signed out on the web, skips the session layers without a request', async () => {
    respond = () => Response.json({ type: 'FeatureCollection', features: [] })
    await Promise.all(sessionSources.map(({ id, source }) => loadApiLayer(id, source, WEB_SIGNED_OUT)))
    expect(requested).toEqual(['/api/stepper'])
  })

  test('signed in on the web, loads prospects', async () => {
    respond = () => Response.json({ prospects: [{ id: 'p1', title: 'Plot', lat: 6.9, lng: 79.8, visibility: 'private' }] })
    const result = await loadApiLayer('prospects', { endpoint: '/api/prospects', auth: 'session' }, WEB_SIGNED_IN)
    expect(requested).toEqual(['/api/prospects'])
    expect(result).toMatchObject({ ok: true, count: 1 })
  })

  test('tells a 401 (sign in) apart from an upstream outage', async () => {
    respond = () => new Response('{}', { status: 401 })
    expect((await loadApiLayer('prospects', { endpoint: '/api/prospects', auth: 'session' }, WEB_SIGNED_IN)).reason).toBe('sign-in')
    respond = () => new Response('{"error":"stepper adapter unavailable"}', { status: 503 })
    expect(await loadApiLayer('stepper', { endpoint: '/api/stepper' }, WEB_SIGNED_OUT)).toMatchObject({ ok: false, reason: 'unavailable' })
  })

  test('passes through a stale last-good copy', async () => {
    respond = () => Response.json({ type: 'FeatureCollection', stale: true, features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [80, 7] }, properties: {} }] })
    expect(await loadApiLayer('stepper', { endpoint: '/api/stepper' }, MCP_APP)).toMatchObject({ ok: true, count: 1, stale: true })
  })
})
