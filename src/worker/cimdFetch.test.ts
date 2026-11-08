import { describe, expect, test } from 'bun:test'
import { CimdFetchError, MetadataCache, createCimdFetch, isPublicIpAddress, parseAllowedHosts } from './cimdFetch'

const DOC_URL = 'https://client.example.com/oauth/client.json'

interface Stub {
  addresses?: Record<string, string[]>
  respond?: (url: string, init?: RequestInit) => Response | Promise<Response>
}

function harness(stub: Stub = {}, extra: Parameters<typeof createCimdFetch>[0] = {}) {
  const requests: string[] = []
  const fetchStub = async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString()
    requests.push(url)
    return stub.respond ? stub.respond(url, init) : Response.json({ client_id: DOC_URL })
  }
  const resolve = async (hostname: string) => stub.addresses?.[hostname] ?? ['93.184.216.34']
  const transport = createCimdFetch({
    fetch: Object.assign(fetchStub, { preconnect: fetch.preconnect }),
    resolve,
    cache: new MetadataCache(),
    ...extra,
  })
  return { transport, requests }
}

async function rejects(promise: Promise<unknown>, message: RegExp) {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(CimdFetchError)
    expect(String(error)).toMatch(message)
    return
  }
  throw new Error('expected the fetch to be refused')
}

describe('isPublicIpAddress', () => {
  test.each([
    ['93.184.216.34', true],
    ['104.18.32.47', true],
    ['2606:4700::6812:202f', true],
    ['127.0.0.1', false],
    ['10.1.2.3', false],
    ['172.16.0.1', false],
    ['172.31.255.255', false],
    ['192.168.1.1', false],
    ['169.254.169.254', false],
    ['100.64.0.1', false],
    ['0.0.0.0', false],
    ['192.0.2.10', false],
    ['198.18.0.1', false],
    ['224.0.0.1', false],
    ['255.255.255.255', false],
    ['::1', false],
    ['::', false],
    ['fe80::1', false],
    ['fc00::1', false],
    ['fd12:3456::1', false],
    ['ff02::1', false],
    ['2001:db8::1', false],
    ['::ffff:127.0.0.1', false],
    ['::ffff:10.0.0.1', false],
    ['::ffff:93.184.216.34', true],
    ['64:ff9b::a00:1', false],
    ['2002:a00:1::1', false],
    ['[::1]', false],
    ['not-an-ip', false],
    ['1.2.3', false],
    ['256.1.1.1', false],
  ])('%s → %p', (address, expected) => {
    expect(isPublicIpAddress(address)).toBe(expected)
  })
})

describe('createCimdFetch', () => {
  test('fetches a public HTTPS document', async () => {
    const { transport, requests } = harness()
    const res = await transport(DOC_URL, { headers: { accept: 'application/json' } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ client_id: DOC_URL })
    expect(requests).toEqual([DOC_URL])
  })

  test('refuses plain HTTP, other ports, credentials and IP literals', async () => {
    const { transport, requests } = harness()
    await rejects(transport('http://client.example.com/c.json'), /HTTPS/)
    await rejects(transport('https://client.example.com:8443/c.json'), /default HTTPS port/)
    await rejects(transport('https://user:pw@client.example.com/c.json'), /credentials/)
    await rejects(transport('https://127.0.0.1/c.json'), /DNS name/)
    await rejects(transport('https://[::1]/c.json'), /DNS name/)
    await rejects(transport('https://169.254.169.254/latest/meta-data'), /DNS name/)
    await rejects(transport('https://localhost/c.json'), /public DNS name/)
    await rejects(transport('https://metadata.google.internal/c.json'), /public DNS name/)
    expect(requests).toEqual([])
  })

  test('refuses non-GET methods', async () => {
    const { transport } = harness()
    await rejects(transport(DOC_URL, { method: 'POST', body: '{}' }), /GET and HEAD/)
  })

  test('refuses a hostname that resolves to any private address', async () => {
    const { transport, requests } = harness({
      addresses: {
        'internal.example.com': ['10.0.0.5'],
        'mixed.example.com': ['93.184.216.34', '192.168.0.10'],
        'metadata.example.com': ['169.254.169.254'],
        'mapped.example.com': ['::ffff:127.0.0.1'],
        'empty.example.com': [],
      },
    })
    await rejects(transport('https://internal.example.com/c.json'), /non-public/)
    await rejects(transport('https://mixed.example.com/c.json'), /non-public/)
    await rejects(transport('https://metadata.example.com/c.json'), /non-public/)
    await rejects(transport('https://mapped.example.com/c.json'), /non-public/)
    await rejects(transport('https://empty.example.com/c.json'), /no addresses/)
    expect(requests).toEqual([])
  })

  test('never follows a redirect', async () => {
    const { transport } = harness({
      respond: () => new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/' } }),
    })
    await rejects(transport(DOC_URL), /must not redirect/)
  })

  test('asks fetch for manual redirects', async () => {
    let seen: RequestRedirect | undefined
    const { transport } = harness({
      respond: (_url, init) => {
        seen = init?.redirect
        return Response.json({})
      },
    })
    await transport(DOC_URL)
    expect(seen).toBe('manual')
  })

  test('caps the body size, declared or streamed', async () => {
    const big = 'x'.repeat(2048)
    const declared = harness({ respond: () => new Response(big, { headers: { 'content-length': '2048' } }) }, { maxBytes: 1024 })
    await rejects(declared.transport(DOC_URL), /too large/)
    const streamed = harness(
      {
        respond: () =>
          new Response(
            new ReadableStream({
              start(controller) {
                for (let i = 0; i < 4; i++) controller.enqueue(new TextEncoder().encode('y'.repeat(512)))
                controller.close()
              },
            }),
          ),
      },
      { maxBytes: 1024 },
    )
    await rejects(streamed.transport(DOC_URL), /too large/)
  })

  test('times out a slow server', async () => {
    const { transport } = harness(
      {
        respond: (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
          }),
      },
      { timeoutMs: 20 },
    )
    await rejects(transport(DOC_URL), /timed out/)
  })

  test('honours the host allowlist', async () => {
    const { transport, requests } = harness({}, { allowedHosts: ['claude.ai', 'chatgpt.com'] })
    await rejects(transport(DOC_URL), /allowlist/)
    await transport('https://chatgpt.com/oauth/client.json')
    expect(requests).toEqual(['https://chatgpt.com/oauth/client.json'])
  })

  test('caches a successful document briefly and respects no-store', async () => {
    let clock = 0
    const cached = harness({ respond: () => Response.json({ n: 1 }, { headers: { 'cache-control': 'max-age=60' } }) }, { now: () => clock })
    await cached.transport(DOC_URL)
    await cached.transport(DOC_URL)
    expect(cached.requests).toHaveLength(1)
    clock = 61_000
    await cached.transport(DOC_URL)
    expect(cached.requests).toHaveLength(2)

    const uncached = harness({ respond: () => Response.json({}, { headers: { 'cache-control': 'no-store' } }) })
    await uncached.transport(DOC_URL)
    await uncached.transport(DOC_URL)
    expect(uncached.requests).toHaveLength(2)
  })

  test('does not cache failures', async () => {
    let status = 500
    const { transport, requests } = harness({ respond: () => new Response('{}', { status }) })
    expect((await transport(DOC_URL)).status).toBe(500)
    status = 200
    expect((await transport(DOC_URL)).status).toBe(200)
    expect(requests).toHaveLength(2)
  })
})

