import { describe, expect, test } from 'bun:test'
import { canonicalRedirect } from './canonicalUrl'

const site = 'https://developing-country.org'

describe('canonicalRedirect', () => {
  test('leaves canonical URLs alone', () => {
    for (const path of ['/', '/analysis', '/analysis/how-far', '/countries/lk', '/data?tab=missing', '/sitemap.xml', '/og/default.jpg']) {
      expect(canonicalRedirect(`${site}${path}`)).toBeNull()
    }
  })

  test('moves plain http and www to the https apex', () => {
    expect(canonicalRedirect('http://developing-country.org/about')).toBe(`${site}/about`)
    expect(canonicalRedirect('https://www.developing-country.org/')).toBe(`${site}/`)
  })

  test('drops trailing slashes and keeps the query', () => {
    expect(canonicalRedirect(`${site}/analysis/`)).toBe(`${site}/analysis`)
    expect(canonicalRedirect(`${site}/data/?tab=missing`)).toBe(`${site}/data?tab=missing`)
    expect(canonicalRedirect(`${site}//about//`)).toBe(`${site}/about`)
  })

  test('lower-cases country codes', () => {
    expect(canonicalRedirect(`${site}/countries/LK`)).toBe(`${site}/countries/lk`)
  })

  test('sends EmDash collection URLs to the route that serves them', () => {
    expect(canonicalRedirect(`${site}/articles/how-far`)).toBe(`${site}/analysis/how-far`)
    expect(canonicalRedirect(`${site}/articles`)).toBeNull()
  })

  test('fixes several things in one hop', () => {
    expect(canonicalRedirect('http://developing-country.org/countries/LK/')).toBe(`${site}/countries/lk`)
  })

  test('never touches EmDash admin and API routes or other hosts', () => {
    expect(canonicalRedirect(`${site}/_emdash/admin/`)).toBeNull()
    expect(canonicalRedirect('http://localhost:4321/about')).toBeNull()
    expect(canonicalRedirect('http://localhost:4321/about/')).toBe('http://localhost:4321/about')
  })
})
