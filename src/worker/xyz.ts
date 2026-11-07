/// <reference types="@cloudflare/workers-types" />
//
// Per-tile XYZ endpoint for our PMTiles archives:  /xyz/<archive>/<z>/<x>/<y>
//
// Why, on top of the /tiles/* range-proxy: MapLibre + pmtiles fetch tiles as
// HTTP *Range* requests (206) against one big .pmtiles file. Browsers and CDNs
// cache 206s poorly, so panning re-hits the network every time. Here each tile
// is its own URL returned as a plain 200, so it caches like any other file —
// at the Cloudflare edge (caches.default) AND in the browser. Panning back is
// then instant from cache (the "Google Maps" behaviour).
//
// getZxy() decompresses the stored (gzip) MVT, so we return raw protobuf.

import { PMTiles, type Source, type RangeResponse } from 'pmtiles'
import type { Env } from './types'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Range, If-Match, If-None-Match',
}

/** pmtiles Source backed by R2 range reads. A fresh reader is built per request
 *  (so an overwritten archive is always read at its current offsets); the edge
 *  cache below means the worker only runs on a cache miss, so the extra R2 reads
 *  to locate a tile are cheap and rare. */
class R2Source implements Source {
  constructor(private env: Env, private key: string) {}
  getKey() { return this.key }
  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    const obj = await this.env.TILES.get(this.key, { range: { offset, length } })
    if (!obj || !('arrayBuffer' in obj)) throw new Error(`archive ${this.key} not found`)
    return { data: await obj.arrayBuffer() }
  }
}

const TILE_RE = /^\/xyz\/([a-z0-9_-]+)\/(\d{1,2})\/(\d{1,7})\/(\d{1,7})(?:\.[a-z]+)?$/i

export async function serveXyz(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (env.ENABLE_TILE_COMPAT !== '1') {
    return new Response('Not Found', { status: 404, headers: CORS })
  }
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405, headers: CORS })
  }
  const url = new URL(request.url)
  const m = TILE_RE.exec(url.pathname)
  if (!m) return new Response('Bad Request', { status: 400, headers: CORS })
  const [, name, zs, xs, ys] = m
  const z = Number(zs), x = Number(xs), y = Number(ys)

  // Edge cache keyed on the tile URL (plain, cacheable — no Range collision).
  const cache = caches.default
  const cacheKey = new Request(url.toString(), { method: 'GET' })
  const hit = await cache.match(cacheKey)
  if (hit) return hit

  let tile: RangeResponse | undefined
  try {
    tile = await new PMTiles(new R2Source(env, `${name}.pmtiles`)).getZxy(z, x, y)
  } catch {
    return new Response('Archive not found', { status: 404, headers: CORS })
  }

  const headers = new Headers(CORS)
  headers.set('Cache-Control', 'public, max-age=86400')
  // Missing tile (sparse coverage / above data zoom): cache a tiny 204 so we
  // don't recompute, and MapLibre just renders nothing there.
  if (!tile) {
    const empty = new Response(null, { status: 204, headers })
    ctx.waitUntil(cache.put(cacheKey, empty.clone()))
    return empty
  }
  headers.set('Content-Type', 'application/x-protobuf')
  const resp = new Response(tile.data, { status: 200, headers })
  ctx.waitUntil(cache.put(cacheKey, resp.clone()))
  return resp
}
