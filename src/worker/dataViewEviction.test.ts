// Oldest-first eviction of saved views, run against the real migrations on a
// bun:sqlite-backed D1 binding so the database triggers are exercised too.
import { describe, expect, test } from 'bun:test'
import { createDataView, revokeDataView } from './dataViews'
import type { QuerySpatialResult } from './querySpatial'
import { TestD1 } from './testing/d1'
import type { Env, Identity } from './types'

const OWNER = 'reader@example.com'
const EDITOR = 'editor@example.com'
const CHART = { kind: 'chart', title: 'Unserved', family: 'comparison', dimension: { field: 'label' }, measure: { field: 'population_unserved' } }

function harness() {
  const db = new TestD1().migrate()
  const objects = new Map<string, string>()
  // SAFETY: the code under test touches only DB, VIEWS and these vars; TestD1 implements the D1 calls it makes.
  const env = {
    DB: db,
    VIEWS: {
      async put(key: string, value: string) { objects.set(key, value) },
      async get() { return null },
      async delete(key: string) { objects.delete(key) },
    },
    PUBLIC_VIEW_ORIGIN: 'https://explore.developing-country.org',
    VIEW_EDITOR_EMAILS: EDITOR,
  } as unknown as Env
  return { db, env }
}

/** Saved before this hour, so the hourly limit does not apply to the seed. */
function seed(db: TestD1, owner: string, count: number, revoked = false): void {
  db.sqlite.run(
    `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?1)
     INSERT INTO data_views (id, query_id, owner_email, visibility, kind, country, title, spec_json,
       result_json, result_path, result_bytes, result_checksum, dataset_version_ids, row_count, created_at, revoked_at)
     SELECT ?2 || '_' || i, ?2 || '_q' || i, ?3, 'link', 'chart', 'LK', 'Seed', '{}',
       '{"rows":[]}', NULL, 11, 'sha256:seed', '[]', 0,
       strftime('%Y-%m-%dT%H:%M:%fZ', '2026-01-01', '+' || i || ' minutes'),
       CASE WHEN ?4 THEN '2026-02-01T00:00:00.000Z' ELSE NULL END
     FROM n`,
    [count, `seed_${owner.split('@')[0]}${revoked ? '_r' : ''}`, owner, revoked ? 1 : 0],
  )
}

function live(db: TestD1, owner: string): Array<{ id: string }> {
  return db.sqlite.query<{ id: string }, [string]>(
    'SELECT id FROM data_views WHERE owner_email = ?1 AND revoked_at IS NULL ORDER BY created_at',
  ).all(owner)
}

function user(email: string): Identity {
  return { email, emailVerified: true, mode: 'user' }
}

function result(): QuerySpatialResult {
  return {
    op: 'gap',
    entities: ['gnd', 'metro_stop'],
    method: 'centroid_distance',
    generated_at: new Date().toISOString(),
    provenance: [{ source: 'Department of Census and Statistics', vintage: '2024', licence: 'official', refresh: 'annual' }],
    completeness: [{ status: 'complete', coverage: 1, coverage_note: 'All published rows.', known_gaps: [] }],
    summary: 'One aggregate result',
    count: 1,
    truncated: false,
    features: [],
    aggregates: { population_unserved: 123 },
    web_url: 'https://developing-country.org/',
    stage: [],
  }
}

describe('saved view eviction', () => {
  test('a full account saves by revoking its oldest view and clearing its payload', async () => {
    const { db, env } = harness()
    seed(db, OWNER, 50)
    const oldest = live(db, OWNER)[0]!.id

    const created = await createDataView(env, user(OWNER), CHART, { op: 'gap' }, result())

    const ids = live(db, OWNER).map((row) => row.id)
    expect(ids).toHaveLength(50)
    expect(ids).not.toContain(oldest)
    expect(ids).toContain(created.view.id)
    const evicted = db.sqlite.query<{ revoked_at: string | null; result_json: string | null; result_bytes: number }, [string]>(
      'SELECT revoked_at, result_json, result_bytes FROM data_views WHERE id = ?1',
    ).get(oldest)
    expect(evicted?.revoked_at).toBeString()
    expect(evicted?.result_json).toBe('')
    expect(evicted?.result_bytes).toBe(11)
  })

  test("an editor's views back articles, so a full editor account is refused instead", async () => {
    const { db, env } = harness()
    seed(db, EDITOR, 50)
    await expect(createDataView(env, user(EDITOR), CHART, { op: 'gap' }, result())).rejects.toThrow('quota is full')
    expect(live(db, EDITOR)).toHaveLength(50)
  })

  test('revoking by hand also clears the inline payload', async () => {
    const { db, env } = harness()
    const created = await createDataView(env, user(OWNER), CHART, { op: 'gap' }, result())
    expect(await revokeDataView(env, user(OWNER), created.view.id)).toBe(true)
    const row = db.sqlite.query<{ result_json: string }, [string]>('SELECT result_json FROM data_views WHERE id = ?1').get(created.view.id)
    expect(row?.result_json).toBe('')
  })
})

describe('data view eviction migration', () => {
  test('revoked rows no longer count toward the platform ceiling', () => {
    const { db } = harness()
    // Seed with the insert triggers off (each one rescans the table), then
    // re-apply this migration to restore the platform ceiling under test.
    const triggers = db.sqlite.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'trigger' AND sql LIKE '%BEFORE INSERT ON data_views%'").all()
    for (const { name } of triggers) db.sqlite.run(`DROP TRIGGER ${name}`)
    seed(db, 'old@example.com', 10_000, true)
    db.migrate({ only: '0014_data_view_eviction.sql' })
    expect(() => seed(db, OWNER, 1)).not.toThrow()
    seed(db, 'live@example.com', 9_999)
    expect(() => seed(db, 'extra@example.com', 1)).toThrow('platform count quota exceeded')
  })

  test('the claim stays frozen: only a revoked row may clear its payload, and only to empty', () => {
    const { db } = harness()
    seed(db, OWNER, 1)
    const id = live(db, OWNER)[0]!.id
    expect(() => db.sqlite.run("UPDATE data_views SET result_json = '' WHERE id = ?1", [id])).toThrow('immutable')
    expect(() => db.sqlite.run("UPDATE data_views SET revoked_at = 'now', result_json = 'x' WHERE id = ?1", [id])).toThrow('immutable')
    expect(() => db.sqlite.run("UPDATE data_views SET revoked_at = 'now', result_json = '' WHERE id = ?1", [id])).not.toThrow()
    expect(() => db.sqlite.run("UPDATE data_views SET title = 'changed' WHERE id = ?1", [id])).toThrow('immutable')
  })

  test('existing revoked rows lose their inline payload when the migration applies', () => {
    const db = new TestD1().migrate({ before: '0014_data_view_eviction.sql' })
    seed(db, OWNER, 2, true)
    db.migrate({ only: '0014_data_view_eviction.sql' })
    const rows = db.sqlite.query<{ result_json: string }, []>('SELECT result_json FROM data_views').all()
    expect(rows.map((row) => row.result_json)).toEqual(['', ''])
  })
})
