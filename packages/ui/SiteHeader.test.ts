import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SiteHeader } from './SiteHeader'

const render = () => renderToStaticMarkup(createElement(SiteHeader, {
  siteUrl: 'https://developing-country.org/', explorerUrl: 'https://explore.example/map/',
}))

const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1])

test('header preserves cross-Worker destinations and explorer base paths', () => {
  const html = render()
  for (const path of ['/data', '/analysis']) expect(html).toContain(`href="https://developing-country.org${path}"`)
  for (const path of ['/?connect=1', '/?signin=1']) expect(html).toContain(`href="https://explore.example/map${path}"`)
  expect(html).toContain('aria-label="Choose country"')
})

test('the map is a front door on the landing page, not a header call-to-action', () => {
  const html = render()
  expect(hrefs(html)).not.toContain('https://explore.example/map/')
  expect(html).not.toMatch(/>Map\b/)
})

test('the phone menu is a native popover carrying every inline destination', () => {
  const html = render()
  // HTML attribute names are case-insensitive; React SSR keeps popoverTarget.
  const target = html.match(/popovertarget="([^"]+)"/i)?.[1]
  expect(target).toBeTruthy()
  expect(html).toContain(`id="${target}" popover="auto"`)
  const [inline, menu] = html.split(/popovertarget=/i)
  const destinations = hrefs(inline).slice(1) // after the home link
  expect(destinations).toHaveLength(5)
  expect(hrefs(menu)).toEqual(destinations)
})

test('a host with in-app MCP and Sign in controls gets a header without those links', () => {
  const html = renderToStaticMarkup(createElement(SiteHeader, {
    siteUrl: 'https://developing-country.org/', explorerUrl: 'https://explore.example/map/', inAppActions: true,
  }))
  expect(html).not.toContain('?connect=1')
  expect(html).not.toContain('?signin=1')
  const [inline, menu] = html.split(/popovertarget=/i)
  expect(hrefs(inline).slice(1)).toEqual(['https://developing-country.org/data', 'https://developing-country.org/initiatives', 'https://developing-country.org/analysis'])
  expect(hrefs(menu)).toEqual(hrefs(inline).slice(1))
})
