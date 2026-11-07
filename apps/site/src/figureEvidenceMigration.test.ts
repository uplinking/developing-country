import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const read = (name: string) => readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8')
const base = [read('0001_article_publication_evidence.sql'), read('0002_strict_publication_evidence.sql')]
const claims = read('0007_claims_and_missing_data.sql')
const interactive = read('0063_interactive_figure_evidence.sql')
const underlays = read('0066_figure_underlay_evidence.sql')
const d1Safe = read('0067_d1_safe_view_url_patterns.sql')
const gateError = 'dc_publication_evidence: invalid published Research Article'
const checksum = `sha256:${'a'.repeat(64)}`
const viewA = 'https://explore.developing-country.org/views/view_gndcoverage'
const viewB = 'https://explore.developing-country.org/views/view_districtrank'

function database() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE _emdash_collections (slug TEXT PRIMARY KEY, supports TEXT);
    INSERT INTO _emdash_collections VALUES ('articles', '["drafts"]');
    CREATE TABLE ec_articles (
      id TEXT PRIMARY KEY, slug TEXT, status TEXT, country_code TEXT, research_question TEXT,
      methodology TEXT, evidence_bundle TEXT, source_manifest TEXT, primary_view_url TEXT, content TEXT,
      format TEXT, analysis_kind TEXT, claim_status TEXT, claim_source_url TEXT, claim_source_title TEXT,
      claim_reported_at TEXT, missing_data TEXT, draft_revision_id TEXT, scheduled_at TEXT
    );
  `)
  // 0067 replaces the 0063 triggers, so every gate test below runs against it.
  for (const sql of [...base, interactive, underlays, d1Safe]) db.exec(sql)
  return db
}

function bundle(views: string[]) {
  return JSON.stringify({
    version: 1,
    kind: 'platform-query',
    country: 'LK',
    generatedAt: '2026-10-01T00:00:00.000Z',
    datasetVersions: [{
      datasetId: 'demographics', versionId: `dsv_${'b'.repeat(32)}`, country: 'LK', checksum,
      vintage: '2024', refreshedAt: '2026-08-20', sourceIds: ['lk-census-2024'],
    }],
    dataViews: views.map((viewUrl, index) => ({ viewUrl, queryId: `query_${index}`, resultChecksum: checksum })),
  })
}

const sources = JSON.stringify([{ sourceId: 'lk-census-2024', title: 'Census', url: 'https://statistics.gov.lk/' }])

function publish(db: Database, id: string, content: unknown[], views: string[], primary: string | null = null) {
  db.run(
    `INSERT INTO ec_articles (id, status, country_code, research_question, methodology, evidence_bundle, source_manifest, primary_view_url, content)
     VALUES (?, 'draft', 'LK', ?, ?, ?, ?, ?, ?)`,
    [id, 'Who lives within ten minutes of a metro stop?', 'A bounded walkshed join over GN divisions with cited sources.', bundle(views), sources, primary, JSON.stringify(content)],
  )
  db.run(`UPDATE ec_articles SET status = 'published' WHERE id = ?`, [id])
}

const paragraph = { _type: 'block', children: [{ _type: 'span', text: 'Finding' }] }

describe('0063 interactive figure evidence gate', () => {
  test('is 0007 minus the dcLiveView duplicate branches, plus the interactive branches', () => {
    for (const name of ['dc_articles_evidence_insert', 'dc_articles_evidence_publish']) {
      const segment = (sql: string) => sql.slice(sql.indexOf(`DROP TRIGGER IF EXISTS ${name};`), sql.indexOf('\nEND;', sql.indexOf(`DROP TRIGGER IF EXISTS ${name};`)))
      const marker = "  OR\n  (\n    length(trim(coalesce(NEW.primary_view_url, ''))) > 0 AND EXISTS ("
      const previous = segment(claims)
      const next = segment(interactive)
      expect(next.startsWith(previous.slice(0, previous.indexOf(marker)))).toBe(true)
      expect(next).toContain("IN ('dcFigure', 'dcStat', 'dcGuess', 'dcExplorer')")
    }
  })

  test('publishes a story that reuses evidenced views across blocks and the primary view', () => {
    const db = database()
    publish(db, 'story', [
      paragraph,
      { _type: 'dcLiveView', view_url: viewA },
      { _type: 'dcLiveView', view_url: viewA },
      { _type: 'dcGuess', guess_id: 'g', view_url: viewB, field: 'share' },
      { _type: 'dcScrolly', steps: [{ text: 'a', view_url: viewA }, { text: 'b', view_url: viewB }] },
      { _type: 'dcStat', view_url: viewB, field: 'share', label: 'x' },
      { _type: 'dcFigure', view_url: viewA },
      { _type: 'dcExplorer', view_url: viewA, title_field: 'name', metrics: [{ field: 'share' }] },
    ], [viewA, viewB], viewA)
    expect(db.query(`SELECT status FROM ec_articles WHERE id = 'story'`).get()).toEqual({ status: 'published' })
  })

  test('rejects any interactive block or scrolly step whose view is not evidenced', () => {
    for (const [index, block] of [
      { _type: 'dcFigure', view_url: viewB },
      { _type: 'dcStat', view_url: viewB, field: 'x', label: 'x' },
      { _type: 'dcGuess', view_url: viewB },
      { _type: 'dcExplorer', view_url: viewB },
      { _type: 'dcFigure' },
      { _type: 'dcScrolly', steps: [{ text: 'a', view_url: viewA }, { text: 'b', view_url: viewB }] },
      { _type: 'dcScrolly', steps: [{ text: 'a' }] },
      { _type: 'dcScrolly', steps: [] },
      { _type: 'dcScrolly' },
    ].entries()) {
      const db = database()
      expect(() => publish(db, `bad-${index}`, [paragraph, block], [viewA])).toThrow(gateError)
    }
  })

  test('still rejects unevidenced live views and keeps dataViews unique', () => {
    expect(() => publish(database(), 'live', [paragraph, { _type: 'dcLiveView', view_url: viewB }], [viewA])).toThrow(gateError)
    expect(() => publish(database(), 'dupe', [paragraph], [viewA, viewA])).toThrow(gateError)
  })
})

describe('0066 underlay evidence gate', () => {
  const viewC = 'https://explore.developing-country.org/views/view_outlines'

  test('publishes figures and steps whose underlays are all evidenced (spaces, blanks and repeats tolerated)', () => {
    const db = database()
    publish(db, 'underlays', [
      paragraph,
      { _type: 'dcFigure', view_url: viewC, underlay_urls: ` ${viewA} , ,${viewB},${viewA}` },
      { _type: 'dcScrolly', steps: [
        { text: 'a', view_url: viewC, underlay_urls: viewA },
        { text: 'b', view_url: viewC, underlay_urls: '' },
        { text: 'c', view_url: viewB },
      ] },
    ], [viewA, viewB, viewC])
    expect(db.query(`SELECT status FROM ec_articles WHERE id = 'underlays'`).get()).toEqual({ status: 'published' })
  })

  test('rejects any unevidenced, partial or non-text underlay', () => {
    for (const [index, block] of [
      { _type: 'dcFigure', view_url: viewA, underlay_urls: viewC },
      { _type: 'dcFigure', view_url: viewA, underlay_urls: `${viewB},${viewC}` },
      { _type: 'dcFigure', view_url: viewA, underlay_urls: `${viewB}x` },
      { _type: 'dcFigure', view_url: viewA, underlay_urls: 42 },
      { _type: 'dcScrolly', steps: [{ text: 'a', view_url: viewA, underlay_urls: `${viewB},https://evil.example/views/view_b` }] },
    ].entries()) {
      expect(() => publish(database(), `bad-underlay-${index}`, [paragraph, block], [viewA, viewB])).toThrow(gateError)
    }
  })

  test('also guards edits to an already published article', () => {
    const db = database()
    publish(db, 'live', [paragraph, { _type: 'dcFigure', view_url: viewA }], [viewA])
    expect(() => db.run(`UPDATE ec_articles SET content = ? WHERE id = 'live'`, [
      JSON.stringify([paragraph, { _type: 'dcFigure', view_url: viewA, underlay_urls: viewB }]),
    ])).toThrow(gateError)
  })
})

