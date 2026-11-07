import { describe, expect, test } from 'bun:test'
import { ApiError } from './errors'
import { queryErrorBody, querySpatial } from './querySpatial'
import type { Env } from './types'

async function unavailable(args: Record<string, unknown>) {
  try {
    await querySpatial({ ENABLE_HEAVY_SPATIAL: '0' } as Env, null, args)
    throw new Error('expected query to fail')
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError)
    const typed = error as ApiError
    expect(typed.status).toBe(503)
    return queryErrorBody(typed)
  }
}

describe('cost-capped spatial operators', () => {
  test('rejects all-pairs gap distance before loading data', async () => {
    const body = await unavailable({
      op: 'gap',
      entities: 'gnd',
      covered_by: 'metro_stop',
      method: 'centroid_distance',
      threshold_m: 800,
    })
    expect(body.error).toBe('operator_unavailable')
    expect(body.method).toBe('centroid_distance')
  })

  test('rejects graph traversal before authentication or graph reads', async () => {
    const body = await unavailable({
      op: 'isochrone',
      origin: { lat: 6.9271, lng: 79.8612 },
      mode: 'walk',
      minutes: 10,
    })
    expect(body.error).toBe('operator_unavailable')
    expect(body.op).toBe('isochrone')
  })
})
