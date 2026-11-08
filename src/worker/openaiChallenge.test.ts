import { describe, expect, test } from 'bun:test'
import { OPENAI_APPS_CHALLENGE_PATH, openaiAppsChallenge } from './openaiChallenge'

const url = `https://explore.developing-country.org${OPENAI_APPS_CHALLENGE_PATH}`

describe('OpenAI domain verification challenge', () => {
  test('returns exactly the configured token as plain text', async () => {
    const res = openaiAppsChallenge(new Request(url), { OPENAI_APPS_CHALLENGE: '  tok_123\n' })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toStartWith('text/plain')
    expect(await res.text()).toBe('tok_123')
  })

  test('is a 404, not the app shell, when no token is configured', async () => {
    const res = openaiAppsChallenge(new Request(url), {})
    expect(res.status).toBe(404)
    expect(await res.text()).not.toContain('<html')
  })

  test('answers HEAD without a body and refuses writes', async () => {
    const head = openaiAppsChallenge(new Request(url, { method: 'HEAD' }), { OPENAI_APPS_CHALLENGE: 'tok' })
    expect(head.status).toBe(200)
    expect(await head.text()).toBe('')
    const post = openaiAppsChallenge(new Request(url, { method: 'POST' }), { OPENAI_APPS_CHALLENGE: 'tok' })
    expect(post.status).toBe(405)
  })
})
