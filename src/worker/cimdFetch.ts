// Network transport for Client ID Metadata Documents (CIMD) on Cloudflare Workers.
//
// With CIMD a client's `client_id` is an HTTPS URL, and the authorization server
// fetches that URL (and any `jwks_uri` it names) to learn the client's redirect
// URIs and keys. That makes the fetch a server-side request to an address an
// anonymous caller chose, the classic SSRF shape. Better Auth's
// `@better-auth/cimd` leaves the transport to the app and asks for four things:
//   1. resolve the hostname once and refuse RFC 6890 special-use addresses,
//   2. connect to exactly that approved address (pinning),
//   3. keep TLS verification for the real hostname,
//   4. follow no redirects.
// It ships a Node transport only.
//
// WHAT WORKERS CAN AND CANNOT DO. A Worker cannot do (2). `fetch()` resolves DNS
// itself and exposes neither the connected address nor a way to pin one.
// `cloudflare:sockets` can connect to an IP and run TLS against the original
// hostname, but Workers refuse socket connections to Cloudflare's own IP ranges,
// and both chatgpt.com and claude.ai sit behind Cloudflare, so pinning through
// sockets would break the two clients that matter. We say so plainly instead of
// pretending.
//
// WHAT THIS DOES INSTEAD (defence in depth):
//   - HTTPS on the default port only, GET/HEAD only, no credentials, and no IP
//     literals; the hostname must be a public DNS name.
//   - Resolve A and AAAA once over DNS-over-HTTPS before fetching, and refuse the
//     fetch if ANY answer is private, loopback, link-local, CGNAT, multicast,
//     documentation, benchmarking, reserved or otherwise special-use. This
//     catches the common case (a name that simply points at an internal
//     address) but is NOT pinning: a rebinding DNS server can answer DoH with a
//     public address and the edge resolver with a private one.
//   - Why that residual is small here: Worker subrequests leave from
//     Cloudflare's edge, which has no route into a private network unless the
//     Worker is given one (Tunnel, VPC or service bindings), and this Worker is
//     not. Cloud metadata endpoints such as 169.254.169.254 do not exist there.
//     A rebinding attacker can therefore reach only what any public client
//     could reach anyway.
//   - Optional host allowlist (CIMD_ALLOWED_HOSTS) for operators who want to
//     accept only known clients. Off by default so unknown MCP clients that use
//     CIMD still work.
//   - Redirects are refused, bodies are capped while streaming, every request
//     times out, and successful responses are cached briefly per isolate so a
//     client's metadata is not re-fetched on every OAuth request.

/** Signature Better Auth's CIMD plugin calls (the Fetch API's). */
export type MetadataFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface CimdFetchOptions {
  /** Network fetch. Injected so tests never touch the network. */
  fetch?: typeof fetch
  /** Resolve a hostname to every A/AAAA address. Defaults to DNS-over-HTTPS. */
  resolve?: (hostname: string, signal: AbortSignal) => Promise<string[]>
  /** Lower-case hostnames to accept. Null or empty accepts any public host. */
  allowedHosts?: readonly string[] | null
  /** Per-request timeout in milliseconds. */
  timeoutMs?: number
  /** Largest body accepted, in bytes. */
  maxBytes?: number
  /** Clock for the response cache. */
  now?: () => number
  /** Response cache shared across requests in this isolate. Pass null to disable. */
  cache?: MetadataCache | null
}

import type { JsonValue } from '../shared/json'
import { isJsonNumber, isJsonObject, isJsonString } from '../shared/json'

const DEFAULT_TIMEOUT_MS = 5_000
// Better Auth caps metadata documents at 5 KB and JWKS at 64 KiB; match the larger.
const DEFAULT_MAX_BYTES = 64 * 1024
const MAX_CACHE_SECONDS = 300
const MAX_CACHE_ENTRIES = 100
const DOH_ENDPOINT = 'https://cloudflare-dns.com/dns-query'

export class CimdFetchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CimdFetchError'
  }
}

// ---------------------------------------------------------------------------
// Address classification (RFC 6890 and the IANA special-purpose registries).
// ---------------------------------------------------------------------------

