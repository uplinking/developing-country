import { expect, test } from 'bun:test'
import {
  buildSearchIndex,
  editDistance,
  initiativeSearchText,
  normalizeSearchText,
  parseSearchQuery,
  searchStem,
} from './lib/initiativeSearch'

const docs: [string, string][] = [
  ['port', 'Colombo Port City expansion • Colombo • transport • Asian Development Bank • Contract awarded'],
  ['airport', 'Bandaranaike airport terminal • Katunayake • transport • Government of Japan'],
  ['housing', 'Community housing programme • national • housing • Government of Sri Lanka'],
  ['hambantota', 'Hambantota water supply scheme • Hambantota • water • China'],
  ['sinhala', 'Kandy road works • Kandy • transport • කොළඹට නව මාර්ගයක්'],
  ['tamil', 'Northern roads • Jaffna • transport • யாழ்ப்பாணத்தில் புதிய வீதி'],
  ['accent', 'Café de Colombo heritage • Colombo • culture_sport'],
]
const index = buildSearchIndex(docs)
const ids = (q: string) => [...(index.search(q).ids ?? [])].sort()

test('an empty or punctuation-only query turns search off instead of matching nothing', () => {
  expect(index.search('').ids).toBeNull()
  expect(index.search('   ').ids).toBeNull()
  expect(index.search('—?!').ids).toBeNull()
})

test('terms match the start of words, so "port" finds the port but not the airport', () => {
  expect(ids('port')).toEqual(['port'])
  expect(ids('PORT')).toEqual(['port'])
  expect(ids('colom')).toEqual(['accent', 'port'])
})

test('every term must match, across fields: name, place, funder and stage labels', () => {
  expect(ids('colombo port')).toEqual(['port'])
  expect(ids('transport japan')).toEqual(['airport'])
  expect(ids('asian development bank contract')).toEqual(['port'])
  expect(ids('housing japan')).toEqual([])
})

test('a quoted phrase must appear in order', () => {
  expect(ids('"water supply"')).toEqual(['hambantota'])
  expect(ids('"supply water"')).toEqual([])
})

test('Sinhala and Tamil terms find report titles, including inflected forms', () => {
  // කොළඹ (Colombo) is reported as කොළඹට (to Colombo): the ending is appended, so a prefix matches.
  expect(ids('කොළඹ')).toEqual(['sinhala'])
  // யாழ்ப்பாணம் (Jaffna) becomes யாழ்ப்பாணத்தில் (in Jaffna): the -ம் ending is dropped before matching.
  expect(ids('யாழ்ப்பாணம்')).toEqual(['tamil'])
  expect(searchStem('யாழ்ப்பாணம்')).toBe('யாழ்ப்பாண')
  expect(searchStem('colombo')).toBe('colombo')
})

test('accents, case, apostrophes and invisible joiners do not stop a match', () => {
  expect(ids('cafe')).toEqual(['accent'])
  expect(normalizeSearchText('Women’s  Day—2026')).toBe('womens day 2026')
  expect(normalizeSearchText('ශ්‍රී')).toBe('ශ්රී')
  // Sinhala and Tamil vowel signs are combining marks and must survive normalisation.
  expect(normalizeSearchText('කොළඹ')).toBe('කොළඹ')
})

test('a misspelt Latin term falls back to the nearest ledger words and says so', () => {
  const r = index.search('hambantotta')
  expect([...(r.ids ?? [])]).toEqual(['hambantota'])
  expect(r.corrections).toEqual([{ from: 'hambantotta', to: 'hambantota' }])
  expect(ids('colmobo port')).toEqual(['port'])
  expect(index.search('port').corrections).toEqual([])
})

test('short or nonsense terms do not fuzzy-match their way into false hits', () => {
  expect(ids('xqzv')).toEqual([])
  expect(ids('prt')).toEqual([])
})

test('query parsing keeps phrases, drops duplicates and caps the number of terms', () => {
  expect(parseSearchQuery('Colombo "port city" colombo')).toEqual(['port city', 'colombo'])
  expect(parseSearchQuery('a b c d e f g h i j').length).toBe(8)
  expect(parseSearchQuery('"unclosed phrase')).toEqual(['unclosed phrase'])
})

test('edit distance counts a transposition as one edit and stops early past the limit', () => {
  expect(editDistance('colombo', 'colmobo', 2)).toBe(1)
  expect(editDistance('kandy', 'kandy', 1)).toBe(0)
  expect(editDistance('kandy', 'galle', 1)).toBe(2)
})

test('an event is found by its initiative, funding line, own text and report titles', () => {
  const text = initiativeSearchText(
    { name: 'Rajagiriya housing', place: 'Colombo', sector: 'housing' },
    { funder: 'other:netherlands', funder_name: 'Government of the Netherlands', purpose: 'programme' },
    {
      summary: 'UDA halts project',
      notes: null,
      supplier: 'Asset Engineering Ltd',
      agency: 'Urban Development Authority',
      sources: [{ title: 'ලක්ෂ 2960ක නිශ්කාර්ය වියදමක්' }, null, {}],
    },
    ['Halted', null],
  )
  const one = buildSearchIndex([['e', text]])
  for (const q of ['rajagiriya', 'netherlands', 'asset engineering', 'urban development', 'halted', 'නිශ්කාර්ය']) {
    expect([...(one.search(q).ids ?? [])]).toEqual(['e'])
  }
  expect(initiativeSearchText(null, undefined, {})).toBe('')
})

test('the published ledger builds and searches quickly enough to run on every keystroke', async () => {
  const file = Bun.file(new URL('../../../public/data/lk-initiatives.json', import.meta.url))
  if (!(await file.exists())) return
  const ledger: {
    projects: ({ id: string } & Parameters<typeof initiativeSearchText>[0])[]
    lines: ({ id: string; project_id: string } & Parameters<typeof initiativeSearchText>[1])[]
    events: ({ id: string; line_id: string } & Parameters<typeof initiativeSearchText>[2])[]
  } = await file.json()
  const projects = new Map(ledger.projects.map(p => [p.id, p]))
  const lines = new Map(ledger.lines.map(l => [l.id, l]))
  let started = performance.now()
  const big = buildSearchIndex(ledger.events.map(e => {
    const line = lines.get(e.line_id)
    return [e.id, initiativeSearchText(line && projects.get(line.project_id), line, e)] as const
  }))
  const buildMs = performance.now() - started
  expect(big.size).toBe(ledger.events.length)
  // Generous ceilings for slow CI machines; locally these run in ~35 ms and well under 5 ms.
  expect(buildMs).toBeLessThan(1000)
  started = performance.now()
  const colombo = big.search('colombo')
  expect(performance.now() - started).toBeLessThan(100)
  expect(colombo.ids?.size).toBeGreaterThan(0)
})
