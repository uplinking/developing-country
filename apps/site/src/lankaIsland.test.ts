import { describe, expect, test } from 'bun:test'
import { DRAG_LIMIT, SPILL_LIP, SPILL_SCROLL, SPILL_SPEED, elephantPose, islandYaw, spillProgress, spillRows, spillThin, spillWet } from './lib/lankaIsland/render'
import { ISLAND, RIVER_MOUTH, SPILL_DEPTH, WATER_LEVEL, buildLankaIsland, frontEdge, sceneTransferables } from './lib/lankaIsland/scene'

describe('Lanka island scene', () => {
  const island = buildLankaIsland()

  test('the same seed builds the same island', () => {
    const again = buildLankaIsland()
    expect(again.terrain.positions).toEqual(island.terrain.positions)
    expect(again.terrain.colors).toEqual(island.terrain.colors)
    expect(again.water.positions).toEqual(island.water.positions)
  })

  test('every layer lines up positions, colours and water kinds', () => {
    const parts = island.animals.flatMap((animal) => animal.parts)
    for (const layer of [island.terrain, island.water, island.falls, ...island.clouds, ...parts]) {
      expect(layer.positions.length % 3).toBe(0)
      expect(layer.colors.length).toBe(layer.positions.length)
    }
    expect(island.water.sea.length).toBe(island.water.positions.length / 3)
  })

  test('voxels stay inside the grid', () => {
    const p = island.terrain.positions
    for (let i = 0; i < p.length; i += 3) {
      expect(p[i]).toBeGreaterThanOrEqual(0)
      expect(p[i]).toBeLessThan(ISLAND.width)
      expect(p[i + 1]).toBeLessThan(ISLAND.height)
      expect(p[i + 2]).toBeLessThan(ISLAND.depth)
    }
  })

  test('it holds both open sea and inland water, including the raised reservoir', () => {
    const { sea, positions } = island.water
    expect(sea.includes(1)).toBe(true)
    expect(sea.includes(0)).toBe(true)
    let reservoir = false
    for (let i = 0; i < sea.length; i++) if (sea[i] === 0 && positions[i * 3 + 1] > 10 && positions[i * 3 + 2] < 40) reservoir = true
    expect(reservoir).toBe(true)
  })

  test('the near shore bows towards the viewer and stays inside the grid', () => {
    expect(frontEdge(ISLAND.width / 2)).toBe(RIVER_MOUTH)
    expect(frontEdge(10)).toBeGreaterThan(frontEdge(60))
    expect(frontEdge(190)).toBeGreaterThan(frontEdge(140))
    expect(frontEdge(0)).toBeLessThan(ISLAND.depth)
    let deepest = 0
    const p = island.terrain.positions
    for (let i = 0; i < p.length; i += 3) deepest = Math.max(deepest, p[i + 2])
    expect(deepest).toBeGreaterThan(RIVER_MOUTH + 10)
  })

  test('two elephants, each a body with a head that carries its trunk and both ears', () => {
    expect(island.animals).toHaveLength(2)
    for (const { parts } of island.animals) {
      expect(parts.filter((part) => part.parent === -1).map((part) => part.kind)).toEqual(['body'])
      const head = parts.findIndex((part) => part.kind === 'head')
      expect(parts.filter((part) => part.parent === head).map((part) => part.kind).sort()).toEqual(['ear', 'ear', 'trunk'])
      for (const part of parts) expect(part.positions.length).toBeGreaterThan(0)
    }
  })

  test('every buffer is handed over once', () => {
    const buffers = sceneTransferables(island)
    expect(new Set(buffers).size).toBe(buffers.length)
  })

  test('the river pours off the front edge, top row first', () => {
    const p = island.spill.positions
    expect(p.length).toBeGreaterThan(0)
    for (let i = 0; i < p.length; i += 3) expect(p[i + 2]).toBeGreaterThan(RIVER_MOUTH)
    expect(p[1]).toBe(WATER_LEVEL)
    for (let i = 3; i < p.length; i += 3) expect(p[i + 1]).toBeLessThanOrEqual(p[i - 2])
    expect(p[p.length - 2]).toBeGreaterThan(WATER_LEVEL - SPILL_DEPTH)
    expect(island.spill.thin).toHaveLength(p.length / 3)
    expect(island.spill.lag).toHaveLength(p.length / 3)
  })

  test('the fall is thrown out towards the viewer, flares wider and comes apart', () => {
    const { positions: p, thin } = island.spill
    // Per row of the fall: its span across, how far out it has reached, and how broken it is.
    const rows = Array.from({ length: SPILL_DEPTH }, () => ({ left: Infinity, right: -Infinity, out: -Infinity, thin: 0, cells: 0 }))
    for (let i = 0; i < thin.length; i++) {
      const row = rows[WATER_LEVEL - p[i * 3 + 1]]
      row.left = Math.min(row.left, p[i * 3])
      row.right = Math.max(row.right, p[i * 3])
      row.out = Math.max(row.out, p[i * 3 + 2])
      row.thin += thin[i]
      row.cells++
    }
    const lip = rows[0], middle = rows[Math.floor(SPILL_DEPTH / 2)], last = rows[SPILL_DEPTH - 1]
    for (const row of rows) expect(row.cells).toBeGreaterThan(0)
    // Out: each row reaches at least as far forward as the one above, and well clear by the end.
    for (let d = 1; d < SPILL_DEPTH; d++) expect(rows[d].out).toBeGreaterThanOrEqual(rows[d - 1].out)
    expect(last.out - lip.out).toBeGreaterThan(10)
    // Wider: both edges move outwards, and while the sheet holds neither pulls back in past the lip.
    expect(middle.left).toBeLessThan(lip.left)
    expect(middle.right).toBeGreaterThan(lip.right)
    for (const row of rows.slice(0, Math.floor(SPILL_DEPTH / 2))) {
      expect(row.left).toBeLessThanOrEqual(lip.left)
      expect(row.right).toBeGreaterThanOrEqual(lip.right)
    }
    // Apart: a whole sheet at the lip, mostly gaps by the bottom.
    expect(lip.thin).toBe(0)
    expect(last.thin / last.cells).toBeGreaterThan(middle.thin / middle.cells)
    expect(last.thin / last.cells).toBeGreaterThan(96)
  })
})

