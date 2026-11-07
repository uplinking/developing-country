import { describe, expect, test } from 'bun:test'
import { aggregateFreshness, freshnessOf } from '../src/shared/freshness'

const policy = { automated_default_days: 30, curated_default_days: 90, overdue_multiplier: 2 }

describe('source freshness state', () => {
  test('uses the end of imprecise registry periods', () => {
    expect(freshnessOf({ refreshed: '2026-08', refresh: 'bun run fetch' }, policy, '2026-09-30')).toMatchObject({
      status: 'fresh', age_days: 30, due_at: '2026-10-01', kind: 'automated',
    })
    expect(freshnessOf({ refreshed: '2026', refresh: 'curated' }, policy, '2026-08-26').age_days).toBe(0)
  })

  test('distinguishes due, overdue, live, and invalid states', () => {
    expect(freshnessOf({ refreshed: '2026-07-01', refresh: 'bun run fetch' }, policy, '2026-08-02').status).toBe('due')
    expect(freshnessOf({ refreshed: '2026-05-01', refresh: 'bun run fetch' }, policy, '2026-08-02').status).toBe('overdue')
    expect(freshnessOf({ refreshed: '2000', refresh: 'live' }, policy, '2026-08-02').status).toBe('live')
    expect(freshnessOf({ refreshed: 'not-a-date', refresh: 'curated' }, policy, '2026-08-02').status).toBe('invalid')
    expect(freshnessOf({ refreshed: '2026-08-03', refresh: 'curated' }, policy, '2026-08-02').status).toBe('invalid')
    expect(freshnessOf({ refreshed: '2026-09', refresh: 'curated' }, policy, '2026-08-02').status).toBe('invalid')
    expect(freshnessOf({ refreshed: '2026-13', refresh: 'curated' }, policy, '2026-08-02').status).toBe('invalid')
    expect(freshnessOf({ refreshed: '2026-02-31', refresh: 'curated' }, policy, '2026-08-02').status).toBe('invalid')
  })

  test('scheduling is opt-in and automated-only', () => {
    expect(freshnessOf({ refreshed: '2026-01-01', refresh: 'bun run fetch', scheduled: true }, policy, '2026-08-02').scheduled).toBe(true)
    expect(freshnessOf({ refreshed: '2026-01-01', refresh: 'curated', scheduled: true }, policy, '2026-08-02').scheduled).toBe(false)
  })

  test('dataset freshness is the worst required source state', () => {
    const states = [
      freshnessOf({ refreshed: '2026-08-01', refresh: 'bun run fetch' }, policy, '2026-08-20'),
      freshnessOf({ refreshed: '2026-01-01', refresh: 'curated' }, policy, '2026-08-20'),
    ]
    expect(aggregateFreshness(states).status).toBe('overdue')
  })
})
