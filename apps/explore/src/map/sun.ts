// Sun / shadow helpers built on SunCalc (MIT, client-side, no API).
// Answers, for any plot + date: sunrise/sunset direction & time, how high the
// sun climbs at noon, day length, and rough shadow length — the things that
// decide how much light a property gets.

// NOTE: the installed suncalc@2.x returns azimuth as a compass bearing in
// DEGREES from north (0=N, clockwise) and altitude in DEGREES — not the
// radians-from-south of the classic library. We use the values directly.
import * as SunCalc from 'suncalc'
import type { Feature, FeatureCollection } from 'geojson'

const DEG2RAD = Math.PI / 180
const RAD2DEG = 180 / Math.PI

export interface SunInfo {
  date: Date
  sunriseTime: string
  sunsetTime: string
  sunriseAz: number // compass bearing, degrees from north
  sunsetAz: number
  noonAltitude: number // degrees above horizon at solar noon
  dayLengthHrs: number
  goldenEveningTime: string
  /** Shadow length as a multiple of object height at 9am / noon / 3pm. */
  shadowNoon: number
}

const fmtTime = (d: Date) =>
  Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

const shadowFactor = (altitudeDeg: number) =>
  altitudeDeg <= 0.5 ? Infinity : 1 / Math.tan(altitudeDeg * DEG2RAD)

export function sunInfo(lng: number, lat: number, date: Date): SunInfo {
  const times = SunCalc.getTimes(date, lat, lng)
  // Sunrise/sunset can be null at extreme latitudes; fall back to solar noon.
  const noon = times.solarNoon ?? date
  const sunrise = times.sunrise ?? noon
  const sunset = times.sunset ?? noon
  const golden = times.goldenHour ?? noon
  const noonPos = SunCalc.getPosition(noon, lat, lng)
  const risePos = SunCalc.getPosition(sunrise, lat, lng)
  const setPos = SunCalc.getPosition(sunset, lat, lng)
  const dayMs = sunset.getTime() - sunrise.getTime()

  return {
    date,
    sunriseTime: fmtTime(sunrise),
    sunsetTime: fmtTime(sunset),
    sunriseAz: risePos.azimuth,
    sunsetAz: setPos.azimuth,
    noonAltitude: Math.max(0, noonPos.altitude),
    dayLengthHrs: dayMs > 0 ? dayMs / 3.6e6 : 0,
    goldenEveningTime: fmtTime(golden),
    shadowNoon: shadowFactor(noonPos.altitude),
  }
}

/** Great-circle-ish destination point a short distance along a bearing (deg). */
function destination(lng: number, lat: number, bearingDeg: number, km: number): [number, number] {
  const R = 6371
  const br = bearingDeg / RAD2DEG
  const lat1 = lat / RAD2DEG
  const lng1 = lng / RAD2DEG
  const dr = km / R
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(dr) + Math.cos(lat1) * Math.sin(dr) * Math.cos(br))
  const lng2 = lng1 + Math.atan2(Math.sin(br) * Math.sin(dr) * Math.cos(lat1), Math.cos(dr) - Math.sin(lat1) * Math.sin(lat2))
  return [lng2 * RAD2DEG, lat2 * RAD2DEG]
}

/** GeoJSON rays from the point toward sunrise, solar noon and sunset directions. */
export function sunRays(lng: number, lat: number, date: Date, km = 6): FeatureCollection {
  const info = sunInfo(lng, lat, date)
  const noon = SunCalc.getTimes(date, lat, lng).solarNoon ?? date
  const noonAz = SunCalc.getPosition(noon, lat, lng).azimuth
  const ray = (bearing: number, kind: string): Feature => ({
    type: 'Feature',
    properties: { kind },
    geometry: { type: 'LineString', coordinates: [[lng, lat], destination(lng, lat, bearing, km)] },
  })
  return {
    type: 'FeatureCollection',
    features: [
      ray(info.sunriseAz, 'sunrise'),
      ray(noonAz, 'noon'),
      ray(info.sunsetAz, 'sunset'),
      { type: 'Feature', properties: { kind: 'point' }, geometry: { type: 'Point', coordinates: [lng, lat] } },
    ],
  }
}

/** Solar-noon azimuth (compass bearing) — used to light the hillshade from the sun. */
export function noonAzimuth(lng: number, lat: number, date: Date): number {
  const noon = SunCalc.getTimes(date, lat, lng).solarNoon ?? date
  return SunCalc.getPosition(noon, lat, lng).azimuth
}

// --- Time-of-day animation ------------------------------------------------
// The daily summary above is static; these drive the live sun-arc / shadow
// sweep, computing the sun's exact position at an arbitrary date-TIME.

export interface SunPos {
  azimuth: number // compass bearing, degrees from north
  altitude: number // degrees above the horizon (negative at night)
}

/** Sun position (compass bearing + altitude, both degrees) at an exact moment. */
export function sunPositionAt(lng: number, lat: number, when: Date): SunPos {
  const p = SunCalc.getPosition(when, lat, lng)
  return { azimuth: p.azimuth, altitude: p.altitude }
}

/** Shadow length as a multiple of object height (∞ when the sun is at/below the horizon). */
export function shadowLengthFactor(altitudeDeg: number): number {
  return shadowFactor(altitudeDeg)
}

/** Sunrise / sunset instants for the day of `date` — the natural bounds of the time scrubber. */
export interface DaylightWindow { sunrise: Date; sunset: Date }

export function daylightWindow(lng: number, lat: number, date: Date): DaylightWindow {
  const times = SunCalc.getTimes(date, lat, lng)
  const noon = times.solarNoon ?? date
  return { sunrise: times.sunrise ?? noon, sunset: times.sunset ?? noon }
}

/**
 * Live GeoJSON for the animated sun mode at an exact date-time:
 *  - a "sun" ray from the point toward the sun (only while it's above the horizon),
 *  - a "shadow" ray in the opposite direction, its length ∝ the shadow factor
 *    (clamped so a near-horizon sun doesn't shoot off the map),
 *  - the point itself.
 * At night (sun below the horizon) only the point is returned.
 */
export function sunRayAt(
  lng: number,
  lat: number,
  when: Date,
  opts: { sunKm?: number; maxShadowKm?: number } = {},
): FeatureCollection {
  const sunKm = opts.sunKm ?? 6
  const maxShadowKm = opts.maxShadowKm ?? 12
  const { azimuth, altitude } = sunPositionAt(lng, lat, when)

  const features: Feature[] = [
    { type: 'Feature', properties: { kind: 'point' }, geometry: { type: 'Point', coordinates: [lng, lat] } },
  ]

  if (altitude > 0) {
    // The sun ray grows a touch as the sun climbs so a high noon sun reads longer.
    const rayKm = sunKm * (0.7 + 0.3 * Math.min(1, altitude / 60))
    features.push({
      type: 'Feature',
      properties: { kind: 'sun' },
      geometry: { type: 'LineString', coordinates: [[lng, lat], destination(lng, lat, azimuth, rayKm)] },
    })
    // Shadow points away from the sun; length ∝ 1/tan(altitude), clamped.
    const shadowKm = Math.min(shadowFactor(altitude), maxShadowKm)
    if (Number.isFinite(shadowKm) && shadowKm > 0.01) {
      features.push({
        type: 'Feature',
        properties: { kind: 'shadow' },
        geometry: {
          type: 'LineString',
          coordinates: [[lng, lat], destination(lng, lat, (azimuth + 180) % 360, shadowKm)],
        },
      })
    }
  }

  return { type: 'FeatureCollection', features }
}
