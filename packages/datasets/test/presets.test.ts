import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  INDICATOR_DATASETS,
  INDICATOR_DATASET_REGISTRY,
  indicatorDatasetPath,
  indicatorPresetPath,
  parseIndicatorTable,
  selectRows,
  type IndicatorDatasetRegistryEntry,
} from '../src'

const ROOT = resolve(import.meta.dir, '../../..')

describe('published indicator presets', () => {
  test('projects the lightweight registry and CMS note from each definition', () => {
    const registry: IndicatorDatasetRegistryEntry[] = [...INDICATOR_DATASET_REGISTRY]
    const projected: IndicatorDatasetRegistryEntry[] = INDICATOR_DATASETS.map((dataset) => {
      const [preset] = dataset.presets
      if (!preset) throw new Error(`Missing default preset for ${dataset.id}`)
      return {
        id: dataset.id,
        title: dataset.title,
        label: dataset.label,
        themeIds: dataset.themeIds,
        defaultPresetId: preset.id,
      }
    })
    expect(registry).toEqual(projected)

    for (const dataset of INDICATOR_DATASETS) {
      expect(Object.values(dataset.note).every((value) => value.trim().length > 0)).toBe(true)
      expect(dataset.note.limit).not.toBe(dataset.description)
    }
  })

  test('every registered dataset has a valid public artifact and provenance match', () => {
    const ids = new Set<string>()
    for (const dataset of INDICATOR_DATASETS) {
      expect(ids.has(dataset.id)).toBe(false)
      ids.add(dataset.id)
      const path = join(ROOT, 'public', indicatorDatasetPath(dataset.id))
      const table = parseIndicatorTable(JSON.parse(readFileSync(path, 'utf8')))
      expect(table.dataset_id).toBe(dataset.id)
      expect([...table.source_ids].sort()).toEqual([...dataset.sourceIds].sort())
      expect(table.rows.length).toBeGreaterThan(0)
    }
  })

  test('every preset selects rows and references registered fields', () => {
    for (const dataset of INDICATOR_DATASETS) {
      const path = join(ROOT, 'public', indicatorDatasetPath(dataset.id))
      const table = parseIndicatorTable(JSON.parse(readFileSync(path, 'utf8')))
      const fieldIds = new Set(table.fields.map((field) => field.id))
      const presetIds = new Set<string>()
      for (const preset of dataset.presets) {
        expect(presetIds.has(preset.id)).toBe(false)
        presetIds.add(preset.id)
        expect(indicatorPresetPath(dataset.id, preset.id)).toBe(`/datasets/${dataset.id}/${preset.id}`)
        expect(fieldIds.has(preset.chart.dimension.field)).toBe(true)
        expect(fieldIds.has(preset.chart.measure.field)).toBe(true)
        if (preset.chart.series) expect(fieldIds.has(preset.chart.series.field)).toBe(true)
        const selected = selectRows(table, preset.query)
        expect(selected.rows.length).toBeGreaterThan(0)
      }
    }
  })
})
