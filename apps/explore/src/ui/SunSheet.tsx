import { sunInfo, sunPositionAt, shadowLengthFactor, daylightWindow } from '../map/sun'
import type { LngLat } from '../types'

interface SunSheetProps {
  point: LngLat | null
  date: Date
  onDate: (d: Date) => void
  playing: boolean
  onTogglePlay: () => void
  onClose: () => void
}

const bearing = (deg: number) => {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  return `${Math.round(deg)}° ${dirs[Math.round(deg / 45) % 8]}`
}

// Day-of-year <-> Date for the slider.
const dayOfYear = (d: Date) =>
  Math.floor((d.getTime() - new Date(d.getFullYear(), 0, 0).getTime()) / 86400000)

const clock = (d: Date) =>
  d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

const minutesOfDay = (d: Date) => d.getHours() * 60 + d.getMinutes()

export default function SunSheet({ point, date, onDate, playing, onTogglePlay, onClose }: SunSheetProps) {
  const info = point ? sunInfo(point.lng, point.lat, date) : null
  const doy = dayOfYear(date)

  // Change the day but keep the current time-of-day so the animation window stays put.
  const setDoy = (n: number) => {
    const d = new Date(date.getFullYear(), 0, 1)
    d.setDate(n)
    d.setHours(date.getHours(), date.getMinutes(), 0, 0)
    onDate(d)
  }

  // Time-of-day scrubber spans the daylight window (sunrise → sunset).
  const win = point ? daylightWindow(point.lng, point.lat, date) : null
  const riseMin = win ? minutesOfDay(win.sunrise) : 0
  const setMin = win ? minutesOfDay(win.sunset) : 24 * 60
  const nowMin = minutesOfDay(date)
  const setTime = (m: number) => {
    const d = new Date(date)
    d.setHours(Math.floor(m / 60), Math.floor(m % 60), 0, 0)
    onDate(d)
  }

  // Live sun position at the current date-time (drives the animated readout).
  const live = point ? sunPositionAt(point.lng, point.lat, date) : null
  const isDay = !!live && live.altitude > 0
  const liveShadow = live ? shadowLengthFactor(live.altitude) : Infinity

  return (
    <div className="feature-sheet" data-route="sun">
      <div className="feature-head">
        <div>
          <span className="feature-kind">Sun &amp; shadow</span>
          <h2 className="feature-title">{point ? 'This spot' : 'Pick a spot'}</h2>
        </div>
        <button className="feature-close" onClick={onClose} aria-label="Exit sun mode">
          ✕
        </button>
      </div>

      <label className="sun-date">
        <span>{date.toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
        <input
          type="range"
          min={1}
          max={365}
          value={doy}
          onChange={(e) => setDoy(Number(e.target.value))}
        />
        <button className="sun-today" onClick={() => onDate(new Date())}>
          Today
        </button>
      </label>

      {!point && <p className="sun-hint">Tap anywhere on the map to analyse the light at that spot.</p>}

      {point && (
        <>
          <div className="scrubber sun-time">
            <div className="scrubber-head">
              <button
                className={`scrub-play${playing ? ' playing' : ''}`}
                onClick={onTogglePlay}
                aria-label={playing ? 'Pause the day' : 'Play the day'}
              >
                {playing ? '⏸' : '▶'}
              </button>
              <span className="scrubber-label">{clock(date)}</span>
              <span className="sun-live-alt">
                {isDay ? `${live!.altitude.toFixed(0)}° · ${bearing(live!.azimuth)}` : 'below horizon'}
              </span>
            </div>
            <input
              className="scrubber-range"
              type="range"
              min={Math.min(riseMin, nowMin)}
              max={Math.max(setMin, nowMin)}
              step={1}
              value={nowMin}
              onChange={(e) => setTime(Number(e.target.value))}
              aria-label="Time of day"
            />
          </div>

          <dl className="feature-rows">
            <div className="feature-row">
              <dt>Shadow now</dt>
              <dd>
                {isDay && Number.isFinite(liveShadow)
                  ? `${liveShadow.toFixed(1)}× height`
                  : '— (no sun)'}
              </dd>
            </div>
          </dl>
        </>
      )}

      {info && (
        <dl className="feature-rows">
          <div className="feature-row">
            <dt>Sunrise</dt>
            <dd>{info.sunriseTime} · {bearing(info.sunriseAz)}</dd>
          </div>
          <div className="feature-row">
            <dt>Sunset</dt>
            <dd>{info.sunsetTime} · {bearing(info.sunsetAz)}</dd>
          </div>
          <div className="feature-row">
            <dt>Noon sun</dt>
            <dd>{info.noonAltitude.toFixed(0)}° high</dd>
          </div>
          <div className="feature-row">
            <dt>Day length</dt>
            <dd>{info.dayLengthHrs.toFixed(1)} h</dd>
          </div>
          <div className="feature-row">
            <dt>Noon shadow</dt>
            <dd>{Number.isFinite(info.shadowNoon) ? `${info.shadowNoon.toFixed(1)}× height` : '—'}</dd>
          </div>
          <div className="feature-row">
            <dt>Golden hour</dt>
            <dd>from {info.goldenEveningTime}</dd>
          </div>
        </dl>
      )}

      {point && (
        <p className="feature-coords">
          {point.lat.toFixed(4)}, {point.lng.toFixed(4)}
        </p>
      )}
    </div>
  )
}
