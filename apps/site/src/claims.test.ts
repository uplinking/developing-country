import { describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readFileSync } from 'node:fs'
import seed from '../seed/seed.json'
import { gapFields, linkedGaps, sourceLinks } from './lib/claims'
import { articleFields } from './lib/content'
import { publicationIssues } from './publicationEvidence'
import { claimSchemaSql } from './claimSchemaMigration'

const claim = seed.content.articles.find((entry) => entry.slug === 'colombo-housing-age-claim')!
const gaps = seed.content.data_gaps.filter((gap) => claim.data.missing_data?.includes(`$ref:${gap.id}`))
const data = { ...claim.data, missing_data: gaps.map((gap) => gap.id) }
const columns = Object.keys(data)
function database() {
  const db = new Database(':memory:')
  db.run(`CREATE TABLE _emdash_collections (id TEXT PRIMARY KEY, slug TEXT UNIQUE, label TEXT, label_singular TEXT, supports TEXT);
    INSERT INTO _emdash_collections VALUES ('articles', 'articles', 'Writing', 'Article', '[]');
    CREATE TABLE _emdash_fields (id TEXT PRIMARY KEY, collection_id TEXT, slug TEXT, label TEXT, type TEXT, column_type TEXT, required INTEGER, "unique" INTEGER, validation TEXT, options TEXT, sort_order INTEGER, searchable INTEGER, translatable INTEGER, indexed INTEGER);
    CREATE TABLE revisions (id TEXT PRIMARY KEY);
    CREATE TABLE _emdash_menu_items (custom_url TEXT);
    INSERT INTO _emdash_menu_items VALUES ('/research?country=LK'), ('https://example.org/research');
    CREATE TABLE ec_pages (content TEXT);
    CREATE TABLE ec_articles (id TEXT PRIMARY KEY, slug TEXT, status TEXT, ${columns.map((column) => `${column} TEXT`).join(', ')}, primary_view_url TEXT);
  `)
  db.run(claimSchemaSql(seed.collections, new Set(columns), new Set()))
  db.run(readFileSync(new URL('../migrations/0007_claims_and_missing_data.sql', import.meta.url), 'utf8'))
  return db
}
function insert(db: Database, table: string, id: string, value: Record<string, unknown>, status = 'published') {
  const names = ['id', 'status', ...Object.keys(value)]
  const values = [id, status, ...Object.values(value).map((v) => typeof v === 'object' ? JSON.stringify(v) : String(v))]
  db.query(`INSERT INTO ${table} (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`).run(...values)
}

describe('CMS tracked claims and missing data', () => {
  test('every tracked claim links to valid CMS gap drafts', () => {
    for (const entry of seed.content.articles.filter((item) => 'analysis_kind' in item.data && item.data.analysis_kind === 'tracked_claim')) {
      const fields = entry.data as typeof claim.data
      expect(entry.status).toBe('draft')
      expect(publicationIssues(fields)).toEqual([])
      for (const ref of fields.missing_data ?? []) {
        const gap = seed.content.data_gaps.find((item) => `$ref:${item.id}` === ref)
        expect(gap).toBeDefined()
        expect(gapFields(gap!.id, gap!.data)).not.toBeNull()
      }
    }
  })
  test('keeps sourced content as drafts and resolves reusable gap references', () => {
    expect(claim.status).toBe('draft')
    expect(gaps.every((gap) => gap.status === 'draft')).toBe(true)
    expect(publicationIssues(data)).toEqual([])
    expect(data.claim_source_url).toContain('/2026/09/12/40-of-colombo-')
    const normalized = gaps.map((gap) => gapFields(gap.id, gap.data)!)
    const parsed = articleFields(data)
    const links = [{ id: 'claim', title: parsed.title, href: '/analysis/claim', missingDataIds: parsed.missingDataIds, countryCode: 'LK' }]
    expect(linkedGaps(normalized, links)).toHaveLength(2)
    expect(linkedGaps(normalized, [...links, { ...links[0]!, id: 'second', href: '/analysis/second' }])[0]!.claims).toHaveLength(2)
    expect(linkedGaps(normalized, [])).toEqual([])
    expect(linkedGaps(normalized, [{ ...links[0]!, countryCode: 'XX' }])).toEqual([])
  })
  test('rejects unsafe sources and malformed classifications', () => {
    expect(sourceLinks([{ title: 'Unsafe', url: 'javascript:alert(1)' }])).toEqual([])
    expect(gapFields('gap', { ...gaps[0]!.data, theme_ids: ['unknown'] })).toBeNull()
    expect(gapFields('gap', { ...gaps[0]!.data, publisher_type: 'invented' })).toBeNull()
    expect(publicationIssues({ ...data, claim_status: 'supported' }).some((issue) => issue.path === 'claim_status')).toBe(true)
    expect(publicationIssues({ ...data, missing_data: [] }).some((issue) => issue.path === 'missing_data')).toBe(true)
  })
  test('migrates schema idempotently and updates only old local route links', () => {
    const db = database()
    db.run(claimSchemaSql(seed.collections, new Set(columns), new Set(Object.keys(gaps[0]!.data))))
    expect(db.query('SELECT count(*) AS n FROM _emdash_fields').get()).toEqual({ n: 19 })
    expect(db.query('SELECT custom_url FROM _emdash_menu_items').all()).toEqual([{ custom_url: '/analysis?country=LK' }, { custom_url: 'https://example.org/research' }])
    db.close()
  })
  test('requires published gap references and prevents source-only verification', () => {
    const db = database()
    expect(() => insert(db, 'ec_articles', 'missing', data)).toThrow('dc_claims')
    for (const gap of gaps) insert(db, 'ec_data_gaps', gap.id, gap.data)
    expect(() => insert(db, 'ec_articles', 'valid', data)).not.toThrow()
    expect(() => db.query("UPDATE ec_articles SET claim_status='supported' WHERE id='valid'").run()).toThrow('dc_claims')
    expect(() => db.query("UPDATE ec_articles SET analysis_kind='essay' WHERE id='valid'").run()).toThrow('dc_claims')
    expect(() => db.query("UPDATE ec_articles SET missing_data='[]' WHERE id='valid'").run()).toThrow('dc_claims')
    expect(() => insert(db, 'ec_articles', 'incomplete-draft', {}, 'draft')).not.toThrow()
    expect(() => insert(db, 'ec_data_gaps', 'bad-gap', { ...gaps[0]!.data, theme_ids: ['invalid'] })).toThrow('dc_data_gaps')
    db.close()
  })
})
