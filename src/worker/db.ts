// D1 data-access layer. Thin, typed helpers over the schema in
// migrations/0001_init.sql. No HTTP here — callers are service.ts / analyze.ts.

import type { Env } from './types'
import type { JsonValue } from '../shared/json'

export interface ProspectRow {
  id: string
  user_email: string
  title: string | null
  url: string | null
  lat: number | null
  lng: number | null
  notes: string | null
  verdict: string | null
  visibility: string
  metadata: string | null
  created_at: string
  updated_at: string
}

export interface AnalysisRow {
  id: string
  user_email: string
  lat: number
  lng: number
  radius_km: number
  source: string // 'web' | 'mcp'
  source_url: string | null
  title: string | null
  summary: string | null
  created_at: string
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`
}

/** Parse the JSON metadata column back into an object for API output. */
export function hydrateProspect(row: ProspectRow) {
  return {
    ...row,
    metadata: row.metadata ? safeJson(row.metadata) : null,
  }
}

function safeJson(s: string): JsonValue | null {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

// ---- Prospects --------------------------------------------------------------

export async function insertProspect(env: Env, row: ProspectRow): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO prospects (id, user_email, title, url, lat, lng, notes, verdict, visibility, metadata, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
  )
    .bind(
      row.id,
      row.user_email,
      row.title,
      row.url,
      row.lat,
      row.lng,
      row.notes,
      row.verdict,
      row.visibility,
      row.metadata,
      row.created_at,
      row.updated_at,
    )
    .run()
}

export async function getProspectRow(env: Env, id: string): Promise<ProspectRow | null> {
  return await env.DB.prepare(`SELECT * FROM prospects WHERE id = ?1`).bind(id).first<ProspectRow>()
}

export async function listProspectRows(env: Env, email: string): Promise<ProspectRow[]> {
  const res = await env.DB.prepare(
    `SELECT * FROM prospects WHERE user_email = ?1 ORDER BY created_at DESC`,
  )
    .bind(email)
    .all<ProspectRow>()
  return res.results ?? []
}

/**
 * Prospects visible to `email`: their own OR public. Used by search/analyze.
 * Always bounded by a LIMIT (public visibility is caller-controllable and
 * uncapped, so an unbounded scan would be a cheap resource-exhaustion vector);
 * an optional bbox pushes the spatial filter into SQL for analyze.
 */
export interface VisibleProspectQuery {
  bbox?: [number, number, number, number] // [minLng, minLat, maxLng, maxLat]
  limit?: number
}

export async function listVisibleProspectRows(
  env: Env,
  email: string,
  q: VisibleProspectQuery = {},
): Promise<ProspectRow[]> {
  const binds: unknown[] = [email]
  let i = 2
  let bboxClause = ''
  if (q.bbox) {
    bboxClause = ` AND (lng >= ?${i++} AND lng <= ?${i++} AND lat >= ?${i++} AND lat <= ?${i++})`
    binds.push(q.bbox[0], q.bbox[2], q.bbox[1], q.bbox[3])
  }
  const limit = Math.min(Math.max(q.limit ?? 1000, 1), 5000)
  const sql =
    `SELECT * FROM prospects WHERE (user_email = ?1 OR visibility = 'public')${bboxClause}` +
    ` ORDER BY created_at DESC LIMIT ${limit}`
  const res = await env.DB.prepare(sql)
    .bind(...binds)
    .all<ProspectRow>()
  return res.results ?? []
}

export async function deleteProspectRow(env: Env, id: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM prospects WHERE id = ?1`).bind(id).run()
}

// ---- Analyses (logged analyze_location runs) --------------------------------

export async function insertAnalysis(env: Env, row: AnalysisRow): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO analyses (id, user_email, lat, lng, radius_km, source, source_url, title, summary, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
  )
    .bind(
      row.id,
      row.user_email,
      row.lat,
      row.lng,
      row.radius_km,
      row.source,
      row.source_url,
      row.title,
      row.summary,
      row.created_at,
    )
    .run()
}

export async function listAnalysisRows(
  env: Env,
  email: string,
  limit = 20,
): Promise<AnalysisRow[]> {
  const capped = Math.min(Math.max(limit, 1), 200)
  const res = await env.DB.prepare(
    `SELECT * FROM analyses WHERE user_email = ?1 ORDER BY created_at DESC LIMIT ${capped}`,
  )
    .bind(email)
    .all<AnalysisRow>()
  return res.results ?? []
}
