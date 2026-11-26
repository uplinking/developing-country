import { describe, expect, test } from 'bun:test'

process.env.BASE_URL = process.env.BASE_URL ?? '/'
const { LAYER_GROUPS, STACK_ORDER } = await import('../src/map/layers')

describe('map stack order', () => {
  test('every panel layer is drawn by the map', () => {
    const missing = LAYER_GROUPS.filter((g) => !g.analysisOnly && !STACK_ORDER.includes(g.id)).map((g) => g.id)
    expect(missing).toEqual([])
  })

  test('analysis-only layers stay off the main map', () => {
    const drawn = LAYER_GROUPS.filter((g) => g.analysisOnly && STACK_ORDER.includes(g.id)).map((g) => g.id)
    expect(drawn).toEqual([])
  })

  test('the metro article layers are analysis-only', () => {
    const ids = LAYER_GROUPS.filter((g) => g.analysisOnly).map((g) => g.id)
    expect(ids).toEqual(['metro_walksheds', 'metro-gap-clusters', 'metro-route-candidates'])
  })
})
