import { describe, expect, test } from 'bun:test'
import { DIP_SECONDS, cameraAt, resolveKey, stillIndex, timeline, type FilmKey } from './lib/cameraFilm'
import { CHAPTER_SHOTS, COLOMBO_SHOT, explorerTour, filmSrc } from './lib/films'

const scene = { width: 1000, height: 500 }

describe('camera film', () => {
  test('a key aims at a point on its target box, zoomed relative to the fitted width', () => {
    const camera = resolveKey({ ax: 0.25, ay: 1, dx: 5, zoom: 2, tilt: 30 }, { x: 100, y: 50, width: 200, height: 40 }, scene, 0.5)
    expect(camera).toEqual({ tilt: 30, turn: 0, x: 155, y: 90, zoom: Math.log(1) })
  })

  test('a key with no target frames the whole scene', () => {
    expect(resolveKey({}, null, scene, 0.4)).toMatchObject({ x: 500, y: 250, zoom: Math.log(0.4) })
  })

  test('cuts split the path into runs and do not take travel time', () => {
    const keys: FilmKey[] = [{}, { after: 2 }, { after: 9, cut: true }, { after: 3 }]
    expect(timeline(keys)).toEqual({
      loop: 5,
      times: [0, 2, 2, 5],
      runs: [{ first: 0, last: 1, start: 0, end: 2 }, { first: 2, last: 3, start: 2, end: 5 }],
    })
  })

  test('the camera passes through every key and dips only at run edges', () => {
    const cameras = [0, 100, 300].map((x) => ({ tilt: 10, turn: 0, x, y: 0, zoom: 0 }))
    const plan = timeline([{}, { after: 4 }, { after: 4 }])
    expect(cameraAt(cameras, plan, 4).camera.x).toBeCloseTo(100)
    expect(cameraAt(cameras, plan, 4).dip).toBe(0)
    expect(cameraAt(cameras, plan, 0).dip).toBe(1)
    expect(cameraAt(cameras, plan, 8 - DIP_SECONDS / 2).dip).toBeCloseTo(0.5)
  })

  test('reduced motion rests on the key marked still, else the first', () => {
    expect(stillIndex([{}, { still: true }, {}])).toBe(1)
    expect(stillIndex([{}, {}])).toBe(0)
  })

  test('every explorer tour stays on its still and has one resting frame', async () => {
    for (const shot of [COLOMBO_SHOT, ...Object.values(CHAPTER_SHOTS)]) {
      for (const width of [shot.large, shot.small]) {
        expect(await Bun.file(`${import.meta.dir}/../public${filmSrc(shot, width)}`).exists()).toBe(true)
      }
      const keys = explorerTour(shot)
      expect(keys.filter((key) => key.still)).toHaveLength(1)
      for (const key of keys) {
        expect(key.ax).toBeGreaterThanOrEqual(0)
        expect(key.ax).toBeLessThanOrEqual(1)
        expect(key.ay).toBeGreaterThanOrEqual(0)
        expect(key.ay).toBeLessThanOrEqual(1)
      }
    }
  })
})
