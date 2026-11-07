import { describe, expect, test } from 'bun:test'
import { serveTile } from './tiles'
import { serveXyz } from './xyz'
import type { Env } from './types'

function disabledEnv(): Env {
  return {
    ENABLE_TILE_COMPAT: '0',
    TILES: {
      head: () => {
        throw new Error('disabled compatibility route touched R2')
      },
      get: () => {
        throw new Error('disabled compatibility route touched R2')
      },
    } as unknown as R2Bucket,
  } as Env
}

describe('legacy tile compatibility routes', () => {
  test('fail closed without touching R2', async () => {
    const env = disabledEnv()
    const ctx = { waitUntil() {} } as unknown as ExecutionContext

    const tile = await serveTile(new Request('https://example.test/tiles/anything.pmtiles'), env)
    const xyz = await serveXyz(new Request('https://example.test/xyz/anything/1/0/0'), env, ctx)

    expect(tile.status).toBe(404)
    expect(xyz.status).toBe(404)
  })
})
