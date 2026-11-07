import { CLAIM_STATUSES, httpsLink, strings, type ClaimStatus } from './claims'
/** Runtime boundary between database-defined EmDash fields and page templates. */

export interface PageFields {
  id: string
  title: string
  description?: string
  content: unknown
}

export interface ArticleFields {
  id: string
  title: string
  dek?: string
  format: 'analysis' | 'dataset_note'
  analysisKind: 'essay' | 'tracked_claim'
  claimStatus?: ClaimStatus
  claimSourceUrl?: string
  claimSourceTitle?: string
  claimReportedAt?: Date
  missingDataIds: string[]
  datasetId?: string
  datasetPreviewUrl?: string
  content: unknown
  countryCode: string
  researchQuestion?: string
  methodology?: string
  evidenceBundle?: unknown
  sourceManifest?: unknown
  primaryViewUrl?: string
  publishedAt?: Date
  updatedAt: Date
  createdAt: Date
}

export interface CountryFields {
  id: string
  name: string
  code: string
  strapline?: string
  content: unknown
  platformUrl?: string
  featuredViewUrl?: string
  coverageNote?: string
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value : fallback
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function date(value: unknown): Date | undefined {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.valueOf())) return parsed
  }
  return undefined
}

export function pageFields(value: unknown): PageFields {
  const data = record(value)
  return {
    id: text(data.id),
    title: text(data.title, 'Untitled page'),
    description: optionalText(data.description),
    content: data.content ?? [],
  }
}

export function articleFields(value: unknown): ArticleFields {
  const data = record(value)
  const createdAt = date(data.createdAt) ?? new Date(0)
  const format = data.format === 'dataset_note' ? 'dataset_note' : 'analysis'
  return {
    id: text(data.id),
    title: text(data.title, 'Untitled analysis'),
    dek: optionalText(data.dek),
    format,
    analysisKind: data.analysis_kind === 'tracked_claim' ? 'tracked_claim' : 'essay',
    claimStatus: typeof data.claim_status === 'string' && Object.hasOwn(CLAIM_STATUSES, data.claim_status) ? data.claim_status as ClaimStatus : undefined,
    claimSourceUrl: httpsLink(data.claim_source_url),
    claimSourceTitle: optionalText(data.claim_source_title),
    claimReportedAt: date(data.claim_reported_at),
    missingDataIds: strings(data.missing_data),
    datasetId: optionalText(data.dataset_id),
    datasetPreviewUrl: optionalText(data.dataset_preview_url),
    content: data.content ?? [],
    countryCode: text(data.country_code, 'LK').toUpperCase(),
    researchQuestion: optionalText(data.research_question),
    methodology: optionalText(data.methodology),
    evidenceBundle: data.evidence_bundle,
    sourceManifest: data.source_manifest,
    primaryViewUrl: optionalText(data.primary_view_url),
    publishedAt: date(data.publishedAt),
    updatedAt: date(data.updatedAt) ?? createdAt,
    createdAt,
  }
}

export function countryFields(value: unknown): CountryFields {
  const data = record(value)
  return {
    id: text(data.id),
    name: text(data.name, 'Unnamed country'),
    code: text(data.code).toUpperCase(),
    strapline: optionalText(data.strapline),
    content: data.content ?? [],
    platformUrl: optionalText(data.platform_url),
    featuredViewUrl: optionalText(data.featured_view_url),
    coverageNote: optionalText(data.coverage_note),
  }
}
