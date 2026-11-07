import { describe, expect, test } from 'bun:test'
import { persistAndFanout } from './stageFanout'
import type { Env } from './types'

describe('stage snapshot retention', () => {
  test('every write prunes expired snapshots globally with ISO timestamps', async () => {
    const statements: Array<{ sql: string; values: unknown[] }> = []
    const db = {
      prepare(sql: string) {
        const call = { sql, values: [] as unknown[] }
        statements.push(call)
        const statement = {
          bind(...values: unknown[]) {
            call.values = values
            return statement
          },
          async run() {
            return { success: true, meta: { changes: 1 } }
          },
        }
        return statement
      },
    }
    await persistAndFanout(
      { DB: db } as unknown as Env,
      {
        email: 'Researcher@Example.com',
        tool: 'query_spatial',
        events: [{ t: 'narrate', title: 'Fresh result', body: 'Ready', kind: 'info' }],
      },
    )

    expect(statements).toHaveLength(2)
    expect(statements[1]?.sql).toContain("strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days')")
    expect(statements[1]?.sql).not.toContain('user_email')
    expect(statements[1]?.values).toEqual([])
  })
})
