import { Database } from 'bun:sqlite'
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, test } from 'bun:test'
import { datasetFieldPreflightSql } from './datasetFieldMigration'
import { datasetExploreUrl, datasetNotes } from './lib/datasets'
import { datasetPreviewAdditionMigrationSql, datasetPreviewMigrationSql, datasetPreviewCurrentMigrationSql } from './datasetPreviewSql'

const initialMigration = readFileSync(new URL('../migrations/0003_dataset_preview_urls.sql', import.meta.url), 'utf8')
const cameraMigration = readFileSync(new URL('../migrations/0004_dataset_preview_cameras.sql', import.meta.url), 'utf8')
const chartMigration = readFileSync(new URL('../migrations/0005_indicator_chart_previews.sql', import.meta.url), 'utf8')
const landCoverMigration = readFileSync(new URL('../migrations/0006_land_cover_grid_preview.sql', import.meta.url), 'utf8')
const extensions = readdirSync(new URL('../migrations/', import.meta.url)).filter(name => /^\d{4}_.*preview.*\.sql$/.test(name) && Number(name.slice(0, 4)) > 8).sort().map(name => readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'))
const currentMigration = readFileSync(new URL('../migrations/0008_current_dataset_previews.sql', import.meta.url), 'utf8')

function database(includeLandCover = true) {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE ec_articles (
      id TEXT PRIMARY KEY,
      status TEXT,
      locale TEXT,
      deleted_at TEXT,
      evidence_bundle TEXT
    );
    CREATE TABLE _emdash_collections (id TEXT PRIMARY KEY, slug TEXT);
    CREATE TABLE _emdash_fields (
      id TEXT PRIMARY KEY,
      collection_id TEXT,
      slug TEXT,
      label TEXT,
      type TEXT,
      column_type TEXT,
      required INTEGER,
      "unique" INTEGER,
      default_value TEXT,
      validation TEXT,
      widget TEXT,
      options TEXT,
      sort_order INTEGER,
      searchable INTEGER,
      translatable INTEGER,
      indexed INTEGER
    );
    INSERT INTO _emdash_collections (id, slug) VALUES ('articles', 'articles');
  `)
  db.exec(datasetFieldPreflightSql(new Set(['id', 'status', 'locale', 'deleted_at'])))
  db.exec(`
    INSERT INTO ec_articles (id, status, format, dataset_id, evidence_bundle) VALUES
      ('demographics', 'published', 'dataset_note', 'demographics', '{"datasetVersions":[{"datasetId":"demographics"}]}'),
      ('walking', 'published', 'dataset_note', 'osm_foot_graph', '{"datasetVersions":[{"datasetId":"osm_foot_graph"}]}'),
      ('labour', 'published', 'dataset_note', 'labour-force', '{"datasetVersions":[{"datasetId":"labour-force"}]}'),
      ('land-cover', 'draft', 'dataset_note', 'land-cover-grid', '{"datasetVersions":[{"datasetId":"land-cover-grid"}]}'),
      ('analysis', 'published', 'analysis', NULL, '{"datasetVersions":[]}');
  `)
  db.exec(initialMigration)
  db.exec(cameraMigration)
  db.exec(chartMigration)
  if (includeLandCover) { db.exec(landCoverMigration); db.exec(currentMigration); for (const sql of extensions) db.exec(sql) }
  return db
}

describe('dataset preview migration', () => {
  test('reproduces the frozen 0008 registration snapshot', () => {
    expect(currentMigration).toBe(datasetPreviewCurrentMigrationSql())
  })
  test('keeps the applied 0005 snapshot immutable and generated', () => {
    expect(chartMigration).toBe(datasetPreviewMigrationSql())
  })

  test('generates the append-only land-cover extension exactly', () => {
    expect(landCoverMigration).toBe(datasetPreviewAdditionMigrationSql())
  })

  test('extends the registry without rewriting the 0005 snapshot', () => {
    const db = database(false)
    expect(db.query('SELECT count(*) AS count FROM dc_dataset_previews').get()).toEqual({ count: 31 })
    expect(db.query('SELECT preview_url FROM dc_dataset_previews WHERE dataset_id = ?').get('land-cover-grid'))
      .toBeNull()
    db.exec(landCoverMigration)
    expect(db.query('SELECT count(*) AS count FROM dc_dataset_previews').get()).toEqual({ count: 32 })
    expect(db.query('SELECT preview_url AS url FROM dc_dataset_previews WHERE dataset_id = ?').get('land-cover-grid'))
      .toEqual({ url: datasetExploreUrl('land-cover-grid', true) })
    db.close()
  })

  test('persists one exact D1 contract row for every registered dataset', () => {
    const db = database()
    const rows = db.query('SELECT dataset_id AS id, preview_url AS url FROM dc_dataset_previews ORDER BY dataset_id').all()
    const expected = datasetNotes.map((dataset) => ({
      id: dataset.id,
      url: dataset.preview ? datasetExploreUrl(dataset.id, true) : null,
    })).sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
    expect(rows).toEqual(expected)
    db.close()
  })

  test('backfills map, chart, and genuine no-preview notes', () => {
    const db = database()
    expect(db.query('SELECT dataset_preview_url AS url FROM ec_articles WHERE id = ?').get('demographics'))
      .toEqual({ url: datasetExploreUrl('demographics', true) })
    expect(db.query('SELECT dataset_preview_url AS url FROM ec_articles WHERE id = ?').get('labour'))
      .toEqual({ url: datasetExploreUrl('labour-force', true) })
    expect(db.query('SELECT dataset_preview_url AS url FROM ec_articles WHERE id = ?').get('walking'))
      .toEqual({ url: null })
    expect(db.query('SELECT dataset_preview_url AS url FROM ec_articles WHERE id = ?').get('land-cover'))
      .toEqual({ url: datasetExploreUrl('land-cover-grid', true) })
    expect(db.query("SELECT label FROM _emdash_fields WHERE slug = 'dataset_preview_url'").get())
      .toEqual({ label: 'Dataset preview URL' })
    db.close()
  })

  test('keeps the existing map contract and blocks a retired camera', () => {
    const db = database()
    expect(() => db.query(`
      UPDATE ec_articles SET dataset_preview_url = ? WHERE id = 'demographics'
    `).run('https://explore.developing-country.org/?embed=dataset&pop=gnd&lng=80.7&lat=7.85&zoom=7.1')).toThrow()
    expect(() => db.query(`
      UPDATE ec_articles SET dataset_preview_url = ? WHERE id = 'demographics'
    `).run(datasetExploreUrl('demographics', true))).not.toThrow()
    db.close()
  })

  test('allows only the registered embedded chart preset', () => {
    const db = database()
    const canonical = datasetExploreUrl('labour-force', true)
    expect(() => db.query(`
      UPDATE ec_articles SET dataset_preview_url = ? WHERE id = 'labour'
    `).run(datasetExploreUrl('labour-force'))).toThrow()
    expect(() => db.query(`
      UPDATE ec_articles SET dataset_preview_url = ? WHERE id = 'labour'
    `).run(canonical)).not.toThrow()
    expect(() => db.query(`
      INSERT INTO ec_articles (id, status, format, dataset_id, dataset_preview_url)
      VALUES ('new-labour', 'published', 'dataset_note', 'labour-force', ?)
    `).run(canonical)).toThrow()
    expect(() => db.query(`
      INSERT INTO ec_articles (id, status, format, dataset_id, dataset_preview_url, evidence_bundle)
      VALUES ('new-labour-valid', 'published', 'dataset_note', 'labour-force', ?, ?)
    `).run(canonical, '{"datasetVersions":[{"datasetId":"labour-force"}]}')).not.toThrow()
    db.close()
  })

  test('keeps the D1 evidence-to-dataset check in parity with publication validation', () => {
    const db = database()
    const canonical = datasetExploreUrl('labour-force', true)
    expect(() => db.query(`
      INSERT INTO ec_articles (id, status, format, dataset_id, dataset_preview_url, evidence_bundle)
      VALUES ('mismatched', 'published', 'dataset_note', 'labour-force', ?, ?)
    `).run(canonical, '{"datasetVersions":[{"datasetId":"demographics"}]}')).toThrow()
    db.close()
  })

  test('allows the registered land-cover map only with matching evidence', () => {
    const db = database()
    const canonical = datasetExploreUrl('land-cover-grid', true)
    expect(() => db.query(`
      INSERT INTO ec_articles (id, status, format, dataset_id, dataset_preview_url, evidence_bundle)
      VALUES ('land-cover-published', 'published', 'dataset_note', 'land-cover-grid', ?, ?)
    `).run(canonical, '{"datasetVersions":[{"datasetId":"land-cover-grid"}]}')).not.toThrow()
    expect(() => db.query(`
      INSERT INTO ec_articles (id, status, format, dataset_id, dataset_preview_url, evidence_bundle)
      VALUES ('land-cover-wrong-layer', 'published', 'dataset_note', 'land-cover-grid', ?, ?)
    `).run(datasetExploreUrl('parks', true), '{"datasetVersions":[{"datasetId":"land-cover-grid"}]}')).toThrow()
    db.close()
  })

  test('fails closed for an unknown published dataset note', () => {
    const db = database()
    expect(() => db.query(`
      INSERT INTO ec_articles (id, status, format, dataset_id, dataset_preview_url, evidence_bundle)
      VALUES ('unknown', 'published', 'dataset_note', 'unknown-dataset', NULL, ?)
    `).run('{"datasetVersions":[{"datasetId":"unknown-dataset"}]}')).toThrow()
    db.close()
  })
})
