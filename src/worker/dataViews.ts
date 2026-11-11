import type {
  ChartViewSpec,
  DataViewPresentation,
  DataViewSpec,
  MapCamera,
  MapViewSpec,
} from '@developing-country/views'
import {
  dataViewUrl,
  DEFAULT_DATA_VIEW_ORIGIN,
  rowsFromViewResult,
  validateDataViewPresentation,
  validateDataViewSpec,
} from '@developing-country/views'
import type { Completeness as DomainCompleteness, CountryCode, EvidenceRef } from '@developing-country/domain'
import { getCountryProfile, isCountryCode } from '@developing-country/countries'
import datasetVersionManifest from '../../scripts/dataset-versions.json' with { type: 'json' }
import type { JsonObject, JsonValue } from '../shared/json'
import { isJsonNumber, isJsonObject } from '../shared/json'
import { newId } from './db'
import { ApiError } from './errors'
import { ONTOLOGY } from './ontology'
import type { QuerySpatialResult } from './querySpatial'
import type { Env, Identity } from './types'
import {
  cameraForPoints,
  checkedAnnotations,
  checkedHighlight,
  composeMapLayers,
} from './viewPresentation'

const MAX_STORED_RESULT_BYTES = 8 * 1024 * 1024
const MAX_INLINE_RESULT_BYTES = 64 * 1024
const MAX_VIEWS_PER_OWNER = 50
const MAX_BYTES_PER_OWNER = 128 * 1024 * 1024
/** Default hourly creation limit per owner; override with VIEW_HOURLY_LIMIT. */
export const DEFAULT_VIEWS_PER_HOUR = 5
/** Hourly limit for VIEW_EDITOR_EMAILS (and the DEV_AUTH user); override with VIEW_EDITOR_HOURLY_LIMIT. */
export const DEFAULT_EDITOR_VIEWS_PER_HOUR = 60
/** Matches the D1 backstop trigger in migrations/0012_data_view_editor_hourly_ceiling.sql. */
const MAX_CONFIGURED_VIEWS_PER_HOUR = 120
const MAX_PLATFORM_VIEWS = 10_000
const MAX_PLATFORM_BYTES = 2 * 1024 * 1024 * 1024
const MAX_PLATFORM_INLINE_BYTES = 256 * 1024 * 1024
const DEFAULT_CAMERA: MapCamera = { center: [80.7718, 7.8731], zoom: 7.2 }

export interface DataViewDocument {
  view: DataViewSpec
  result: QuerySpatialResult | null
  result_url: string
  view_url: string
  revoked_at?: string
  /** Non-fatal authoring notes (truncated map, rows without a join key). Never stored. */
  warnings?: string[]
}

interface DataViewRow {
  id: string
  query_id: string
  owner_email: string
  visibility: 'link' | 'public'
  kind: 'map' | 'chart'
  country: string
  title: string
  spec_json: string
  result_json: string | null
  result_path: string | null
  result_bytes: number
  result_checksum: string
  dataset_version_ids: string
  row_count: number
  created_at: string
  revoked_at: string | null
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, stable(entry)]),
    )
  }
  return value
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(stable(value))
}

export async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `sha256:${hex}`
}

interface ManifestVersion {
  datasetId: string
  versionId: string
  country: CountryCode
  entityIds: string[]
  sourceIds: string[]
  vintage: string
  refreshedAt: string
  checksum: string
}

const MANIFEST_VERSIONS = datasetVersionManifest.versions as ManifestVersion[]
const MANIFEST_COUNTRY = getCountryProfile(datasetVersionManifest.country).code

const COMPLETENESS_PRIORITY: DomainCompleteness['status'][] = [
  'known_absent', 'unverified', 'partial', 'osm_only', 'derived', 'complete',
]

function combinedCompleteness(result: QuerySpatialResult): DomainCompleteness {
  const entries = result.completeness
  const status =
    COMPLETENESS_PRIORITY.find((candidate) => entries.some((entry) => entry.status === candidate)) ??
    'unverified'
  const coverages = entries.map((entry) => entry.coverage).filter((value): value is number => typeof value === 'number')
  return {
    status,
    coverage: coverages.length ? Math.min(...coverages) : null,
    coverageNote:
      [...new Set(entries.map((entry) => entry.coverage_note).filter(Boolean))].join(' · ') ||
      'No coverage statement was supplied by the source dataset.',
    knownGaps: [...new Set(entries.flatMap((entry) => entry.known_gaps))],
    comparator: entries.map((entry) => entry.comparator).find(Boolean),
  }
}

