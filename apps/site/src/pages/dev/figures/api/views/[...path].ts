import type { APIRoute } from 'astro'
import { DEV_VIEWS } from '../../../../../dev/figureFixtures'

/**
 * DEV-ONLY Data View API for /dev/figures. Mirrors the platform's
 * GET /api/views/{id} and /api/views/{id}/result/{hash}.json shapes.
 * Every production request gets a 404.
 */
export const GET: APIRoute = ({ params }) => {
  if (!import.meta.env.DEV) return new Response(null, { status: 404 })
  const [id = '', kind, file] = (params.path ?? '').split('/')
  const entry = DEV_VIEWS[id]
  if (!entry) return Response.json({ error: 'not_found' }, { status: 404 })
  if (kind === 'result' && file === `${entry.view.data.resultChecksum.replace(/^sha256:/, '')}.json`) {
    return Response.json(entry.result, { headers: { 'cache-control': 'no-store' } })
  }
  if (kind) return Response.json({ error: 'not_found' }, { status: 404 })
  return Response.json({
    view: entry.view,
    ...(entry.inline ? { result: entry.result } : {}),
    view_url: `https://explore.developing-country.org/views/${id}`,
    result_url: '',
  }, { headers: { 'cache-control': 'no-store' } })
}
