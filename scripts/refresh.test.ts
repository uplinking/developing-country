import { describe, expect, test } from 'bun:test'
import registry from './data-sources.json'
import { freshnessOf } from '../src/shared/freshness'

const expectedDue = registry.sources.filter(source => {
  const state = freshnessOf(source, registry.freshness_policy, '2027-01-01')
  return state.scheduled && ['due', 'overdue'].includes(state.status)
}).map(source => source.id)

const root = new URL('..', import.meta.url).pathname

function refresh(...args: string[]) {
  return Bun.spawnSync(['bun', 'scripts/refresh.mjs', ...args], { cwd: root })
}

describe('refresh CLI', () => {
  test('selects only opted-in automated sources that are due', () => {
    const result = refresh('due', '--scheduled', '--ids', '--as-of', '2027-01-01')
    expect(result.exitCode).toBe(0)
    expect(result.stdout.toString().trim().split('\n')).toEqual(expectedDue)
  })

  test('keeps machine-readable output free of headings', () => {
    const result = refresh('due', '--scheduled', '--json', '--as-of', '2027-01-01')
    const rows = JSON.parse(result.stdout.toString())
    expect(rows.map((row: { id: string }) => row.id)).toEqual(expectedDue)
    expect(rows.every((row: { freshness: { scheduled: boolean } }) => row.freshness.scheduled)).toBe(true)
  })

  test('does not execute a curated source that happens to contain a build instruction', () => {
    const result = refresh('run', 'rda')
    expect(result.exitCode).toBe(0)
    expect(result.stdout.toString()).toContain('CURATED — no automated pull')
  })

  test('fails closed for a malformed assessment date', () => {
    const result = refresh('due', '--ids', '--as-of', 'not-a-date')
    expect(result.exitCode).toBe(1)
    expect(result.stderr.toString()).toContain('--as-of must be a valid YYYY-MM-DD date')
  })

  test('refuses an impossible source verification date before touching the registry', () => {
    const result = refresh('touch', 'osm', '2026-99-99')
    expect(result.exitCode).toBe(1)
    expect(result.stderr.toString()).toContain('bad date: 2026-99-99')
  })

  test('refuses a future source verification date before touching the registry', () => {
    const result = refresh('touch', 'osm', '2999-01-01')
    expect(result.exitCode).toBe(1)
    expect(result.stderr.toString()).toContain('bad date: 2999-01-01')
  })
})
