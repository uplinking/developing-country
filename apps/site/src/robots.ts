/**
 * robots.txt, served by the Worker before EmDash so it costs no database read.
 *
 * Listings like /data and /analysis take filter and search query strings, and every filter
 * link leads to more combinations. Crawlers that follow them render the same pages under
 * tens of thousands of URLs, each a cache miss that reads the whole CMS. Only the plain
 * address of each page is worth crawling; the sitemap lists them all.
 */
export const ROBOTS_TXT = [
  'User-agent: *',
  'Allow: /',
  'Disallow: /_emdash/',
  // Explicit prefixes for crawlers that do not support wildcards.
  'Disallow: /data?',
  'Disallow: /analysis?',
  'Disallow: /*?',
  '',
  'Sitemap: https://developing-country.org/sitemap.xml',
  '',
].join('\n')

export function robotsResponse(): Response {
  return new Response(ROBOTS_TXT, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    },
  })
}
