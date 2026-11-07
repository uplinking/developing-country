import { describe, expect, test } from 'bun:test'
import coverageLedger from '../../scripts/coverage-ledger.json' with { type: 'json' }
import sourceRegistry from '../../scripts/data-sources.json' with { type: 'json' }
import { getLayerCatalog } from './catalog'

describe('agent-readable dataset catalog', () => {
  test('projects storage, schema, freshness, provenance, and completeness for every entity', () => {
    const catalog = getLayerCatalog()
    expect(catalog.schema_version).toBe(2)
    expect(catalog.runtime_capabilities).toEqual({
      heavy_spatial: false,
      isochrone: false,
      gap_centroid_distance: false,
    })
    expect(catalog.layers.length).toBe(catalog.count)
    expect(catalog.layers.length).toBeGreaterThan(33)
    expect(catalog.layers.some((dataset) => dataset.id === 'data_views')).toBe(true)
    const registered = new Map(sourceRegistry.sources.map((source) => [source.id, source]))
    for (const dataset of catalog.layers) {
      expect(dataset.id.length).toBeGreaterThan(0)
      expect(dataset.description.length).toBeGreaterThan(0)
      expect(dataset.country).toBe('LK')
      expect(dataset.source.length).toBeGreaterThan(0)
      expect(dataset.source_ids.length).toBeGreaterThan(0)
      expect(dataset.sources).toHaveLength(dataset.source_ids.length)
      expect(dataset.vintage.length).toBeGreaterThan(0)
      expect(dataset.refreshed_at?.length).toBeGreaterThan(0)
      expect(['fresh', 'due', 'overdue', 'live', 'invalid']).toContain(dataset.freshness.status)
      expect(dataset.licence.length).toBeGreaterThan(0)
      expect(dataset.how_to_refresh.length).toBeGreaterThan(0)
      expect(dataset.field_schema.id_field.length).toBeGreaterThan(0)
      expect(dataset.field_schema.name_field.length).toBeGreaterThan(0)
      expect(dataset.field_schema.geometry).toBe(dataset.geometry)
      expect(dataset.completeness.status.length).toBeGreaterThan(0)
      expect(Array.isArray(dataset.completeness.known_gaps)).toBe(true)
      for (const source of dataset.sources) {
        const registry = registered.get(source.id)
        expect(registry).toBeDefined()
        expect(source.refreshed_at).toBe(registry?.refreshed)
        expect(source.vintage).toBe(registry?.vintage)
        expect(source.how_to_refresh).toBe(registry?.refresh)
        expect(source.freshness.refreshed_at).toBe(source.refreshed_at)
        expect(source.freshness.assessed_at).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      }
    }
  })

  test('discloses when the deployment enables CPU-heavy operators', () => {
    expect(getLayerCatalog(undefined, true).runtime_capabilities).toEqual({
      heavy_spatial: true,
      isochrone: true,
      gap_centroid_distance: true,
    })
  })

  test('keeps the retired product name out of public agent metadata', () => {
    expect(JSON.stringify(getLayerCatalog())).not.toMatch(/final[ -]?map/i)
    expect(JSON.stringify(coverageLedger)).not.toMatch(/final[ -]?map/i)
  })

  test('fails closed instead of returning LK data for another country', () => {
    expect(() => getLayerCatalog('IN')).toThrow('country not supported: IN')
  })
})
