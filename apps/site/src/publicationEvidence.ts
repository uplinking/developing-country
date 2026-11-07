import { CLAIM_STATUSES, strings } from './lib/claims'
import { isDataViewUrl } from '@developing-country/views'
import { INTERACTIVE_BLOCK_TYPES, parseUnderlayUrls, viewUrlsInContent } from '@developing-country/emdash-blocks/figure-blocks'
import { datasetNotes, isDatasetId, isDatasetPreviewUrl } from './lib/datasets'

export interface PublicationIssue {
  path: string
  message: string
}

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/
const ISO_DATE = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/
const DATASET_VERSION = /^dsv_[0-9a-f]{32}$/
const CHECKSUM = /^sha256:[0-9a-f]{64}$/

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function jsonValue(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) as unknown } catch { return undefined }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function exactText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value === value.trim()
}

function isoTimestamp(value: unknown): value is string {
  if (!exactText(value) || !ISO_TIMESTAMP.test(value)) return false
  const instant = new Date(value)
  if (Number.isNaN(instant.getTime())) return false
  return value.length === 20
    ? instant.toISOString().replace('.000Z', 'Z') === value
    : instant.toISOString() === value
}

/** Dataset freshness preserves the source's honest YYYY, YYYY-MM, or YYYY-MM-DD precision. */
function isoCalendarDate(value: unknown): value is string {
  if (!exactText(value)) return false
  const match = ISO_DATE.exec(value)
  if (!match || match[1] === '0000') return false
  const month = match[2] === undefined ? undefined : Number(match[2])
  const day = match[3] === undefined ? undefined : Number(match[3])
  if (month === undefined) return true
  if (month < 1 || month > 12) return false
  if (day === undefined) return true
  const year = Number(match[1])
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return day >= 1 && day <= days[month - 1]!
}

function datasetRefreshDate(value: unknown): value is string {
  return isoCalendarDate(value) || isoTimestamp(value)
}

function httpsUrl(value: unknown): boolean {
  if (typeof value !== 'string' || value !== value.trim() || /[\s@]/.test(value)) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && /[a-z0-9]/i.test(url.hostname) && !url.username && !url.password
  } catch {
    return false
  }
}

function canonicalViewUrl(value: unknown): value is string {
  return exactText(value) && isDataViewUrl(value)
}

function liveViewUrl(block: Record<string, unknown>): unknown {
  return block.view_url ?? block.url ?? block.id ?? ''
}

const INTERACTIVE_TYPES = new Set<string>(INTERACTIVE_BLOCK_TYPES)

/**
 * Interactive blocks (ADR 0009): every view URL a block carries — including each
 * dcScrolly step, via the shared `viewUrlsInContent` — must be canonical and
 * evidenced. Unlike dcLiveView, interactive blocks may reuse one view (a stat
 * and a figure can bind the same view; consecutive scrolly steps usually do).
 */
