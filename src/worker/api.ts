// REST API under /api/*. Thin HTTP layer over service.ts — parse, authenticate,
// dispatch, serialise. All business logic lives in service.ts (shared with MCP).

import type { Env, Identity } from './types'
import { authenticate } from './auth'
import { configuredProviders } from './betterAuth'
import {
  ApiError,
  addProspect,
  analyze,
  catalog,
  coverage,
  contribute,
  deleteProspect,
  getIssue,
  getProspect,
  listAnalyses,
  listIssues,
  listProspects,
  reportIssue,
  ontology,
  query,
  searchPlaces,
  stepper,
  updateProspect,
  type ContributeParams,
} from './service'
import { extractStage, persistAndFanout } from './stageFanout'
import { normalizeEmail } from './identity'
import { parseEvtBody, rateLimitEvt, writeViewEvent } from './analytics'
import type { JsonObject, JsonPrimitive, JsonValue } from '../shared/json'
import {
  isJsonNumber,
  isJsonObject,
  isJsonString,
  jsonObjectFromSerializable,
  parseJsonObject,
} from '../shared/json'
import { getDataView, getDataViewResult, revokeDataView } from './dataViews'
import { JsonBodyTooLargeError, readJsonBodyLimited } from './requestBody'

// Same-origin app; the session cookie rides along automatically. We keep a
// permissive CORS surface for the read paths but never reflect credentials to a
// wildcard origin (the browser blocks that anyway).
const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Dev-User',
}

function json<T extends object | JsonPrimitive>(
  data: T,
  status = 200,
  extraHeaders?: HeadersInit,
): Response {
  const headers = new Headers(JSON_HEADERS)
  if (extraHeaders) new Headers(extraHeaders).forEach((value, key) => headers.set(key, value))
  return new Response(JSON.stringify(data), { status, headers })
}

function err(status: number, message: string): Response {
  return json({ error: message }, status)
}

async function body(request: Request): Promise<JsonObject> {
  let parsed: JsonValue
  try {
    parsed = await readJsonBodyLimited(request)
  } catch (error) {
    if (error instanceof JsonBodyTooLargeError) {
      throw new ApiError(413, 'JSON body exceeds 256 KiB limit')
    }
    throw new ApiError(400, 'invalid JSON body')
  }
  if (!isJsonObject(parsed)) throw new ApiError(400, 'JSON body must be an object')
  return parsed
}

function optionalString(value: JsonValue | undefined): string | undefined {
  return isJsonString(value) ? value : undefined
}

function optionalNumber(value: JsonValue | undefined): number | undefined {
  return isJsonNumber(value) ? value : undefined
}

function prospectParams(value: JsonObject) {
  return {
    url: optionalString(value.url),
    title: optionalString(value.title),
    lat: optionalNumber(value.lat),
    lng: optionalNumber(value.lng),
    notes: optionalString(value.notes),
    verdict: optionalString(value.verdict),
    visibility: optionalString(value.visibility),
  }
}

function contributionParams(value: JsonObject, issueId: string): ContributeParams {
  const kind = optionalString(value.kind)
  return {
    issue_id: issueId,
    kind:
      kind === 'comment' || kind === 'solution' || kind === 'evidence' ? kind : undefined,
    body: optionalString(value.body),
  }
}

