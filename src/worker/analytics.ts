// Workers Analytics Engine — aggregate demand, no fingerprinting.
// No scraped personal data; no cookies or IPs in the dataset.

import type { Env } from './types'
import type { JsonObject } from '../shared/json'
import { isJsonNumber, isJsonObject } from '../shared/json'

export type ToolCallPoint = {
  tool: string
  op?: string
  entities?: string[]
  ms: number
  count?: number
  truncated?: boolean
}

export type MissPoint = {
  error: string
  entity?: string
  op?: string
  origin?: { lat: number; lng: number }
}

function dataset(env: Env) {
  return env.ANALYTICS
}

function firstEntity(entities: string[] | undefined): string {
  return entities && entities.length ? String(entities[0]).slice(0, 64) : ''
}

export function writeToolCall(env: Env, p: ToolCallPoint): void {
  const ae = dataset(env)
  if (!ae) return
  try {
    ae.writeDataPoint({
      indexes: ['tool_call'],
      blobs: [
        p.tool.slice(0, 64),
        (p.op ?? '').slice(0, 64),
        firstEntity(p.entities),
        p.truncated ? 'truncated' : '',
        '',
      ],
      doubles: [p.ms, p.count ?? 0, 0, 0],
    })
  } catch {
    /* never fail the tool on telemetry */
  }
}

export function writeMiss(env: Env, p: MissPoint): void {
  const ae = dataset(env)
  if (!ae) return
  try {
    ae.writeDataPoint({
      indexes: ['miss'],
      blobs: [
        (p.error ?? '').slice(0, 64),
        (p.op ?? '').slice(0, 64),
        (p.entity ?? '').slice(0, 64),
        '',
        '',
      ],
      doubles: [0, 0, p.origin?.lat ?? 0, p.origin?.lng ?? 0],
    })
  } catch {
    /* swallow */
  }
}

export function writeSearchZero(env: Env, q: string): void {
  const ae = dataset(env)
  if (!ae) return
  try {
    ae.writeDataPoint({
      indexes: ['search_zero'],
      blobs: ['search_places', '', '', '', q.slice(0, 80)],
      doubles: [0, 0, 0, 0],
    })
  } catch {
    /* swallow */
  }
}

export function writeViewEvent(env: Env, event: string, mount: string): void {
  const ae = dataset(env)
  if (!ae) return
  try {
    ae.writeDataPoint({
      indexes: ['view'],
      blobs: [event.slice(0, 32), mount.slice(0, 36), '', '', ''],
      doubles: [0, 0, 0, 0],
    })
  } catch {
    /* swallow */
  }
}

export function missFromBody(body: JsonObject): MissPoint | null {
  const error = String(body.error ?? '')
  if (
    error !== 'entity_known_absent' &&
    error !== 'operator_unavailable' &&
    error !== 'origin_outside_graph'
  ) {
    return null
  }
  const origin = isJsonObject(body.origin) ? body.origin : null
  const lat = isJsonNumber(origin?.lat) ? origin.lat : undefined
  const lng = isJsonNumber(origin?.lng) ? origin.lng : undefined
  return {
    error,
    entity: body.entity != null ? String(body.entity) : undefined,
    op: body.op != null ? String(body.op) : undefined,
    origin: lat != null && lng != null ? { lat, lng } : undefined,
  }
}

const VIEW_EVENTS = new Set(['select', 'hover', 'open_link', 'ready', 'geometry_fetch'])
const EVT_WINDOW_MS = 10 * 60 * 1000
const EVT_PER_MOUNT = 40
const EVT_PER_IP = 120

export async function rateLimitEvt(
  mount: string,
  ip: string,
): Promise<boolean> {
  const bucket = Math.floor(Date.now() / EVT_WINDOW_MS)
  const okMount = await bump(`https://evt.internal/m/${mount}/${bucket}`, EVT_PER_MOUNT)
  const okIp = await bump(`https://evt.internal/ip/${ip || 'unknown'}/${bucket}`, EVT_PER_IP)
  return okMount && okIp
}

async function bump(url: string, max: number): Promise<boolean> {
  try {
    const cache = await caches.open('dc-evt')
    const hit = await cache.match(url)
    const n = hit ? Number(await hit.text()) || 0 : 0
    if (n >= max) return false
    await cache.put(
      url,
      new Response(String(n + 1), {
        headers: { 'Cache-Control': `max-age=${EVT_WINDOW_MS / 1000}` },
      }),
    )
    return true
  } catch {
    return true
  }
}

export function parseEvtBody(raw: JsonObject): { mount: string; event: string } | null {
  const mount = String(raw.mount ?? '')
  const event = String(raw.event ?? '')
  if (!/^[0-9a-f-]{8,36}$/i.test(mount)) return null
  if (!VIEW_EVENTS.has(event)) return null
  return { mount, event }
}
