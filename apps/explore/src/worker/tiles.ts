/// <reference types="@cloudflare/workers-types" />
//
// R2 range-proxy for PMTiles archives at /tiles/*. The pmtiles client in the
// browser issues HTTP Range GETs; R2 supports them, and we add the CORS headers
// MapLibre needs. Behaviour preserved exactly from the original single-file
// worker — in particular we do NOT cache via the Cache API (see note below).

import type { Env } from './types'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Range, If-Match, If-None-Match',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, ETag, Accept-Ranges',
}

function parseRange(header: string | null, size: number): { offset: number; length: number } | null {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m) return null
  const [, startStr, endStr] = m
  if (startStr === '' && endStr === '') return null
  if (startStr === '') {
    const suffix = Number(endStr)
    return { offset: Math.max(0, size - suffix), length: Math.min(suffix, size) }
  }
  const start = Number(startStr)
  const end = endStr === '' ? size - 1 : Math.min(Number(endStr), size - 1)
  if (start > end) return null
  return { offset: start, length: end - start + 1 }
}

export async function serveTile(request: Request, env: Env): Promise<Response> {
  if (env.ENABLE_TILE_COMPAT !== '1') {
    return new Response('Not Found', { status: 404, headers: CORS })
  }
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405, headers: CORS })
  }

  const url = new URL(request.url)
  const key = decodeURIComponent(url.pathname.replace(/^\/tiles\//, ''))
  if (!key || key.includes('..')) return new Response('Bad Request', { status: 400, headers: CORS })

  // NB: don't use the Cache API keyed on a URL fragment — the Cache API strips
  // fragments, so different byte ranges collide onto one entry and tile reads
  // get served header bytes. R2 range reads are fast; skip edge caching here.
  const head = await env.TILES.head(key)
  if (!head) return new Response('Not Found', { status: 404, headers: CORS })

  const range = parseRange(request.headers.get('Range'), head.size)
  const headers = new Headers(CORS)
  headers.set('Accept-Ranges', 'bytes')
  headers.set('ETag', head.httpEtag)
  headers.set('Cache-Control', 'public, max-age=86400')
  headers.set('Content-Type', head.httpMetadata?.contentType ?? 'application/octet-stream')

  if (request.method === 'HEAD') {
    headers.set('Content-Length', String(head.size))
    return new Response(null, { status: 200, headers })
  }

  const obj = range
    ? await env.TILES.get(key, { range: { offset: range.offset, length: range.length } })
    : await env.TILES.get(key)
  if (!obj) return new Response('Not Found', { status: 404, headers: CORS })

  let status = 200
  if (range) {
    status = 206
    headers.set('Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${head.size}`)
    headers.set('Content-Length', String(range.length))
  } else {
    headers.set('Content-Length', String(head.size))
  }

  return new Response(obj.body, { status, headers })
}