function parseIpv4(address: string): number[] | null {
  const parts = address.split('.')
  if (parts.length !== 4) return null
  const octets: number[] = []
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const value = Number(part)
    if (value > 255) return null
    octets.push(value)
  }
  return octets
}

// [first octet, second octet range] blocks for IPv4 special-use space.
function isPublicIpv4(octets: number[]): boolean {
  const [a = 0, b = 0, c = 0] = octets
  if (a === 0) return false // "this network"
  if (a === 10) return false // private
  if (a === 100 && b >= 64 && b <= 127) return false // CGNAT shared space
  if (a === 127) return false // loopback
  if (a === 169 && b === 254) return false // link-local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false // private
  if (a === 192 && b === 0 && c === 0) return false // IETF protocol assignments
  if (a === 192 && b === 0 && c === 2) return false // TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return false // 6to4 relay anycast
  if (a === 192 && b === 168) return false // private
  if (a === 198 && (b === 18 || b === 19)) return false // benchmarking
  if (a === 198 && b === 51 && c === 100) return false // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return false // TEST-NET-3
  if (a >= 224) return false // multicast, reserved, broadcast
  return true
}

function parseIpv6(address: string): number[] | null {
  let text = address.toLowerCase()
  if (text.startsWith('[') && text.endsWith(']')) text = text.slice(1, -1)
  const zone = text.indexOf('%')
  if (zone !== -1) text = text.slice(0, zone)
  if (!text.includes(':')) return null
  // Embedded IPv4 tail (::ffff:1.2.3.4, 64:ff9b::1.2.3.4).
  let tail: number[] = []
  const lastColon = text.lastIndexOf(':')
  const maybeV4 = text.slice(lastColon + 1)
  if (maybeV4.includes('.')) {
    const v4 = parseIpv4(maybeV4)
    if (!v4) return null
    tail = [((v4[0] ?? 0) << 8) | (v4[1] ?? 0), ((v4[2] ?? 0) << 8) | (v4[3] ?? 0)]
    text = `${text.slice(0, lastColon)}:0:0`
  }
  const halves = text.split('::')
  if (halves.length > 2) return null
  const parse = (part: string) => (part === '' ? [] : part.split(':'))
  const head = parse(halves[0] ?? '')
  const rest = halves.length === 2 ? parse(halves[1] ?? '') : []
  const missing = 8 - head.length - rest.length
  if (halves.length === 1 && missing !== 0) return null
  if (halves.length === 2 && missing < 1) return null
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...rest]
  const words: number[] = []
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null
    words.push(Number.parseInt(group, 16))
  }
  if (tail.length === 2) words.splice(6, 2, tail[0] ?? 0, tail[1] ?? 0)
  return words.length === 8 ? words : null
}

function isPublicIpv6(words: number[]): boolean {
  const [w0 = 0, w1 = 0, w2 = 0, w3 = 0, w4 = 0, w5 = 0, w6 = 0, w7 = 0] = words
  if (words.every((w) => w === 0)) return false // unspecified
  if (w0 === 0 && w1 === 0 && w2 === 0 && w3 === 0 && w4 === 0 && w5 === 0 && w6 === 0 && w7 === 1) return false // loopback
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible: judge the embedded address.
  if (w0 === 0 && w1 === 0 && w2 === 0 && w3 === 0 && w4 === 0 && (w5 === 0xffff || w5 === 0)) {
    return isPublicIpv4([w6 >> 8, w6 & 0xff, w7 >> 8, w7 & 0xff])
  }
  if (w0 === 0x64 && w1 === 0xff9b) return false // NAT64 (well-known and local-use)
  if (w0 === 0x100 && w1 === 0 && w2 === 0 && w3 === 0) return false // discard-only
  if (w0 === 0x2001 && w1 < 0x200) return false // IETF protocol assignments, Teredo, ORCHID, benchmarking
  if (w0 === 0x2001 && w1 === 0xdb8) return false // documentation
  if (w0 === 0x2002) return false // 6to4 (tunnels to arbitrary IPv4)
  if (w0 === 0x3fff && w1 <= 0x0fff) return false // documentation (RFC 9637)
  if ((w0 & 0xfe00) === 0xfc00) return false // unique local
  if ((w0 & 0xffc0) === 0xfe80) return false // link-local
  if ((w0 & 0xffc0) === 0xfec0) return false // deprecated site-local
  if ((w0 & 0xff00) === 0xff00) return false // multicast
  // Only global unicast (2000::/3) is public.
  return (w0 & 0xe000) === 0x2000
}

