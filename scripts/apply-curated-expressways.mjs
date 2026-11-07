// Inject the curated proposed expressways (scripts/expressways-curated.mjs) into
// public/data/expressways.geojson WITHOUT a network round-trip. Use this when
// Overpass is unavailable and you just need the curated alignments applied to
// the existing OSM-derived data. Idempotent: it strips any features whose id we
// own before re-appending, so re-running produces the same file.
//
//   bun scripts/apply-curated-expressways.mjs

import { readFile, writeFile } from 'node:fs/promises'
import { CURATED_EXPRESSWAY_IDS, curatedExpresswayFeatures } from './expressways-curated.mjs'

const PATH = 'public/data/expressways.geojson'
const fc = JSON.parse(await readFile(PATH, 'utf8'))
if (fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) {
  throw new Error(`${PATH} is not a FeatureCollection`)
}

const before = fc.features.length
const kept = fc.features.filter((f) => !CURATED_EXPRESSWAY_IDS.has(f.id))
const curated = curatedExpresswayFeatures()
fc.features = [...kept, ...curated]

// Self-check: every curated id is present exactly once.
for (const id of CURATED_EXPRESSWAY_IDS) {
  const n = fc.features.filter((f) => f.id === id).length
  if (n !== 1) throw new Error(`expected 1 feature for ${id}, got ${n}`)
}

await writeFile(PATH, JSON.stringify(fc))
console.log(
  `Applied ${curated.length} curated expressways → ${fc.features.length} features ` +
    `(was ${before}; removed ${before - kept.length} stale, added ${curated.length}).`,
)
