import { describe, expect, test } from 'bun:test'
import packageJson from '../package.json'

describe('root development entrypoint', () => {
  test('starts the editorial site and explorer together', () => {
    expect(packageJson.scripts.dev).toBe('bun scripts/dev.mjs')
    expect(packageJson.scripts['dev:site']).toBe('bun run --cwd apps/site dev')
    expect(packageJson.scripts['dev:explore']).toBe('vite --mode explore')
  })
})
