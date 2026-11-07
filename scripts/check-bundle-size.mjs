#!/usr/bin/env bun
// Compressed Worker size guard for the two production Workers.
//
//   bun run check:bundle-size                      # inspect existing dry-run output
//   bun run check:bundle-size -- --run             # run both dry-runs first, then guard
//   bun run check:bundle-size -- --target site     # one Worker only
//   bun run check:bundle-size -- --explore-log a.log --site-log b.log
//                                                  # also parse Wrangler's own numbers
//   bun run check:bundle-size -- --max-site 2600   # override a ceiling (KiB gzip)
//
// Why this exists: Workers Free rejects scripts above 3 MiB compressed, and the
// Astro/EmDash site sits close to that ceiling. `wrangler deploy --dry-run`
// prints "Total Upload: <raw> KiB / gzip: <gz> KiB" but never fails on it, so
// this script turns the number into a hard CI gate with explicit ceilings.
//
// How the number is measured (mirrors wrangler's printBundleSize): every module
// that would be uploaded is concatenated (main entry last) and gzipped once with
// zlib defaults. Module order can differ slightly from wrangler's, so expect a
// drift of well under 1 %; when a captured Wrangler log is supplied its figure
// is parsed too and the guard uses the LARGER of the two.
//
// Sources of truth per target (never the `--outdir` for the site: wrangler does
// not clear it, so stale hashed chunks from earlier builds accumulate there):
//   explore  .wrangler/dry-run-explore/index.js   (single esbuild bundle,
//            overwritten on every dry run; README.md carries the timestamp)
//   site     apps/site/.wrangler/deploy/config.json -> configPath ->
//            dist/server/wrangler.json (Astro's redirected config: no_bundle,
//            main + ESModule rules) -> modules under dist/server
//
// Idempotent and read-only: it never builds unless --run is passed, and --run
// only invokes the checked-in `bun run dry-run:*` scripts (no Cloudflare calls).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const KIB = 1024
const TOP_CHUNKS = 10

/** Explicit ceilings (KiB, gzip). Workers Free hard limit is 3072 KiB. */
const TARGETS = {
  explore: {
    label: 'explore.developing-country.org (developing-country-explore)',
    limitKiB: 1024,
    dryRunScript: 'dry-run:explore',
    outdir: '.wrangler/dry-run-explore',
    resolveModules: resolveExploreModules,
  },
  site: {
    label: 'developing-country.org (developing-country-site)',
    limitKiB: 2700,
    dryRunScript: 'dry-run:site',
    outdir: 'apps/site/.wrangler/dry-run-site',
    resolveModules: resolveSiteModules,
  },
}

// ---------------------------------------------------------------- arguments
function parseArgs(argv) {
  const opts = { run: false, targets: Object.keys(TARGETS), logs: {}, limits: {} }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => {
      const v = argv[++i]
      if (v === undefined) fail(`missing value after ${a}`)
      return v
    }
    if (a === '--run') opts.run = true
    else if (a === '--target') {
      const t = next()
      if (!TARGETS[t]) fail(`unknown --target ${t}; expected one of ${Object.keys(TARGETS).join(', ')}`)
      opts.targets = [t]
    } else if (a === '--explore-log') opts.logs.explore = next()
    else if (a === '--site-log') opts.logs.site = next()
    else if (a === '--max-explore' || a === '--max-site') {
      const n = Number(next())
      if (!Number.isFinite(n) || n <= 0) fail(`${a} expects a positive number of KiB`)
      opts.limits[a.slice(6)] = n
    }
    else if (a === '--help' || a === '-h') {
      console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 13).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'))
      process.exit(0)
    } else fail(`unknown argument ${a}`)
  }
  return opts
}

function fail(msg) {
  console.error(`check-bundle-size: ${msg}`)
  process.exit(2)
}

// ---------------------------------------------------------------- helpers
const kib = (bytes) => `${(bytes / KIB).toFixed(2)} KiB`
// oxlint-disable-next-line no-control-regex -- ESC is the point: wrangler colourises the report
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '')

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

/** Minimal glob → RegExp for wrangler `rules[].globs` (`**`, `*`, `?`). */
function globToRegExp(glob) {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*'
        i++
        if (glob[i + 1] === '/') i++
      } else re += '[^/]*'
    } else if (c === '?') re += '[^/]'
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`)
}

/** Strip // and /* *\/ comments so wrangler.jsonc parses; strings are respected. */
function parseJsonc(text) {
  let out = ''
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (c === '"') {
      let j = i + 1
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1
      out += text.slice(i, j + 1)
      i = j + 1
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
    } else if (c === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2) + 2
    } else {
      out += c
      i++
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'))
}

/** "generated at 2026-08-26T00:27:44.419Z" from wrangler's outdir README. */
function outdirTimestamp(outdir) {
  const readme = join(ROOT, outdir, 'README.md')
  if (!existsSync(readme)) return null
  return readFileSync(readme, 'utf8').match(/generated at (\S+?)\.?$/m)?.[1] ?? null
}

// ---------------------------------------------------------------- module resolution
function resolveExploreModules(target) {
  const main = join(ROOT, target.outdir, 'index.js')
  if (!existsSync(main)) {
    throw new Error(`${relative(ROOT, main)} not found — run \`bun run ${target.dryRunScript}\` first (or pass --run)`)
  }
  return { main, modules: [], generatedAt: outdirTimestamp(target.outdir), note: `bundle ${relative(ROOT, main)}` }
}

