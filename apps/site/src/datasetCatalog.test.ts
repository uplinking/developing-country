import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import catalogJson from '../data/dataset-catalog.json'
import { DATASET_CATALOG_POINTER } from './generated/datasetCatalogPointer'
import {
  DatasetCatalogError,
  createDatasetCatalogReader,
  parseDatasetCatalog,
  readDatasetCatalog,
  type DatasetCatalogStore,
} from './lib/datasetCatalog'
import { datasetNotes } from './lib/datasets'

const bytes = new TextEncoder().encode(
  readFileSync(new URL('../data/dataset-catalog.json', import.meta.url), 'utf8'),
)
const expectedIds = datasetNotes.map((dataset) => dataset.id)

function store(value: Uint8Array | null, onGet?: () => void): DatasetCatalogStore {
  return {
    async get() {
      onGet?.()
      if (!value) return null
      return { async arrayBuffer() { return value.slice().buffer } }
    },
  }
}

describe('R2-backed dataset catalogue', () => {
  test('validates the generated catalogue against every registered dataset', () => {
    const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown
    const catalog = parseDatasetCatalog(value, expectedIds)
    expect(catalog.versions).toHaveLength(expectedIds.length)
    expect(catalog.versions.map((version) => version.datasetId).sort()).toEqual([...expectedIds].sort())
  })

  test('carries build-time search terms and synonyms for /data search', () => {
    const catalog = parseDatasetCatalog(catalogJson, expectedIds)
    expect(catalog.search.datasets['housing-occupancy-tenure']?.fields).toContain('Tenure category')
    expect(catalog.search.datasets['housing-occupancy-tenure']?.values).toContain('Jaffna')
    expect(catalog.search.synonyms.outage).toContain('power cut')
    expect(() => parseDatasetCatalog({ ...catalogJson, search: undefined }, expectedIds)).toThrow(DatasetCatalogError)
    const stray = { fields: '', values: '', description: '' }
    const withStray = { ...catalogJson, search: { ...catalogJson.search, datasets: { ...catalogJson.search.datasets, stray } } }
    expect(() => parseDatasetCatalog(withStray, expectedIds)).toThrow('not a registered dataset')
  })

  test('verifies the immutable object bytes before parsing them', async () => {
    const catalog = await readDatasetCatalog(store(bytes), DATASET_CATALOG_POINTER, expectedIds)
    expect(catalog.country).toBe('LK')
    expect(catalog.sources.length).toBeGreaterThan(0)
  })

  test('fails closed when R2 returns missing or altered content', async () => {
    expect(readDatasetCatalog(store(null), DATASET_CATALOG_POINTER, expectedIds))
      .rejects.toBeInstanceOf(DatasetCatalogError)
    const altered = bytes.slice()
    altered[altered.length - 2] ^= 1
    expect(readDatasetCatalog(store(altered), DATASET_CATALOG_POINTER, expectedIds))
      .rejects.toThrow('checksum mismatch')
  })

  test('shares one R2 read per isolate and retries after a transient miss', async () => {
    let reads = 0
    let available = false
    const reader = createDatasetCatalogReader({
      async get() {
        reads++
        if (!available) return null
        return { async arrayBuffer() { return bytes.slice().buffer } }
      },
    }, DATASET_CATALOG_POINTER, expectedIds)
    let firstError: unknown
    try { await reader() } catch (error) { firstError = error }
    expect(firstError).toBeInstanceOf(DatasetCatalogError)
    expect((firstError as Error).message).toContain('object is missing')
    available = true
    const [first, second] = await Promise.all([reader(), reader()])
    expect(first).toBe(second)
    expect(reads).toBe(2)
  })
})
