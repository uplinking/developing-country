import { describe, expect, test } from 'bun:test'
import { CANONICAL_EXPLORER_ORIGIN, resolveExplorerHref } from './lib/explorer'

describe('site-to-explorer links', () => {
  test('keeps canonical links in production', () => {
    expect(resolveExplorerHref(`${CANONICAL_EXPLORER_ORIGIN}/?layers=metro`))
      .toBe(`${CANONICAL_EXPLORER_ORIGIN}/?layers=metro`)
  })

  test('uses the local explorer during site development', () => {
    expect(resolveExplorerHref(
      `${CANONICAL_EXPLORER_ORIGIN}/?layers=metro`,
      'http://127.0.0.1:5173',
    )).toBe('http://127.0.0.1:5173/?layers=metro')
  })

  test('does not rewrite unrelated external or relative links', () => {
    expect(resolveExplorerHref('https://example.org/map', 'http://127.0.0.1:5173'))
      .toBe('https://example.org/map')
    expect(resolveExplorerHref('/data', 'http://127.0.0.1:5173')).toBe('/data')
  })
})
