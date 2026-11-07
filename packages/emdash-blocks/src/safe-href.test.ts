import { describe, expect, test } from 'bun:test'
import { safeCmsHref } from './safe-href'

describe('CMS link boundary', () => {
  test('allows intentional navigation targets', () => {
    for (const href of ['/research', '/research?q=metro', '#sources', 'https://example.org/x', 'mailto:hi@example.org']) {
      expect(safeCmsHref(href)).toBe(href)
    }
  })

  test('rejects executable, protocol-relative, malformed, and control-character links', () => {
    for (const href of ['javascript:alert(1)', 'data:text/html,x', '//evil.example', '/\\evil.example', '/\\/evil.example', 'relative/path', '/safe\nunsafe']) {
      expect(safeCmsHref(href)).toBeNull()
    }
  })
})