function resolveSiteModules(target) {
  const deployConfig = join(ROOT, 'apps/site/.wrangler/deploy/config.json')
  if (!existsSync(deployConfig)) {
    throw new Error(`${relative(ROOT, deployConfig)} not found — run \`bun run ${target.dryRunScript}\` first (or pass --run)`)
  }
  const { configPath } = JSON.parse(readFileSync(deployConfig, 'utf8'))
  const redirected = resolve(dirname(deployConfig), configPath)
  if (!existsSync(redirected)) {
    throw new Error(`redirected config ${relative(ROOT, redirected)} missing — rebuild the site (\`bun run ${target.dryRunScript}\`)`)
  }
  const cfg = parseJsonc(readFileSync(redirected, 'utf8'))
  if (cfg.no_bundle !== true) {
    throw new Error(`expected no_bundle:true in ${relative(ROOT, redirected)}; the adapter output shape changed — update this script`)
  }
  const dir = dirname(redirected)
  const main = resolve(dir, cfg.main)
  const globs = (cfg.rules ?? []).flatMap((r) => r.globs ?? [])
  if (globs.length === 0) throw new Error(`no module rules in ${relative(ROOT, redirected)}`)
  const matchers = globs.map(globToRegExp)
  const modules = walk(dir)
    .filter((f) => f !== main && matchers.some((m) => m.test(relative(dir, f).split('\\').join('/'))))
    .sort()
  return {
    main,
    modules,
    generatedAt: statSync(main).mtime.toISOString(),
    note: `${modules.length + 1} modules under ${relative(ROOT, dir)} (rules ${globs.join(', ')})`,
  }
}

// ---------------------------------------------------------------- measurement
function measure(resolved) {
  const files = [...resolved.modules, resolved.main]
  const parts = files.map((f) => ({ file: f, content: readFileSync(f) }))
  const all = Buffer.concat(parts.map((p) => p.content))
  const perFile = parts
    .map((p) => ({ file: p.file, raw: p.content.length, gzip: gzipSync(p.content).length }))
    .sort((a, b) => b.gzip - a.gzip)
  return { raw: all.length, gzip: gzipSync(all).length, count: files.length, perFile }
}

/** Parse wrangler's "Total Upload: 11132.41 KiB / gzip: 2727.23 KiB" line. */
function parseWranglerLog(text) {
  const m = stripAnsi(text).match(/Total Upload:\s*([\d.]+)\s*KiB\s*\/\s*gzip:\s*([\d.]+)\s*KiB/)
  if (!m) return null
  return { raw: Number(m[1]) * KIB, gzip: Number(m[2]) * KIB }
}

function runDryRun(target) {
  console.log(`\n$ bun run ${target.dryRunScript}`)
  const res = spawnSync('bun', ['run', target.dryRunScript], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false', FORCE_COLOR: '0' },
  })
  const output = `${res.stdout ?? ''}${res.stderr ?? ''}`
  process.stdout.write(output)
  if (res.status !== 0) throw new Error(`\`bun run ${target.dryRunScript}\` exited ${res.status}`)
  return output
}

// ---------------------------------------------------------------- main
const opts = parseArgs(process.argv.slice(2))
let failed = false

for (const name of opts.targets) {
  const target = TARGETS[name]
  console.log(`\n== ${name}: ${target.label}`)
  let reported = null
  try {
    let logText = null
    if (opts.run) logText = runDryRun(target)
    else if (opts.logs[name]) logText = readFileSync(resolve(opts.logs[name]), 'utf8')
    if (logText !== null) {
      reported = parseWranglerLog(logText)
      if (!reported) throw new Error(`no "Total Upload: … / gzip: … KiB" line found in the ${name} wrangler output`)
    }

    const resolved = target.resolveModules(target)
    const m = measure(resolved)
    const limitKiB = opts.limits[name] ?? target.limitKiB
    const limit = limitKiB * KIB
    const effective = Math.max(m.gzip, reported?.gzip ?? 0)
    const pct = (effective / limit) * 100

    console.log(`   source      ${resolved.note}`)
    if (resolved.generatedAt) console.log(`   generated   ${resolved.generatedAt}`)
    console.log(`   measured    ${kib(m.raw)} / gzip: ${kib(m.gzip)}  (${m.count} file${m.count === 1 ? '' : 's'})`)
    if (reported) {
      const drift = ((m.gzip - reported.gzip) / reported.gzip) * 100
      console.log(`   wrangler    ${kib(reported.raw)} / gzip: ${kib(reported.gzip)}  (measured drift ${drift >= 0 ? '+' : ''}${drift.toFixed(2)} %)`)
      if (Math.abs(drift) > 2) console.log('   ! measured and wrangler gzip differ by more than 2 % — module discovery may be out of date')
    }
    console.log(`   limit       ${limitKiB} KiB gzip → ${pct.toFixed(1)} % used, ${kib(limit - effective)} headroom`)
    if (m.perFile.length > 1) {
      console.log(`   top ${Math.min(TOP_CHUNKS, m.perFile.length)} server chunks by gzip:`)
      for (const f of m.perFile.slice(0, TOP_CHUNKS)) {
        console.log(`     ${kib(f.gzip).padStart(12)}  (raw ${kib(f.raw).padStart(11)})  ${relative(ROOT, f.file)}`)
      }
    }
    if (effective > limit) {
      failed = true
      console.log(`   FAIL  ${kib(effective)} gzip exceeds the ${limitKiB} KiB ceiling by ${kib(effective - limit)}`)
    } else {
      console.log(`   OK    ${kib(effective)} gzip ≤ ${limitKiB} KiB`)
    }
  } catch (err) {
    failed = true
    console.log(`   FAIL  ${err.message}`)
  }
}

console.log(failed ? '\ncheck-bundle-size: FAILED' : '\ncheck-bundle-size: all Workers within their compressed ceilings')
process.exit(failed ? 1 : 0)
