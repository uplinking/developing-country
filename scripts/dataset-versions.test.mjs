import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import {
  MANIFEST_PATH,
  ROW_COUNT_ARTIFACT,
  assessmentDateFor,
  buildManifest,
  canonicalJson,
  deriveManifest,
  loadInputs,
  rowCountOf,
  trackedDataFiles,
} from './build-dataset-versions.mjs'

const enc = (value) => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value))

describe('dataset version manifest', () => {
  test('assesses refresh dates on the registered country civil day', () => {
    const nearMidnightUtc = new Date('2026-08-30T20:00:00.000Z')
    expect(assessmentDateFor('LK', nearMidnightUtc)).toBe('2026-08-31')
    expect(assessmentDateFor('XX', nearMidnightUtc)).toBe('2026-08-30')
  })

  test('committed manifest equals a fresh deterministic rebuild', async () => {
    const first = await buildManifest()
    const second = await buildManifest()
    expect(first.problems).toEqual([])
    expect(canonicalJson(first.manifest)).toBe(canonicalJson(second.manifest))
    expect(canonicalJson(first.manifest)).toBe(readFileSync(MANIFEST_PATH, 'utf8'))
  })

  test('never versions pmtiles / d1 / adapter / none storage, even when a tile exists locally', async () => {
    const inputs = await loadInputs()
    const { manifest, problems } = deriveManifest({
      ...inputs,
      tracked: trackedDataFiles(),
      readArtifact: (path) => new Uint8Array(readFileSync(path)),
    })
    expect(problems).toEqual([])
    const versioned = new Set(manifest.versions.map((v) => v.datasetId))
    for (const entry of inputs.catalog) {
      const local = entry.storage.kind === 'geojson' || entry.storage.kind === 'index' || entry.storage.kind === 'table'
      for (const datasetId of entry.dataset_ids) {
        if (local) expect(versioned.has(datasetId)).toBe(true)
      }
      if (['pmtiles', 'd1', 'adapter', 'none'].includes(entry.storage.kind)) {
        for (const datasetId of entry.dataset_ids) {
          if (!versioned.has(datasetId)) {
            expect(manifest.excluded.some((e) => e.datasetId === datasetId)).toBe(true)
          }
        }
      }
    }
    for (const version of manifest.versions) {
      expect(version.versionId).toMatch(/^dsv_[0-9a-f]{32}$/)
      expect(version.checksum).toMatch(/^sha256:[0-9a-f]{64}$/)
      expect(version.artifacts.every((a) => a.path.startsWith('public/data/'))).toBe(true)
      expect(version.artifacts.every((a) => !a.path.endsWith('.pmtiles'))).toBe(true)
    }
    expect(manifest.versions.find((version) => version.datasetId === 'metro')?.entityIds)
      .toEqual(['metro_line', 'metro_stop'])
    expect(manifest.versions.find((version) => version.datasetId === 'schools')?.entityIds)
      .toEqual(['school'])
    expect(manifest.versions.find((version) => version.datasetId === 'expressways')?.refreshedAt)
      .toBe('2026-08-16')
  })

  test('versionId changes with artifact bytes but not with key order', async () => {
    const inputs = await loadInputs()
    const tracked = trackedDataFiles()
    const build = (mutate) =>
      deriveManifest({
        ...inputs,
        tracked,
        readArtifact: (path) => {
          const bytes = new Uint8Array(readFileSync(path))
          return mutate(path, bytes)
        },
      }).manifest
    const base = build((_, b) => b)
    const changed = build((path, b) => (path === 'public/data/metro.geojson' ? enc({ features: [] }) : b))
    const byId = (m) => Object.fromEntries(m.versions.map((v) => [v.datasetId, v.versionId]))
    const a = byId(base)
    const b = byId(changed)
    expect(a.metro).not.toBe(b.metro)
    expect(a.parks).toBe(b.parks)
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }))
  })

  test('untracked artifacts are reported as problems, never silently versioned', async () => {
    const inputs = await loadInputs()
    const tracked = new Set([...trackedDataFiles()].filter((p) => p !== 'public/data/parks.geojson'))
    const { manifest, problems } = deriveManifest({
      ...inputs,
      tracked,
      readArtifact: (path) => new Uint8Array(readFileSync(path)),
    })
    expect(problems.some((p) => p.includes('public/data/parks.geojson'))).toBe(true)
    expect(manifest.versions.some((v) => v.datasetId === 'parks')).toBe(false)
  })

  test('rowCount only when a feature collection or valid Indicator Table is unambiguous', () => {
    expect(rowCountOf(enc({ type: 'FeatureCollection', features: [{}, {}] }))).toBe(2)
    expect(rowCountOf(enc({ count: 3, features: [{}, {}] }))).toBeUndefined()
    expect(rowCountOf(enc({ nodes: [1, 2, 3] }))).toBeUndefined()
    expect(rowCountOf(enc({
      schema_version: 1,
      dataset_id: 'test-table',
      country: 'LK',
      source_ids: ['test-source'],
      vintage: '2026',
      primary_key: ['year'],
      fields: [
        { id: 'year', role: 'dimension', type: 'year', label: 'Year' },
        { id: 'value', role: 'measure', type: 'number', label: 'Value', aggregation: 'none' },
      ],
      rows: [{ year: 2026, value: 1 }],
    }))).toBe(1)
    expect(rowCountOf(enc({ rows: [{ fake: true }] }))).toBeUndefined()
    expect(rowCountOf(enc('not json'))).toBeUndefined()
  })

  test('routing graphs count undirected edges, packed or not', () => {
    expect(rowCountOf(enc({ nodes: [0, 0, 1, 1, 2, 2], edges: [0, 1, 150, 1, 2, 90], packed: true }))).toBe(2)
    expect(rowCountOf(enc({ nodes: [0, 0, 1, 1], edges: [0, 1], packed: true }))).toBeUndefined()
    expect(rowCountOf(enc({ nodes: [[0, 0], [1, 1]], edges: [[0, 1, 150]] }))).toBe(1)
  })

  test('every version has a rowCount unless explicitly exempted with a reason', async () => {
    const inputs = await loadInputs()
    const build = (overrides) => deriveManifest({
      ...inputs,
      tracked: trackedDataFiles(),
      readArtifact: (path) => new Uint8Array(readFileSync(path)),
      ...overrides,
    })
    const { manifest, problems } = build({})
    expect(problems).toEqual([])
    expect(manifest.versions.filter((v) => typeof v.rowCount !== 'number').map((v) => v.datasetId)).toEqual([])
    const demographics = manifest.versions.find((v) => v.datasetId === 'demographics')
    expect(demographics.rowCount).toBe(demographics.artifacts.find((a) => a.path === 'public/data/gnd-index.json').rows)

    // Drop only the demographics rule; other multi-artifact datasets keep theirs.
    const withoutDemographics = Object.fromEntries(Object.entries(ROW_COUNT_ARTIFACT).filter(([id]) => id !== 'demographics'))
    const undeclared = build({ rowCountArtifacts: withoutDemographics })
    expect(undeclared.problems.some((p) => p.startsWith('demographics: no rowCount'))).toBe(true)
    expect(build({ rowCountArtifacts: withoutDemographics, rowCountExempt: { demographics: 'mixed grains' } }).problems).toEqual([])
    expect(build({ rowCountArtifacts: withoutDemographics, rowCountExempt: { demographics: ' ' } }).problems)
      .toContain('ROW_COUNT_EXEMPT demographics: reason missing')
    expect(build({ rowCountExempt: { parks: 'stale' } }).problems.some((p) => p.includes('parks: has a rowCount'))).toBe(true)
  })

  test('requires an explicit country stamp on the source registry', async () => {
    const inputs = await loadInputs()
    const { problems } = deriveManifest({
      ...inputs,
      registryCountry: undefined,
      tracked: trackedDataFiles(),
      readArtifact: (path) => new Uint8Array(readFileSync(path)),
    })
    expect(problems).toContain('source registry country is missing')
  })

  test('refuses missing, malformed, or future source verification dates', async () => {
    const inputs = await loadInputs()
    for (const refreshed of [undefined, '2026-02-31', '2027-01-01']) {
      const sources = inputs.sources.map((source) =>
        source.id === 'lk-metro' ? { ...source, refreshed } : source,
      )
      const { problems, manifest } = deriveManifest({
        ...inputs,
        sources,
        assessedAt: '2026-08-27',
        tracked: trackedDataFiles(),
        readArtifact: (path) => new Uint8Array(readFileSync(path)),
      })
      expect(problems.some((problem) => problem.includes('source lk-metro'))).toBe(true)
      expect(manifest.versions.some((version) => version.datasetId === 'metro')).toBe(false)
    }
  })
})
