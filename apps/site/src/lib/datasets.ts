import {
  INDICATOR_DATASET_REGISTRY,
  indicatorPresetPath,
} from '@developing-country/datasets/registry'
import {
  DATASET_PUBLISHER_IDS,
  PUBLISHER_TYPES,
  PUBLIC_DATA_THEMES,
  datasetLicence,
  datasetPublisher,
  isPublisherTypeId,
  isPublicDataThemeId,
  publicDataTheme,
  type DatasetPublisher,
  type PublicDataThemeId,
} from '@developing-country/datasets'
import type { DatasetCatalog, DatasetSourceRecord, DatasetVersionRecord } from './datasetCatalog'

interface DatasetCamera {
  lng: number
  lat: number
  zoom: number
}

interface DatasetMapPreview {
  kind: 'map'
  camera: DatasetCamera
  layers?: string
  pop?: 'province' | 'district' | 'dsd' | 'gnd'
}

interface DatasetChartPreview {
  kind: 'chart'
  presetId: string
}

export type DatasetPreview = DatasetMapPreview | DatasetChartPreview

interface DatasetNoteDefinition {
  id: string
  title: string
  label: string
  themeIds: readonly PublicDataThemeId[]
  preview: DatasetPreview | null
}

const SRI_LANKA: DatasetCamera = { lng: 80.72, lat: 7.85, zoom: 6.8 }
const COLOMBO: DatasetCamera = { lng: 79.923, lat: 6.907, zoom: 9.8 }

const mapDatasetNotes = [
  { id: 'attractions', title: 'Visitor attractions', label: 'Places to visit', themeIds: ['EDUC', 'REGI'], preview: { kind: 'map', layers: 'attractions', camera: SRI_LANKA } },
  { id: 'boi-zones', title: 'Board of Investment zones', label: 'Industrial zones', themeIds: ['ECON', 'REGI'], preview: { kind: 'map', layers: 'boi-zones', camera: { lng: 80.742, lat: 7.377, zoom: 7 } } },
  { id: 'cycling', title: 'Cycling routes', label: 'Cycling', themeIds: ['TRAN'], preview: { kind: 'map', layers: 'cycling', camera: { lng: 81.767, lat: 7.224, zoom: 10.7 } } },
  { id: 'demographics', title: 'Population and administrative areas', label: 'Population', themeIds: ['SOCI'], preview: { kind: 'map', pop: 'gnd', camera: SRI_LANKA } },
  { id: 'developments', title: 'Public development projects', label: 'Public projects', themeIds: ['GOVE', 'REGI'], preview: { kind: 'map', layers: 'developments', camera: { lng: 80.554, lat: 7.968, zoom: 6.8 } } },
  { id: 'expressways', title: 'Expressways', label: 'Expressways', themeIds: ['TRAN'], preview: { kind: 'map', layers: 'expressways', camera: { lng: 80.471, lat: 6.928, zoom: 7.5 } } },
  { id: 'hospitals', title: 'Hospitals and clinics on OpenStreetMap', label: 'Hospitals', themeIds: ['HEAL'], preview: { kind: 'map', layers: 'hospitals', camera: SRI_LANKA } },
  { id: 'irrigation-gauges', title: 'River gauges', label: 'River gauges', themeIds: ['ENVI'], preview: { kind: 'map', layers: 'irrigation-gauges', camera: SRI_LANKA } },
  { id: 'land-cover-grid', title: 'Dominant land-cover grid', label: 'Land cover map', themeIds: ['ENVI'], preview: { kind: 'map', layers: 'land-cover-grid', camera: SRI_LANKA } },
  { id: 'metro', title: 'Colombo Metro Bus', label: 'Metro Bus', themeIds: ['TRAN'], preview: { kind: 'map', layers: 'metro', camera: COLOMBO } },
  { id: 'metro_catchment', title: 'Walking access to Metro Bus', label: 'Walking access', themeIds: ['TRAN'], preview: { kind: 'map', layers: 'metro_catchment', camera: COLOMBO } },
  { id: 'metro_walksheds', title: 'Walking reach of Metro Bus stops', label: 'Metro walksheds', themeIds: ['TRAN'], preview: { kind: 'map', layers: 'metro_walksheds', camera: COLOMBO } },
  { id: 'osm_foot_graph', title: 'Colombo walking network', label: 'Walking network', themeIds: ['TRAN'], preview: null },
  { id: 'parks', title: 'Parks on OpenStreetMap', label: 'Parks', themeIds: ['ENVI'], preview: { kind: 'map', layers: 'parks', camera: { lng: 80.857, lat: 7.346, zoom: 7 } } },
  { id: 'population-change', title: 'District population change 2012 to 2024', label: 'Population change map', themeIds: ['SOCI', 'REGI'], preview: { kind: 'map', layers: 'population-change', camera: SRI_LANKA } },
  { id: 'schools', title: 'Schools on OpenStreetMap', label: 'Schools', themeIds: ['EDUC'], preview: { kind: 'map', layers: 'schools', camera: SRI_LANKA } },
  { id: 'sea-routes', title: 'Computed sea routes', label: 'Sea routes', themeIds: ['TRAN', 'INTR'], preview: { kind: 'map', layers: 'sea-routes', camera: { lng: 80.2, lat: 7.25, zoom: 6.25 } } },
  { id: 'trails', title: 'Walking and hiking trails', label: 'Trails', themeIds: ['TRAN'], preview: { kind: 'map', layers: 'trails', camera: { lng: 80.688, lat: 6.682, zoom: 8 } } },
  { id: 'waterfalls', title: 'Waterfalls on OpenStreetMap', label: 'Waterfalls', themeIds: ['ENVI'], preview: { kind: 'map', layers: 'waterfalls', camera: { lng: 80.556, lat: 7.741, zoom: 6.9 } } },
  { id: 'workplaces', title: 'Offices in Colombo (Overture Maps)', label: 'Offices', themeIds: ['ECON', 'REGI'], preview: { kind: 'map', layers: 'workplaces', camera: COLOMBO } },
] as const satisfies readonly DatasetNoteDefinition[]