function interactiveBlockIssues(
  block: Record<string, unknown>,
  index: number,
  referencedViews: Set<string>,
  add: (path: string, message: string) => void,
): void {
  const type = typeof block._type === 'string' ? block._type : ''
  if (!INTERACTIVE_TYPES.has(type)) return
  const at = `content[${index}]`
  const checkUrl = (url: unknown, path: string) => {
    if (!canonicalViewUrl(url)) add(path, 'must be a canonical developing-country Data View URL')
    else if (!referencedViews.has(url)) add(path, 'must appear in evidence_bundle.dataViews')
  }
  // Underlays (dcFigure and scrolly steps) are views too: canonical and evidenced.
  const checkUnderlays = (value: unknown, path: string) => {
    if (value === undefined || value === null || value === '') return
    if (typeof value !== 'string') { add(path, 'must be a comma-separated list of Data View URLs'); return }
    for (const url of parseUnderlayUrls(value)) checkUrl(url, path)
  }
  if (type === 'dcFigure') checkUnderlays(block.underlay_urls, `${at}.underlay_urls`)
  if (type === 'dcScrolly') {
    const steps = Array.isArray(block.steps) ? block.steps : []
    if (steps.length === 0) add(`${at}.steps`, 'must contain at least one step')
    steps.forEach((step, stepIndex) => {
      const value = record(step)
      const path = `${at}.steps[${stepIndex}]`
      if (!value) { add(path, 'must be an object'); return }
      // viewUrlsInContent yields the step view first, then its underlays.
      const urls = viewUrlsInContent([{ _type: 'dcScrolly', steps: [value] }])
      if (!text(value.view_url) || urls.length === 0) add(`${path}.view_url`, 'is required')
      else checkUrl(value.view_url, `${path}.view_url`)
      if (!text(value.text)) add(`${path}.text`, 'is required')
      checkUnderlays(value.underlay_urls, `${path}.underlay_urls`)
    })
    return
  }
  const urls = viewUrlsInContent([block])
  if (!text(block.view_url) || urls.length === 0) add(`${at}.view_url`, 'is required')
  else checkUrl(block.view_url, `${at}.view_url`)
  if ((type === 'dcStat' || type === 'dcGuess') && !text(block.field) && block.aggregate !== 'count') add(`${at}.field`, 'is required')
  if (type === 'dcStat' && !text(block.label)) add(`${at}.label`, 'is required')
  if (type === 'dcGuess') {
    if (!text(block.guess_id)) add(`${at}.guess_id`, 'is required')
    if (!text(block.question)) add(`${at}.question`, 'is required')
    const min = Number(block.min)
    const max = Number(block.max)
    if (block.min === '' || block.max === '' || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
      add(`${at}.max`, 'must be a number greater than min')
    }
  }
  if (type === 'dcExplorer') {
    if (!text(block.title_field)) add(`${at}.title_field`, 'is required')
    const metrics = Array.isArray(block.metrics) ? block.metrics.map(record) : []
    if (metrics.length === 0 || metrics.some((metric) => !metric || !text(metric.field))) {
      add(`${at}.metrics`, 'must list at least one metric, each with a field')
    }
  }
}

