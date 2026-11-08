import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { getStepper, jsObjectLiteralToJson, parseStepperHtml, resetStepperCache } from './stepper'
import type { Env } from './types'

const FIXTURE = readFileSync(new URL('./fixtures/steppermap-2026-11.html', import.meta.url), 'utf8')
// SAFETY: getStepper takes env for symmetry with the other adapters and never reads it.
const env = {} as Env

describe('parseStepperHtml', () => {
  test('reads the November 2026 page shape (`const SPOTS = [ … ]`)', () => {
    const spots = parseStepperHtml(FIXTURE)
    expect(spots.map((s) => s.id)).toEqual([0, 1, 41, 60])
    expect(spots[1]).toMatchObject({ name: 'Paravithota', cat: 'waterfall', lat: 6.611236956186576, lng: 80.27651985165593, ytId: 'eLgSQk40OxY', isShort: true })
    expect(spots[2]).toMatchObject({ name: "Galway's Land National Park", community: true })
    expect(spots[2].desc).toContain('<strong>Visitor tips:</strong> Placeholder [early mornings]')
  })

  test('still reads the earlier `const spots` shape', () => {
    const html = '<script>const spots = [ { id:1, name:"A", lat:6.9, lng:79.8, } ];</script>'
    expect(parseStepperHtml(html)).toMatchObject([{ id: 1, name: 'A', lat: 6.9, lng: 79.8 }])
  })

  test.each([
    ['a different name', '<script>let places = [{ name: "A", lat: 7, lng: 80 }]</script>'],
    ['a window global', '<script>window.SPOT_DATA = [{ name: "A", lat: 7, lng: 80 }]</script>'],
    ['single quotes and comments', "<script>var spots = [ // first\n { name: 'Ella\\'s', lat: 7, /* centre */ lng: 80, ytId: undefined }, ]</script>"],
    ['a JSON data block', '<script type="application/json" id="data">{"spots":[{"name":"A","lat":7,"lng":80}]}</script>'],
    ['string coordinates and lon', '<script>const SPOTS = [{ name: "A", lat: "7", lon: "80" }]</script>'],
  ])('finds the spots under %s', (_label, html) => {
    const [spot] = parseStepperHtml(html)
    expect(spot).toMatchObject({ lat: 7, lng: 80 })
  })

  test('skips array literals that hold no spots', () => {
    const html = "<script>const NATURE = ['waterfall'];\nconst rows = [{ a: 1 }];\nconst all = [{ name: 'A', lat: 7, lng: 80 }]</script>"
    expect(parseStepperHtml(html)).toHaveLength(1)
  })

  test('drops spots with missing or out-of-range coordinates', () => {
    const html = '<script>const SPOTS = [{ lat: 7, lng: 80 }, { lat: 700, lng: 80 }, { name: "no coords" }]</script>'
    expect(parseStepperHtml(html)).toHaveLength(1)
  })

  test('says what it tried when the data is gone', () => {
    expect(() => parseStepperHtml('<html>maintenance</html>')).toThrow('no array literal or JSON data block')
    expect(() => parseStepperHtml("<script>const NATURE = ['waterfall']</script>")).toThrow('tried NATURE (no lat/lng objects)')
  })
})

describe('jsObjectLiteralToJson', () => {
  test('leaves prose that looks like keys, brackets or comments alone', () => {
    const src = `[{ desc: "see: [this] // not a comment", other: 'it\\'s "quoted"' }]`
    expect(JSON.parse(jsObjectLiteralToJson(src))).toEqual([{ desc: 'see: [this] // not a comment', other: `it's "quoted"` }])
  })
})

describe('getStepper', () => {
  const realFetch = globalThis.fetch
  let page: string | Error
  let fetches = 0

  beforeEach(() => {
    resetStepperCache()
    fetches = 0
    globalThis.fetch = Object.assign(
      async () => {
        fetches++
        if (page instanceof Error) throw page
        return new Response(page, { headers: { 'content-type': 'text/html' } })
      },
      { preconnect: realFetch.preconnect },
    )
  })
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  test('returns a FeatureCollection from the live page', async () => {
    page = FIXTURE
    const result = await getStepper(env)
    expect(result.type).toBe('FeatureCollection')
    expect(result.stale).toBeUndefined()
    expect(result.features).toHaveLength(4)
    expect(result.features[0].geometry.coordinates).toEqual([80.3280173, 5.9901834])
    expect(result.features[1].properties).toMatchObject({ ytUrl: 'https://www.youtube.com/watch?v=eLgSQk40OxY' })
  })

  test('serves the last good copy, marked stale, when the page stops parsing', async () => {
    page = FIXTURE
    await getStepper(env)
    page = '<html>redesigned</html>'
    const result = await getStepper(env, true)
    expect(result.stale).toBe(true)
    expect(result.stale_reason).toContain('steppermap.com')
    expect(result.features).toHaveLength(4)
    // Within the failure backoff the stale copy is served without refetching.
    const before = fetches
    expect((await getStepper(env)).stale).toBe(true)
    expect(fetches).toBe(before)
  })

  test('serves the last good copy when the fetch itself fails', async () => {
    page = FIXTURE
    await getStepper(env)
    page = new Error('network down')
    expect(await getStepper(env, true)).toMatchObject({ stale: true, stale_reason: 'network down' })
  })

  test('throws when there is no good copy to fall back to', async () => {
    page = '<html>redesigned</html>'
    await expect(getStepper(env)).rejects.toThrow('no array literal')
  })
})