export async function handleApi(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: JSON_HEADERS })

  const url = new URL(request.url)
  const path = url.pathname.replace(/\/+$/, '') // strip trailing slash
  const method = request.method

  // Resolve identity but DON'T gate yet — read-only "lure" endpoints (the map's
  // public layers + Analyze) work signed-out; only writes and personal data
  // require a session. `identity` may be null here.
  const identity = await authenticate(request, env)

  try {
    // ---- Public reads (identity optional; anon never sees private data) ----
    if (path === '/api/evt' && method === 'POST') {
      const parsed = parseEvtBody(await body(request))
      if (!parsed) return json({ ok: false }, 400)
      const ip = request.headers.get('CF-Connecting-IP') ?? ''
      if (!(await rateLimitEvt(parsed.mount, ip))) {
        return new Response(null, { status: 204, headers: JSON_HEADERS })
      }
      writeViewEvent(env, parsed.event, parsed.mount)
      return new Response(null, { status: 204, headers: JSON_HEADERS })
    }
    if (path === '/api/auth-providers' && method === 'GET') {
      return json({ providers: configuredProviders(env) })
    }
    if (path === '/api/me' && method === 'GET') {
      return json(identity ? { email: identity.email, mode: identity.mode } : { email: null, mode: 'anon' })
    }
    if (path === '/api/catalog' && method === 'GET') return json(await catalog(url.searchParams.get('country') ?? undefined, env))
    if (path === '/api/ontology' && method === 'GET') return json(ontology(url.searchParams.get('country') ?? undefined))
    if (path === '/api/coverage' && method === 'GET') return json(coverage(url.searchParams.get('country') ?? undefined))
    const publicViewResultGet = /^\/api\/views\/([^/]+)\/result\/([a-f0-9]{64})\.json$/.exec(path)
    if (publicViewResultGet && method === 'GET') {
      const response = await getDataViewResult(
        env,
        decodeURIComponent(publicViewResultGet[1]),
        publicViewResultGet[2],
        request.headers.get('If-None-Match'),
      )
      if (!response) return err(404, 'live view result not found')
      return response
    }
    const publicViewGet = /^\/api\/views\/([^/]+)$/.exec(path)
    if (publicViewGet && method === 'GET') {
      const document = await getDataView(env, decodeURIComponent(publicViewGet[1]))
      if (!document) return err(404, 'live view not found')
      if (document.revoked_at) {
        return json(
          { error: 'live view revoked', revoked_at: document.revoked_at },
          410,
          { 'Cache-Control': 'private, no-store' },
        )
      }
      const etag = `"${document.view.data.resultChecksum}"`
      if (request.headers.get('If-None-Match') === etag) {
        return new Response(null, {
          status: 304,
          headers: { ETag: etag, 'Cache-Control': 'public, max-age=60, s-maxage=300' },
        })
      }
      return json(document, 200, {
        ETag: etag,
        'Cache-Control': 'public, max-age=60, s-maxage=300',
      })
    }
    if (path === '/api/stepper' && method === 'GET') {
      try {
        return json(await stepper(env))
      } catch (e) {
        return err(503, `stepper adapter unavailable: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    if (path === '/api/analyze' && method === 'GET') {
      const latRaw = url.searchParams.get('lat')
      const lngRaw = url.searchParams.get('lng')
      const lat = latRaw === null ? NaN : Number(latRaw)
      const lng = lngRaw === null ? NaN : Number(lngRaw)
      const radiusRaw = url.searchParams.get('radius_km')
      const radius_km = radiusRaw !== null ? Number(radiusRaw) : undefined
      return json(await analyze(env, identity, {
        country: url.searchParams.get('country') ?? undefined,
        lat,
        lng,
        radius_km,
      }))
    }
    if (path === '/api/search' && method === 'GET') {
      const q = url.searchParams.get('q') ?? ''
      const limit = url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : undefined
      return json(await searchPlaces(env, identity, {
        country: url.searchParams.get('country') ?? undefined,
        q,
        limit,
      }))
    }
    if (path === '/api/query' && method === 'POST') {
      const args = await body(request)
      const result = await query(env, identity, args)
      const { geometry, ...rest } = result
      const restObject = jsonObjectFromSerializable(rest) ?? {}
      if (identity && ctx) {
        ctx.waitUntil(
          persistAndFanout(env, {
            email: identity.email,
            tool: 'query_data',
            events: extractStage(restObject),
            geometry,
            hull: rest.hull,
          }),
        )
      }
      if (args.include_geometry && geometry && JSON.stringify(geometry).length > 2 * 1024 * 1024) {
        return json({ ...rest, truncated: true, geometry_omitted: 'over_2mb' })
      }
      return json(args.include_geometry ? result : rest)
    }
    // Viewing crowdsourced issues is public; only reporting needs a session.
    if (path === '/api/issues' && method === 'GET') {
      return json(
        await listIssues(env, identity, {
          bbox: url.searchParams.get('bbox') ?? undefined,
          category: url.searchParams.get('category') ?? undefined,
          status: url.searchParams.get('status') ?? undefined,
          limit: url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : undefined,
        }),
      )
    }
    const publicIssueGet = /^\/api\/issues\/([^/]+)$/.exec(path)
    if (publicIssueGet && method === 'GET') {
      return json(await getIssue(env, identity, decodeURIComponent(publicIssueGet[1])))
    }

    // ---- Everything below writes or touches personal data: require a session.
    if (!identity) return err(401, 'unauthorized — sign in required')
    return await route(request, env, identity, path, method, url)
  } catch (e) {
    if (e instanceof ApiError) {
      const parsed = parseJsonObject(e.message)
      if (parsed) return json(parsed, e.status)
      return err(e.status, e.message)
    }
    return err(500, e instanceof Error ? e.message : String(e) || 'internal error')
  }
}

async function route(
  request: Request,
  env: Env,
  identity: Identity,
  path: string,
  method: string,
  url: URL,
): Promise<Response> {
  // Public reads (/api/me, catalog, stepper, analyze, search, GET issues) are
  // handled in handleApi BEFORE the auth gate. Everything here requires a
  // session (identity is guaranteed non-null).

  if (path === '/api/session' && method === 'GET') {
    let tab_count = 0
    if (env.SESSIONS) {
      tab_count = await env.SESSIONS.getByName('email:' + normalizeEmail(identity.email)).tabCount()
    }
    return json({ paired: Boolean(env.SESSIONS), tab_count, email: identity.email })
  }

  const revokeView = /^\/api\/views\/([^/]+)\/revoke$/.exec(path)
  if (revokeView && method === 'POST') {
    const revoked = await revokeDataView(env, identity, decodeURIComponent(revokeView[1]))
    return revoked ? json({ ok: true }) : err(404, 'live view not found')
  }
  if (path === '/api/session/snapshot' && method === 'GET') {
    const email = normalizeEmail(identity.email)
    const rows = await env.DB.prepare(
      `SELECT tool, events_json, hull_json, created_at FROM stage_snapshots
       WHERE user_email = ?1 ORDER BY created_at DESC LIMIT 50`,
    )
      .bind(email)
      .all<{ tool: string; events_json: string; hull_json: string | null; created_at: string }>()
    const d1Rows = (rows.results ?? []).filter((r) => {
      try {
        const events: JsonValue = JSON.parse(r.events_json)
        return (Array.isArray(events) && events.length > 0) || Boolean(r.hull_json)
      } catch {
        return false
      }
    })
    if (d1Rows.length > 0) {
      return json({
        source: 'd1',
        snapshots: d1Rows.map((r) => ({
          tool: r.tool,
          events: JSON.parse(r.events_json),
          hull: r.hull_json ? JSON.parse(r.hull_json) : null,
          created_at: r.created_at,
        })),
      })
    }
    if (env.SESSIONS) {
      const snapshotJson = await env.SESSIONS.getByName('email:' + email).snapshot()
      const snap = parseJsonObject(snapshotJson)
      const events = snap && Array.isArray(snap.events) ? snap.events : []
      return json({ source: 'do', snapshots: events.length && snap ? [snap] : [] })
    }
    return json({ source: 'none', snapshots: [] })
  }

  // /api/analyses — the caller's own logged analyze runs, newest first.
  if (path === '/api/analyses') {
    if (method === 'GET') {
      const limit = url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : undefined
      return json(await listAnalyses(env, identity, { limit }))
    }
    return err(405, 'method not allowed')
  }

  // /api/prospects
  if (path === '/api/prospects') {
    if (method === 'GET') return json(await listProspects(env, identity))
    if (method === 'POST') {
      return json(await addProspect(env, identity, prospectParams(await body(request))), 201)
    }
    return err(405, 'method not allowed')
  }

  // /api/prospects/:id
  const prospectMatch = /^\/api\/prospects\/([^/]+)$/.exec(path)
  if (prospectMatch) {
    const id = decodeURIComponent(prospectMatch[1])
    if (method === 'GET') return json(await getProspect(env, identity, id))
    if (method === 'PATCH') {
      const patch = prospectParams(await body(request))
      return json(await updateProspect(env, identity, { ...patch, id }))
    }
    if (method === 'DELETE') return json(await deleteProspect(env, identity, id))
    return err(405, 'method not allowed')
  }

  // /api/issues
  if (path === '/api/issues') {
    if (method === 'GET') {
      return json(
        await listIssues(env, identity, {
          bbox: url.searchParams.get('bbox') ?? undefined,
          category: url.searchParams.get('category') ?? undefined,
          status: url.searchParams.get('status') ?? undefined,
          limit: url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : undefined,
        }),
      )
    }
    if (method === 'POST') {
      const value = await body(request)
      return json(
        await reportIssue(env, identity, {
          lat: Number(value.lat),
          lng: Number(value.lng),
          category: String(value.category ?? ''),
          description: optionalString(value.description),
          media: Array.isArray(value.media) ? value.media : undefined,
        }),
        201,
      )
    }
    return err(405, 'method not allowed')
  }

  // /api/issues/:id/contributions
  const contribMatch = /^\/api\/issues\/([^/]+)\/contributions$/.exec(path)
  if (contribMatch) {
    const issue_id = decodeURIComponent(contribMatch[1])
    if (method === 'POST') {
      return json(await contribute(env, identity, contributionParams(await body(request), issue_id)), 201)
    }
    return err(405, 'method not allowed')
  }

  // /api/issues/:id
  const issueMatch = /^\/api\/issues\/([^/]+)$/.exec(path)
  if (issueMatch) {
    const id = decodeURIComponent(issueMatch[1])
    if (method === 'GET') return json(await getIssue(env, identity, id))
    return err(405, 'method not allowed')
  }

  return err(404, 'not found')
}
