import { describe, expect, test } from 'bun:test'
import { liveViewUrlFromNode } from '../src/live-view'

describe('live Data View Portable Text compatibility', () => {
  test('prefers the non-reserved field used by new editorial blocks', () => {
    expect(liveViewUrlFromNode({
      view_url: 'https://explore.developing-country.org/views/view_new',
      id: 'https://explore.developing-country.org/views/view_legacy',
    })).toEndWith('/views/view_new')
  })

  test('survives EmDash renaming the legacy reserved url field to id', () => {
    const legacyUrl = 'https://explore.developing-country.org/views/view_roundtrip'
    expect(liveViewUrlFromNode({ url: legacyUrl })).toBe(legacyUrl)
    expect(liveViewUrlFromNode({ id: legacyUrl })).toBe(legacyUrl)
  })
})
