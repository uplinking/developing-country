import { describe, expect, test } from 'bun:test'
import { blockComponents } from '../src/astro'
import { createPlugin, INTERACTIVE_BLOCK_TYPES, parseUnderlayUrls, viewUrlsInContent } from '../src'
import { safeFigureViewUrl, safeScrollySteps, safeUnderlayUrls, numberField } from '../src/figure-view'

const view = 'https://explore.developing-country.org/views/view_gndcoverage'

describe('interactive article blocks', () => {
  test('every interactive block has an admin editor and a renderer', () => {
    const configs = createPlugin().admin?.portableTextBlocks ?? []
    for (const type of INTERACTIVE_BLOCK_TYPES) {
      expect(configs.some((config) => config.type === type)).toBe(true)
      expect(type in blockComponents).toBe(true)
    }
    const scrolly = configs.find((config) => config.type === 'dcScrolly')
    const steps = scrolly?.fields?.find((field) => field.action_id === 'steps')
    expect(steps?.type).toBe('repeater')
  })

  test('view URLs must be canonical, on the platform origin and not the site', () => {
    expect(safeFigureViewUrl(view, 'https://developing-country.org')).toBe(view)
    expect(safeFigureViewUrl(`${view}?embed=1`, 'https://developing-country.org')).toBeNull()
    expect(safeFigureViewUrl('https://evil.example/views/view_a', 'https://developing-country.org')).toBeNull()
    expect(safeFigureViewUrl(view, 'https://explore.developing-country.org')).toBeNull()
    expect(safeFigureViewUrl(42, 'https://developing-country.org')).toBeNull()
  })

  test('one bad scrolly step fails the whole block closed', () => {
    expect(safeScrollySteps([{ text: 'a', view_url: view, zoom: '' }], 'https://developing-country.org')).toEqual([{ text: 'a', view_url: view, zoom: '' }])
    expect(safeScrollySteps([{ text: 'a', view_url: view }, { text: 'b', view_url: 'nope' }], 'https://developing-country.org')).toBeNull()
    expect(safeScrollySteps([], 'https://developing-country.org')).toBeNull()
  })

  test('CMS number fields never turn blank into zero', () => {
    expect(numberField({ min: '' }, 'min')).toBeUndefined()
    expect(numberField({ min: '0' }, 'min')).toBe(0)
    expect(numberField({ min: 12.5 }, 'min')).toBe(12.5)
  })
})

describe('underlay_urls', () => {
  const outlines = 'https://explore.developing-country.org/views/view_outlines'
  const density = 'https://explore.developing-country.org/views/view_density'

  test('parse helper trims, drops blanks and de-duplicates', () => {
    expect(parseUnderlayUrls(` ${density}, ,${density},${outlines} `)).toEqual([density, outlines])
    expect(parseUnderlayUrls(undefined)).toEqual([])
    expect(parseUnderlayUrls(42)).toEqual([])
  })

  test('viewUrlsInContent includes figure and step underlays so the gate requires them', () => {
    expect(viewUrlsInContent([
      { _type: 'dcFigure', view_url: outlines, underlay_urls: density },
      { _type: 'dcScrolly', steps: [{ text: 'a', view_url: outlines, underlay_urls: `${density}` }, { text: 'b', view_url: density }] },
      { _type: 'dcStat', view_url: density, underlay_urls: outlines },
    ])).toEqual([outlines, density, outlines, density, density, density])
  })

  test('Astro validation fails the block closed on one bad underlay', () => {
    expect(safeUnderlayUrls(`${density},${outlines}`, 'https://developing-country.org')).toEqual([density, outlines])
    expect(safeUnderlayUrls(`${density},https://evil.example/views/view_x`, 'https://developing-country.org')).toBeNull()
    expect(safeUnderlayUrls('', 'https://developing-country.org')).toEqual([])
    expect(safeScrollySteps([{ text: 'a', view_url: outlines, underlay_urls: 'nope' }], 'https://developing-country.org')).toBeNull()
    expect(safeScrollySteps([{ text: 'a', view_url: outlines, underlay_urls: density }], 'https://developing-country.org')?.[0]?.underlay_urls).toBe(density)
  })
})
