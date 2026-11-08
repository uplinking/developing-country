// OpenAI plugin domain verification. The submission portal issues a token and
// checks that https://<MCP host>/.well-known/openai-apps-challenge returns it
// as plain text, nothing else. The token is not a secret (anyone can fetch it),
// but it is set per deployment: OPENAI_APPS_CHALLENGE as a var or secret.
// Unset, the path is a plain 404 rather than falling through to the SPA.

import type { Env } from './types'

export const OPENAI_APPS_CHALLENGE_PATH = '/.well-known/openai-apps-challenge'

export function openaiAppsChallenge(request: Request, env: Pick<Env, 'OPENAI_APPS_CHALLENGE'>): Response {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } })
  }
  const token = env.OPENAI_APPS_CHALLENGE?.trim()
  if (!token) return new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
  return new Response(request.method === 'HEAD' ? null : token, {
    status: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