function indicatorDatasetNote(dataset: typeof INDICATOR_DATASET_REGISTRY[number]): DatasetNoteDefinition {
  return {
    id: dataset.id,
    title: dataset.title,
    label: dataset.label,
    themeIds: dataset.themeIds,
    preview: { kind: 'chart', presetId: dataset.defaultPresetId },
  }
}

export const datasetNotes: readonly DatasetNoteDefinition[] = [
  ...mapDatasetNotes,
  ...INDICATOR_DATASET_REGISTRY.map(indicatorDatasetNote),
]

export type DatasetId = DatasetNoteDefinition['id']

export {
  DATASET_PUBLISHER_IDS,
  PUBLISHER_TYPES,
  PUBLIC_DATA_THEMES,
  isPublisherTypeId,
  isPublicDataThemeId,
  publicDataTheme,
}

export function formatRefreshDate(value: string): string {
  const year = /^(\d{4})$/.exec(value)
  if (year) return year[1]!
  const month = /^(\d{4})-(\d{2})$/.exec(value)
  if (month) {
    const parsed = new Date(Date.UTC(Number(month[1]), Number(month[2]) - 1, 1))
    return parsed.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export interface SourceLicenceDisclosure {
  status: 'open' | 'permission_unclear' | 'restricted' | 'not_recorded'
  label: string
  text: string
  caveat: string | null
}

export interface DatasetLicenceSignal {
  status: 'permissible' | 'questionable' | 'restricted'
  label: string
}

function sourceLicenceDisclosure(source: DatasetSourceRecord): SourceLicenceDisclosure {
  const text = source.licence?.trim() || 'No licence statement is recorded in the source registry.'
  if (source.licence_status === 'open') {
    return { status: 'open', label: 'Open licence', text, caveat: null }
  }
  if (source.licence_status === 'permission_unclear') {
    return {
      status: 'permission_unclear',
      label: 'Reuse permission unclear',
      text,
      caveat: 'A public source URL or download does not by itself grant permission to reuse the material.',
    }
  }
  if (source.licence_status === 'restricted') {
    return {
      status: 'restricted',
      label: 'Reuse restricted',
      text,
      caveat: 'Do not redistribute this source without permission from its rights holder.',
    }
  }
  return {
    status: 'not_recorded',
    label: 'Licence status not recorded',
    text,
    caveat: 'The registry has not assessed reuse permission; verify the publisher’s terms before reuse.',
  }
}

export function datasetLicenceSignal(
  disclosures: readonly SourceLicenceDisclosure[],
): DatasetLicenceSignal {
  if (disclosures.some((licence) => licence.status === 'restricted')) {
    return { status: 'restricted', label: 'Reuse restricted' }
  }
  if (disclosures.length > 0 && disclosures.every((licence) => licence.status === 'open')) {
    return { status: 'permissible', label: 'Reuse permitted' }
  }
  return { status: 'questionable', label: 'Check reuse terms' }
}

export function isDatasetId(value: string | undefined): value is DatasetId {
  return datasetNotes.some((dataset) => dataset.id === value)
}

function datasetNote(id: DatasetId): DatasetNoteDefinition {
  const note = datasetNotes.find((dataset) => dataset.id === id)
  if (!note) throw new Error(`Unknown dataset ${id}`)
  return note
}

export function datasetMeta(catalog: DatasetCatalog, id: DatasetId) {
  const note = datasetNote(id)
  const version = catalog.versions.find((candidate) => candidate.datasetId === id)
  if (!version) throw new Error(`Missing Dataset Version for ${id}`)
  return {
    ...note,
    publisher: datasetPublisher(id),
    licence: datasetLicence(id),
    themes: note.themeIds.map(publicDataTheme),
    version,
    sources: version.sourceIds.map((sourceId) => {
      const source = catalog.sources.find((candidate) => candidate.id === sourceId)
      if (!source) throw new Error(`Missing source ${sourceId} for ${id}`)
      return { ...source, licenceDisclosure: sourceLicenceDisclosure(source) }
    }),
  }
}

export type { DatasetPublisher }

export function datasetExploreUrl(
  id: DatasetId,
  embedded = false,
  origin = 'https://explore.developing-country.org',
): string {
  const { preview } = datasetNote(id)
  const url = preview?.kind === 'chart'
    ? new URL(indicatorPresetPath(id, preview.presetId), origin)
    : new URL(origin)
  if (embedded) url.searchParams.set('embed', 'dataset')
  if (preview?.kind === 'map' && preview.layers) url.searchParams.set('layers', preview.layers)
  if (preview?.kind === 'map' && preview.pop) url.searchParams.set('pop', preview.pop)
  if (embedded && preview?.kind === 'map') {
    url.searchParams.set('lng', String(preview.camera.lng))
    url.searchParams.set('lat', String(preview.camera.lat))
    url.searchParams.set('zoom', String(preview.camera.zoom))
  }
  return url.href
}

export function isDatasetPreviewUrl(id: DatasetId, value: unknown): value is string {
  return typeof value === 'string' && value === datasetExploreUrl(id, true)
}

/** Use the CMS-owned canonical URL, swapping only its origin for local preview. */
export function resolveDatasetPreviewUrl(
  id: DatasetId,
  value: unknown,
  origin?: string,
): string {
  const canonical = isDatasetPreviewUrl(id, value) ? value : datasetExploreUrl(id, true)
  if (!origin) return canonical
  const url = new URL(canonical)
  const local = new URL(origin)
  url.protocol = local.protocol
  url.host = local.host
  return url.href
}

export function datasetStats(catalog: DatasetCatalog) {
  return {
    datasets: catalog.versions.length,
    sources: new Set(catalog.versions.flatMap((version: DatasetVersionRecord) => version.sourceIds)).size,
    gaps: catalog.knownDataGaps.length,
  }
}

export function knownDataGaps(catalog: DatasetCatalog) {
  return catalog.knownDataGaps
}
