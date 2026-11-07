import { createHash } from 'node:crypto'
import { parseIndicatorTable } from '../../packages/datasets/src/table.ts'

export const sha256 = value => createHash('sha256').update(value).digest('hex')
export const normaliseText = text => text.replace(/[\u200b\u200c\u00ad]/g, '')
const token = String.raw`(?:[-−–]?\d[\d,]*(?:\.\d+)?%?|\([\d,]+(?:\.\d+)?\)|[-–—]|ND)`
const tail = new RegExp(String.raw`^(.*?)\s{2,}(${token}(?:\s+${token})*)\s*$`)
const bids = new RegExp(String.raw`^\s*(>=\s*10|\d+)\s{2,}(${token}(?:\s+${token})*)\s*$`)

export function extractCells(recipe, pages) {
  let tokens
  if (recipe.reviewed_cells) {
    if (!recipe.review_note || !Number.isInteger(recipe.row_index)) throw new Error('Reviewed cells require a review note and stable row index')
    tokens = recipe.reviewed_cells
  } else {
    const line = pages[recipe.page - 1]?.split(/\r?\n/)[recipe.line - 1]
    if (line === undefined || sha256(line) !== recipe.line_sha256) throw new Error(`Unreviewed text layout: ${recipe.document} page ${recipe.page} line ${recipe.line}`)
    const match = (recipe.dataset.endsWith('procurement-bids') ? bids : tail).exec(line)
    if (!match || match[1].trim() !== recipe.label) throw new Error(`Source label changed: ${recipe.label}`)
    tokens = match[2].trim().split(/\s+/)
  }
  if (tokens.length !== recipe.columns.length) throw new Error(`Column count changed: ${recipe.label}`)
  return tokens.map((raw, index) => {
    if (raw === '') return { value: null, value_status: 'source blank', source_value: recipe.reported_cells?.[index] ?? raw }
    if (!new RegExp(`^${token}$`).test(raw)) throw new Error(`Invalid numeric cell: ${raw}`)
    if (raw === 'ND' || /^[-–—]$/.test(raw)) return { value: null, value_status: raw === 'ND' ? 'not disclosed' : 'source dash', source_value: recipe.reported_cells?.[index] ?? raw }
    const value = Number(raw.replace(/[, %]/g, '').replace(/[−–]/g, '-').replace(/^\((.*)\)$/, '-$1'))
    if (!Number.isFinite(value)) throw new Error(`Invalid numeric cell: ${raw}`)
    return { value, value_status: 'reported', source_value: recipe.reported_cells?.[index] ?? raw }
  })
}

export function buildTable(definition, recipes, documents, texts) {
  const rows = recipes.filter(r => r.dataset === definition.id).flatMap(r => {
    const doc = documents.find(d => d.id === r.document)
    if (!doc || !texts.has(doc.id)) throw new Error(`Missing source ${r.document}`)
    return extractCells(r, normaliseText(texts.get(doc.id)).split('\f')).map((cell, i) => {
      const c = r.columns[i]
      return {
        record_id: `${doc.id}:${r.page}:${r.line ?? `reviewed-${r.row_index}`}:${i + 1}`,
        period: c.period, subject: r.subject, category: r.label,
        label: r.subject === r.label || r.dataset === 'treasury-public-debt' ? r.subject : `${r.subject} — ${r.label}`,
        metric: c.metric ?? r.metric, unit: c.unit, ...cell,
        reporting_period: r.reporting_period ?? doc.reporting_period ?? '',
        observation_role: (r.reporting_period ?? doc.reporting_period) ? (c.period === (r.reporting_period ?? doc.reporting_period) ? 'current edition period' : 'comparison period') : '', debt_scope: r.debt_scope ?? '',
        counterparty: r.counterparty ?? '', issue_date: r.issue_date ?? '', maturity_date: r.maturity_date ?? '', instrument_id: r.instrument_id ?? '',
        extraction_method: r.reviewed_cells ? 'reviewed cells' : 'verified text line', review_note: r.review_note ?? '',
        source_locator: r.source_locator ?? `PDF page ${r.page}, ${r.line ? `text line ${r.line}` : `reviewed row ${r.row_index}`}`,
        source_document: doc.url, source_sha256: doc.sha256, source_page: r.page, source_line: r.line,
      }
    })
  })
  if (!rows.length) throw new Error(`Empty dataset ${definition.id}`)
  const dimensions = ['record_id', 'period', 'subject', 'category', 'label', 'metric', 'unit', 'value_status', 'source_value', 'source_document', 'source_sha256', 'reporting_period', 'observation_role', 'debt_scope', 'counterparty', 'issue_date', 'maturity_date', 'instrument_id', 'extraction_method', 'review_note', 'source_locator']
  return parseIndicatorTable({
    schema_version: 1, dataset_id: definition.id, country: 'LK', source_ids: [definition.source],
    vintage: definition.vintage, title: definition.title, description: definition.description,
    grain: 'One reported numeric cell per source table row, period, metric and unit.',
    notes: ['PDF page numbers are 1-based physical pages, not printed page labels.', 'Source dashes and ND remain null, never inferred zero. Source totals and components overlap; value is not additive.'],
    caveats: [definition.caveat, 'Selected reviewed tables and rows; this is not a complete extraction of the publication or historical archive. Source footnotes and definitions remain authoritative.'],
    primary_key: ['record_id'],
    fields: [
      ...dimensions.map(id => ({ id, label: id.replaceAll('_', ' '), role: 'dimension', type: 'string' })),
      ...['source_page', 'source_line'].map(id => ({ id, label: id.replaceAll('_', ' '), role: 'dimension', type: 'integer' })),
      { id: 'value', label: 'Reported value', role: 'measure', type: 'number', unit: 'See unit field', aggregation: 'none' },
    ], rows,
  })
}

// Restrict traversal to Treasury publication content; never follow arbitrary page instructions.
export function publicationLinks(html, base) {
  // A firewall challenge or origin-error page is served with 200, so name it in the diagnostic.
  if (!html.includes('<div class="page-template--body"')) throw new Error(`Publication layout changed: ${base} (page title: ${html.match(/<title>([^<]*)/)?.[1]?.trim() || 'none'})`)
  const body = html.slice(html.indexOf('<div class="page-template--body"')).split('<footer')[0].split('footer--')[0]
  return [...new Set([...body.matchAll(/<a\b[^>]*href="([^"]+)"/g)].map(m => new URL(m[1].replaceAll('&amp;', '&'), base).href)
    .filter(url => url.startsWith('https://www.treasury.gov.lk/web/') || url.startsWith('https://www.treasury.gov.lk/api/file/')))]
}

export function assertReviewedLinks(found, known, context) {
  const unseen = found.filter(url => !known.includes(url))
  if (unseen.length) throw new Error(`New Treasury publication/edition needs review (${context}):\n${unseen.join('\n')}\nUse refresh-data; download and review the new tables before extending recipes. Freshness must not be stamped.`)
}