/** True when `address` is an IP literal that is not RFC 6890 special-use. */
export function isPublicIpAddress(address: string): boolean {
  const v4 = parseIpv4(address)
  if (v4) return isPublicIpv4(v4)
  const v6 = parseIpv6(address)
  if (v6) return isPublicIpv6(v6)
  return false
}

function isIpLiteral(hostname: string): boolean {
  return parseIpv4(hostname) !== null || parseIpv6(hostname) !== null
}

// ---------------------------------------------------------------------------
// DNS over HTTPS.
// ---------------------------------------------------------------------------

/** Resolve every A and AAAA address of `hostname` through Cloudflare's DoH JSON API. */
export function dohResolver(fetchImpl: typeof fetch) {
  return async (hostname: string, signal: AbortSignal): Promise<string[]> => {
    const addresses: string[] = []
    for (const type of ['A', 'AAAA'] as const) {
      const url = `${DOH_ENDPOINT}?name=${encodeURIComponent(hostname)}&type=${type}`
      const res = await fetchImpl(url, { headers: { Accept: 'application/dns-json' }, signal })
      if (!res.ok) throw new CimdFetchError(`DNS lookup failed with HTTP ${res.status}`)
      const body: JsonValue = await res.json()
      if (!isJsonObject(body)) throw new CimdFetchError('DNS lookup returned no JSON')
      const status = isJsonNumber(body.Status) ? body.Status : -1
      // 0 = NOERROR, 3 = NXDOMAIN. Anything else (SERVFAIL, REFUSED) fails closed.
      if (status !== 0 && status !== 3) throw new CimdFetchError(`DNS lookup failed with status ${status}`)
      const answers = body.Answer
      if (!Array.isArray(answers)) continue
      for (const answer of answers) {
        if (!isJsonObject(answer) || !isJsonString(answer.data)) continue
        // 1 = A, 28 = AAAA. CNAME (5) hops are followed by the resolver; their
        // final A/AAAA records are in the same answer section.
        if (answer.type === 1 || answer.type === 28) addresses.push(answer.data)
      }
    }
    return addresses
  }
}

// ---------------------------------------------------------------------------
// Response cache (per isolate). Stores finished bytes, never promises: on
// Workers a promise tied to one request's I/O must not be awaited by another.
// ---------------------------------------------------------------------------

interface CachedResponse {
  status: number
  headers: [string, string][]
  body: Uint8Array
  expiresAt: number
}

export class MetadataCache {
  private readonly entries = new Map<string, CachedResponse>()

  get(url: string, now: number): CachedResponse | undefined {
    const entry = this.entries.get(url)
    if (!entry) return undefined
    if (entry.expiresAt <= now) {
      this.entries.delete(url)
      return undefined
    }
    return entry
  }

  set(url: string, entry: CachedResponse): void {
    this.entries.delete(url)
    while (this.entries.size >= MAX_CACHE_ENTRIES) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) break
      this.entries.delete(oldest)
    }
    this.entries.set(url, entry)
  }

  clear(): void {
    this.entries.clear()
  }
}

const sharedCache = new MetadataCache()

/** Seconds a response may be cached, or 0 when it must not be. */
function cacheSeconds(headers: Headers): number {
  const control = (headers.get('cache-control') ?? '').toLowerCase()
  if (/(^|,)\s*(no-store|private|no-cache)\b/.test(control)) return 0
  if ((headers.get('vary') ?? '').trim() === '*') return 0
  const maxAge = /(?:^|,)\s*(?:s-maxage|max-age)\s*=\s*(\d+)/.exec(control)
  const seconds = maxAge ? Number(maxAge[1]) : MAX_CACHE_SECONDS
  return Math.max(0, Math.min(seconds, MAX_CACHE_SECONDS))
}

async function readLimited(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel()
    throw new CimdFetchError('response body too large')
  }
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new CimdFetchError('response body too large')
    }
    chunks.push(value)
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

