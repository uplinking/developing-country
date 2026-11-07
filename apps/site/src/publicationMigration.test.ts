import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const migration = [
  readFileSync(new URL('../migrations/0001_article_publication_evidence.sql', import.meta.url), 'utf8'),
  readFileSync(new URL('../migrations/0002_strict_publication_evidence.sql', import.meta.url), 'utf8'),
].join('\n')
const checksum = `sha256:${'a'.repeat(64)}`
const gateError = 'dc_publication_evidence: invalid published Research Article'

interface EvidenceFixture {
  generatedAt?: string
  datasetVersions: Array<{
    versionId: string
    checksum: string
    vintage?: unknown
    [key: string]: unknown
  }>
  dataViews: Array<Record<string, unknown>>
  [key: string]: unknown
}

function emptyDatabase() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE _emdash_collections (
      slug TEXT PRIMARY KEY,
      supports TEXT
    );
    INSERT INTO _emdash_collections (slug, supports)
    VALUES ('articles', '["drafts","revisions","preview","scheduling","search","seo"]');

    CREATE TABLE ec_articles (
      id TEXT PRIMARY KEY,
      slug TEXT,
      status TEXT,
      country_code TEXT,
      research_question TEXT,
      methodology TEXT,
      evidence_bundle TEXT,
      source_manifest TEXT,
      primary_view_url TEXT,
      content TEXT,
      draft_revision_id TEXT,
      scheduled_at TEXT
    );
  `)
  return db
}

function database() {
  const db = emptyDatabase()
  db.exec(migration)
  return db
}

function evidenceValue(): EvidenceFixture {
  return {
    version: 1,
    kind: 'platform-query',
    country: 'LK',
    generatedAt: '2026-08-26T00:00:00.000Z',
    datasetVersions: [{
      datasetId: 'demographics',
      versionId: `dsv_${'b'.repeat(32)}`,
      country: 'LK',
      checksum,
      vintage: '2024',
      refreshedAt: '2026-08-20',
      sourceIds: ['lk-census-2024'],
    }],
    dataViews: [],
  }
}

function evidence() {
  return JSON.stringify(evidenceValue())
}

const sources = JSON.stringify([{
  sourceId: 'lk-census-2024',
  title: 'Sri Lanka Census 2024',
  url: 'https://statistics.gov.lk/',
}])
const content = JSON.stringify([{ _type: 'block', children: [{ _type: 'span', text: 'Finding' }] }])

function insertDraft(db: Database, id: string, bundle: string | null = evidence()) {
  db.run(
    `INSERT INTO ec_articles
      (id, status, country_code, research_question, methodology, evidence_bundle, source_manifest, content)
     VALUES (?, 'draft', 'LK', ?, ?, ?, ?, ?)`,
    [id, 'Which communities lack reliable public transport access?', 'We reviewed a bounded platform query and all cited source coverage.', bundle, sources, content],
  )
}

describe('D1 Research Article publication trigger', () => {
  test('allows incomplete drafts but blocks their publication', () => {
    const db = database()
    insertDraft(db, 'draft', null)
    expect(() => db.run(`UPDATE ec_articles SET status = 'published' WHERE id = 'draft'`))
      .toThrow(gateError)
    expect(db.query(`SELECT status FROM ec_articles WHERE id = 'draft'`).get()).toEqual({ status: 'draft' })

    insertDraft(db, 'malformed-json', '{')
    expect(() => db.run(
      `UPDATE ec_articles SET status = 'published' WHERE id = 'malformed-json'`,
    )).toThrow()
  })

  test('allows one atomic revision promotion when the candidate is evidenced', () => {
    const db = database()
    insertDraft(db, 'ready')
    db.run(`UPDATE ec_articles SET status = 'published' WHERE id = 'ready'`)
    expect(db.query(`SELECT status FROM ec_articles WHERE id = 'ready'`).get()).toEqual({ status: 'published' })
  })

  test('blocks direct published inserts and unmanifested Dataset Version sources', () => {
    const db = database()
    expect(() => db.run(`INSERT INTO ec_articles (id, status) VALUES ('bad', 'published')`))
      .toThrow(gateError)
    insertDraft(db, 'unmanifested')
    db.run(`UPDATE ec_articles SET source_manifest = ? WHERE id = 'unmanifested'`, [
      JSON.stringify([{ sourceId: 'different', title: 'Different', url: 'https://example.com/' }]),
    ])
    expect(() => db.run(`UPDATE ec_articles SET status = 'published' WHERE id = 'unmanifested'`))
      .toThrow(gateError)
  })

  test('keeps the invariant when an already-published row is edited', () => {
    const db = database()
    insertDraft(db, 'published-edit')
    db.run(`UPDATE ec_articles SET status = 'published' WHERE id = 'published-edit'`)

    expect(() => db.run(
      `UPDATE ec_articles SET evidence_bundle = NULL WHERE id = 'published-edit'`,
    )).toThrow(gateError)
    expect(db.query(`SELECT evidence_bundle FROM ec_articles WHERE id = 'published-edit'`).get())
      .not.toEqual({ evidence_bundle: null })
  })

  test('rejects malformed immutable IDs, timestamps, and evidence fields', () => {
    const invalidBundles = [
      { mutate: (value: EvidenceFixture) => { delete value.generatedAt }, message: 'invalid evidence bundle contract' },
      { mutate: (value: EvidenceFixture) => { value.generatedAt = '2026-02-30T00:00:00.000Z' }, message: 'invalid evidence bundle contract' },
      { mutate: (value: EvidenceFixture) => { value.datasetVersions[0]!.datasetId = 123 }, message: 'invalid Dataset Version' },
      { mutate: (value: EvidenceFixture) => { value.datasetVersions[0]!.datasetId = ' demographics' }, message: 'invalid Dataset Version' },
      { mutate: (value: EvidenceFixture) => { value.datasetVersions[0]!.versionId = `dsv_${'g'.repeat(32)}` }, message: 'invalid Dataset Version' },
      { mutate: (value: EvidenceFixture) => { value.datasetVersions[0]!.versionId = `dsv_${'b'.repeat(32)} ` }, message: 'invalid Dataset Version' },
      { mutate: (value: EvidenceFixture) => { value.datasetVersions[0]!.checksum = `sha256:${'z'.repeat(64)}` }, message: 'invalid Dataset Version' },
      { mutate: (value: EvidenceFixture) => { delete value.datasetVersions[0]!.vintage }, message: 'invalid Dataset Version' },
      { mutate: (value: EvidenceFixture) => { value.datasetVersions[0]!.vintage = 2024 }, message: 'invalid Dataset Version' },
      { mutate: (value: EvidenceFixture) => { value.datasetVersions[0]!.refreshedAt = 123 }, message: 'invalid Dataset Version' },
      { mutate: (value: EvidenceFixture) => { value.datasetVersions[0]!.refreshedAt = '2026-02-30' }, message: 'invalid Dataset Version' },
      { mutate: (value: EvidenceFixture) => { value.datasetVersions[0]!.refreshedAt = '2026-02-30T00:00:00.000Z' }, message: 'invalid Dataset Version' },
      { mutate: (value: EvidenceFixture) => { value.datasetVersions[0]!.sourceIds = ['lk-census-2024', 'lk-census-2024'] }, message: 'invalid Dataset Version' },
      {
        mutate: (value: EvidenceFixture) => value.dataViews.push({
          viewUrl: 'https://explore.developing-country.org/views/view_valid?theme=raw',
          queryId: 'query_abc123',
          resultChecksum: checksum,
        }),
        message: 'invalid Data View evidence',
      },
      {
        mutate: (value: EvidenceFixture) => value.dataViews.push({
          viewUrl: 'https://explore.developing-country.org/views/view_valid',
          queryId: 123,
          resultChecksum: checksum,
        }),
        message: 'invalid Data View evidence',
      },
    ]

    for (const [index, fixture] of invalidBundles.entries()) {
      const db = database()
      const value = evidenceValue()
      fixture.mutate(value)
      insertDraft(db, `invalid-${index}`, JSON.stringify(value))
      expect(() => db.run(
        `UPDATE ec_articles SET status = 'published' WHERE id = ?`,
        [`invalid-${index}`],
      )).toThrow(gateError)
    }
  })

  test('rejects duplicate Dataset and Data View identities', () => {
    const duplicateDatasetId = database()
    const datasets = evidenceValue()
    datasets.datasetVersions.push({
      ...datasets.datasetVersions[0]!,
      versionId: `dsv_${'c'.repeat(32)}`,
    })
    insertDraft(duplicateDatasetId, 'duplicate-dataset', JSON.stringify(datasets))
    expect(() => duplicateDatasetId.run(
      `UPDATE ec_articles SET status = 'published' WHERE id = 'duplicate-dataset'`,
    )).toThrow(gateError)

    const duplicateVersionId = database()
    const versions = evidenceValue()
    versions.datasetVersions.push({
      ...versions.datasetVersions[0]!,
      datasetId: 'transport',
    })
    insertDraft(duplicateVersionId, 'duplicate-version', JSON.stringify(versions))
    expect(() => duplicateVersionId.run(
      `UPDATE ec_articles SET status = 'published' WHERE id = 'duplicate-version'`,
    )).toThrow(gateError)

    const duplicateView = database()
    const views = evidenceValue()
    const repeatedUrl = 'https://explore.developing-country.org/views/view_repeated'
    views.dataViews.push(
      { viewUrl: repeatedUrl, queryId: 'query_one', resultChecksum: checksum },
      { viewUrl: repeatedUrl, queryId: 'query_two', resultChecksum: `sha256:${'b'.repeat(64)}` },
    )
    insertDraft(duplicateView, 'duplicate-view', JSON.stringify(views))
    expect(() => duplicateView.run(
      `UPDATE ec_articles SET status = 'published' WHERE id = 'duplicate-view'`,
    )).toThrow(gateError)
  })

  test('accepts honest source-date precision and canonical UTC freshness timestamps', () => {
    for (const [index, refreshedAt] of ['2000', '2026-08', '2026-08-20', '2026-08-20T00:00:00.000Z'].entries()) {
      const db = database()
      const value = evidenceValue()
      value.datasetVersions[0]!.refreshedAt = refreshedAt
      insertDraft(db, `freshness-${index}`, JSON.stringify(value))
      expect(() => db.run(
        `UPDATE ec_articles SET status = 'published' WHERE id = ?`,
        [`freshness-${index}`],
      )).not.toThrow()
    }
  })

  test('requires empirical Dataset Version sources to have HTTPS evidence', () => {
    const db = database()
    insertDraft(db, 'design-source')
    db.run(`UPDATE ec_articles SET source_manifest = ? WHERE id = 'design-source'`, [
      JSON.stringify([{
        sourceId: 'lk-census-2024', title: 'Unverifiable census reference', type: 'platform-design',
      }]),
    ])
    expect(() => db.run(`UPDATE ec_articles SET status = 'published' WHERE id = 'design-source'`))
      .toThrow(gateError)
  })

  test('rejects primary/body and duplicate body live views', () => {
    const viewUrl = 'https://explore.developing-country.org/views/view_valid'
    const bundle = evidenceValue()
    bundle.dataViews.push({ viewUrl, queryId: 'query_abc123', resultChecksum: checksum })

    const primaryDuplicate = database()
    insertDraft(primaryDuplicate, 'primary-duplicate', JSON.stringify(bundle))
    primaryDuplicate.run(
      `UPDATE ec_articles SET primary_view_url = ?, content = ? WHERE id = 'primary-duplicate'`,
      [viewUrl, JSON.stringify([{ _type: 'dcLiveView', view_url: viewUrl }])],
    )
    expect(() => primaryDuplicate.run(
      `UPDATE ec_articles SET status = 'published' WHERE id = 'primary-duplicate'`,
    )).toThrow(gateError)

    const bodyDuplicate = database()
    insertDraft(bodyDuplicate, 'body-duplicate', JSON.stringify(bundle))
    bodyDuplicate.run(`UPDATE ec_articles SET content = ? WHERE id = 'body-duplicate'`, [
      JSON.stringify([
        { _type: 'dcLiveView', view_url: viewUrl },
        { _type: 'dcLiveView', view_url: viewUrl },
      ]),
    ])
    expect(() => bodyDuplicate.run(
      `UPDATE ec_articles SET status = 'published' WHERE id = 'body-duplicate'`,
    )).toThrow(gateError)
  })

  test('rejects coerced source fields and URLs without an authority', () => {
    for (const [index, source] of [
      { sourceId: 'lk-census-2024', title: 123, url: 'https://statistics.gov.lk/' },
      { sourceId: 'lk-census-2024', title: 'Invalid authority', url: 'https://' },
      { sourceId: 'lk-census-2024', title: 'Whitespace authority', url: 'https:// ' },
      { sourceId: 'lk-census-2024', title: 'Dot authority', url: 'https://.' },
      { sourceId: 'lk-census-2024', title: 'At-sign authority', url: 'https://@' },
      { sourceId: 'lk-census-2024', title: 'Padded URL', url: ' https://statistics.gov.lk/' },
      { sourceId: 'lk-census-2024', title: 'Credentialed URL', url: 'https://user:secret@statistics.gov.lk/' },
    ].entries()) {
      const db = database()
      insertDraft(db, `invalid-source-${index}`)
      db.run(`UPDATE ec_articles SET source_manifest = ? WHERE id = ?`, [
        JSON.stringify([source]), `invalid-source-${index}`,
      ])
      expect(() => db.run(
        `UPDATE ec_articles SET status = 'published' WHERE id = ?`,
        [`invalid-source-${index}`],
      )).toThrow(gateError)
    }
  })

  test('upgrades the known legacy design note without blocking draft remediation', () => {
    const db = emptyDatabase()
    db.run(
      `INSERT INTO ec_articles
        (id, slug, status, country_code, research_question, methodology, evidence_bundle, source_manifest, content)
       VALUES (?, 'evidence-needs-receipts', 'published', 'LK', ?, ?, ?, ?, ?)`,
      [
        '01M0Y8QAPBHGN9JA3WGMKW9ETN',
        'What evidence must remain attached to a public claim?',
        'A platform design review of provenance and completeness contracts.',
        JSON.stringify({
          kind: 'design-note', datasetVersions: [], generatedAt: '2026-08-25T00:00:00.000Z',
        }),
        JSON.stringify([{ title: 'developing-country.org data contract', type: 'platform-design' }]),
        content,
      ],
    )

    db.exec(migration)
    const row = db.query(`SELECT evidence_bundle FROM ec_articles WHERE slug = ?`)
      .get('evidence-needs-receipts') as { evidence_bundle: string }
    expect(JSON.parse(row.evidence_bundle)).toMatchObject({
      version: 1, kind: 'design-note', country: 'LK', dataViews: [],
    })
    const collection = db.query(`SELECT supports FROM _emdash_collections WHERE slug = 'articles'`)
      .get() as { supports: string }
    expect(JSON.parse(collection.supports)).toEqual(['drafts', 'revisions', 'preview', 'search', 'seo'])

    const incompatible = emptyDatabase()
    incompatible.run(`INSERT INTO ec_articles (id, status) VALUES ('unknown-live-row', 'published')`)
    incompatible.run(
      `INSERT INTO ec_articles (id, status, scheduled_at)
       VALUES ('scheduled-draft', 'scheduled', '2026-08-27T00:00:00.000Z')`,
    )
    incompatible.run(
      `INSERT INTO ec_articles (id, status, scheduled_at, draft_revision_id)
       VALUES ('published-with-schedule', 'published', '2026-08-27T00:00:00.000Z', 'pending-revision')`,
    )
    incompatible.exec(migration)
    expect(incompatible.query(
      `SELECT id, status, scheduled_at, draft_revision_id
       FROM ec_articles WHERE id IN ('scheduled-draft', 'published-with-schedule') ORDER BY id`,
    ).all()).toEqual([
      {
        id: 'published-with-schedule', status: 'published', scheduled_at: null,
        draft_revision_id: 'pending-revision',
      },
      { id: 'scheduled-draft', status: 'draft', scheduled_at: null, draft_revision_id: null },
    ])
    expect(() => incompatible.run(
      `UPDATE ec_articles SET draft_revision_id = 'revision-with-correction' WHERE id = 'unknown-live-row'`,
    )).not.toThrow()
    expect(() => incompatible.run(
      `UPDATE ec_articles SET evidence_bundle = NULL WHERE id = 'unknown-live-row'`,
    )).toThrow(gateError)
    expect(() => incompatible.run(
      `UPDATE ec_articles SET status = 'draft' WHERE id = 'unknown-live-row'`,
    )).not.toThrow()
  })
})
