import { describe, expect, test } from 'bun:test'
import { crawlHint } from './crawlHints'

const origin = 'https://explore.developing-country.org'

describe('crawlHint', () => {
  test('folds every map state into the map at its root', () => {
    expect(crawlHint(`${origin}/`)).toEqual({ canonical: `${origin}/` })
    expect(crawlHint(`${origin}/?layers=metro,gnd&pop=1`)).toEqual({ canonical: `${origin}/` })
  })

  test('keeps live views and dataset charts as their own pages, without the query', () => {
    expect(crawlHint(`${origin}/views/view_1?x=1`)).toEqual({ canonical: `${origin}/views/view_1` })
    expect(crawlHint(`${origin}/datasets/ccpi-monthly/headline/`)).toEqual({ canonical: `${origin}/datasets/ccpi-monthly/headline` })
  })

  test('keeps embeds, the connect and sign-in flows, and unknown paths out of the index', () => {
    expect(crawlHint(`${origin}/?embed=dataset&layers=metro`)).toEqual({ noindex: true })
    expect(crawlHint(`${origin}/datasets/ccpi-monthly/headline?embed=dataset`)).toEqual({ noindex: true })
    expect(crawlHint(`${origin}/?connect=1`)).toEqual({ noindex: true })
    expect(crawlHint(`${origin}/?response_type=code&client_id=a&redirect_uri=b`)).toEqual({ noindex: true })
    expect(crawlHint(`${origin}/authorize`)).toEqual({ noindex: true })
    expect(crawlHint(`${origin}/brand`)).toEqual({ noindex: true })
  })

  test('honours a base path', () => {
    expect(crawlHint('https://example.org/app/views/v', '/app')).toEqual({ canonical: 'https://example.org/app/views/v' })
    expect(crawlHint('https://example.org/app', '/app')).toEqual({ canonical: 'https://example.org/app/' })
  })
})
