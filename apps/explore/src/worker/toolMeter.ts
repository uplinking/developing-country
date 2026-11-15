// Per-call I/O metering for MCP tools (Phase 0 of the architecture plan).
//
// handleMcp is the composition root for a tool call: it hands the tool a copy of
// `env` whose D1, R2 and static-asset bindings count what the call does. The
// counts land in one log line and one Analytics Engine point per call, so cost
// per tool comes from measurement instead of estimates.
//
// The wrappers only count. Every call is forwarded unchanged to the real
// binding, and the meter is created per request, so nothing here outlives or
// leaks between requests. Caches in the tool code are keyed by asset path, not
// by the env object, so a fresh env per call does not defeat them.
//
// D1 limits: `.first()` and `.raw()` return no meta, so they count as queries
// but add no rows. Rows read are therefore a floor, exact for `.all()`, `.run()`
// and `.batch()`.

import type { Env } from './types'

export interface ToolMeter {
  d1Queries: number
  d1RowsRead: number
  d1RowsWritten: number
  /** R2 list, put and multipart operations (billed as Class A). */
  r2ClassA: number
  /** R2 get and head operations (billed as Class B). */
  r2ClassB: number
  r2BytesRead: number
  assetFetches: number
  assetBytes: number
}

export function newToolMeter(): ToolMeter {
  return {
    d1Queries: 0,
    d1RowsRead: 0,
    d1RowsWritten: 0,
    r2ClassA: 0,
    r2ClassB: 0,
    r2BytesRead: 0,
    assetFetches: 0,
    assetBytes: 0,
  }
}

type D1Meta = { rows_read?: number; rows_written?: number }

function addD1Meta(meter: ToolMeter, meta: D1Meta | undefined): void {
  meter.d1RowsRead += meta?.rows_read ?? 0
  meter.d1RowsWritten += meta?.rows_written ?? 0
}

/** Forward any property the wrapper does not intercept, keeping `this` on the real object. */
function forward<T extends object>(target: T, prop: string | symbol): unknown {
  const value: unknown = Reflect.get(target, prop, target)
  return typeof value === 'function' ? value.bind(target) : value
}

// D1's batch() needs the real prepared statements, so remember each wrapper's original.
const realStatements = new WeakMap<object, D1PreparedStatement>()

function meterStatement(statement: D1PreparedStatement, meter: ToolMeter): D1PreparedStatement {
  const wrapped = new Proxy(statement, {
    get(target, prop) {
      if (prop === 'bind') {
        return (...values: unknown[]) => meterStatement(target.bind(...values), meter)
      }
      if (prop === 'all' || prop === 'run') {
        return async () => {
          meter.d1Queries += 1
          const result = await target[prop]()
          addD1Meta(meter, result.meta)
          return result
        }
      }
      if (prop === 'first' || prop === 'raw') {
        return (...args: unknown[]) => {
          meter.d1Queries += 1
          return (target[prop] as (...a: unknown[]) => unknown)(...args)
        }
      }
      return forward(target, prop)
    },
  })
  realStatements.set(wrapped, statement)
  return wrapped
}

function meterD1<T extends D1Database | D1DatabaseSession>(db: T, meter: ToolMeter): T {
  return new Proxy(db, {
    get(target, prop) {
      if (prop === 'prepare') {
        return (sql: string) => meterStatement(target.prepare(sql), meter)
      }
      if (prop === 'batch') {
        return async (statements: D1PreparedStatement[]) => {
          meter.d1Queries += statements.length
          const results = await target.batch(statements.map((s) => realStatements.get(s) ?? s))
          for (const result of results) addD1Meta(meter, result.meta)
          return results
        }
      }
      if (prop === 'withSession' && 'withSession' in target) {
        return (...args: Parameters<D1Database['withSession']>) =>
          meterD1((target as D1Database).withSession(...args), meter)
      }
      return forward(target, prop)
    },
  })
}

const R2_CLASS_A = new Set(['put', 'list', 'createMultipartUpload', 'resumeMultipartUpload'])

function meterR2(bucket: R2Bucket, meter: ToolMeter): R2Bucket {
  return new Proxy(bucket, {
    get(target, prop) {
      if (prop === 'get' || prop === 'head') {
        return async (...args: unknown[]) => {
          meter.r2ClassB += 1
          const object = await (target[prop] as (...a: unknown[]) => Promise<R2Object | R2ObjectBody | null>)(...args)
          if (object && 'body' in object) meter.r2BytesRead += object.size
          return object
        }
      }
      if (typeof prop === 'string' && R2_CLASS_A.has(prop)) {
        return (...args: unknown[]) => {
          meter.r2ClassA += 1
          return (Reflect.get(target, prop, target) as (...a: unknown[]) => unknown).apply(target, args)
        }
      }
      return forward(target, prop)
    },
  })
}

function meterAssets(assets: Fetcher, meter: ToolMeter): Fetcher {
  return new Proxy(assets, {
    get(target, prop) {
      if (prop === 'fetch') {
        return async (...args: Parameters<Fetcher['fetch']>) => {
          meter.assetFetches += 1
          const response = await target.fetch(...args)
          meter.assetBytes += Number(response.headers.get('content-length')) || 0
          return response
        }
      }
      return forward(target, prop)
    },
  })
}

/** A copy of `env` whose D1, R2 and asset bindings report into `meter`. */
export function meteredEnv(env: Env, meter: ToolMeter): Env {
  return {
    ...env,
    DB: meterD1(env.DB, meter),
    ASSETS: meterAssets(env.ASSETS, meter),
    TILES: meterR2(env.TILES, meter),
    VIEWS: meterR2(env.VIEWS, meter),
    DATASETS: env.DATASETS ? meterR2(env.DATASETS, meter) : undefined,
  }
}

let servedInIsolate = 0

/** True for the first tool call this isolate serves: its module caches start empty. */
export function takeColdFlag(): boolean {
  servedInIsolate += 1
  return servedInIsolate === 1
}

/**
 * The OAuth client a verified JWT access token was issued to (`azp`), for
 * labelling metrics. Call only after authentication succeeded; this decodes,
 * it does not verify. Opaque and legacy tokens report 'opaque'; cookie or dev
 * sessions report 'session'.
 */
export function clientLabel(authorization: string | null): string {
  const token = /^Bearer\s+(\S+)\s*$/i.exec(authorization ?? '')?.[1]
  if (!token) return 'session'
  const parts = token.split('.')
  if (parts.length !== 3) return 'opaque'
  try {
    const json = atob(parts[1]!.replace(/-/g, '+').replace(/_/g, '/'))
    const azp: unknown = JSON.parse(json).azp
    return typeof azp === 'string' && azp ? azp.slice(0, 96) : 'unknown'
  } catch {
    return 'unknown'
  }
}