describe('0067 D1-safe view URL patterns', () => {
  const prefix = 'https://explore.developing-country.org/views/view_'
  const body = (sql: string) => sql.slice(sql.indexOf('DROP TRIGGER IF EXISTS dc_articles_evidence_insert;'))

  test('is 0063 with each long view-URL LIKE/GLOB swapped for a 50-byte prefix comparison', () => {
    expect(new TextEncoder().encode(prefix).length).toBe(50)
    const derived = body(interactive)
      .replaceAll(`coalesce(json_extract(view.value, '$.viewUrl'), '') NOT GLOB '${prefix}[a-z0-9]*'`, `substr(coalesce(json_extract(view.value, '$.viewUrl'), ''), 1, 50) <> '${prefix}'`)
      .replaceAll(`NEW.primary_view_url NOT LIKE '${prefix}%'`, `substr(NEW.primary_view_url, 1, 50) <> '${prefix}'`)
      .replace(/coalesce\((\s+json_extract\(block\.value, '\$\.view_url'\),\s+json_extract\(block\.value, '\$\.url'\),\s+json_extract\(block\.value, '\$\.id'\),\s+''\s+)\) NOT LIKE '[^']+%'/g, `substr(coalesce($1), 1, 50) <> '${prefix}'`)
    expect(body(d1Safe)).toBe(derived)
  })

  test('keeps every LIKE and GLOB pattern within the D1 limit of 50 bytes', () => {
    const patterns = [...d1Safe.matchAll(/(?:LIKE|GLOB)\s+'([^']*)'/gi)].map((match) => match[1]!)
    expect(patterns.length).toBeGreaterThan(0)
    expect(patterns.filter((pattern) => new TextEncoder().encode(pattern).length > 50)).toEqual([])
  })

  test('still rejects a primary view outside the canonical explore origin', () => {
    const db = database()
    expect(() => publish(db, 'offsite', [paragraph], [viewA], 'https://example.org/views/view_gndcoverage')).toThrow(gateError)
  })
})
