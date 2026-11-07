import { PUBLISHER_TYPES, isPublisherTypeId, isPublicDataThemeId, publicDataTheme } from './datasets'

export const CLAIM_STATUSES = {
  awaiting_data: 'Awaiting data',
  supported: 'Supported by evidence',
  contradicted: 'Contradicted by evidence',
  mixed: 'Mixed evidence',
} as const
export const GAP_STATUSES = {
  not_public: 'Not publicly located',
  partial: 'Partial data available',
  requested: 'Data requested',
  available: 'Data available',
} as const
export type ClaimStatus = keyof typeof CLAIM_STATUSES
export type GapStatus = keyof typeof GAP_STATUSES
export interface SourceLink { title: string; url: string; note?: string }
export interface DataGap {
  id: string
  title: string
  summary: string
  country: string
  themeIds: string[]
  themes: ReturnType<typeof publicDataTheme>[]
  publisher: { id: string; name: string; type: typeof PUBLISHER_TYPES[number] }
  status: GapStatus
  neededFields: string
  availableEvidence: string
  nextSteps: string
  checkedAt: string
  sources: SourceLink[]
}
export function jsonValue(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { return undefined }
}
export function record(value: unknown): Record<string, unknown> {
  const parsed = jsonValue(value)
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
}
export function strings(value: unknown): string[] {
  const parsed = jsonValue(value)
  return Array.isArray(parsed) ? [...new Set(parsed.filter((v): v is string => typeof v === 'string' && v.trim().length > 0))] : []
}
export function httpsLink(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim() !== value) return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined
  } catch { return undefined }
}
export function sourceLinks(value: unknown): SourceLink[] {
  const parsed = jsonValue(value)
  if (!Array.isArray(parsed)) return []
  return parsed.flatMap((item) => {
    const data = record(item)
    const url = httpsLink(data.url)
    return typeof data.title === 'string' && url ? [{ title: data.title, url, note: typeof data.note === 'string' ? data.note : undefined }] : []
  })
}
export function gapFields(id: string, value: unknown): DataGap | null {
  const data = record(value)
  const required = ['title', 'summary', 'country_code', 'publisher_id', 'publisher_name', 'needed_fields', 'available_evidence', 'next_steps', 'checked_at']
  if (required.some((key) => typeof data[key] !== 'string' || !(data[key] as string).trim())) return null
  if (typeof data.publisher_type !== 'string' || !isPublisherTypeId(data.publisher_type)) return null
  if (typeof data.availability !== 'string' || !Object.hasOwn(GAP_STATUSES, data.availability)) return null
  if (Number.isNaN(Date.parse(String(data.checked_at)))) return null
  const themeIds = strings(data.theme_ids).filter(isPublicDataThemeId)
  if (!themeIds.length) return null
  return {
    id, title: String(data.title), summary: String(data.summary), country: String(data.country_code),
    themeIds, themes: themeIds.map(publicDataTheme),
    publisher: { id: String(data.publisher_id), name: String(data.publisher_name), type: PUBLISHER_TYPES.find((type) => type.id === data.publisher_type)! },
    status: data.availability as GapStatus,
    neededFields: String(data.needed_fields), availableEvidence: String(data.available_evidence),
    nextSteps: String(data.next_steps), checkedAt: String(data.checked_at), sources: sourceLinks(data.source_manifest),
  }
}
export interface ClaimLink { id: string; title: string; href: string; missingDataIds: string[]; countryCode: string; summary?: string; sourceTitle?: string; sourceUrl?: string }
/** Call with published CMS entries only. References are CMS content IDs, never hand-written URLs. */
export function linkedGaps(gaps: DataGap[], claims: ClaimLink[]) {
  return gaps.flatMap((gap) => {
    const linkedClaims = claims.filter((claim) => claim.countryCode === gap.country && claim.missingDataIds.includes(gap.id))
    return linkedClaims.length ? [{ gap, claims: linkedClaims }] : []
  })
}
