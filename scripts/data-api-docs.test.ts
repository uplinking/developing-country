import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { PYTHON_EXAMPLE, R_EXAMPLE } from '../apps/site/src/lib/apiExamples'

describe('data API guide', () => {
  test('the repository doc and the /api page show the same examples', () => {
    const doc = readFileSync(new URL('../docs/DATA_API.md', import.meta.url), 'utf8')
    expect(doc).toContain(`\`\`\`python\n${PYTHON_EXAMPLE}\n\`\`\``)
    expect(doc).toContain(`\`\`\`r\n${R_EXAMPLE}\n\`\`\``)
  })
})
