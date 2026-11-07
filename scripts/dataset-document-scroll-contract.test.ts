import { describe, expect, test } from 'bun:test'

const read = (path: string) => Bun.file(path).text()

describe('dataset report document scrolling', () => {
  test('dataset routes release the map shell body lock', async () => {
    const [bootstrap, globalCss] = await Promise.all([
      read('src/main.tsx'),
      read('src/index.css'),
    ])

    expect(bootstrap).toContain("document.body.classList.add('document-scroll')")
    expect(globalCss).toContain('body.document-scroll')
    expect(globalCss).toContain('overflow-y: auto')
  })
})
