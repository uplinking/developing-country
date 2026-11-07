#!/usr/bin/env bun
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { sha256, buildTable, publicationLinks, assertReviewedLinks } from './treasury/extract.mjs'

const root = resolve(import.meta.dir, '..')
const manifest = JSON.parse(readFileSync(join(root, 'scripts/treasury/recipes.json'), 'utf8'))
const discovery = JSON.parse(readFileSync(join(root, 'scripts/treasury/discovery.json'), 'utf8'))
const registry = JSON.parse(readFileSync(join(root, 'scripts/data-sources.json'), 'utf8'))
const args = process.argv.slice(2)
let source, offline
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--source' && args[i + 1]) source = args[++i]
  else if (args[i] === '--source-dir' && args[i + 1]) offline = resolve(args[++i])
  else throw new Error(`Unknown/missing argument: ${args[i]}`)
}
const definitions = manifest.datasets.filter(d => !source || d.source === source)
if (!definitions.length) throw new Error(`Unknown Treasury source: ${source}`)
const sources = [...new Set(definitions.map(d => d.source))]
const work = mkdtempSync(join(tmpdir(), 'treasury-'))
function fetchFile(url, path) {
  execFileSync('curl', ['--fail', '--silent', '--show-error', '--location', '--proto', '=https', '--proto-redir', '=https', '--max-time', '90', '--retry', '2', url, '-o', path], { stdio: 'inherit' })
}
try {
  if (!offline) {
    // The site's firewall intermittently serves a 200 "You are being redirected..." challenge
    // under burst traffic; pace the crawl and retry that page, then fail closed as before.
    const getLinks = url => {
      const path = join(work, 'page.html')
      let html
      for (let attempt = 0; attempt < 5; attempt++) {
        Bun.sleepSync(attempt ? 20000 * attempt : 1000)
        fetchFile(url.endsWith('/') ? url : `${url}/`, path)
        html = readFileSync(path, 'utf8')
        if (!/<title>\s*You are being redirected/i.test(html)) break
      }
      const links = publicationLinks(html, url)
      if (!links.length) throw new Error(`Empty publication index: ${url}`)
      return links
    }
    const rootLinks = getLinks(discovery.root)
    assertReviewedLinks(rootLinks, discovery.root_links, discovery.root)
    for (const id of sources) {
      const registered = registry.sources.find(s => s.id === id)
      if (!registered) throw new Error(`Unregistered source ${id}`)
      const config = discovery.sources[id]
      const found = new Set(rootLinks.filter(u => u.includes('/api/file/')))
      if (registered.url !== discovery.root) {
        const queue = [registered.url]; const seen = new Set()
        while (queue.length) {
          const url = queue.shift()
          if (seen.has(url)) continue
          if (seen.size >= 200) throw new Error('Archive traversal exceeded review limit')
          seen.add(url)
          const links = getLinks(url)
          const relevant = links.filter(u => u.includes('/api/file/') || u.startsWith(registered.url.replace(/\/$/, '') + '/'))
          assertReviewedLinks(relevant, config.known_links, url)
          for (const link of relevant) {
            if (link.includes('/api/file/')) found.add(link)
            else if (!seen.has(link)) queue.push(link)
          }
        }
      }
      for (const docId of new Set(manifest.rows.filter(r => definitions.some(d => d.id === r.dataset && d.source === id)).map(r => r.document))) {
        const doc = manifest.documents.find(d => d.id === docId)
        if (!found.has(doc.url)) throw new Error(`Reviewed document is no longer linked: ${doc.url}`)
      }
    }
  } else console.warn('OFFLINE rebuild: no publication discovery or freshness verification. Do not touch source dates.')
  const used = new Set(manifest.rows.filter(r => definitions.some(d => d.id === r.dataset)).map(r => r.document))
  const texts = new Map()
  for (const doc of manifest.documents.filter(d => used.has(d.id))) {
    const pdf = offline ? join(offline, `${doc.id}.pdf`) : join(work, `${doc.id}.pdf`)
    if (!offline) fetchFile(doc.url, pdf)
    if (sha256(readFileSync(pdf)) !== doc.sha256) throw new Error(`PDF changed; review required: ${doc.url}`)
    texts.set(doc.id, execFileSync('pdftotext', ['-layout', pdf, '-'], { encoding: 'utf8', maxBuffer: 30 * 1024 * 1024 }))
  }
  // Validate the entire selected batch before writing any dataset.
  const tables = definitions.map(d => buildTable(d, manifest.rows, manifest.documents, texts))
  mkdirSync(join(root, 'public/data'), { recursive: true })
  for (const table of tables) writeFileSync(join(root, `public/data/${table.dataset_id}.json`), JSON.stringify(table) + '\n')
  console.log(`Built ${tables.length} Treasury datasets; ${tables.reduce((n, t) => n + t.rows.length, 0)} observations. ${offline ? 'Offline rebuild only.' : 'Publication discovery and PDF hashes verified.'}`)
} finally { rmSync(work, { recursive: true, force: true }) }
