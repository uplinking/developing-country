// Minimal D1 binding over bun:sqlite, for tests that run Better Auth against
// the real migrations. Implements the subset Better Auth's D1 path uses:
// prepare().bind().all()/run()/first()/raw(), batch() and exec().
import { Database } from 'bun:sqlite'
import { readdirSync, readFileSync } from 'node:fs'

type Param = string | number | bigint | boolean | null | Uint8Array

// Real D1 binds only null, numbers, strings, booleans and binary. Anything else
// (a Date, an object) throws D1_TYPE_ERROR in production, so it throws here too.
function normalise(value: unknown): Param {
  if (value === undefined || value === null) return null
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') return value
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  throw new TypeError(`D1_TYPE_ERROR: Type '${typeof value}' not supported for value '${String(value)}'`)
}

class Statement {
  constructor(
    private readonly db: Database,
    readonly sql: string,
    private readonly params: Param[] = [],
  ) {}

  bind(...params: unknown[]): Statement {
    return new Statement(this.db, this.sql, params.map(normalise))
  }

  private exec(): { results: Record<string, unknown>[]; changes: number; lastRowId: number } {
    const query = this.db.query(this.sql)
    if (query.columnNames.length > 0) {
      const results = query.all(...this.params) as Record<string, unknown>[]
      return { results, changes: 0, lastRowId: 0 }
    }
    const info = query.run(...this.params)
    return { results: [], changes: info.changes, lastRowId: Number(info.lastInsertRowid) }
  }

  async all<T = Record<string, unknown>>() {
    const { results, changes, lastRowId } = this.exec()
    return { results: results as T[], success: true, meta: { changes, last_row_id: lastRowId, duration: 0 } }
  }

  async run() {
    return this.all()
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const { results } = this.exec()
    const row = results[0]
    if (!row) return null
    return (column ? row[column] : row) as T
  }

  async raw<T = unknown[]>(): Promise<T[]> {
    const query = this.db.query(this.sql)
    return query.values(...this.params) as T[]
  }
}

export class TestD1 {
  readonly sqlite: Database

  constructor() {
    this.sqlite = new Database(':memory:')
    this.sqlite.run('PRAGMA foreign_keys = ON')
  }

  prepare(sql: string): Statement {
    return new Statement(this.sqlite, sql)
  }

  async batch(statements: Statement[]) {
    const out = []
    for (const statement of statements) out.push(await statement.all())
    return out
  }

  async exec(sql: string) {
    this.sqlite.run(sql)
    return { count: 1, duration: 0 }
  }

  async dump(): Promise<ArrayBuffer> {
    return new ArrayBuffer(0)
  }

  /** Apply migrations/*.sql in order, optionally stopping before `before`. */
  migrate(options: { before?: string; only?: string } = {}): this {
    const dir = new URL('../../../migrations/', import.meta.url)
    for (const file of readdirSync(dir).sort()) {
      if (options.only && file !== options.only) continue
      if (options.before && file >= options.before) break
      this.sqlite.run(readFileSync(new URL(file, dir), 'utf8'))
    }
    return this
  }
}
