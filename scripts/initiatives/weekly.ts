// The weekly initiatives run (a local LLM command-line tool reads the news; see backfill.ts):
//   1. read the news since the last run in English, Sinhala and Tamil (backfill.ts --since);
//   2. with whatever usage is left, walk the backlog of older months, newest first, until the
//      tool's usage limit stops it (the next run continues where it stopped);
//   3. rebuild the ledger and the dataset registry, run the full check;
//   4. commit to a fresh branch and open a draft PR. Merging it is the release (main deploys).
//
// Run from its own git worktree (see scripts/initiatives/README.md), never from a
// checkout someone is working in: it resets the branch it runs on.
//   bun scripts/initiatives/weekly.ts [--no-backlog] [--no-pr] [--allow-dirty]
import { readFile, writeFile } from 'node:fs/promises'

const args = process.argv.slice(2)
const BACKLOG = !args.includes('--no-backlog')
const PR = !args.includes('--no-pr')
const ALLOW_DIRTY = args.includes('--allow-dirty') // manual test runs in a working checkout only
const TODAY = new Date().toISOString().slice(0, 10)
// lk_news starts in September 2021; the first backfill covered January 2024 onwards.
const BACKLOG_FROM = '2021-09', BACKLOG_TO = '2023-12'
const LOOKBACK_DAYS = 21 // re-checks recent weeks: lk_news sometimes adds articles late

const log = (msg: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`)

async function sh(cmd: string[], opts: { allow?: number[] } = {}): Promise<{ code: number; out: string }> {
  log(`$ ${cmd.join(' ')}`)
  const p = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe' })
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited])
  if (out.trim()) console.log(out.trimEnd().split('\n').slice(-25).join('\n'))
  if (err.trim()) console.error(err.trimEnd().split('\n').slice(-25).join('\n'))
  if (code !== 0 && !(opts.allow ?? []).includes(code)) throw new Error(`${cmd[0]} ${cmd[1] ?? ''} exited ${code}`)
  return { code, out }
}

function notify(message: string) {
  // Best effort: a macOS notification with the result.
  Bun.spawn(['osascript', '-e', `display notification ${JSON.stringify(message)} with title "developing-country weekly"`], { stdout: 'ignore', stderr: 'ignore' })
}

const coveragePath = 'scripts/initiatives/coverage.json'
const sourcesPath = 'scripts/data-sources.json'

async function main() {
  if (!ALLOW_DIRTY && (await sh(['git', 'status', '--porcelain'])).out.trim()) throw new Error('Working tree is not clean; the weekly run only works in its own worktree')
  await sh(['bun', 'install', '--frozen-lockfile'])

  // 1. This week's news, with a lookback so late-collected articles are not missed.
  const since = new Date(Date.now() - LOOKBACK_DAYS * 864e5).toISOString().slice(0, 10)
  const week = await sh(['bun', 'scripts/initiatives/backfill.ts', '--since', since, '--langs', 'en,si,ta', '--workers', '3'], { allow: [75] })
  if (week.code === 75) throw new Error('The reader hit its usage limit before this week was read; nothing to publish')

  // 2. Backlog of older months with the usage that is left.
  let backlog = 'skipped'
  if (BACKLOG) {
    const r = await sh(['bun', 'scripts/initiatives/backfill.ts', '--from', BACKLOG_FROM, '--to', BACKLOG_TO, '--langs', 'en,si,ta', '--workers', '3', '--newest-first'], { allow: [75] })
    backlog = r.code === 75 ? 'stopped at the usage limit' : 'finished'
  }

  // 3. The page treats weeks after read_to as unread; the source entry says what was read.
  const cov = JSON.parse(await readFile(coveragePath, 'utf8'))
  cov.read_to = TODAY
  await writeFile(coveragePath, JSON.stringify(cov) + '\n')
  await sh(['bun', 'scripts/initiatives/coverage.ts'])
  const firstMonth = (await Array.fromAsync(new Bun.Glob('backfill_*_en.json').scan('scripts/initiatives/news'))).sort()[0]?.slice(9, 16) ?? '2024-01'
  const sources = JSON.parse(await readFile(sourcesPath, 'utf8'))
  const ledger = sources.sources.find((s: { id: string }) => s.id === 'lk-initiatives-ledger')
  if (!ledger) throw new Error('lk-initiatives-ledger is missing from scripts/data-sources.json')
  ledger.vintage = `News read ${firstMonth}-01 to ${TODAY} (English, Sinhala, Tamil); IMF and World Bank since 2023`
  await writeFile(sourcesPath, JSON.stringify(sources, null, 2) + '\n')
  await sh(['bun', 'scripts/refresh.mjs', 'touch', 'lk-initiatives-ledger', TODAY])

  await sh(['bun', 'scripts/initiatives/build.ts'])
  await sh(['git', 'add', '-A', 'scripts/initiatives', 'public/data', sourcesPath])
  await sh(['bun', 'run', 'build:dataset-versions'])
  await sh(['bun', 'run', 'datasets:sync'])
  const check = await sh(['bun', 'run', 'check'], { allow: [1] })

  // 4. Branch, commit, draft PR.
  const added = (await sh(['git', 'status', '--porcelain', 'scripts/initiatives/news'])).out.trim().split('\n').filter(l => /weekly_|backfill_/.test(l) && !l.startsWith(' M'))
  if (!added.length) { log('No new batches; nothing to publish'); notify('No new initiatives this week.'); return }
  const summary = (await sh(['bun', 'scripts/initiatives/build.ts', '--check'], { allow: [1] })).out.trim()
  const ledgerNow = JSON.parse(await readFile('public/data/lk-initiatives.json', 'utf8'))
  const title = `Initiatives: weekly read to ${TODAY}`
  const body = [
    `Weekly machine read of lk_news. Review before merging; merging releases.`,
    '',
    `- New batch files: ${added.length} (${added.map(l => l.slice(3).replace('scripts/initiatives/news/', '')).join(', ')})`,
    `- Ledger: ${ledgerNow.events.length} events, ${ledgerNow.projects.length} initiatives`,
    `- Backlog of older months: ${backlog}`,
    `- Full check: ${check.code === 0 ? 'passed' : '**failed** (see the job log; fix before merging)'}`,
    summary ? `\n${summary}` : '',
  ].join('\n')
  if (!PR) { log(`--no-pr: would open "${title}"\n${body}`); return }
  const branch = `initiatives/weekly-${TODAY}`
  await sh(['git', 'checkout', '-B', branch])
  await sh(['git', 'add', '-A'])
  await sh(['git', 'commit', '-q', '-m', title, '-m', body])
  await sh(['git', 'push', '-f', '-u', 'origin', branch])
  const pr = await sh(['gh', 'pr', 'create', '--draft', '--base', 'main', '--head', branch, '--title', title, '--body', body], { allow: [1] })
  notify(check.code === 0 ? `Draft PR ready: ${pr.out.trim() || branch}` : `Draft PR opened, but the full check failed: ${branch}`)
}

try { await main() } catch (error) {
  console.error(`weekly run failed: ${(error as Error).message}`)
  notify(`Weekly run failed: ${(error as Error).message}`)
  process.exit(1)
}
