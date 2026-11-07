import { GENERATED_INDICATOR_DATASET_REGISTRY } from './registry.generated'
import type { PublicDataThemeId } from './themes'

export interface IndicatorDatasetRegistryEntry {
  id: string
  title: string
  label: string
  themeIds: readonly PublicDataThemeId[]
  defaultPresetId: string
}

/**
 * Small product-facing registry shared by the site and the full Explorer
 * presets. Keep query rows and renderer intent out of this module so the CMS
 * Worker can validate dataset identities without bundling every chart preset.
 */
export const INDICATOR_DATASET_REGISTRY = GENERATED_INDICATOR_DATASET_REGISTRY satisfies readonly IndicatorDatasetRegistryEntry[]

export type IndicatorDatasetId = typeof INDICATOR_DATASET_REGISTRY[number]['id']

export function indicatorDatasetRegistryEntry(id: string): IndicatorDatasetRegistryEntry | undefined {
  return INDICATOR_DATASET_REGISTRY.find((dataset) => dataset.id === id)
}

export function indicatorDatasetIdentity(id: IndicatorDatasetId): Pick<IndicatorDatasetRegistryEntry, 'id' | 'title' | 'label'> {
  const entry = indicatorDatasetRegistryEntry(id)
  if (!entry) throw new Error(`Unknown indicator dataset ${id}`)
  return { id: entry.id, title: entry.title, label: entry.label }
}

export { indicatorDatasetPath, indicatorPresetPath } from './paths'
