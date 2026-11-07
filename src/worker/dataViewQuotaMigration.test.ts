import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const migration = readFileSync(
  new URL('../../migrations/0011_data_view_inline_quota.sql', import.meta.url),
  'utf8',
)

describe('Data View inline quota migration', () => {
  test('accepts R2-backed claims but rejects inline storage above 256 MiB', () => {
    const db = new Database(':memory:')
    db.run(`CREATE TABLE data_views (
      id TEXT PRIMARY KEY,
      result_json TEXT,
      result_bytes INTEGER NOT NULL,
      revoked_at TEXT
    )`)
    db.run(migration)
    db.run("INSERT INTO data_views VALUES ('existing', 'x', 268435456, NULL)")
    expect(() => db.run("INSERT INTO data_views VALUES ('inline', 'x', 1, NULL)"))
      .toThrow('data view D1 inline byte quota exceeded')
    expect(() => db.run("INSERT INTO data_views VALUES ('r2', NULL, 8388608, NULL)"))
      .not.toThrow()
  })
})
