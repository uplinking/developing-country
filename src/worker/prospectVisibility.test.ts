import { describe, expect, test } from 'bun:test'
import { prospectForViewer, type ProspectRow } from './db'

const row: ProspectRow = {
  id: 'pro_1',
  user_email: 'owner@example.com',
  title: 'Flat near Galle Face',
  url: 'https://example.com/listing/1',
  lat: 6.9247,
  lng: 79.8446,
  notes: 'private note',
  verdict: 'shortlist',
  visibility: 'public',
  metadata: '{"budget":120}',
  created_at: '2026-11-01T00:00:00.000Z',
  updated_at: '2026-11-02T00:00:00.000Z',
}

describe('prospectForViewer', () => {
  test('the owner sees the full row', () => {
    const seen = prospectForViewer(row, 'owner@example.com')
    expect(seen).toMatchObject({ user_email: 'owner@example.com', notes: 'private note', metadata: { budget: 120 } })
  })

  test.each([
    ['another account', 'someone@example.com'],
    ['an anonymous caller', ''],
    ['a missing identity', undefined],
  ])('%s sees only the shared listing fields', (_label, viewer) => {
    const seen = prospectForViewer(row, viewer)
    expect(Object.keys(seen).sort()).toEqual(
      ['created_at', 'id', 'lat', 'lng', 'title', 'updated_at', 'url', 'verdict', 'visibility'].sort(),
    )
    expect(JSON.stringify(seen)).not.toContain('owner@example.com')
    expect(JSON.stringify(seen)).not.toContain('private note')
  })
})