describe('Lanka island motion', () => {
  test('a drag turns the island only a little either way', () => {
    expect(islandYaw(0)).toBe(0)
    expect(islandYaw(10)).toBe(DRAG_LIMIT)
    expect(islandYaw(-10)).toBe(-DRAG_LIMIT)
  })

  test('the drinker lifts its trunk now and then; the body never moves', () => {
    const drinker = { drinking: true, phase: 0 }
    const lifts = Array.from({ length: 70 }, (_, i) => elephantPose('trunk', drinker, 0, i / 10).pitch)
    expect(Math.min(...lifts)).toBeLessThan(-0.5)
    expect(elephantPose('body', drinker, 0, 3.2)).toEqual({ pitch: 0, yaw: 0, roll: 0 })
    expect(Math.sign(elephantPose('ear', drinker, -1, 1).yaw)).toBe(-Math.sign(elephantPose('ear', drinker, 1, 1).yaw))
  })

  test('scrolling pours the river from a lip to its full fall', () => {
    expect(spillProgress(0, 900)).toBe(0)
    expect(spillProgress(900 * SPILL_SCROLL, 900)).toBe(1)
    expect(spillProgress(5000, 900)).toBe(1)
    expect(spillRows(0)).toBe(SPILL_LIP)
    expect(spillRows(1)).toBe(SPILL_DEPTH)
  })

  test('the pour always ends in drops, never a cut line', () => {
    // Whole water well behind the leading end, nothing at it, and the fall's own break-up kept.
    expect(spillThin(0, 0, SPILL_DEPTH)).toBe(0)
    expect(spillThin(0, 0, SPILL_LIP)).toBe(0)
    expect(spillThin(0, SPILL_LIP, SPILL_LIP)).toBe(1)
    expect(spillThin(0, 19, 20)).toBeGreaterThan(spillThin(0, 16, 20))
    expect(spillThin(0.6, 2, SPILL_DEPTH)).toBe(0.6)
  })

  test('strands break into drops that fall with the flow', () => {
    const wetShare = (thin: number) => Array.from({ length: 400 }, (_, drop) => spillWet(thin, 0.3, drop, 0)).filter(Boolean).length / 400
    expect(wetShare(0)).toBe(1)
    expect(wetShare(1)).toBe(0)
    expect(wetShare(0.3)).toBeGreaterThan(wetShare(0.7))
    expect(wetShare(0.97)).toBeGreaterThan(0) // the last of a strand is still single drops
    // Half a second of flow later, every gap and drop is SPILL_SPEED / 2 rows further down.
    for (let drop = 0; drop < 60; drop++) expect(spillWet(0.6, 0.3, drop + SPILL_SPEED / 2, 0.5)).toBe(spillWet(0.6, 0.3, drop, 0))
  })
})
