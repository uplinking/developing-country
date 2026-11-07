import { describe, expect, test } from 'bun:test'
import { catalog, datasetDocuments, gapDocuments } from './dataSearchFixture'
import { datasetMeta, isDatasetId } from './lib/datasets'
import {
  normalise,
  parseQuery,
  search,
  stem,
  type SearchDocument,
} from './lib/dataSearch'

const synonyms = catalog.search.synonyms

function ranked(query: string, documents: readonly SearchDocument[] = datasetDocuments) {
  const parsed = parseQuery(query, synonyms)
  if (!parsed) throw new Error(`empty query: ${query}`)
  return search(documents, parsed)
}
const ids = (query: string, documents?: readonly SearchDocument[]) => ranked(query, documents).hits.map((hit) => hit.id)

describe('query parsing', () => {
  test('normalises case, accents and punctuation', () => {
    expect(normalise('  Pupil–teacher RATIO, Nuwara-Éliya ')).toBe('pupil teacher ratio nuwara eliya')
    expect(normalise('workers’ remittances')).toBe('workers remittances')
  })

  test('stems plurals only', () => {
    expect(['outages', 'dropouts', 'pupils', 'facilities', 'census', 'analysis', 'class'].map(stem))
      .toEqual(['outage', 'dropout', 'pupil', 'facility', 'census', 'analysis', 'class'])
  })

  test('treats a blank query as no search', () => {
    expect(parseQuery('', synonyms)).toBeNull()
    expect(parseQuery('   ', synonyms)).toBeNull()
    expect(parseQuery('—', synonyms)).toBeNull()
    expect(parseQuery(null, synonyms)).toBeNull()
  })

  test('drops filler words but keeps a query made only of them', () => {
    expect(parseQuery('data on school dropouts in Sri Lanka', synonyms)!.concepts.map((c) => c.term))
      .toEqual(['school', 'dropout'])
    expect(parseQuery('sri lanka', synonyms)!.concepts.map((c) => c.term)).toEqual(['sri', 'lanka'])
  })

  test('expands multi-word synonyms before single words', () => {
    const query = parseQuery('power cuts', synonyms)!
    expect(query.concepts.map((c) => c.term)).toEqual(['power cut'])
    expect(query.expansions).toContain('interruption')
  })

  test('bounds the work a long query can cause', () => {
    const query = parseQuery('word '.repeat(500), synonyms)!
    expect(query.text.length).toBeLessThanOrEqual(200)
    expect(query.concepts).toHaveLength(1)
  })
})

describe('ranking rules', () => {
  const docs: SearchDocument[] = [
    { id: 'summary-only', text: { title: ['Household survey'], summary: ['Includes rainfall notes'] } },
    { id: 'field', text: { title: ['Weather stations'], fields: ['Rainfall · Temperature'] } },
    { id: 'title', text: { title: ['Rainfall by district'] } },
  ]

  test('title matches outrank field matches, which outrank summary matches', () => {
    expect(ids('rainfall', docs)).toEqual(['title', 'field', 'summary-only'])
  })

  test('a typed word outranks a synonym in the same field', () => {
    const outage: SearchDocument[] = [
      { id: 'synonym', text: { title: ['Supply interruptions'] } },
      { id: 'typed', text: { title: ['Supply outages'] } },
    ]
    expect(ids('outages', outage)).toEqual(['typed', 'synonym'])
  })

  test('every word must match; otherwise partial matches are flagged', () => {
    expect(ranked('rainfall district', docs)).toEqual({ hits: [{ id: 'title', score: expect.any(Number), matched: 2 }], partial: false })
    const partial = ranked('rainfall jaffna', docs)
    expect(partial.partial).toBe(true)
    expect(partial.hits.map((hit) => hit.id)).toEqual(['title', 'field', 'summary-only'])
  })

  test('returns nothing for words that match nothing', () => {
    expect(ranked('zzzqx', docs)).toEqual({ hits: [], partial: true })
  })
})

// Relevance against the real catalogue: the checked-in R2 catalogue artifact
// plus the CMS seed, built through the same document builders as /data.
describe('relevance on the catalogue', () => {
  test('plain words: "school dropouts" finds school enrolment', () => {
    expect(ids('school dropouts')[0]).toBe('school-resources')
  })

  test('plain words: "electricity outages" finds supply reliability first', () => {
    expect(ids('electricity outages')[0]).toBe('electricity-supply-reliability')
  })

  test('synonym only: "power cuts" and "blackouts" reach supply reliability', () => {
    expect(ids('power cuts')[0]).toBe('electricity-supply-reliability')
    expect(ids('blackouts')[0]).toBe('electricity-supply-reliability')
  })

  test('place + plain word: "Colombo rent" finds housing tenure and Colombo property prices', () => {
    const top = ids('Colombo rent').slice(0, 3)
    expect(top).toContain('housing-occupancy-tenure')
    expect(top).toContain('colombo-asking-price-indices')
  })

  test('publisher: "Central Bank" ranks Central Bank datasets first', () => {
    const hits = ids('Central Bank')
    const central = hits.filter((id) => {
      if (!isDatasetId(id)) throw new Error(id)
      const meta = datasetMeta(catalog, id)
      return [meta.publisher.name, ...meta.sources.map((source) => source.publisher)].join(' ').includes('Central Bank')
    })
    expect(central.length).toBeGreaterThanOrEqual(10)
    expect(hits.slice(0, central.length)).toEqual(central)
  })

  test('publisher: "Ceylon Electricity Board" finds its customer and sales table first', () => {
    expect(ids('Ceylon Electricity Board')[0]).toBe('electricity-customers-sales')
  })

  test('ministry publisher: "Ministry of Finance" returns Treasury tables', () => {
    const hits = ids('Ministry of Finance')
    expect(hits.length).toBeGreaterThanOrEqual(10)
    for (const id of hits.slice(0, 10)) {
      if (!isDatasetId(id)) throw new Error(id)
      const meta = datasetMeta(catalog, id)
      expect([meta.publisher.name, ...meta.sources.map((source) => source.publisher)].join(' ')).toContain('Ministry of Finance')
    }
  })

  test('place: "Jaffna" finds district-level tables', () => {
    const hits = ids('Jaffna')
    expect(hits).toContain('housing-occupancy-tenure')
    expect(hits).toContain('poverty-headcount-district')
    expect(hits.length).toBeGreaterThanOrEqual(10)
  })

  test('field names: "tenure", "SAIFI" and "pupil teacher ratio"', () => {
    expect(ids('tenure')[0]).toBe('housing-occupancy-tenure')
    expect(ids('SAIFI')[0]).toBe('electricity-supply-reliability')
    expect(ids('pupil teacher ratio')[0]).toBe('school-resources')
  })

  test('synonym: "rice yield" finds paddy yield', () => {
    expect(ids('rice yield')[0]).toBe('paddy-yield-history')
  })

  test('title matches rank above summary-only matches: "poverty"', () => {
    const top = ids('poverty').slice(0, 4)
    expect(top.every((id) => id.includes('poverty'))).toBe(true)
  })

  test('missing data is searchable by title, field and holder', () => {
    expect(ids('housing construction', gapDocuments)[0]).toBe('colombo-housing-construction-register')
    expect(ids('National Housing Development Authority', gapDocuments)).toEqual(['colombo-housing-construction-register'])
    expect(ids('government buildings', gapDocuments)[0]).toBe('public-building-construction-register')
  })
})
