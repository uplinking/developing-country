import { describe, expect, test } from 'bun:test'
import { webRootUrl, webUrl } from './analyze'
import type { Env } from './types'

describe('cross-surface URL contracts', () => {
  test('public links use the explorer origin, never the legacy auth mount', () => {
    // SAFETY: webRootUrl/webUrl read only these documented optional URL fields.
    const env = {
      BETTER_AUTH_URL: 'https://example.org/app',
      PUBLIC_VIEW_ORIGIN: 'https://explore.developing-country.org',
    } as Env
    expect(webRootUrl(env)).toBe('https://explore.developing-country.org')
    expect(webUrl(env, 6.9271, 79.8612)).toBe(
      'https://explore.developing-country.org/?lat=6.9271&lng=79.8612',
    )
  })

  test('rejects a configured origin with a path', () => {
    // SAFETY: webRootUrl reads only PUBLIC_VIEW_ORIGIN.
    expect(() => webRootUrl({ PUBLIC_VIEW_ORIGIN: 'https://example.org/app' } as Env))
      .toThrow('PUBLIC_VIEW_ORIGIN must be an origin')
  })
})
