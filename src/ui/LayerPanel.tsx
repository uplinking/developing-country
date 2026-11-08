import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  CATEGORIES,
  LAYER_GROUPS,
  CLIMATE_VARIABLES,
  CLIMATE_MONTHS,
  CLIMATE_INFO,
  SUN_INFO,
  climateLegend,
  isClimateAvailable,
  POP_LEVELS,
  POP_LEGEND,
  DEMOGRAPHICS_INFO,
  isDemographicsAvailable,
  type PopLevelId,
  groupUnits,
  isGroupAvailable,
  type LayerGroup,
  type LegendItem,
  type SourceInfo,
} from '../map/layers'
import { iconSpec, glyphInk, MARKER_BOX, MARKER_PATH, GLYPH_NUDGE } from '../map/icons'
import type {
  ApiLayerStatus,
  ApiLayerStatusMap,
  ClimateState,
  ClimateVariableId,
  VisibilityState,
} from '../types'

interface LayerPanelProps {
  visibility: VisibilityState
  onToggle: (id: string) => void
  onSetMany: (ids: string[], visible: boolean) => void
  climate: ClimateState
  onClimateVariable: (v: ClimateVariableId | null) => void
  onClimateMonth: (m: number) => void
  population: PopLevelId | null
  onPopulationLevel: (l: PopLevelId | null) => void
  animating: boolean
  onToggleAnimate: () => void
  terrain3D: boolean
  onToggle3D: () => void
  sunActive: boolean
  onToggleSun: () => void
  analyzeActive: boolean
  onToggleAnalyze: () => void
  apiStatus: ApiLayerStatusMap
  /** Whether a user is signed in (drives the "Sign in to use" affordance). */
  signedIn: boolean
  /** Open the auth modal (from an API layer's signed-out state). */
  onRequestSignIn: () => void
  /**
   * `dock` (explorer): left sidebar on desktop, bottom sheet on phones.
   * `overlay` (MCP App): a plate over the map that opens as a popover.
   */
  variant?: 'dock' | 'overlay'
  /** Show the Analyze and Sun tool cards (the MCP App has no picking modes). */
  tools?: boolean
  /** Another sheet took the screen: drop a phone sheet to its peek bar. */
  yieldTo?: boolean
  /** Layer groups this surface cannot load (the MCP App's CSP has no terrain tile host). */
  hiddenGroups?: ReadonlySet<string>
}

/**
 * Sheet heights. Desktop only distinguishes collapsed from open; a phone sheet
 * also has a half height so the map stays usable while choosing layers.
 * Collapsed always leaves the band in view — the panel can never be lost.
 */
type RailSize = 'collapsed' | 'half' | 'full'

const RAIL_STORAGE_KEY = 'dc.layers.open'
const PHONE_QUERY = '(max-width: 767px)'
const DRAG_SNAP_PX = 36

function isPhone(): boolean {
  return window.matchMedia(PHONE_QUERY).matches
}

/** Desktop remembers the viewer's choice; phones always start on the map. */
function initialSize(variant: 'dock' | 'overlay'): RailSize {
  if (variant === 'overlay' || isPhone()) return 'collapsed'
  try {
    return window.localStorage.getItem(RAIL_STORAGE_KEY) === '0' ? 'collapsed' : 'half'
  } catch {
    return 'half'
  }
}

function rememberOpen(open: boolean) {
  try {
    window.localStorage.setItem(RAIL_STORAGE_KEY, open ? '1' : '0')
  } catch {
    /* private mode / blocked storage: the default is fine */
  }
}

function activeCount(visibility: VisibilityState, climate: ClimateState, population: PopLevelId | null): number {
  const layers = Object.values(visibility).filter(Boolean).length
  return layers + (climate.variable ? 1 : 0) + (population ? 1 : 0)
}

/** The legend draws the *same* pin the map draws, from the same path data in
 *  map/icons.ts — so the panel can never drift from the marker on the map. */