function utcTimestamp(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T00:00:00.000Z`
  if (/^\d{4}-\d{2}$/.test(value)) return `${value}-01T00:00:00.000Z`
  if (/^\d{4}$/.test(value)) return `${value}-01-01T00:00:00.000Z`
  return value
}

function evidence(result: QuerySpatialResult, queryId: string): EvidenceRef {
  if (result.dataset_versions) return {
    queryId, generatedAt: result.generated_at,
    sourceIds: [...new Set(result.dataset_versions.flatMap(v => v.sourceIds))],
    datasetVersions: result.dataset_versions,
  }
  const entityIds = new Set(result.entities)
  const versions = MANIFEST_VERSIONS.filter((version) =>
    version.entityIds.some((entityId) => entityIds.has(entityId)),
  )
  const versionedEntities = new Set(versions.flatMap((version) => version.entityIds))
  const unversionedEntities = result.entities.filter((entityId) => !versionedEntities.has(entityId))
  if (unversionedEntities.length > 0) {
    throw new ApiError(
      422,
      `a persistent live view requires an immutable Dataset Version for every result entity; unversioned: ${unversionedEntities.join(', ')}`,
    )
  }
  const ontologySources = ONTOLOGY.entities
    .filter((entity) => entityIds.has(entity.id))
    .flatMap((entity) => entity.source_ids)
  const sources = [...new Set([...ontologySources, ...versions.flatMap((version) => version.sourceIds)])].sort()
  const generatedAt = result.generated_at
  const completeness = combinedCompleteness(result)
  return {
    queryId,
    generatedAt,
    sourceIds: sources,
    datasetVersions: versions.map((version) => ({
      datasetId: version.datasetId,
      versionId: version.versionId,
      country: version.country,
      sourceIds: version.sourceIds,
      vintage: version.vintage,
      refreshedAt: utcTimestamp(version.refreshedAt),
      checksum: version.checksum,
      completeness,
    })),
  }
}

function cameraFrom(args: JsonObject, result: QuerySpatialResult, requested?: MapCamera): MapCamera {
  if (requested) return requested
  const origin = isJsonObject(args.origin) ? args.origin : null
  if (origin && isJsonNumber(origin.lng) && isJsonNumber(origin.lat)) {
    return { center: [origin.lng, origin.lat], zoom: 12 }
  }
  const bbox = Array.isArray(args.bbox) ? args.bbox : null
  if (bbox?.length === 4 && bbox.every(isJsonNumber)) {
    return { center: [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2], zoom: 9 }
  }
  return cameraForPoints(rowsFromViewResult(result)) ?? DEFAULT_CAMERA
}

function buildSpec(
  id: string,
  queryId: string,
  checksum: string,
  result: QuerySpatialResult,
  presentation: DataViewPresentation,
  args: JsonObject,
  warnings: string[],
): DataViewSpec {
  const base = {
    version: 1 as const,
    id,
    country: MANIFEST_COUNTRY,
    title: presentation.title,
    description: presentation.description,
    data: {
      queryId,
      resultChecksum: checksum,
      rowCount: result.features.length || (result.aggregates ? 1 : 0),
    },
    evidence: evidence(result, queryId),
    theme: 'developing-country/v1' as const,
    createdAt: result.generated_at,
  }
  if (presentation.kind === 'map') {
    const annotations = checkedAnnotations(presentation)
    const view: MapViewSpec = {
      ...base,
      kind: 'map',
      camera: cameraFrom(args, result, presentation.camera),
      layers: composeMapLayers(result, presentation, warnings),
      ...(annotations ? { annotations } : {}),
    }
    return view
  }
  const view: ChartViewSpec = {
    ...base,
    kind: 'chart',
    intent: {
      family: presentation.family,
      dimension: presentation.dimension,
      measure: presentation.measure,
      series: presentation.series,
    },
    presentation: {
      orientation: presentation.orientation,
      stacked: presentation.stacked,
      showLegend: presentation.show_legend,
      highlight: checkedHighlight(presentation, result),
    },
  }
  return view
}

function publicViewOrigin(env: Env): string {
  const raw = env.PUBLIC_VIEW_ORIGIN?.trim() || DEFAULT_DATA_VIEW_ORIGIN
  try {
    const parsed = new URL(raw)
    if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
      throw new Error('origin contains a path, query, fragment, or credentials')
    }
    return parsed.origin
  } catch {
    throw new ApiError(500, 'PUBLIC_VIEW_ORIGIN must be a valid origin without a path, query, fragment, or credentials')
  }
}

function viewUrl(env: Env, id: string): string {
  return dataViewUrl(publicViewOrigin(env), id)
}

function resultHash(checksum: string): string {
  return checksum.replace(/^sha256:/, '')
}

function resultUrl(env: Env, id: string, checksum: string): string {
  const origin = publicViewOrigin(env)
  return `${origin}/api/views/${id}/result/${resultHash(checksum)}.json`
}

function resultPayload(result: QuerySpatialResult): { json: string; bytes: number; inline: string | null } {
  const json = canonicalJson(result)
  const bytes = new TextEncoder().encode(json).byteLength
  if (bytes > MAX_STORED_RESULT_BYTES) {
    throw new ApiError(413, JSON.stringify({
      error: 'snapshot_too_large',
      limit_bytes: MAX_STORED_RESULT_BYTES,
      bytes,
      message:
        `live view result exceeds the ${MAX_STORED_RESULT_BYTES / 1024 / 1024} MiB snapshot limit (${bytes} bytes); ` +
        'select fewer fields, lower limit, narrow the where clause, or aggregate with group_by',
    }))
  }
  return { json, bytes, inline: bytes <= MAX_INLINE_RESULT_BYTES ? json : null }
}

function resultPath(id: string, checksum: string): string {
  return `views/${id}/result-${resultHash(checksum)}.json`
}

function validateChartFields(presentation: DataViewPresentation, result: QuerySpatialResult): void {
  if (presentation.kind !== 'chart') return
  const rows = rowsFromViewResult(result)
  if (rows.length === 0) throw new ApiError(422, 'a chart view requires at least one result row')
  const has = (field: string) => rows.some((row) => Object.hasOwn(row, field))
  if (!has(presentation.dimension.field)) {
    throw new ApiError(422, `chart dimension field does not exist in the result: ${presentation.dimension.field}`)
  }
  if (!rows.some((row) => typeof row[presentation.measure.field] === 'number' && Number.isFinite(row[presentation.measure.field]))) {
    throw new ApiError(422, `chart measure field has no finite numeric values: ${presentation.measure.field}`)
  }
  if (presentation.series && !has(presentation.series.field)) {
    throw new ApiError(422, `chart series field does not exist in the result: ${presentation.series.field}`)
  }
}

interface DataViewUsage {
  owner_views: number
  owner_bytes: number
  recent_views: number
  platform_views: number
  platform_bytes: number
  platform_inline_bytes: number
}

function configuredLimit(raw: string | undefined, fallback: number): number {
  const value = Number(raw?.trim())
  return raw?.trim() && Number.isInteger(value) && value >= 1
    ? Math.min(value, MAX_CONFIGURED_VIEWS_PER_HOUR)
    : fallback
}

/** Named editors (VIEW_EDITOR_EMAILS) and the local DEV_AUTH user author multi-figure articles. */
export function isViewEditor(env: Env, identity: Identity): boolean {
  if (identity.mode === 'dev') return true
  const email = identity.email.trim().toLowerCase()
  return (env.VIEW_EDITOR_EMAILS ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .some((entry) => entry.length > 0 && entry === email)
}

export function hourlyViewLimit(env: Env, identity: Identity): number {
  const standard = configuredLimit(env.VIEW_HOURLY_LIMIT, DEFAULT_VIEWS_PER_HOUR)
  if (!isViewEditor(env, identity)) return standard
  return Math.max(standard, configuredLimit(env.VIEW_EDITOR_HOURLY_LIMIT, DEFAULT_EDITOR_VIEWS_PER_HOUR))
}

interface EvictableView {
  id: string
  result_bytes: number
}

/**
 * Make room for one more view by revoking the owner's oldest live views until
 * the per-owner count and byte caps fit. A saved view is a convenience link, so
 * a full account keeps working instead of failing every save.
 */
async function evictOldestViews(
  env: Env,
  ownerEmail: string,
  ownerViews: number,
  ownerBytes: number,
  nextBytes: number,
): Promise<number> {
  const { results } = await env.DB.prepare(
    `SELECT id, result_bytes FROM data_views
     WHERE owner_email = ?1 AND revoked_at IS NULL
     ORDER BY created_at ASC, id ASC`,
  )
    .bind(ownerEmail)
    .all<EvictableView>()
  let views = ownerViews
  let bytes = ownerBytes
  let evicted = 0
  const revokedAt = new Date().toISOString()
  for (const view of results) {
    if (views < MAX_VIEWS_PER_OWNER && bytes + nextBytes <= MAX_BYTES_PER_OWNER) break
    if (await revokeOwnedView(env, ownerEmail, view.id, revokedAt)) {
      views -= 1
      bytes -= Number(view.result_bytes)
      evicted += 1
    }
  }
  if (evicted > 0) console.log(JSON.stringify({ op: 'data_view_evict_oldest', evicted }))
  return evicted
}

async function assertStorageQuota(
  env: Env,
  ownerEmail: string,
  hourlyLimit: number,
  nextBytes: number,
  nextInlineBytes: number,
  evictWhenFull: boolean,
): Promise<void> {
  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const usage = await env.DB.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN owner_email = ?1 AND revoked_at IS NULL THEN 1 ELSE 0 END), 0) AS owner_views,
       COALESCE(SUM(CASE WHEN owner_email = ?1 AND revoked_at IS NULL THEN result_bytes ELSE 0 END), 0) AS owner_bytes,
       COALESCE(SUM(CASE WHEN owner_email = ?1 AND created_at >= ?2 THEN 1 ELSE 0 END), 0) AS recent_views,
       COALESCE(SUM(CASE WHEN revoked_at IS NULL THEN 1 ELSE 0 END), 0) AS platform_views,
       COALESCE(SUM(CASE WHEN revoked_at IS NULL THEN result_bytes ELSE 0 END), 0) AS platform_bytes,
       COALESCE(SUM(CASE WHEN revoked_at IS NULL AND result_json IS NOT NULL THEN result_bytes ELSE 0 END), 0) AS platform_inline_bytes
     FROM data_views`,
  )
    .bind(ownerEmail, cutoff)
    .first<DataViewUsage>()
  if (!usage) throw new ApiError(503, 'live view storage usage is unavailable')
  if (Number(usage.recent_views) >= hourlyLimit) {
    throw new ApiError(429, `live view creation is limited to ${hourlyLimit} per hour for this account`)
  }
  const ownerFull = () =>
    Number(usage.owner_views) >= MAX_VIEWS_PER_OWNER || Number(usage.owner_bytes) + nextBytes > MAX_BYTES_PER_OWNER
  if (ownerFull() && evictWhenFull) {
    await evictOldestViews(env, ownerEmail, Number(usage.owner_views), Number(usage.owner_bytes), nextBytes)
    return assertStorageQuota(env, ownerEmail, hourlyLimit, nextBytes, nextInlineBytes, false)
  }
  if (ownerFull()) {
    throw new ApiError(429, 'your live view storage quota is full; revoke an old view before creating another')
  }
  if (Number(usage.platform_views) >= MAX_PLATFORM_VIEWS || Number(usage.platform_bytes) + nextBytes > MAX_PLATFORM_BYTES) {
    throw new ApiError(503, 'the public live view storage budget is currently full')
  }
  if (Number(usage.platform_inline_bytes) + nextInlineBytes > MAX_PLATFORM_INLINE_BYTES) {
    throw new ApiError(503, 'the D1 live view storage budget is currently full')
  }
}

