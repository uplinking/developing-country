export interface QueryCamera {
  longitude: number
  latitude: number
  zoom: number
}

/**
 * Camera used by ordinary explorer deep links.
 *
 * Dataset embeds have their own explicit `zoom` camera, parsed by
 * datasetEmbedConfig. Keeping that route out of this legacy `z` parser stops a
 * valid article camera from being overwritten after the map loads.
 */
export function cameraFromDeepLink(search: string, fallbackZoom = 13): QueryCamera | null {
  try {
    const params = new URLSearchParams(search)
    if (params.get('embed') === 'dataset') return null

    const latitudeParam = params.get('lat')
    const longitudeParam = params.get('lng')
    if (latitudeParam === null || longitudeParam === null) return null

    const latitude = Number(latitudeParam)
    const longitude = Number(longitudeParam)
    const zoomParam = params.get('z')
    const zoom = zoomParam === null ? fallbackZoom : Number(zoomParam)

    if (
      !Number.isFinite(latitude)
      || !Number.isFinite(longitude)
      || !Number.isFinite(zoom)
      || latitude < -90
      || latitude > 90
      || longitude < -180
      || longitude > 180
      || zoom <= 0
    ) return null

    return { longitude, latitude, zoom }
  } catch {
    return null
  }
}
