// The flagship "Analyze" readout. When Analyze mode is on, tapping the map
// picks a point; the Worker joins every layer server-side and this sheet renders
// the composite. Handles the loading and error states itself, then defers to
// FeatureSheet's section rendering for the result.
//
// Every state renders as a sign panel with the vermillion route tab (the
// express line), so the flagship is recognisable before its title is read.

import { useMemo } from 'react'
import FeatureSheet from './FeatureSheet'
import { formatAnalyze } from '../map/featureFormat'
import type { AnalyzeResult } from '../map/analyzeClient'
import type { LngLat } from '../types'

interface AnalyzeSheetProps {
  point: LngLat | null
  result: AnalyzeResult | null
  loading: boolean
  error: string | null
  onClose: () => void
}

function Head({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="feature-head">
      <div>
        <span className="feature-kind">Analyze</span>
        <h2 className="feature-title">{title}</h2>
      </div>
      <button className="feature-close" onClick={onClose} aria-label="Exit analyze mode">
        ✕
      </button>
    </div>
  )
}

export default function AnalyzeSheet({ point, result, loading, error, onClose }: AnalyzeSheetProps) {
  const info = useMemo(() => (result ? formatAnalyze(result) : null), [result])

  // Idle: nothing picked yet.
  if (!point && !loading && !result) {
    return (
      <div className="feature-sheet" data-route="flag">
        <Head title="Pick a spot" onClose={onClose} />
        <p className="sun-hint">
          Tap anywhere on the map. developing-country.org pulls every layer together at that point —
          demographics, expressways, planned developments and nature — into one
          readout.
        </p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="feature-sheet" data-route="flag">
        <Head title={point ? `${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}` : 'Analyzing…'} onClose={onClose} />
        <div className="analyze-loading">
          <span className="map-spinner" aria-hidden="true" />
          <span>Reading every layer at this spot…</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="feature-sheet" data-route="flag">
        <Head title="Couldn’t analyze" onClose={onClose} />
        <p className="analyze-error">Something went wrong reading this spot.</p>
        <p className="sun-hint">Check your connection and tap the map again to retry.</p>
      </div>
    )
  }

  return <FeatureSheet info={info} onClose={onClose} />
}