function parsedDatasetVersionIds(row: DataViewRow): string[] | null {
  try {
    const value: unknown = JSON.parse(row.dataset_version_ids)
    return Array.isArray(value) && value.every((entry) => typeof entry === 'string') ? value : null
  } catch {
    return null
  }
}

function storedSpec(row: DataViewRow): DataViewSpec | null {
  try {
    const input: JsonValue = JSON.parse(row.spec_json)
    const checked = validateDataViewSpec(input)
    if (!checked.ok) return null
    const spec = checked.value
    const datasetVersionIds = parsedDatasetVersionIds(row)
    const expectedVersionIds = spec.evidence.datasetVersions.map((version) => version.versionId)
    if (
      !isCountryCode(row.country) ||
      spec.id !== row.id ||
      spec.kind !== row.kind ||
      spec.country !== row.country ||
      spec.title !== row.title ||
      spec.createdAt !== row.created_at ||
      spec.evidence.generatedAt !== spec.createdAt ||
      spec.data.queryId !== row.query_id ||
      spec.evidence.queryId !== row.query_id ||
      spec.data.resultChecksum !== row.result_checksum ||
      spec.data.rowCount !== row.row_count ||
      spec.evidence.datasetVersions.some((version) => version.country !== spec.country) ||
      !datasetVersionIds ||
      canonicalJson(datasetVersionIds) !== canonicalJson(expectedVersionIds) ||
      !Number.isInteger(row.result_bytes) ||
      row.result_bytes < 0 ||
      row.result_bytes > MAX_STORED_RESULT_BYTES ||
      (row.result_path !== null && row.result_path !== resultPath(row.id, row.result_checksum))
    ) return null
    return spec
  } catch {
    return null
  }
}

