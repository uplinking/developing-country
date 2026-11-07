// Place search. Lives INSIDE the nameboard (see .nameboard in App.css)
// and carries no surface of its own — the board is the surface; results drop
// below it as a sign panel.
// Hits GET /api/search (same body as MCP search_places).

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { withBase } from '../base'
import { isJsonNumber, isJsonObject, isJsonString, type JsonValue } from '../shared/json'

export interface PlaceHit {
  layer: string
  name: string
  lat: number | null
  lng: number | null
  id?: string
  district?: string | null
}

const LAYER_LABEL = new Map(Object.entries({
  metro_stop: 'Metro stop',
  metro_line: 'Metro line',
  district: 'District',
  gnd: 'GN division',
  dsd: 'Division',
  expressway: 'Expressway',
  developments: 'Development',
  'boi-zones': 'BOI zone',
  boi_zone: 'BOI zone',
  attractions: 'Attraction',
  waterfalls: 'Waterfall',
  trails: 'Trail',
  cycling: 'Cycling',
  parks: 'Park',
  schools: 'School',
  hospitals: 'Hospital',
  prospects: 'Prospect',
  issues: 'Issue',
}))

function labelOf(layer: string): string {
  return LAYER_LABEL.get(layer) ?? layer.replace(/_/g, ' ')
}

function parsePlaceHit(value: JsonValue): PlaceHit | null {
  if (!isJsonObject(value) || !isJsonString(value.layer) || !isJsonString(value.name)) return null
  const lat = isJsonNumber(value.lat) ? value.lat : null
  const lng = isJsonNumber(value.lng) ? value.lng : null
  const hit: PlaceHit = { layer: value.layer, name: value.name, lat, lng }
  if (isJsonString(value.id)) hit.id = value.id
  if (isJsonString(value.district) || value.district === null) hit.district = value.district
  return hit
}

function parseSearchResults(body: JsonValue): PlaceHit[] {
  if (!isJsonObject(body) || !Array.isArray(body.results)) return []
  return body.results.map(parsePlaceHit).filter((hit): hit is PlaceHit => hit !== null)
}

export default function PlaceSearch({
  onPick,
}: {
  onPick: (hit: PlaceHit) => void
}) {
  const listId = useId()
  const boxRef = useRef<HTMLDivElement>(null)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<PlaceHit[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [busy, setBusy] = useState(false)
  // The last name we committed by picking a hit. Setting the input to the
  // pick's name would otherwise re-run the query and re-open the dropdown
  // straight over the readout that pick just opened.
  const pickedRef = useRef<string | null>(null)

  useEffect(() => {
    const t = q.trim()
    if (t.length < 2) return
    if (t === pickedRef.current) {
      // The input was just filled from a pick — don't re-query that exact
      // string and pop the dropdown over the new readout. One-shot block.
      pickedRef.current = null
      return
    }
    const handle = window.setTimeout(() => {
      setBusy(true)
      void fetch(withBase(`/api/search?q=${encodeURIComponent(t)}&limit=8`), {
        credentials: 'include',
      })
        .then(async (res) => {
          if (!res.ok) throw new Error('search failed')
          const body: JsonValue = await res.json()
          const rows = parseSearchResults(body)
          setHits(rows)
          setActive(0)
          setOpen(true)
        })
        .catch(() => {
          setHits([])
        })
        .finally(() => setBusy(false))
    }, 220)
    return () => window.clearTimeout(handle)
  }, [q])

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !e.composedPath().includes(boxRef.current)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const choose = (hit: PlaceHit) => {
    pickedRef.current = hit.name
    setQ(hit.name)
    setOpen(false)
    onPick(hit)
  }


  const updateQuery = (value: string) => {
    setQ(value)
    if (value.trim().length >= 2) return
    setHits([])
    setOpen(false)
  }

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setOpen(false)
      return
    }
    if (!open || hits.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % hits.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i - 1 + hits.length) % hits.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const hit = hits[active]
      if (hit) choose(hit)
    }
  }

  return (
    <div className="chrome-search" ref={boxRef}>
      <svg className="search-glyph" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M10.4 10.4L14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <input
        type="search"
        value={q}
        onChange={(e) => updateQuery(e.target.value)}
        onFocus={() => hits.length > 0 && setOpen(true)}
        onKeyDown={onKey}
        placeholder="Search a place"
        aria-label="Search a place"
        aria-autocomplete="list"
        aria-controls={listId}
        aria-expanded={open}
        autoComplete="off"
        spellCheck={false}
      />
      {busy && <span className="search-busy" aria-hidden="true" />}
      {open && (
        <ul className="search-results" id={listId} role="listbox">
          {hits.length === 0 ? (
            <li className="search-empty">No matches</li>
          ) : (
            hits.map((hit, i) => (
              <li key={`${hit.layer}-${hit.name}-${hit.lat}-${i}`} role="none">
                <button
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  className={`search-hit${i === active ? ' on' : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(hit)}
                >
                  <span className="search-hit-name">{hit.name}</span>
                  <span className="search-hit-layer">
                    {hit.district ? `${labelOf(hit.layer)} · ${hit.district}` : labelOf(hit.layer)}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
