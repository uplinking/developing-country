import { MAP_MAX_ZOOM, MAP_MIN_ZOOM } from './config'
import { allUnits, POP_LEGEND, POP_LEVELS, type LegendItem, type PopLevelId } from './map/layers'

interface EmbedCamera {
  longitude: number
  latitude: number
  zoom: number
}

export interface DatasetEmbedConfig {
  embedded: boolean
  initialView?: EmbedCamera
  layerIds: string[]
  population: PopLevelId | null
  legend: LegendItem[]
  selectionLabel?: string
}

const populationIds = new Set<string>(POP_LEVELS.map((level) => level.id))

export function datasetEmbedConfig(search: string): DatasetEmbedConfig {
  try {
    const params = new URLSearchParams(search)
    const embedded = params.get('embed') === 'dataset'
    const layerIds = params.get('layers')?.split(',').filter(Boolean) ?? []
    const populationParam = params.get('pop')
    const population = populationParam && populationIds.has(populationParam)
      ? populationParam as PopLevelId
      : null

    const longitudeParam = params.get('lng')
    const latitudeParam = params.get('lat')
    const zoomParam = params.get('zoom')
    const longitude = Number(longitudeParam)
    const latitude = Number(latitudeParam)
    const zoom = Number(zoomParam)
    const hasCamera = embedded
      && longitudeParam !== null
      && latitudeParam !== null
      && zoomParam !== null
      && Number.isFinite(longitude)
      && Number.isFinite(latitude)
      && Number.isFinite(zoom)
      && longitude >= -180 && longitude <= 180
      && latitude >= -90 && latitude <= 90

    const unit = layerIds.length === 1
      ? allUnits().find((candidate) => candidate.id === layerIds[0])
      : undefined
    const populationLevel = population
      ? POP_LEVELS.find((level) => level.id === population)
      : undefined
    const selectionLabel = populationLevel
      ? `${populationLevel.label} population`
      : unit?.label

    return {
      embedded,
      initialView: hasCamera
        ? { longitude, latitude, zoom: Math.min(MAP_MAX_ZOOM, Math.max(MAP_MIN_ZOOM, zoom)) }
        : undefined,
      layerIds,
      population,
      legend: populationLevel ? POP_LEGEND : unit?.legend ?? [],
      selectionLabel,
    }
  } catch {
    return { embedded: false, layerIds: [], population: null, legend: [] }
  }
}