export async function createDataView(
  env: Env,
  identity: Identity | null,
  rawPresentation: JsonValue,
  args: JsonObject,
  result: QuerySpatialResult,
): Promise<DataViewDocument> {
  if (!identity) throw new ApiError(401, 'sign in to create a persistent live view')
  if (!identity.emailVerified) {
    throw new ApiError(403, 'persistent live views require a verified account; sign in with Google or GitHub')
  }
  // Validate deployment configuration before allocating an id or touching R2/D1.
  publicViewOrigin(env)
  const parsed = validateDataViewPresentation(rawPresentation)
  if (!parsed.ok) throw new ApiError(400, JSON.stringify({ error: 'invalid_presentation', issues: parsed.issues }))
  const id = newId('view')
  const queryId = newId('query')
  const stored = resultPayload(result)
  validateChartFields(parsed.value, result)
  const checksum = await sha256(result)
  const warnings: string[] = []
  const spec = buildSpec(id, queryId, checksum, result, parsed.value, args, warnings)
  const checked = validateDataViewSpec(spec)
  if (!checked.ok) throw new ApiError(500, `generated invalid live view: ${checked.issues.join('; ')}`)
  const visibility = parsed.value.visibility ?? 'link'
  const path = stored.inline === null ? resultPath(id, checksum) : null
  const datasetVersionIds = checked.value.evidence.datasetVersions.map((version) => version.versionId)
  const ownerEmail = identity.email.toLowerCase()
  // Editors' views back published articles, so they are never evicted.
  const evictWhenFull = !isViewEditor(env, identity)
  await assertStorageQuota(env, ownerEmail, hourlyViewLimit(env, identity), stored.bytes, stored.inline === null ? 0 : stored.bytes, evictWhenFull)
  if (path) {
    await env.VIEWS.put(path, stored.json, {
      httpMetadata: {
        contentType: 'application/json; charset=utf-8',
        cacheControl: 'public, max-age=300, must-revalidate',
      },
      customMetadata: { checksum, viewId: id },
    })
  }
  try {
    await env.DB.prepare(
      `INSERT INTO data_views
        (id, query_id, owner_email, visibility, kind, country, title, spec_json,
         result_json, result_path, result_bytes, result_checksum, dataset_version_ids,
         row_count, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)`,
    )
      .bind(
        id,
        queryId,
        ownerEmail,
        visibility,
        checked.value.kind,
        checked.value.country,
        checked.value.title,
        JSON.stringify(checked.value),
        stored.inline,
        path,
        stored.bytes,
        checksum,
        JSON.stringify(datasetVersionIds),
        checked.value.data.rowCount,
        checked.value.createdAt,
      )
      .run()
  } catch (error) {
    if (path) await env.VIEWS.delete(path).catch(() => undefined)
    throw error
  }
  return {
    view: checked.value,
    result,
    result_url: resultUrl(env, id, checksum),
    view_url: viewUrl(env, id),
    ...(warnings.length > 0 ? { warnings } : {}),
  }
}

