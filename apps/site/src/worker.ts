// Astro fetch handling plus EmDash scheduled publishing and maintenance.
// No Worker Loader is configured: local blocks are trusted native code and the
// site remains compatible with Cloudflare's free/low-cost path.
import emdashWorker, { PluginBridge } from '@emdash-cms/cloudflare/worker'
import type { ExportedHandlerFetchHandler } from '@cloudflare/workers-types'
import { cacheDisposition } from './cachePolicy'
import { canonicalRedirect } from './canonicalUrl'

export { PluginBridge }

const upstreamFetch = emdashWorker.fetch
if (!upstreamFetch) throw new Error('EmDash Worker fetch handler unavailable')
const fetch: ExportedHandlerFetchHandler<Record<string, unknown>> = async (request, env, ctx) => {
  if (request.method === 'GET' || request.method === 'HEAD') {
    const location = canonicalRedirect(request.url)
    if (location) return new Response(null, { status: 301, headers: { Location: location } })
  }
  const response = await upstreamFetch(request, env, ctx)
  if (response.status === 101) return response

  const headers = new Headers(response.headers)
  const csp = headers.get('Content-Security-Policy')?.replace(/;?\s*$/, '')
  if (!csp?.match(/(?:^|;)\s*frame-ancestors\b/i)) {
    headers.set('Content-Security-Policy', `${csp ? `${csp}; ` : ''}frame-ancestors 'self'`)
  }
  if (cacheDisposition(request, response.headers.get('Cache-Control'), response.status) === 'preserve') {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  }

  // Workers Caching applies heuristic freshness even without a route rule.
  // Make the safety boundary explicit so admin, auth, API, preview-token, and
  // editorial MCP responses can never become shared cache entries.
  headers.set('Cache-Control', 'private, no-store')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

export default {
  ...emdashWorker,
  fetch,
}