describe('parseAllowedHosts', () => {
  test('splits, trims and lower-cases; empty means no allowlist', () => {
    expect(parseAllowedHosts(' Claude.ai, chatgpt.com ,')).toEqual(['claude.ai', 'chatgpt.com'])
    expect(parseAllowedHosts('')).toBeNull()
    expect(parseAllowedHosts(undefined)).toBeNull()
  })
})

describe('Workers runtime compatibility', () => {
  // Better Auth's CIMD plugin calls the transport with `redirect: "error"`. Workers
  // throw on that value in `new Request()`; Bun does not, which hid a production
  // outage where every CIMD client failed with "Failed to fetch metadata document".
  test('accepts the options Better Auth passes, even where Request rejects redirect "error"', async () => {
    const RealRequest = globalThis.Request
    class WorkersRequest extends RealRequest {
      constructor(input: RequestInfo | URL, init?: RequestInit) {
        if (init?.redirect === 'error') {
          throw new TypeError('Invalid redirect value, must be one of "follow" or "manual"')
        }
        super(input, init)
      }
    }
    globalThis.Request = WorkersRequest as typeof Request
    try {
      let seen: RequestInit | undefined
      const { transport } = harness({
        respond: (_url, init) => {
          seen = init
          return Response.json({ client_id: DOC_URL })
        },
      })
      const controller = new AbortController()
      const res = await transport(DOC_URL, {
        headers: new Headers({ Accept: 'application/json' }),
        redirect: 'error',
        signal: controller.signal,
      })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ client_id: DOC_URL })
      expect(seen?.redirect).toBe('manual')
      expect(new Headers(seen?.headers).get('accept')).toBe('application/json')
    } finally {
      globalThis.Request = RealRequest
    }
  })

  test('still refuses a redirecting metadata URL', async () => {
    const { transport } = harness({
      respond: () => new Response(null, { status: 302, headers: { Location: 'https://evil.example/x' } }),
    })
    await rejects(transport(DOC_URL, { redirect: 'error' }), /must not redirect/)
  })

  test('drops wire-encoding headers from the rebuilt response', async () => {
    const { transport } = harness({
      respond: () =>
        new Response(JSON.stringify({ client_id: DOC_URL }), {
          headers: { 'content-type': 'application/json', 'content-encoding': 'gzip', 'content-length': '5' },
        }),
    })
    const res = await transport(DOC_URL)
    expect(res.headers.get('content-encoding')).toBeNull()
    expect(res.headers.get('content-length')).toBeNull()
    expect(res.headers.get('content-type')).toBe('application/json')
  })
})
