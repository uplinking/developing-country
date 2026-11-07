#!/usr/bin/env bun
import { resolve } from 'node:path'

// CI supplies its scoped API token; local operators can use Wrangler OAuth.
// Do not invoke convenience scripts that unset CLOUDFLARE_API_TOKEN here.
const root = resolve(import.meta.dir, '..')
const site = resolve(root, 'apps/site')
const run = async (command: string[], cwd = root) => {
  console.log(`Running ${command.join(' ')}`)
  const child = Bun.spawn(command, { cwd, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' })
  if (await child.exited !== 0) throw new Error(`Release stopped: ${command.join(' ')}`)
}
if (!process.argv.includes('--built')) {
  await run(['bun', 'run', 'data:catalog'], site)
  await run(['bun', 'run', 'build:explore'])
  await run(['bun', 'run', 'build:site'])
}
await run(['bunx', 'wrangler', 'd1', 'migrations', 'apply', 'developing-country-platform', '--config', 'wrangler.explore.jsonc', '--remote'])
await run(['bun', 'scripts/migrate.ts', '--remote'], site)
await run(['bun', 'scripts/upload-dataset-catalog.ts', '--remote'], site)
await run(['bunx', 'wrangler', 'deploy', '--config', 'wrangler.explore.jsonc'])
await run(['bun', 'run', 'wrangler', 'deploy'], site)
await run(['bunx', 'wrangler', 'deploy', '--config', 'wrangler.ingestion.jsonc'])
for (const url of ['https://developing-country.org/', 'https://developing-country.org/data', 'https://explore.developing-country.org/', 'https://explore.developing-country.org/api/catalog']) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error(`Release smoke check failed: ${url} (${response.status})`)
  console.log(`Verified ${url}: ${response.status}`)
}