function rebuild(entry: CachedResponse, method: string): Response {
  return new Response(method === 'HEAD' ? null : entry.body.slice(), { status: entry.status, headers: entry.headers })
}

/** Parse CIMD_ALLOWED_HOSTS ("claude.ai, chatgpt.com") into lower-case hostnames. */
export function parseAllowedHosts(value: string | undefined): string[] | null {
  const hosts = (value ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host.length > 0)
  return hosts.length > 0 ? hosts : null
}

/** Build the transport handed to `cimd({ fetchClientMetadataResource })`. */
export function createCimdFetch(options: CimdFetchOptions = {}): MetadataFetch {
  const fetchImpl = options.fetch ?? fetch
  const resolve = options.resolve ?? dohResolver(fetchImpl)
  const allowed = options.allowedHosts && options.allowedHosts.length > 0 ? new Set(options.allowedHosts) : null
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const now = options.now ?? Date.now
  const cache = options.cache === undefined ? sharedCache : options.cache

  return async (input, init) => {
    // Never build `new Request(input, init)`: Better Auth's CIMD plugin passes
    // `redirect: "error"`, which Workers reject outright ("error" won't be
    // implemented at the edge), so every CIMD client failed on production while
    // Bun-based tests passed. Read the parts we use instead. Redirects stay
    // refused below: we always fetch with `redirect: 'manual'` and reject 3xx.
    const source = input instanceof Request ? input : null
    const method = (init?.method ?? source?.method ?? 'GET').toUpperCase()
    if (method !== 'GET' && method !== 'HEAD') throw new CimdFetchError('only GET and HEAD are allowed')
    const requestHeaders = new Headers(init?.headers ?? source?.headers)
    const outer = init?.signal ?? source?.signal ?? null
    let url: URL
    try {
      url = new URL(source ? source.url : input.toString())
    } catch {
      throw new CimdFetchError('invalid URL')
    }
    if (url.protocol !== 'https:') throw new CimdFetchError('metadata URL must use HTTPS')
    if (url.username || url.password) throw new CimdFetchError('metadata URL must not carry credentials')
    if (url.port !== '' && url.port !== '443') throw new CimdFetchError('metadata URL must use the default HTTPS port')
    const hostname = url.hostname.toLowerCase()
    if (isIpLiteral(hostname)) throw new CimdFetchError('metadata URL must use a DNS name, not an IP address')
    if (!hostname.includes('.') || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
      throw new CimdFetchError('metadata URL must use a public DNS name')
    }
    if (allowed && !allowed.has(hostname)) throw new CimdFetchError('metadata host is not on the allowlist')

    const cacheKey = url.toString()
    const cached = cache?.get(cacheKey, now())
    if (cached) return rebuild(cached, method)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const onAbort = () => controller.abort()
    outer?.addEventListener('abort', onAbort)
    try {
      const addresses = await resolve(hostname, controller.signal)
      if (addresses.length === 0) throw new CimdFetchError('metadata hostname has no addresses')
      for (const address of addresses) {
        if (!isPublicIpAddress(address)) throw new CimdFetchError('metadata hostname resolves to a non-public address')
      }
      const response = await fetchImpl(url.toString(), {
        method,
        headers: requestHeaders,
        redirect: 'manual',
        signal: controller.signal,
      })
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel()
        throw new CimdFetchError('metadata fetch must not redirect')
      }
      const body = method === 'HEAD' ? new Uint8Array() : await readLimited(response, maxBytes)
      // The body is already decoded, so drop the transfer headers that describe the wire form.
      const headers = [...response.headers.entries()].filter(
        ([name]) => name !== 'content-encoding' && name !== 'content-length',
      )
      if (response.status === 200 && cache) {
        const seconds = cacheSeconds(response.headers)
        if (seconds > 0) cache.set(cacheKey, { status: 200, headers, body, expiresAt: now() + seconds * 1000 })
      }
      return new Response(method === 'HEAD' ? null : body, { status: response.status, headers })
    } catch (error) {
      if (controller.signal.aborted && !(error instanceof CimdFetchError)) throw new CimdFetchError('metadata fetch timed out')
      throw error
    } finally {
      clearTimeout(timer)
      outer?.removeEventListener('abort', onAbort)
    }
  }
}
