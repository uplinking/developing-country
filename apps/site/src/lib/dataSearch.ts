// Plain-language search over the /data catalogue.
//
// Pure and dependency-free so it can run inside the site Worker, which has very
// little bundle headroom. The bulky inputs (field labels, dimension values such
// as district names, and the reviewable synonym map) are built at build time
// into the R2 dataset catalogue (see apps/site/scripts/build-dataset-catalog.ts),
// so only this scorer ships in the Worker.
//
// Ranking: every query concept (a word, or a phrase from the synonym map) must
// match somewhere in a document. A concept scores the weight of the best field
// it matched, so a title or field-name match outranks a summary match, and a
// synonym match counts for less than the word the reader typed. When no
// document matches every concept, the best partial matches are returned and
// flagged so the page can say so.

const SEARCH_FIELDS = ['title', 'label', 'fields', 'publisher', 'values', 'themes', 'sources', 'summary'] as const
export type SearchField = typeof SEARCH_FIELDS[number]

export const FIELD_WEIGHTS = {
  title: 10,
  label: 8,
  fields: 6,
  publisher: 5,
  values: 4,
  themes: 3,
  sources: 3,
  summary: 2,
} as const satisfies Record<SearchField, number>

/** A synonym counts for this share of the word the reader typed. */
const SYNONYM_FACTOR = 0.6
/** Extra credit, as a share of each further field's weight, when a concept matches in several fields. */
const SPREAD_FACTOR = 0.1
/** The whole query is the title or label. */
const EXACT_BONUS = 8
/** The whole multi-word query appears as a phrase in the title, label, publisher or a field name. */
const PHRASE_BONUS = 4
const PHRASE_FIELDS: ReadonlySet<SearchField> = new Set(['title', 'label', 'publisher', 'fields'])
/** Query tokens at least this long also match longer words that start with them. */
const PREFIX_MIN = 5
const MAX_QUERY_CHARS = 200
const MAX_QUERY_TOKENS = 16

const STOPWORDS = new Set([
  'a', 'about', 'an', 'and', 'any', 'are', 'by', 'data', 'dataset', 'for', 'from', 'how', 'in', 'is', 'lanka',
  'lankan', 'lk', 'many', 'much', 'of', 'on', 'or', 'show', 'sri', 'stat', 'statistic', 'the', 'to', 'what',
  'where', 'which', 'with',
])

export type SynonymMap = Readonly<Record<string, readonly string[]>>

export interface SearchDocument {
  id: string
  /** Text per field; empty entries are ignored. */
  text: Partial<Record<SearchField, readonly (string | null | undefined)[]>>
}

interface Alternative {
  tokens: string[]
  synonym: boolean
}

interface Concept {
  /** What the reader typed for this concept, normalised. */
  term: string
  alternatives: Alternative[]
}

export interface SearchQuery {
  /** The trimmed query, as typed. */
  text: string
  concepts: Concept[]
  /** Synonym phrases added to the query, for display ("also searched for"). */
  expansions: string[]
}

export interface SearchHit {
  id: string
  score: number
  /** How many query concepts matched. */
  matched: number
}

export interface SearchResult {
  hits: SearchHit[]
  /** True when no document matched every concept and `hits` holds the best partial matches. */
  partial: boolean
}

