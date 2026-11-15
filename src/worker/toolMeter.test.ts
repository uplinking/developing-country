import { describe, expect, test } from 'bun:test'
import { clientLabel, meteredEnv, newToolMeter } from './toolMeter'
import type { Env } from './types'

// Small fakes shaped like the Workers bindings: enough to observe what the meter forwards and counts.
class FakeStatement {
  constructor(readonly sql: string, readonly values: unknown[] = []) {}
  bind(...values: unknown[]) { return new FakeStatement(this.sql, values) }
  async all() { return { results: [{ sql: this.sql, values: this.values }], meta: { rows_read: 7, rows_written: 0 } } }
  async run() { return { results: [], meta: { rows_read: 1, rows_written: 2 } } }
  async first() { return { sql: this.sql } }
}

class FakeD1 {
  batched: unknown[] = []
  prepare(sql: string) { return new FakeStatement(sql) }
  async batch(statements: unknown[]) {
    this.batched = statements
    return statements.map(() => ({ results: [], meta: { rows_read: 3, rows_written: 1 } }))
  }
}

const fakeR2 = {
  async get(key: string) { return { key, size: 100, body: new ReadableStream() } },
  async head(key: string) { return { key, size: 50 } },
  async list() { return { objects: [] } },
  async put() { return null },
}

const fakeAssets = {
  async fetch() { return new Response('{"a":1}', { headers: { 'content-length': '7' } }) },
}

function env(db = new FakeD1()): Env {
  return {
    DB: db, ASSETS: fakeAssets, TILES: fakeR2, VIEWS: fakeR2, DATASETS: fakeR2, BETTER_AUTH_SECRET: 'x',
  } as unknown as Env
}

describe('meteredEnv', () => {
  test('counts D1 queries and rows, and returns the real results', async () => {
    const meter = newToolMeter()
    const e = meteredEnv(env(), meter)
    const all = await e.DB.prepare('SELECT 1').bind(42).all()
    expect(all.results).toEqual([{ sql: 'SELECT 1', values: [42] }])
    await e.DB.prepare('UPDATE t').run()
    expect(await e.DB.prepare('SELECT 2').first()).toEqual({ sql: 'SELECT 2' })
    expect(meter).toMatchObject({ d1Queries: 3, d1RowsRead: 8, d1RowsWritten: 2 })
  })

  test('hands batch() the real statements, not the wrappers', async () => {
    const db = new FakeD1()
    const meter = newToolMeter()
    const e = meteredEnv(env(db), meter)
    await e.DB.batch([e.DB.prepare('A').bind(1), e.DB.prepare('B')])
    expect(db.batched.every((s) => s instanceof FakeStatement)).toBe(true)
    expect(meter).toMatchObject({ d1Queries: 2, d1RowsRead: 6, d1RowsWritten: 2 })
  })

  test('counts R2 operations by billing class and bytes read', async () => {
    const meter = newToolMeter()
    const e = meteredEnv(env(), meter)
    await e.DATASETS!.get('a')
    await e.TILES.head('b')
    await e.VIEWS.list()
    await e.VIEWS.put('c', 'x')
    expect(meter).toMatchObject({ r2ClassA: 2, r2ClassB: 2, r2BytesRead: 100 })
  })

  test('counts static asset fetches and bytes', async () => {
    const meter = newToolMeter()
    const res = await meteredEnv(env(), meter).ASSETS.fetch('https://assets.local/x.json')
    expect(await res.json()).toEqual({ a: 1 })
    expect(meter).toMatchObject({ assetFetches: 1, assetBytes: 7 })
  })

  test('keeps the original env untouched', async () => {
    const base = env()
    meteredEnv(base, newToolMeter())
    expect(base.DB).toBeInstanceOf(FakeD1)
  })
})

describe('clientLabel', () => {
  const jwt = (payload: object) =>
    ['e30', btoa(JSON.stringify(payload)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'), 'sig'].join('.')

  test('reads the azp claim of a JWT access token', () => {
    expect(clientLabel(`Bearer ${jwt({ azp: 'https://claude.ai/oauth/mcp-client', sub: 'u1' })}`))
      .toBe('https://claude.ai/oauth/mcp-client')
  })

  test('labels non-JWT and missing credentials', () => {
    expect(clientLabel('Bearer opaque-token')).toBe('opaque')
    expect(clientLabel(null)).toBe('session')
    expect(clientLabel(`Bearer ${jwt({ sub: 'u1' })}`)).toBe('unknown')
    expect(clientLabel('Bearer a.!!!.c')).toBe('unknown')
  })
})
