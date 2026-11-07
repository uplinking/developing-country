/**
 * Search over the initiatives ledger the /initiatives page has already downloaded.
 *
 * The page needs every event to total the money strip, so the full ledger is in memory anyway.
 * Searching it in the browser costs no extra bytes, no requests and no Cloudflare quota.
 *
 * Matching is word-prefix: every query term must start a word somewhere in the event's text
 * (project name, place, sector, funder, summary, notes, supplier, agency and the titles of the
 * reports it cites). Prefixes suit Sinhala and Tamil too, whose case endings attach to the end of a
 * word (කොළඹ finds කොළඹට). A Latin term with no exact hit falls back to the nearest spellings in the
 * ledger's own vocabulary, so a typo still lands.
 */

/** The ledger fields search reads. Everything is optional because the ledger is external input. */
export interface SearchableProject {
  name?: string | null
  place?: string | null
  sector?: string | null
}

export interface SearchableLine {
  funder?: string | null
  funder_name?: string | null
  purpose?: string | null
}

export interface SearchableEvent {
  summary?: string | null
  notes?: string | null
  supplier?: string | null
  agency?: string | null
  sources?: ({ title?: string | null } | null)[] | null
}

export interface SearchCorrection {
  /** The term as typed, normalised. */
  from: string
  /** The ledger word used instead. */
  to: string
}

export interface SearchResult {
  /** Ids of the matching documents, or null when the query is empty (search is off). */
  ids: Set<string> | null
  /** Terms that had no exact hit and were matched by spelling instead. */
  corrections: SearchCorrection[]
}

export interface SearchIndex {
  readonly size: number
  search: (raw: string) => SearchResult
}

const LATIN_DIACRITICS = /[̀-ͯ]/g
// ZWJ/ZWNJ and the soft hyphen render invisibly and are typed inconsistently in Sinhala conjuncts.
const INVISIBLE = /[­​-‍⁠﻿]/g
const APOSTROPHES = /['‘’ʼ]/g
// Letters, combining marks (Sinhala and Tamil vowel signs are marks) and digits are word characters.
const NON_WORD = /[^\p{L}\p{M}\p{N}]+/gu
const LATIN_WORD = /^[a-z0-9]+$/
const MAX_TERMS = 8
const MAX_FUZZY_ALTERNATIVES = 6

/** Case-fold, drop Latin accents and invisible joiners, and reduce punctuation to single spaces. */
export function normalizeSearchText(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFD')
    .replace(LATIN_DIACRITICS, '')
    .normalize('NFC')
    .replace(INVISIBLE, '')
    .replace(APOSTROPHES, '')
    .replace(NON_WORD, ' ')
    .trim()
}

/** Split a query into normalised terms. A "quoted phrase" stays one term. Duplicates are dropped. */
export function parseSearchQuery(raw: string): string[] {
  const terms: string[] = []
  const add = (part: string) => {
    const term = normalizeSearchText(part)
    if (term && !terms.includes(term)) terms.push(term)
  }
  const phrase = /"([^"]*)"?/g
  let rest = ''
  let at = 0
  for (const match of raw.matchAll(phrase)) {
    rest += raw.slice(at, match.index) + ' '
    add(match[1] ?? '')
    at = match.index + match[0].length
  }
  rest += raw.slice(at)
  for (const word of normalizeSearchText(rest).split(' ')) add(word)
  return terms.slice(0, MAX_TERMS)
}

/** The text one event is found by: its initiative, its funding line, itself and its reports. */
export function initiativeSearchText(
  project: SearchableProject | null | undefined,
  line: SearchableLine | null | undefined,
  event: SearchableEvent,
  labels: (string | null | undefined)[] = [],
): string {
  const parts: (string | null | undefined)[] = [
    project?.name,
    project?.place,
    project?.sector,
    line?.funder?.replace(/^other:/, ''),
    line?.funder_name,
    line?.purpose,
    event.summary,
    event.notes,
    event.supplier,
    event.agency,
    ...labels,
  ]
  for (const source of event.sources ?? []) parts.push(source?.title)
  return parts.filter(Boolean).join(' • ')
}

// Tamil nouns ending in -ம் take an oblique -த்த- stem before case endings:
// யாழ்ப்பாணம் (Jaffna) is reported as யாழ்ப்பாணத்தில் (in Jaffna), மாவட்டம் as மாவட்டத்தில்.
const TAMIL_M_FINAL = /(?<=[஀-௿]{2})ம்$/

/** The prefix a term is matched by. Only the Tamil -ம் ending is stripped; everything else is as typed. */
export function searchStem(term: string): string {
  return term.replace(TAMIL_M_FINAL, '')
}

/** Optimal-string-alignment distance, giving up once it must exceed `max`. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev2: number[] = []
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let d = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, prev2[j - 2]! + 1)
      row.push(d)
      if (d < best) best = d
    }
    if (best > max) return max + 1
    prev2 = prev
    prev = row
  }
  return prev[b.length]!
}

/** Build an index over [id, text] pairs. Normalisation happens once here, not per keystroke. */
export function buildSearchIndex(docs: Iterable<readonly [string, string]>): SearchIndex {
  const ids: string[] = []
  const hays: string[] = []
  for (const [id, text] of docs) {
    ids.push(id)
    hays.push(' ' + normalizeSearchText(text) + ' ')
  }

  let vocabulary: Map<string, number> | null = null
  const words = () => {
    if (vocabulary) return vocabulary
    vocabulary = new Map()
    for (const hay of hays) {
      for (const word of new Set(hay.split(' '))) {
        if (word.length >= 3 && LATIN_WORD.test(word)) vocabulary.set(word, (vocabulary.get(word) ?? 0) + 1)
      }
    }
    return vocabulary
  }

  const hits = (needle: string) => {
    const found: number[] = []
    for (let i = 0; i < hays.length; i++) if (hays[i]!.includes(needle)) found.push(i)
    return found
  }

  /** Ledger words a mistyped term probably meant, closest and most common first. */
  const nearWords = (term: string) => {
    if (term.length < 4 || !LATIN_WORD.test(term)) return []
    const max = term.length >= 8 ? 2 : 1
    const scored: [string, number, number][] = []
    for (const [word, count] of words()) {
      let d = editDistance(term, word, max)
      // A longer word whose opening is a near miss also counts: "hambantot" finds "hambantota".
      if (d > max && word.length > term.length) d = editDistance(term, word.slice(0, term.length), max)
      if (d <= max) scored.push([word, d, count])
    }
    scored.sort((x, y) => x[1] - y[1] || y[2] - x[2] || x[0].localeCompare(y[0]))
    return scored.slice(0, MAX_FUZZY_ALTERNATIVES).map(([word]) => word)
  }

  return {
    size: ids.length,
    search(raw) {
      const terms = parseSearchQuery(raw)
      if (!terms.length) return { ids: null, corrections: [] }
      const corrections: SearchCorrection[] = []
      let matched: Set<number> | null = null
      for (const term of terms) {
        let found = new Set(hits(' ' + searchStem(term)))
        if (!found.size) {
          const near = nearWords(term)
          for (const word of near) for (const i of hits(' ' + word)) found.add(i)
          if (near[0]) corrections.push({ from: term, to: near[0] })
        }
        if (matched) {
          const prior: Set<number> = matched
          found = new Set([...found].filter(i => prior.has(i)))
        }
        matched = found
        if (!matched.size) break
      }
      return { ids: new Set([...(matched ?? [])].map(i => ids[i]!)), corrections }
    },
  }
}
