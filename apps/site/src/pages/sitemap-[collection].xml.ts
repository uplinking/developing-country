import type { APIContext } from 'astro'

export const prerender = false

/** EmDash's per-collection sitemaps listed URLs that do not exist; anything that kept one gets the real sitemap. */
export function GET(context: APIContext) {
  return context.redirect('/sitemap.xml', 301)
}
