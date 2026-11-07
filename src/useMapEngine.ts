import { useCallback, useEffect, useRef, useState } from 'react'
import type { MapHandle } from './map/stagePlayer'
import { allUnits, type PopLevelId } from './map/layers'
import { analyzeLocation, type AnalyzeResult } from './map/analyzeClient'
import { daylightWindow } from './map/sun'
import type {
  ApiLayerStatus,
  ApiLayerStatusMap,
  ClimateState,
  ClimateVariableId,
  FeatureInfo,
  LngLat,
  VisibilityState,
} from './types'

const initialVisibility: VisibilityState = Object.fromEntries(
  allUnits().map((u) => [u.id, u.defaultVisible]),
)

export function useMapEngine() {
  const [visibility, setVisibility] = useState<VisibilityState>(initialVisibility)
  const [climate, setClimate] = useState<ClimateState>({ variable: null, month: 0 })
  const [popLevel, setPopLevel] = useState<PopLevelId | null>(null)
  const [animating, setAnimating] = useState(false)
  const [terrain3D, setTerrain3D] = useState(false)
  const [feature, setFeature] = useState<FeatureInfo | null>(null)
  const [sunActive, setSunActive] = useState(false)
  const [sunPoint, setSunPoint] = useState<LngLat | null>(null)
  const [sunDate, setSunDate] = useState<Date>(() => new Date())
  const [sunPlaying, setSunPlaying] = useState(false)
  const [analyzeActive, setAnalyzeActive] = useState(false)
  const [analyzePoint, setAnalyzePoint] = useState<LngLat | null>(null)
  const [analyzeResult, setAnalyzeResult] = useState<AnalyzeResult | null>(null)
  const [analyzeLoading, setAnalyzeLoading] = useState(false)
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)

  const [apiStatus, setApiStatus] = useState<ApiLayerStatusMap>({})
  const onApiLayerStatus = (id: string, status: ApiLayerStatus) =>
    setApiStatus((s) => ({ ...s, [id]: status }))

  const mapHandle = useRef<MapHandle | null>(null)

  const toggle = (id: string) => setVisibility((v) => ({ ...v, [id]: !(v[id] ?? false) }))
  const setMany = useCallback((ids: string[], visible: boolean) => {
    setVisibility((v) => ({ ...v, ...Object.fromEntries(ids.map((id) => [id, visible])) }))
  }, [])

  const setClimateVariable = (variable: ClimateVariableId | null) => {
    setClimate((c) => ({ ...c, variable }))
    if (!variable) setAnimating(false)
  }
  const setClimateMonth = (month: number) => {
    setAnimating(false)
    setClimate((c) => ({ ...c, month }))
  }

  useEffect(() => {
    if (!animating || !climate.variable) return
    const t = setInterval(
      () => setClimate((c) => ({ ...c, month: c.month >= 12 ? 1 : c.month + 1 })),
      750,
    )
    return () => clearInterval(t)
  }, [animating, climate.variable])

  const sunDayKey = `${sunDate.getFullYear()}-${sunDate.getMonth()}-${sunDate.getDate()}`
  useEffect(() => {
    if (!sunPlaying || !sunActive || !sunPoint) return
    const [year, month, date] = sunDayKey.split('-').map(Number)
    const day = new Date(year, month, date, 12)
    const { sunrise, sunset } = daylightWindow(sunPoint.lng, sunPoint.lat, day)
    const startMs = sunrise.getTime()
    const endMs = sunset.getTime()
    const spanMs = endMs - startMs
    if (!(spanMs > 0)) return
    const sweepMs = 6000
    const tickMs = 80
    const step = (spanMs / sweepMs) * tickMs
    const t = setInterval(() => {
      setSunDate((d) => {
        const next = d.getTime() + step
        return new Date(next > endMs ? startMs : next)
      })
    }, tickMs)
    return () => clearInterval(t)
  }, [sunPlaying, sunActive, sunPoint, sunDayKey])

  const toggleSunPlay = () => setSunPlaying((p) => !p)
  const setSunDateManual = (d: Date) => {
    setSunPlaying(false)
    setSunDate(d)
  }

  const exitAnalyze = () => {
    setAnalyzeActive(false)
    setAnalyzePoint(null)
    setAnalyzeResult(null)
    setAnalyzeError(null)
    setAnalyzeLoading(false)
  }

  const toggleSun = () =>
    setSunActive((s) => {
      const next = !s
      if (next) {
        setFeature(null)
        exitAnalyze()
      } else {
        setSunPoint(null)
        setSunPlaying(false)
      }
      return next
    })

  const toggleAnalyze = () => {
    if (analyzeActive) {
      exitAnalyze()
      return
    }
    setSunActive(false)
    setSunPoint(null)
    setSunPlaying(false)
    setFeature(null)
    setAnalyzeActive(true)
    setAnalyzePoint(null)
    setAnalyzeResult(null)
    setAnalyzeError(null)
  }

  const onAnalyzePick = (p: LngLat) => {
    setAnalyzePoint(p)
    setAnalyzeResult(null)
    setAnalyzeError(null)
    setAnalyzeLoading(true)
    analyzeLocation(p)
      .then((r) => {
        setAnalyzeResult(r)
        setAnalyzeLoading(false)
      })
      .catch((e: Error) => {
        setAnalyzeError(e.message || 'analysis failed')
        setAnalyzeLoading(false)
      })
  }

  return {
    mapHandle,
    visibility,
    setVisibility,
    toggle,
    setMany,
    climate,
    setClimate,
    setClimateVariable,
    setClimateMonth,
    animating,
    setAnimating,
    popLevel,
    setPopLevel,
    terrain3D,
    setTerrain3D,
    feature,
    setFeature,
    sunActive,
    sunPoint,
    sunDate,
    sunPlaying,
    toggleSun,
    toggleSunPlay,
    setSunDateManual,
    setSunPoint,
    setSunActive,
    setSunPlaying,
    analyzeActive,
    analyzePoint,
    analyzeResult,
    analyzeLoading,
    analyzeError,
    setAnalyzeActive,
    setAnalyzePoint,
    setAnalyzeResult,
    setAnalyzeError,
    setAnalyzeLoading,
    toggleAnalyze,
    onAnalyzePick,
    exitAnalyze,
    apiStatus,
    onApiLayerStatus,
  }
}
