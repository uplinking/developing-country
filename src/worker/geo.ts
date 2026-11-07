// Hand-rolled geo helpers — no deps, Workers-safe.
// GeoJSON coordinate order is [lng, lat].

import type { JsonValue } from '../shared/json'
import { isJsonNumber } from '../shared/json'

export type LngLat = [number, number]

const EARTH_R_KM = 6371.0088

function isLngLat(value: JsonValue | undefined): value is LngLat {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    isJsonNumber(value[0]) &&
    isJsonNumber(value[1])
  )
}

function isLine(value: JsonValue): value is LngLat[] {
  return Array.isArray(value) && value.every(isLngLat)
}

function isPolygon(value: JsonValue): value is LngLat[][] {
  return Array.isArray(value) && value.every(isLine)
}

function isMultiPolygon(value: JsonValue): value is LngLat[][][] {
  return Array.isArray(value) && value.every(isPolygon)
}

/** Great-circle distance in kilometres between two points. */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_R_KM * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** Ray-casting point-in-polygon. `ring` is an array of [lng, lat]. */
export function pointInRing(lng: number, lat: number, ring: LngLat[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0]
    const yi = ring[i][1]
    const xj = ring[j][0]
    const yj = ring[j][1]
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi + 0.0) + xi
    if (intersect) inside = !inside
  }
  return inside
}

/** Point-in-polygon honouring holes. `polygon` = array of rings (outer, holes…). */
export function pointInPolygon(lng: number, lat: number, polygon: LngLat[][]): boolean {
  if (polygon.length === 0) return false
  if (!pointInRing(lng, lat, polygon[0])) return false
  for (let i = 1; i < polygon.length; i++) {
    if (pointInRing(lng, lat, polygon[i])) return false // inside a hole
  }
  return true
}

/** Works for Polygon and MultiPolygon geometries. */
export function pointInGeometry(
  lng: number,
  lat: number,
  geom: { type: string; coordinates: JsonValue },
): boolean {
  if (geom.type === 'Polygon') {
    return isPolygon(geom.coordinates) && pointInPolygon(lng, lat, geom.coordinates)
  }
  if (geom.type === 'MultiPolygon') {
    if (!isMultiPolygon(geom.coordinates)) return false
    for (const poly of geom.coordinates) {
      if (pointInPolygon(lng, lat, poly)) return true
    }
    return false
  }
  return false
}

/** Minimum distance (km) from a point to any vertex of a LineString/MultiLineString. */
export function distanceToLineKm(
  lat: number,
  lng: number,
  geom: { type: string; coordinates: JsonValue },
): number {
  let best = Infinity
  const scanLine = (coords: LngLat[]) => {
    for (const [clng, clat] of coords) {
      const d = haversineKm(lat, lng, clat, clng)
      if (d < best) best = d
    }
  }
  if (geom.type === 'LineString') {
    if (isLine(geom.coordinates)) scanLine(geom.coordinates)
  } else if (geom.type === 'MultiLineString') {
    if (isPolygon(geom.coordinates)) {
      for (const line of geom.coordinates) scanLine(line)
    }
  } else if (geom.type === 'Point') {
    if (isLngLat(geom.coordinates)) {
      const [clng, clat] = geom.coordinates
      best = haversineKm(lat, lng, clat, clng)
    }
  }
  return best
}

/** Representative point (first coordinate) of any geometry, as [lng, lat]. */
export function firstCoord(geom: { type: string; coordinates: JsonValue }): LngLat | null {
  let c: JsonValue = geom.coordinates
  while (Array.isArray(c) && Array.isArray(c[0])) c = c[0]
  return isLngLat(c) ? c : null
}
