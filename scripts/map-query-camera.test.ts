import { describe, expect, test } from 'bun:test'
import { cameraFromDeepLink } from '../src/map/queryCamera'

describe('explorer deep-link camera', () => {
  test('leaves the explicit dataset embed camera alone', () => {
    expect(cameraFromDeepLink('?embed=dataset&lng=80.554&lat=7.968&zoom=6.8')).toBeNull()
  })

  test('reads ordinary explorer deep links', () => {
    expect(cameraFromDeepLink('?lng=79.86&lat=6.93&z=11.5')).toEqual({
      longitude: 79.86,
      latitude: 6.93,
      zoom: 11.5,
    })
  })

  test('uses the documented fallback only when z is absent', () => {
    expect(cameraFromDeepLink('?lng=79.86&lat=6.93')).toEqual({
      longitude: 79.86,
      latitude: 6.93,
      zoom: 13,
    })
    expect(cameraFromDeepLink('?lng=79.86&lat=6.93&z=not-a-number')).toBeNull()
  })
})