/** Lowercase, strip accents and punctuation; keeps letters and digits only. */
export function normalise(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Light English stemmer: plurals only, so "outages" meets "outage" and "pupils" meets "pupil". */
export function stem(token: string): string {
  if (token.length > 4 && token.endsWith('ies')) return `${token.slice(0, -3)}y`
  if (token.length > 4 && token.endsWith('sses')) return token.slice(0, -2)
  if (token.length > 3 && token.endsWith('s') && !/(ss|us|is)$/.test(token)) return token.slice(0, -1)
  return token
}

export function tokenize(text: string): string[] {
  const normalised = normalise(text)
  return normalised ? normalised.split(' ').map(stem) : []
}

const tokenMatches = (doc: string, query: string) =>
  doc === query || (query.length >= PREFIX_MIN && doc.startsWith(query))

function phraseIn(haystack: readonly string[], needle: readonly string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false
  outer: for (let start = 0; start <= haystack.length - needle.length; start++) {
    for (let offset = 0; offset < needle.length; offset++) {
      if (!tokenMatches(haystack[start + offset]!, needle[offset]!)) continue outer
    }
    return true
  }
  return false
}

interface PreparedSynonyms {
  /** Keys as token lists, longest first so "power cut" wins over "power". */
  keys: { tokens: string[]; alternatives: string[][]; labels: string[] }[]
}

const preparedSynonyms = new WeakMap<object, PreparedSynonyms>()

function prepareSynonyms(synonyms: SynonymMap): PreparedSynonyms {
  const cached = preparedSynonyms.get(synonyms)
  if (cached) return cached
  const keys = Object.entries(synonyms)
    .map(([key, values]) => ({
      tokens: tokenize(key),
      alternatives: values.map(tokenize).filter((tokens) => tokens.length > 0),
      labels: values.map((value) => value.trim()).filter(Boolean),
    }))
    .filter((entry) => entry.tokens.length > 0)
    .sort((left, right) => right.tokens.length - left.tokens.length)
  const prepared = { keys }
  preparedSynonyms.set(synonyms, prepared)
  return prepared
}

/** Returns null for an empty query, so callers can show the unsearched catalogue. */
export function parseQuery(raw: string | null | undefined, synonyms: SynonymMap = {}): SearchQuery | null {
  const text = (raw ?? '').trim().slice(0, MAX_QUERY_CHARS)
  const tokens = tokenize(text).slice(0, MAX_QUERY_TOKENS)
  if (tokens.length === 0) return null
  const { keys } = prepareSynonyms(synonyms)
  const concepts: Concept[] = []
  const expansions: string[] = []
  let index = 0
  while (index < tokens.length) {
    const entry = keys.find((candidate) =>
      candidate.tokens.every((token, offset) => tokens[index + offset] === token))
    if (entry) {
      concepts.push({
        term: entry.tokens.join(' '),
        alternatives: [
          { tokens: entry.tokens, synonym: false },
          ...entry.alternatives.map((alternative) => ({ tokens: alternative, synonym: true })),
        ],
      })
      expansions.push(...entry.labels)
      index += entry.tokens.length
      continue
    }
    const token = tokens[index]!
    if (!STOPWORDS.has(token)) concepts.push({ term: token, alternatives: [{ tokens: [token], synonym: false }] })
    index++
  }
  // A query made only of stopwords ("data", "sri lanka") still searches for them.
  if (concepts.length === 0) {
    for (const token of new Set(tokens)) concepts.push({ term: token, alternatives: [{ tokens: [token], synonym: false }] })
  }
  const unique = [...new Map(concepts.map((concept) => [concept.term, concept])).values()]
  return { text, concepts: unique, expansions: [...new Set(expansions)] }
}

interface PreparedDocument {
  id: string
  fields: { field: SearchField; tokens: string[] }[]
  heading: string[]
}

const textOf = (value: SearchDocument['text'][SearchField]) => value?.filter(Boolean).join(' | ') ?? ''

function prepareDocument(document: SearchDocument): PreparedDocument {
  const fields = SEARCH_FIELDS
    .map((field) => ({ field, tokens: tokenize(textOf(document.text[field])) }))
    .filter((entry) => entry.tokens.length > 0)
  return { id: document.id, fields, heading: tokenize(textOf(document.text.title)) }
}

function conceptScore(document: PreparedDocument, concept: Concept): number {
  const weights: number[] = []
  for (const { field, tokens } of document.fields) {
    let best = 0
    for (const alternative of concept.alternatives) {
      if (!phraseIn(tokens, alternative.tokens)) continue
      best = Math.max(best, FIELD_WEIGHTS[field] * (alternative.synonym ? SYNONYM_FACTOR : 1))
    }
    if (best > 0) weights.push(best)
  }
  if (weights.length === 0) return 0
  weights.sort((left, right) => right - left)
  return weights[0]! + weights.slice(1).reduce((sum, weight) => sum + weight * SPREAD_FACTOR, 0)
}

function bonus(document: PreparedDocument, query: SearchQuery): number {
  const typed = tokenize(query.text).filter((token) => !STOPWORDS.has(token))
  if (typed.length === 0) return 0
  const headings = [document.heading, document.fields.find((entry) => entry.field === 'label')?.tokens ?? []]
  if (headings.some((heading) => heading.join(' ') === typed.join(' '))) return EXACT_BONUS
  const phraseFields = document.fields.filter((entry) => PHRASE_FIELDS.has(entry.field))
  if (typed.length > 1 && phraseFields.some((entry) => phraseIn(entry.tokens, typed))) return PHRASE_BONUS
  return 0
}

/** Ranks documents for a parsed query. Ties keep the input order. */
export function search(documents: readonly SearchDocument[], query: SearchQuery): SearchResult {
  const scored = documents.map((document, order) => {
    const prepared = prepareDocument(document)
    const scores = query.concepts.map((concept) => conceptScore(prepared, concept))
    const matched = scores.filter((score) => score > 0).length
    const score = matched > 0 ? scores.reduce((sum, value) => sum + value, 0) + bonus(prepared, query) : 0
    return { id: document.id, score: Math.round(score * 100) / 100, matched, order }
  })
  const rank = (hits: typeof scored) => hits
    .sort((left, right) => right.matched - left.matched || right.score - left.score || left.order - right.order)
    .map(({ id, score, matched }) => ({ id, score, matched }))
  const complete = scored.filter((hit) => hit.matched === query.concepts.length)
  if (complete.length > 0) return { hits: rank(complete), partial: false }
  return { hits: rank(scored.filter((hit) => hit.matched > 0)), partial: true }
}

// ---------------------------------------------------------------- documents

/** Build-time terms for one Dataset, stored in the R2 dataset catalogue. */
export interface DatasetSearchTerms {
  /** Field (column) labels, " · " separated. */
  fields: string
  /** Distinct dimension values such as districts, crops or utilities, " · " separated. */
  values: string
  /** Catalogue description of the Dataset. */
  description: string
}

interface Named { name: string }
interface Labelled { label: string }

export interface DatasetDocumentInput {
  id: string
  title: string
  label: string
  dek?: string | null
  question?: string | null
  publisher: Named & { type: Labelled }
  themes: readonly Labelled[]
  sources: readonly (Named & { publisher?: string })[]
  terms?: DatasetSearchTerms
}

export function datasetSearchDocument(input: DatasetDocumentInput): SearchDocument {
  return {
    id: input.id,
    text: {
      title: [input.title],
      label: [input.label],
      fields: [input.terms?.fields],
      publisher: [input.publisher.name, input.publisher.type.label],
      values: [input.terms?.values],
      themes: input.themes.map((theme) => theme.label),
      sources: input.sources.flatMap((source) => [source.name, source.publisher]),
      summary: [input.dek, input.question, input.terms?.description],
    },
  }
}

export interface GapDocumentInput {
  id: string
  title: string
  summary: string
  neededFields: string
  availableEvidence: string
  nextSteps: string
  publisher: Named & { type: Labelled }
  themes: readonly Labelled[]
  sources: readonly { title: string }[]
}

export function gapSearchDocument(
  gap: GapDocumentInput,
  claims: readonly { title: string; summary?: string }[],
): SearchDocument {
  return {
    id: gap.id,
    text: {
      title: [gap.title],
      // The fields a Missing Data record asks for are its "field names".
      fields: [gap.neededFields],
      publisher: [gap.publisher.name, gap.publisher.type.label],
      themes: gap.themes.map((theme) => theme.label),
      sources: gap.sources.map((source) => source.title),
      summary: [gap.summary, gap.availableEvidence, gap.nextSteps, ...claims.flatMap((claim) => [claim.title, claim.summary])],
    },
  }
}