export async function getDataView(env: Env, id: string): Promise<DataViewDocument | null> {
  const row = await env.DB.prepare(
    `SELECT * FROM data_views WHERE id = ?1 AND visibility IN ('link', 'public') LIMIT 1`,
  )
    .bind(id)
    .first<DataViewRow>()
  if (!row) return null
  const spec = storedSpec(row)
  if (!spec) return null
  try {
    if (row.revoked_at) {
      return {
        view: spec,
        result: null,
        result_url: resultUrl(env, row.id, row.result_checksum),
        view_url: viewUrl(env, row.id),
        revoked_at: row.revoked_at,
      }
    }
    const result = row.result_json ? JSON.parse(row.result_json) as QuerySpatialResult : null
    if (result) {
      const bytes = new TextEncoder().encode(row.result_json ?? '').byteLength
      if (bytes !== row.result_bytes || await sha256(result) !== row.result_checksum) return null
    }
    return {
      view: spec,
      result,
      result_url: resultUrl(env, row.id, row.result_checksum),
      view_url: viewUrl(env, row.id),
    }
  } catch {
    return null
  }
}

export async function getDataViewResult(
  env: Env,
  id: string,
  hash: string,
  ifNoneMatch?: string | null,
): Promise<Response | null> {
  if (!/^[a-f0-9]{64}$/.test(hash)) return null
  const row = await env.DB.prepare(
    `SELECT *
     FROM data_views WHERE id = ?1 AND visibility IN ('link', 'public') LIMIT 1`,
  )
    .bind(id)
    .first<DataViewRow>()
  if (!row || resultHash(row.result_checksum) !== hash) return null
  if (!storedSpec(row)) return null
  if (row.revoked_at) {
    return new Response(JSON.stringify({ error: 'live view revoked', revoked_at: row.revoked_at }), {
      status: 410,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store' },
    })
  }

  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=300, must-revalidate',
    'Access-Control-Allow-Origin': '*',
    ETag: `"${row.result_checksum}"`,
  })
  if (ifNoneMatch === headers.get('ETag')) return new Response(null, { status: 304, headers })
  if (row.result_path) {
    const object = await env.VIEWS.get(row.result_path)
    if (!object) return null
    if (
      object.size !== row.result_bytes ||
      object.customMetadata?.checksum !== row.result_checksum ||
      object.customMetadata?.viewId !== row.id
    ) return null
    headers.set('Content-Length', String(object.size))
    return new Response(object.body, { headers })
  }
  if (!row.result_json) return null
  if (new TextEncoder().encode(row.result_json).byteLength !== row.result_bytes) return null
  try {
    if (await sha256(JSON.parse(row.result_json) as JsonValue) !== row.result_checksum) return null
  } catch {
    return null
  }
  headers.set('Content-Length', String(row.result_bytes))
  return new Response(row.result_json, { headers })
}

