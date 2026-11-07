#!/usr/bin/env bun

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const host = process.env.DC_DEV_HOST?.trim() || '127.0.0.1'
const sitePort = process.env.DC_SITE_PORT?.trim() || '4321'
const explorePort = process.env.DC_EXPLORE_PORT?.trim() || '5173'

const siteUrl = `http://${host}:${sitePort}`
const exploreUrl = `http://${host}:${explorePort}`

console.log(`
developing-country.org development
  site     ${siteUrl}
  explorer ${exploreUrl}

Open the site URL first. The explorer powers maps, charts, and interactive article views.
`)

// Astro's CLI can manage a background server across both a regular terminal
// and Codex's dev-server UI. Root dev owns that server and stops it on exit.
const site = Bun.spawn(
  ['bun', 'run', 'dev:site', '--', '--background', '--host', host, '--port', sitePort],
  { cwd: root, env: process.env, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' },
)
const siteCode = await site.exited
if (siteCode !== 0) {
  console.error(`site development server failed to start with code ${siteCode}`)
  process.exit(siteCode)
}

async function waitForSite() {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const response = await fetch(siteUrl)
      if (response.ok) return
    } catch {
      // The background server is still starting.
    }
    await Bun.sleep(250)
  }
  throw new Error(`site development server did not become ready at ${siteUrl}`)
}

async function stopSite() {
  const stop = Bun.spawn(['bun', 'run', '--cwd', 'apps/site', 'astro', 'dev', 'stop'], {
    cwd: root,
    env: process.env,
    stdout: 'inherit',
    stderr: 'inherit',
  })
  await stop.exited
}

try {
  await waitForSite()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  await stopSite()
  process.exit(1)
}

const explorer = Bun.spawn(
  ['bun', 'run', 'dev:explore', '--', '--host', host, '--port', explorePort],
  { cwd: root, env: process.env, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' },
)

let stopping = false
async function shutdown() {
  if (stopping) return
  stopping = true
  explorer.kill('SIGTERM')
  await Promise.allSettled([explorer.exited, stopSite()])
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    void shutdown().then(() => process.exit(0))
  })
}

const explorerCode = await explorer.exited
if (!stopping) {
  await shutdown()
  process.exit(explorerCode)
}