function PinSwatch({ id }: { id: string }) {
  const spec = iconSpec(id)
  if (!spec) return null
  // The legend draws the same badge the map draws, from the same path data.
  const ink = glyphInk(spec.color)
  return (
    <svg
      className="swatch swatch-pin"
      viewBox={`0 0 ${MARKER_BOX.w} ${MARKER_BOX.h}`}
      role="img"
      aria-label={spec.label}
    >
      <path d={MARKER_PATH} fill="none" stroke="rgba(15,23,42,0.3)" strokeWidth={3.4} strokeLinejoin="round" />
      <path d={MARKER_PATH} fill={spec.color} stroke="#fff" strokeWidth={2.2} strokeLinejoin="round" />
      <g transform={`translate(${GLYPH_NUDGE.x} ${GLYPH_NUDGE.y})`}>
        {spec.fill?.map((d, i) => (
          <path key={`f${i}`} d={d} fill={ink} />
        ))}
        {spec.stroke?.map((d, i) => (
          <path
            key={`s${i}`}
            d={d}
            fill="none"
            stroke={ink}
            strokeWidth={1.9}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </g>
    </svg>
  )
}

function Swatch({ item }: { item: LegendItem }) {
  if (item.icon) return <PinSwatch id={item.icon} />
  if (item.style === 'fill' || item.style === undefined) {
    return <span className="swatch swatch-fill" style={{ background: item.swatch }} />
  }
  return (
    <span className={`swatch swatch-line ${item.style}`}>
      <span className="swatch-line-bar" style={{ background: item.swatch }} />
    </span>
  )
}

function Toggle({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean
  disabled?: boolean
  onChange: () => void
}) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={onChange} />
      <span className="slider" />
    </label>
  )
}

function Legend({ items }: { items: LegendItem[] }) {
  return (
    <ul className="legend">
      {items.map((item) => (
        <li key={item.label}>
          <Swatch item={item} />
          <span>{item.label}</span>
        </li>
      ))}
    </ul>
  )
}

/** The "i" corner button + its provenance popover. */
function InfoCorner({
  id,
  info,
  openId,
  onToggle,
}: {
  id: string
  info: SourceInfo
  openId: string | null
  onToggle: (id: string) => void
}) {
  const open = openId === id
  return (
    <div className="info-corner">
      <button
        className={`info-btn${open ? ' open' : ''}`}
        aria-label="Data source"
        aria-expanded={open}
        onClick={() => onToggle(id)}
      >
        i
      </button>
      {open && (
        <div className="info-pop" role="dialog">
          <div className="info-src">{info.source}</div>
          {info.detail && <p className="info-detail">{info.detail}</p>}
          <div className="info-meta">
            {info.year && <span className="info-year">{info.year}</span>}
            {info.url && (
              <a className="info-link" href={info.url} target="_blank" rel="noreferrer">
                Source ↗
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/** Small right-aligned status pill for an API-backed layer. */
function ApiBadge({ status, signedIn }: { status: ApiLayerStatus | undefined; signedIn: boolean }) {
  if (!status) return null
  if (status.loading) return <span className="badge">loading…</span>
  // Signed out ⇒ the API returns 401; frame it as "sign in", not a fault.
  if (!status.ok) return <span className="badge badge-warn">{signedIn ? 'unavailable' : 'sign in'}</span>
  return <span className="badge count-badge">{status.count}</span>
}

function LayerCard({
  group,
  visibility,
  onToggle,
  onSetMany,
  terrain3D,
  onToggle3D,
  infoId,
  onToggleInfo,
  apiStatus,
  signedIn,
  onRequestSignIn,
}: {
  group: LayerGroup
  visibility: VisibilityState
  onToggle: (id: string) => void
  onSetMany: (ids: string[], visible: boolean) => void
  terrain3D: boolean
  onToggle3D: () => void
  infoId: string | null
  onToggleInfo: (id: string) => void
  apiStatus: ApiLayerStatusMap
  signedIn: boolean
  onRequestSignIn: () => void
}) {
  const locked = !isGroupAvailable(group)
  const units = groupUnits(group)
  const isVisible = (id: string) => visibility[id] ?? group.defaultVisible
  const isApi = group.source.type === 'api'
  const status = isApi ? apiStatus[group.id] : undefined

  const allOn = units.every((u) => isVisible(u.id))
  const headerChecked = group.perLayerToggle ? units.some((u) => isVisible(u.id)) : isVisible(units[0].id)
  const onHeaderToggle = () =>
    group.perLayerToggle
      ? onSetMany(units.map((u) => u.id), !allOn)
      : onToggle(units[0].id)

  return (
    <div className={`layer-card${locked ? ' locked' : ''}`}>
      <div className="layer-head">
        <Toggle checked={headerChecked} disabled={locked} onChange={onHeaderToggle} />
        <div className="layer-title">
          <span className="layer-label">{group.label}</span>
          {locked && <span className="badge">needs data pipeline</span>}
          {isApi && <ApiBadge status={status} signedIn={signedIn} />}
        </div>
        <InfoCorner id={group.id} info={group.info} openId={infoId} onToggle={onToggleInfo} />
      </div>
      <p className="layer-blurb">{group.blurb}</p>

      {isApi && !signedIn && status && !status.loading && !status.ok && (
        <button className="layer-signin" onClick={onRequestSignIn}>
          Sign in to use
        </button>
      )}

      {isApi && status && !status.loading && status.ok && status.count === 0 && (
        <p className="layer-empty">Nothing to show yet — this layer is empty.</p>
      )}

      {!locked && group.perLayerToggle && (
        <ul className="subunits">
          {units.map((u) => (
            <li key={u.id}>
              <Toggle checked={isVisible(u.id)} onChange={() => onToggle(u.id)} />
              {u.legend[0] && <Swatch item={u.legend[0]} />}
              <span>{u.label}</span>
            </li>
          ))}
        </ul>
      )}

      {!locked && !group.perLayerToggle && isVisible(units[0].id) && <Legend items={group.legend} />}

      {group.id === 'hillshade' && (
        <label className="terrain-toggle">
          <input type="checkbox" checked={terrain3D} onChange={onToggle3D} />
          <span>3D terrain</span>
        </label>
      )}
    </div>
  )
}

/** Climate: master toggle, a variable segmented control, and a shared
 *  Annual/Jan..Dec scrubber with an animate button. */
function ClimateCard({
  climate,
  onVariable,
  onMonth,
  animating,
  onToggleAnimate,
  infoId,
  onToggleInfo,
}: {
  climate: ClimateState
  onVariable: (v: ClimateVariableId | null) => void
  onMonth: (m: number) => void
  animating: boolean
  onToggleAnimate: () => void
  infoId: string | null
  onToggleInfo: (id: string) => void
}) {
  const locked = !isClimateAvailable()
  const active = climate.variable
  const activeVar = CLIMATE_VARIABLES.find((v) => v.id === active) ?? null

  const onHeaderToggle = () => onVariable(active ? null : 'rainfall')

  return (
    <div className={`layer-card${locked ? ' locked' : ''}`}>
      <div className="layer-head">
        <Toggle checked={!!active} disabled={locked} onChange={onHeaderToggle} />
        <div className="layer-title">
          <span className="layer-label">Climate</span>
          {locked && <span className="badge">needs data pipeline</span>}
        </div>
        <InfoCorner id="climate" info={CLIMATE_INFO} openId={infoId} onToggle={onToggleInfo} />
      </div>
      <p className="layer-blurb">
        {activeVar
          ? activeVar.blurb
          : 'Typical rainfall, temperature and humidity. Pick a month, or see the yearly average.'}
      </p>

      {!locked && active && (
        <>
          <div className="segmented" role="tablist" aria-label="Climate variable">
            {CLIMATE_VARIABLES.map((v) => (
              <button
                key={v.id}
                role="tab"
                aria-selected={active === v.id}
                className={`seg${active === v.id ? ' seg-on' : ''}`}
                onClick={() => onVariable(v.id)}
              >
                {v.label}
              </button>
            ))}
          </div>

          <div className="scrubber">
            <div className="scrubber-head">
              <button
                className={`scrub-play${animating ? ' playing' : ''}`}
                onClick={onToggleAnimate}
                aria-label={animating ? 'Pause month animation' : 'Animate months'}
              >
                {animating ? '⏸' : '▶'}
              </button>
              <span className="scrubber-label">{CLIMATE_MONTHS[climate.month]}</span>
            </div>
            <input
              className="scrubber-range"
              type="range"
              min={0}
              max={12}
              step={1}
              value={climate.month}
              onChange={(e) => onMonth(Number(e.target.value))}
              list="climate-ticks"
            />
            <datalist id="climate-ticks">
              {CLIMATE_MONTHS.map((_, i) => (
                <option key={i} value={i} />
              ))}
            </datalist>
          </div>

          {activeVar && <Legend items={climateLegend(activeVar, climate.month)} />}
        </>
      )}
    </div>
  )
}

/** Population: master toggle + a slider that picks the census level
 *  (province → district → division → GN division). Coloured by density. */
function PopulationCard({
  level,
  onLevel,
  infoId,
  onToggleInfo,
}: {
  level: PopLevelId | null
  onLevel: (l: PopLevelId | null) => void
  infoId: string | null
  onToggleInfo: (id: string) => void
}) {
  const locked = !isDemographicsAvailable()
  const idx = level ? POP_LEVELS.findIndex((l) => l.id === level) : 1
  const active = POP_LEVELS[idx]
  const onHeaderToggle = () => onLevel(level ? null : 'district')

  return (
    <div className={`layer-card${locked ? ' locked' : ''}`}>
      <div className="layer-head">
        <Toggle checked={!!level} disabled={locked} onChange={onHeaderToggle} />
        <div className="layer-title">
          <span className="layer-label">Population density</span>
          {locked && <span className="badge">needs data pipeline</span>}
        </div>
        <InfoCorner id="population" info={DEMOGRAPHICS_INFO} openId={infoId} onToggle={onToggleInfo} />
      </div>
      <p className="layer-blurb">
        {level
          ? active.blurb
          : 'How crowded each area is — slide from province down to neighbourhood. Deep colour is packed.'}
      </p>

      {!locked && level && (
        <>
          <div className="scrubber">
            <div className="scrubber-head">
              <span className="scrubber-label">{active.label}</span>
            </div>
            <input
              className="scrubber-range"
              type="range"
              min={0}
              max={POP_LEVELS.length - 1}
              step={1}
              value={idx}
              onChange={(e) => onLevel(POP_LEVELS[Number(e.target.value)].id)}
              list="pop-ticks"
            />
            <datalist id="pop-ticks">
              {POP_LEVELS.map((_, i) => (
                <option key={i} value={i} />
              ))}
            </datalist>
            <div className="scrub-ticks">
              {POP_LEVELS.map((l, i) => (
                <button
                  key={l.id}
                  type="button"
                  className={`scrub-tick${i === idx ? ' on' : ''}`}
                  onClick={() => onLevel(l.id)}
                >
                  {l.short}
                </button>
              ))}
            </div>
          </div>
          <Legend items={POP_LEGEND} />
        </>
      )}
    </div>
  )
}

/** Sun & shadow: a toggle; the readout opens in the right-hand sheet on tap. */
function SunCard({
  active,
  onToggle,
  infoId,
  onToggleInfo,
}: {
  active: boolean
  onToggle: () => void
  infoId: string | null
  onToggleInfo: (id: string) => void
}) {
  return (
    <div className={`layer-card${active ? ' sun-on' : ''}`}>
      <div className="layer-head">
        <Toggle checked={active} onChange={onToggle} />
        <div className="layer-title">
          <span className="roundel roundel-sun" aria-hidden="true">S</span>
          <span className="layer-label">Sun &amp; shadow</span>
        </div>
        <InfoCorner id="sun" info={SUN_INFO} openId={infoId} onToggle={onToggleInfo} />
      </div>
      <p className="layer-blurb">
        See where the sun rises, sets and casts shadows on any plot, on any date.
        {active ? ' Tap the map to pick a spot.' : ''}
      </p>
    </div>
  )
}

/** Analyze: the flagship. A toggle that turns map taps into a composite readout. */
function AnalyzeCard({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <div className={`layer-card analyze-card${active ? ' analyze-on' : ''}`}>
      <div className="layer-head">
        <Toggle checked={active} onChange={onToggle} />
        <div className="layer-title">
          <span className="roundel" aria-hidden="true">A</span>
          <span className="layer-label">Analyze a location</span>
        </div>
      </div>
      <p className="layer-blurb">
        Tap any spot for one readout of everything around it: who lives there, what is being
        built, what is nearby and what neighbours have reported.
        {active ? ' Tap the map to pick a spot.' : ''}
      </p>
    </div>
  )
}

export default function LayerPanel({
  visibility,
  onToggle,
  onSetMany,
  climate,
  onClimateVariable,
  onClimateMonth,
  population,
  onPopulationLevel,
  animating,
  onToggleAnimate,
  terrain3D,
  onToggle3D,
  sunActive,
  onToggleSun,
  analyzeActive,
  onToggleAnalyze,
  apiStatus,
  signedIn,
  onRequestSignIn,
  variant = 'dock',
  tools = true,
  yieldTo = false,
  hiddenGroups,
}: LayerPanelProps) {
  const [size, setSize] = useState<RailSize>(() => initialSize(variant))
  const [infoId, setInfoId] = useState<string | null>(null)
  const drag = useRef<{ y: number } | null>(null)
  const open = size !== 'collapsed'
  const count = activeCount(visibility, climate, population)

  const resize = (next: RailSize) => {
    setSize(next)
    if (variant === 'dock' && !isPhone()) rememberOpen(next !== 'collapsed')
  }

  // A feature or analysis sheet opening on a phone reclaims the screen.
  useEffect(() => {
    if (yieldTo && (variant === 'overlay' || isPhone())) setSize('collapsed')
  }, [yieldTo, variant])

  // Escape folds the panel back to its band.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !infoId) setSize('collapsed')
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, infoId])

  // Phone sheet: drag the band to snap between peek, half and full; a tap
  // toggles peek ↔ half. Desktop and overlay: the band is a plain toggle.
  const onBandPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (variant !== 'dock' || !isPhone()) return
    drag.current = { y: e.clientY }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onBandPointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const start = drag.current
    drag.current = null
    if (!start) return
    const dy = e.clientY - start.y
    if (Math.abs(dy) < DRAG_SNAP_PX) return
    const order: RailSize[] = ['collapsed', 'half', 'full']
    const at = order.indexOf(size)
    const next = order[Math.max(0, Math.min(order.length - 1, at + (dy < 0 ? 1 : -1)))]!
    resize(next)
    // Swallow the click that follows a drag.
    const swallow = (ev: Event) => { ev.stopPropagation(); ev.preventDefault() }
    e.currentTarget.addEventListener('click', swallow, { capture: true, once: true })
  }
  const onBandClick = () => resize(open ? 'collapsed' : 'half')
  const onToggleInfo = (id: string) => setInfoId((cur) => (cur === id ? null : id))

  // Close an open info popover when clicking anywhere outside one.
  useEffect(() => {
    if (!infoId) return
    const onDoc = (e: MouseEvent) => {
      const insideInfo = e.composedPath().some((target) => target instanceof Element && target.matches('.info-corner, .info-corner *'))
      if (!insideInfo) setInfoId(null)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [infoId])

  return (
    <aside
      className={`layer-rail rail-${variant} rail-${size}${open ? ' open' : ' collapsed'}`}
      aria-label="Map layers"
    >
      <button
        className="rail-band"
        onClick={onBandClick}
        onPointerDown={onBandPointerDown}
        onPointerUp={onBandPointerUp}
        onPointerCancel={() => { drag.current = null }}
        aria-expanded={open}
        aria-controls="layer-rail-body"
      >
        <span className="panel-title">Layers</span>
        <span className="rail-count" aria-label={`${count} on`}>{count ? `${count} on` : 'none on'}</span>
        {/* Points the way the panel will move; the phone sheet flips it in CSS. */}
        <span className="chevron" aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>

      <div className="rail-body" id="layer-rail-body" hidden={!open}>
        {tools && (
          <section className="layer-cat">
            <h3>Analyze</h3>
            <AnalyzeCard active={analyzeActive} onToggle={onToggleAnalyze} />
          </section>
        )}

        {CATEGORIES.map((cat) => {
          const groups = LAYER_GROUPS.filter((g) => g.category === cat.id && !hiddenGroups?.has(g.id))
          const isEnv = cat.id === 'environment'
          const isDemo = cat.id === 'demographics'
          if (groups.length === 0 && !isEnv && !isDemo) return null
          return (
            <section key={cat.id} className="layer-cat">
              <h3>{cat.label}</h3>
              {groups.map((group) => (
                <LayerCard
                  key={group.id}
                  group={group}
                  visibility={visibility}
                  onToggle={onToggle}
                  onSetMany={onSetMany}
                  terrain3D={terrain3D}
                  onToggle3D={onToggle3D}
                  infoId={infoId}
                  onToggleInfo={onToggleInfo}
                  apiStatus={apiStatus}
                  signedIn={signedIn}
                  onRequestSignIn={onRequestSignIn}
                />
              ))}
              {isDemo && (
                <PopulationCard
                  level={population}
                  onLevel={onPopulationLevel}
                  infoId={infoId}
                  onToggleInfo={onToggleInfo}
                />
              )}
              {isEnv && (
                <>
                  <ClimateCard
                    climate={climate}
                    onVariable={onClimateVariable}
                    onMonth={onClimateMonth}
                    animating={animating}
                    onToggleAnimate={onToggleAnimate}
                    infoId={infoId}
                    onToggleInfo={onToggleInfo}
                  />
                  {tools && (
                    <SunCard
                      active={sunActive}
                      onToggle={onToggleSun}
                      infoId={infoId}
                      onToggleInfo={onToggleInfo}
                    />
                  )}
                </>
              )}
            </section>
          )
        })}
        <p className="panel-foot">
          Basemap & roads © OpenStreetMap · Terrain: SRTM · Climate: WorldClim · Demographics:
          nuuuwan/gig-data · Map pins: original developing-country.org artwork
        </p>
      </div>
    </aside>
  )
}