/** Validate the exact article candidate that would become the live revision. */
export function publicationIssues(input: unknown): PublicationIssue[] {
  const article = record(input)
  if (!article) return [{ path: '$', message: 'article data must be an object' }]
  const issues: PublicationIssue[] = []
  const add = (path: string, message: string) => issues.push({ path, message })

  const format = exactText(article.format) ? article.format : ''
  if (format !== 'analysis' && format !== 'dataset_note') {
    add('format', 'must be analysis or dataset_note')
  }
  const datasetId = article.dataset_id
  if (format === 'dataset_note' && !exactText(datasetId)) {
    add('dataset_id', 'is required for dataset notes')
  } else if (datasetId !== undefined && datasetId !== null && datasetId !== '' && !exactText(datasetId)) {
    add('dataset_id', 'must be an unpadded string ID')
  }
  if (format === 'dataset_note' && exactText(datasetId)) {
    if (!isDatasetId(datasetId)) {
      add('dataset_id', 'must identify a registered dataset')
    } else {
      const preview = article.dataset_preview_url
      const hasPreview = preview !== undefined && preview !== null && preview !== ''
      if (hasPreview && !isDatasetPreviewUrl(datasetId, preview)) {
        add('dataset_preview_url', 'must match the registered interactive preview for this dataset')
      }
      const registered = datasetNotes.find((dataset) => dataset.id === datasetId)
      if (registered?.preview && !hasPreview) {
        add('dataset_preview_url', 'is required for datasets with an interactive preview')
      }
      if (!registered?.preview && hasPreview) {
        add('dataset_preview_url', 'must be empty for datasets without an interactive preview')
      }
    }
  } else if (article.dataset_preview_url !== undefined && article.dataset_preview_url !== null && article.dataset_preview_url !== '') {
    add('dataset_preview_url', 'is only valid for dataset notes')
  }
  const country = exactText(article.country_code) ? article.country_code : ''
  if (country !== 'LK') add('country_code', 'must be a registered country code (currently LK)')
  if (text(article.research_question).length < 12) add('research_question', 'must state the question being investigated')
  if (text(article.methodology).length < 20) add('methodology', 'must explain how the evidence was selected and analysed')

  const bundle = record(jsonValue(article.evidence_bundle))
  const sourceManifest = jsonValue(article.source_manifest)
  const sources = Array.isArray(sourceManifest) ? sourceManifest.map(record) : []
  if (!bundle) add('evidence_bundle', 'must be a JSON object')
  if (!Array.isArray(sourceManifest) || sourceManifest.length === 0) {
    add('source_manifest', 'must contain at least one auditable source')
  }

  const sourceIds = new Set<string>()
  const auditableSourceIds = new Set<string>()
  sources.forEach((source, index) => {
    if (!source) {
      add(`source_manifest[${index}]`, 'must be an object')
      return
    }
    if (!text(source.title)) add(`source_manifest[${index}].title`, 'is required')
    const sourceIdValue = source.sourceId
    const sourceId = exactText(sourceIdValue) ? sourceIdValue : ''
    if (sourceIdValue !== undefined && !sourceId) {
      add(`source_manifest[${index}].sourceId`, 'must be a non-empty unpadded string ID')
    } else if (sourceId) {
      if (sourceIds.has(sourceId)) add(`source_manifest[${index}].sourceId`, 'must be unique')
      sourceIds.add(sourceId)
      if (httpsUrl(source.url)) auditableSourceIds.add(sourceId)
    }
    const sourceUrl = text(source.url)
    if (sourceUrl ? !httpsUrl(source.url) : text(source.type) !== 'platform-design') {
      add(`source_manifest[${index}].url`, 'must be HTTPS (design notes may omit it with type platform-design)')
    }
  })

  const tracked = article.analysis_kind === 'tracked_claim'
  if (article.analysis_kind != null && !['essay', 'tracked_claim'].includes(String(article.analysis_kind))) add('analysis_kind', 'must be essay or tracked_claim')
  if (tracked) {
    if (format !== 'analysis') add('analysis_kind', 'tracked claims belong to analysis')
    if (!Object.hasOwn(CLAIM_STATUSES, String(article.claim_status))) add('claim_status', 'must be a supported claim assessment')
    if (!httpsUrl(article.claim_source_url)) add('claim_source_url', 'must link to the original HTTPS report')
    if (!text(article.claim_source_title)) add('claim_source_title', 'must name the original report')
    if (!isoTimestamp(article.claim_reported_at)) add('claim_reported_at', 'must be the original report timestamp')
    if (!sources.some((source) => source?.url === article.claim_source_url)) add('source_manifest', 'must include the original report')
    const refs = jsonValue(article.missing_data)
    if (!Array.isArray(refs) || refs.some((id) => !exactText(id)) || strings(refs).length !== refs.length) add('missing_data', 'must contain unique CMS data-gap IDs')
    if (article.claim_status === 'awaiting_data' && strings(refs).length === 0) add('missing_data', 'awaiting-data claims must identify the missing records')
  }
  if (bundle?.kind === 'claim-review') {
    if (!tracked) add('evidence_bundle.kind', 'claim-review is only for tracked claims')
    if (article.claim_status !== 'awaiting_data') add('claim_status', 'a source-only review cannot verify or contradict a claim; supply platform-query evidence')
  }
  if (tracked && bundle?.kind !== 'claim-review' && bundle?.kind !== 'platform-query') add('evidence_bundle.kind', 'tracked claims require claim-review or platform-query evidence')

  const referencedViews = new Set<string>()
  if (bundle) {
    if (bundle.version !== 1) add('evidence_bundle.version', 'must equal 1')
    if (bundle.country !== country) add('evidence_bundle.country', 'must match country_code')
    const kind = text(bundle.kind)
    if (kind !== 'platform-query' && kind !== 'design-note' && kind !== 'claim-review') {
      add('evidence_bundle.kind', 'must be platform-query, design-note or claim-review')
    }
    if (!isoTimestamp(bundle.generatedAt)) add('evidence_bundle.generatedAt', 'must be a real UTC ISO timestamp')

    const versions = Array.isArray(bundle.datasetVersions) ? bundle.datasetVersions : []
    if (!Array.isArray(bundle.datasetVersions)) add('evidence_bundle.datasetVersions', 'must be an array')
    if (kind === 'platform-query' && versions.length === 0) {
      add('evidence_bundle.datasetVersions', 'platform-query articles require at least one Dataset Version')
    }
    const datasetIds = new Set<string>()
    const versionIds = new Set<string>()
    versions.forEach((value, index) => {
      const version = record(value)
      const path = `evidence_bundle.datasetVersions[${index}]`
      if (!version) { add(path, 'must be an object'); return }
      const datasetId = exactText(version.datasetId) ? version.datasetId : ''
      const versionId = exactText(version.versionId) ? version.versionId : ''
      if (!datasetId) add(`${path}.datasetId`, 'must be a non-empty unpadded ID')
      else if (datasetIds.has(datasetId)) add(`${path}.datasetId`, 'must be unique')
      else datasetIds.add(datasetId)
      if (!DATASET_VERSION.test(versionId)) add(`${path}.versionId`, 'must be an immutable unpadded dsv_ identifier')
      else if (versionIds.has(versionId)) add(`${path}.versionId`, 'must be unique')
      else versionIds.add(versionId)
      if (version.country !== country) add(`${path}.country`, 'must match the article country')
      if (!exactText(version.checksum) || !CHECKSUM.test(version.checksum)) add(`${path}.checksum`, 'must be an unpadded sha256 checksum')
      if (!text(version.vintage)) add(`${path}.vintage`, 'is required')
      if (!datasetRefreshDate(version.refreshedAt)) {
        add(`${path}.refreshedAt`, 'must be a real ISO source date or UTC timestamp')
      }
      const rawIds = Array.isArray(version.sourceIds) ? version.sourceIds : []
      const ids = rawIds.filter(exactText)
      if (ids.length === 0) add(`${path}.sourceIds`, 'must cite at least one Source')
      if (rawIds.some((id) => !exactText(id))) {
        add(`${path}.sourceIds`, 'must contain only non-empty unpadded string IDs')
      }
      const versionSourceIds = new Set<string>()
      for (const id of ids) {
        if (versionSourceIds.has(id)) {
          add(`${path}.sourceIds`, `source ${id} must not be repeated`)
          continue
        }
        versionSourceIds.add(id)
        if (!sourceIds.has(id)) add(`${path}.sourceIds`, `source ${id} is missing from source_manifest`)
        else if (!auditableSourceIds.has(id)) add(`${path}.sourceIds`, `source ${id} must have an HTTPS URL`)
      }
    })
    if (
      format === 'dataset_note'
      && exactText(datasetId)
      && isDatasetId(datasetId)
      && !datasetIds.has(datasetId)
    ) {
      add('evidence_bundle.datasetVersions', `must include the Dataset Version for ${datasetId}`)
    }

    const views = Array.isArray(bundle.dataViews) ? bundle.dataViews : []
    if (bundle.dataViews !== undefined && !Array.isArray(bundle.dataViews)) add('evidence_bundle.dataViews', 'must be an array')
    const viewUrls = new Set<string>()
    views.forEach((value, index) => {
      const view = record(value)
      const path = `evidence_bundle.dataViews[${index}]`
      if (!view) { add(path, 'must be an object'); return }
      const url = exactText(view.viewUrl) ? view.viewUrl : ''
      if (!canonicalViewUrl(url)) add(`${path}.viewUrl`, 'must be a canonical developing-country Data View URL')
      else if (viewUrls.has(url)) add(`${path}.viewUrl`, 'must be unique')
      else {
        viewUrls.add(url)
        referencedViews.add(url)
      }
      if (!exactText(view.queryId)) add(`${path}.queryId`, 'must be a non-empty unpadded ID')
      if (!exactText(view.resultChecksum) || !CHECKSUM.test(view.resultChecksum)) {
        add(`${path}.resultChecksum`, 'must be an unpadded sha256 checksum')
      }
    })
  }

  const primaryValue = article.primary_view_url
  const primaryView = primaryValue === undefined || primaryValue === null || primaryValue === ''
    ? ''
    : exactText(primaryValue) ? primaryValue : null
  if (primaryView === null) {
    add('primary_view_url', 'must be empty or an unpadded canonical Data View URL')
  } else if (primaryView) {
    if (!canonicalViewUrl(primaryView)) add('primary_view_url', 'must be a canonical developing-country Data View URL')
    else if (!referencedViews.has(primaryView)) add('primary_view_url', 'must appear in evidence_bundle.dataViews')
  }

  const content = jsonValue(article.content)
  if (!Array.isArray(content) || content.length === 0) add('content', 'must contain article content')
  for (const [index, value] of (Array.isArray(content) ? content : []).entries()) {
    const block = record(value)
    if (!block) continue
    if (block._type !== 'dcLiveView') {
      interactiveBlockIssues(block, index, referencedViews, add)
      continue
    }
    const url = liveViewUrl(block)
    if (!canonicalViewUrl(url)) {
      add(`content[${index}].view_url`, 'must be a canonical developing-country Data View URL')
    } else {
      // Views may be reused across blocks and with primary_view_url (migration 0063).
      if (!referencedViews.has(url)) add(`content[${index}].view_url`, 'must appear in evidence_bundle.dataViews')
    }
  }

  return issues
}

export function canPublishArticle(input: unknown): boolean {
  return publicationIssues(input).length === 0
}
