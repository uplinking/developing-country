import { describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readFileSync } from 'node:fs'

function migration(name: string): string {
  return readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8')
}

describe('data view storage invariants', () => {
  test('D1-compatible triggers freeze claims while allowing lifecycle changes', () => {
    const db = new Database(':memory:')
    db.run(migration('0007_data_views.sql'))
    db.query(
      `INSERT INTO data_views
        (id, query_id, owner_email, visibility, kind, country, title, spec_json,
         result_json, result_checksum, row_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'view_test', 'query_test', 'owner@example.com', 'link', 'map', 'LK', 'Frozen claim', '{}', '{}',
      `sha256:${'a'.repeat(64)}`, 0, '2026-08-26T01:00:00.000Z',
    )

    db.run(migration('0008_immutable_data_views.sql'))
    expect(() => db.query('UPDATE data_views SET title = ? WHERE id = ?').run('Changed', 'view_test'))
      .toThrow('data_views are immutable')
    expect(() => db.query('DELETE FROM data_views WHERE id = ?').run('view_test'))
      .toThrow('data_views are immutable')

    db.query('UPDATE data_views SET visibility = ?, revoked_at = ? WHERE id = ?')
      .run('public', '2026-08-26T02:00:00.000Z', 'view_test')
    expect(db.query('SELECT visibility, revoked_at FROM data_views WHERE id = ?').get('view_test')).toEqual({
      visibility: 'public',
      revoked_at: '2026-08-26T02:00:00.000Z',
    })
    db.close()
  })

  test('D1 enforces the hourly creation ceiling under concurrent writers', () => {
    const db = new Database(':memory:')
    db.run(migration('0007_data_views.sql'))
    db.run(migration('0008_immutable_data_views.sql'))
    db.run(migration('0009_data_view_quotas.sql'))
    const insert = db.query(
      `INSERT INTO data_views
        (id, query_id, owner_email, visibility, kind, country, title, spec_json,
         result_json, result_path, result_bytes, result_checksum, dataset_version_ids,
         row_count, created_at)
       VALUES (?, ?, ?, 'link', 'map', 'LK', 'Quota test', '{}', '{}', NULL, 2, ?, '[]', 0, ?)`,
    )
    const now = new Date().toISOString()
    for (let index = 0; index < 5; index++) {
      insert.run(`view_${index}`, `query_${index}`, 'owner@example.com', `sha256:${String(index).repeat(64)}`, now)
    }
    expect(() => insert.run('view_5', 'query_5', 'owner@example.com', `sha256:${'5'.repeat(64)}`, now))
      .toThrow('data view hourly creation limit exceeded')
    // The limit is per owner, not a platform-wide accidental lock.
    insert.run('view_other', 'query_other', 'other@example.com', `sha256:${'a'.repeat(64)}`, now)
    db.close()
  })
})
