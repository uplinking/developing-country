import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { CountryLogo } from './CountryLogo'

test('country lettering is separate and safely escaped', () => {
  const html = renderToStaticMarkup(createElement(CountryLogo, { country: 'Trinidad & Tobago' }))
  expect(html).toContain('Trinidad &amp; Tobago')
  expect(html).toContain('<text')
  expect(html).not.toContain('<image')
})

test('the mark-only variant has no lettering or opaque background', () => {
  const html = renderToStaticMarkup(createElement(CountryLogo, { showCountry: false }))
  expect(html).not.toContain('<text')
  expect(html).not.toContain('<rect')
  expect(html).toContain('aria-label="Developing Country"')
})

test('multiple dithered logos have unique pattern references', () => {
  const html = renderToStaticMarkup(createElement('div', null,
    createElement(CountryLogo, { texture: 'dither' }),
    createElement(CountryLogo, { texture: 'dither' })))
  const ids = [...html.matchAll(/<pattern id="([^"]+)"/g)].map(match => match[1])
  expect(ids.length).toBe(2)
  expect(new Set(ids).size).toBe(2)
  for (const id of ids) expect(html).toContain(`url(#${id})`)
})
