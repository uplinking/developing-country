import { describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { datasetFieldPreflightSql } from './datasetFieldMigration'

describe('dataset field migration preflight', () => {
  test('adds fields and the dataset indexes to a legacy article collection', () => {
    const sql = datasetFieldPreflightSql(new Set(['id', 'slug']))

    expect(sql).toContain('ALTER TABLE ec_articles ADD COLUMN format TEXT')
    expect(sql).toContain('ALTER TABLE ec_articles ADD COLUMN dataset_id TEXT')
    expect(sql).toContain('ALTER TABLE ec_articles ADD COLUMN dataset_preview_url TEXT')
    expect(sql).toContain('idx_cf_01m0zrqh7j1hzrd9weetdatrqj')
    expect(sql).toContain('idx_cf_01m0zrqh7j1hzrd9weetdatrqj_loc')
  })

  test('only reconciles metadata when the physical fields already exist', () => {
    const sql = datasetFieldPreflightSql(new Set([
      'format',
      'dataset_id',
      'dataset_preview_url',
    ]))

    expect(sql).not.toContain('ALTER TABLE')
    expect(sql).not.toContain('CREATE INDEX')
    expect(sql).toContain("AND slug = 'format'")
    expect(sql).toContain("AND slug = 'dataset_id'")
    expect(sql).toContain("AND slug = 'dataset_preview_url'")
  })

  test('upgrades the legacy production table shape', () => {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE ec_articles (
        id TEXT PRIMARY KEY,
        locale TEXT,
        deleted_at TEXT
      );
      CREATE TABLE _emdash_collections (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE
      );
      CREATE TABLE _emdash_fields (
        id TEXT PRIMARY KEY,
        collection_id TEXT NOT NULL,
        slug TEXT NOT NULL,
        label TEXT NOT NULL,
        type TEXT NOT NULL,
        column_type TEXT NOT NULL,
        required INTEGER NOT NULL,
        "unique" INTEGER NOT NULL,
        default_value TEXT,
        validation TEXT,
        widget TEXT,
        options TEXT,
        sort_order INTEGER NOT NULL,
        searchable INTEGER NOT NULL,
        translatable INTEGER NOT NULL,
        indexed INTEGER NOT NULL
      );
      INSERT INTO _emdash_collections (id, slug) VALUES ('articles-id', 'articles');
    `)

    db.exec(datasetFieldPreflightSql(new Set(['id', 'locale', 'deleted_at'])))

    const columns = db.query("SELECT name FROM pragma_table_info('ec_articles')").all()
      .map((row) => (row as { name: string }).name)
    expect(columns).toContain('format')
    expect(columns).toContain('dataset_id')
    expect(columns).toContain('dataset_preview_url')
    expect(db.query('SELECT slug FROM _emdash_fields ORDER BY sort_order').all()).toEqual([
      { slug: 'format' },
      { slug: 'dataset_id' },
      { slug: 'dataset_preview_url' },
    ])
    expect(db.query("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_cf_%'").all())
      .toHaveLength(2)
  })
})