export async function revokeDataView(env: Env, identity: Identity, id: string): Promise<boolean> {
  return revokeOwnedView(env, identity.email.toLowerCase(), id, new Date().toISOString())
}

/**
 * Tombstone one live view. The claim (spec, checksum, dataset versions) stays;
 * the result payload goes, inline or in R2, since nothing serves it again.
 */
async function revokeOwnedView(env: Env, ownerEmail: string, id: string, revokedAt: string): Promise<boolean> {
  const owned = await env.DB.prepare(
    `SELECT result_path FROM data_views
     WHERE id = ?1 AND owner_email = ?2 AND revoked_at IS NULL LIMIT 1`,
  )
    .bind(id, ownerEmail)
    .first<Pick<DataViewRow, 'result_path'>>()
  if (!owned) return false
  const result = await env.DB.prepare(
    `UPDATE data_views SET revoked_at = ?1,
       result_json = CASE WHEN result_json IS NULL THEN NULL ELSE '' END
     WHERE id = ?2 AND owner_email = ?3 AND revoked_at IS NULL`,
  )
    .bind(revokedAt, id, ownerEmail)
    .run()
  const revoked = Number(result.meta.changes ?? 0) > 0
  if (revoked && owned.result_path) {
    let lastError: unknown
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await env.VIEWS.delete(owned.result_path)
        lastError = undefined
        break
      } catch (error) {
        lastError = error
      }
    }
    if (lastError) {
      // The D1 tombstone is authoritative, so the object is no longer
      // reachable even if R2 cleanup exhausts its bounded retries.
      console.log(JSON.stringify({ op: 'data_view_revoke_r2_delete_failed', id, attempts: 3, error: String(lastError) }))
    }
  }
  return revoked
}
