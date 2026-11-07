// Turns a clicked MapLibre feature into a normalized FeatureInfo for the
// detail sheet. Kept separate from MapView so the per-layer presentation logic
// is easy to read and extend.

import type {
  ClimateVariableId,
  FeatureInfo,
  FeatureLink,
  FeatureRow,
  FeatureSection,
  TimelineStep,
} from '../types'
import { CLIMATE_MONTHS, CLIMATE_VARIABLES, POP_LEVELS, type PopLevelId } from './layers'
import type { AnalyzeResult } from './analyzeClient'
import type { JsonObject, JsonValue } from '../shared/json'
import { isJsonObject } from '../shared/json'

// Canonical project lifecycle. Each feature's `status` maps to the stage it has
// reached; earlier stages are done, later ones are still ahead.
const LIFECYCLE = ['Proposed', 'Approved', 'Under construction', 'Operational'] as const
// The stages object keys a rough date onto each lifecycle step (any subset).
const STAGE_KEYS = ['proposed', 'approved', 'construction', 'operational'] as const
const STATUS_STAGE = new Map<string, number>([
  ['proposed', 0],
  ['planned', 0],
  ['approved', 1],
  ['construction', 2],
  ['under-construction', 2],
  ['open', 3],
  ['existing', 3],
  ['operational', 3],
  ['completed', 3],
])

/** A stage date counts as "reached" if it names a year now past and isn't a
 *  target/estimate — used to place the "current" dot from the dates themselves,
 *  so an approved-but-not-built project reads correctly even if its map status
 *  is coarser. */
function stageReached(v: string | null): boolean {
  if (!v || v === '—' || /target|expected|planned|est\.?/i.test(v)) return false
  const m = /(\d{4})/.exec(v)
  return m ? Number(m[1]) <= new Date().getFullYear() : false
}

function buildTimeline(status: string, stages?: JsonValue): TimelineStep[] {
  const dates = isJsonObject(stages) ? stages : {}
  // Start from the coarse map status, then let concrete stage dates advance it.
  let cur = STATUS_STAGE.get(status) ?? 0
  for (let i = 0; i < STAGE_KEYS.length; i++) {
    if (stageReached(str(dates[STAGE_KEYS[i]]))) cur = Math.max(cur, i)
  }
  return LIFECYCLE.map((label, i) => {
    const d = str(dates[STAGE_KEYS[i]])
    return {
      label,
      state: i < cur ? 'done' : i === cur ? 'current' : 'future',
      date: d && d !== '—' ? d : undefined,
    }
  })
}

/** OSM expressway refs are inconsistent (E001, E04, E002…). Normalize to E0N. */
export function normalizeRef(ref: string | null | undefined): string | null {
  if (!ref) return null
  const m = /^E0*(\d+)/i.exec(ref)
  if (!m) return ref
  return 'E' + m[1].padStart(2, '0')
}

const humanize = (v: JsonValue | undefined): string => {
  const s = String(v ?? '').replace(/[-_]/g, ' ')
  return s ? s[0].toUpperCase() + s.slice(1) : s
}

type Props = JsonObject

const str = (v: JsonValue | undefined): string | null =>
  v === null || v === undefined || v === '' ? null : String(v)

function rows(...items: (FeatureRow | null)[]): FeatureRow[] {
  return items.filter((r): r is FeatureRow => r !== null)
}

function links(...items: (FeatureLink | null)[]): FeatureLink[] {
  return items.filter((l): l is FeatureLink => l !== null)
}

/** A Wikipedia "en:Some Title" tag → a real article URL. */
function wikipediaLink(v: JsonValue | undefined): FeatureLink | null {
  const s = str(v)
  if (!s) return null
  const m = /^([a-z-]+):(.+)$/.exec(s)
  const lang = m ? m[1] : 'en'
  const title = m ? m[2] : s
  return { label: 'Wikipedia ↗', url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}` }
}

/** Open a spot in Google Maps — a dropped pin at its coordinates, ready for
 * directions. This is what people actually want; OSM permalinks are for editors. */
function googleMapsLink(lngLat: { lng: number; lat: number }): FeatureLink {
  return {
    label: 'Open in Google Maps ↗',
    url: `https://www.google.com/maps/search/?api=1&query=${lngLat.lat},${lngLat.lng}`,
  }
}

/** Latest news about a named project — a Google News search, which is what
 * people reach for to check "what's the status now?" beyond the source PDF. */
function googleNewsLink(name: string): FeatureLink {
  return {
    label: 'Latest news ↗',
    url: `https://news.google.com/search?q=${encodeURIComponent(`${name} Sri Lanka`)}`,
  }
}

function websiteLink(v: JsonValue | undefined): FeatureLink | null {
  const s = str(v)
  if (!s) return null
  const url = /^https?:\/\//i.test(s) ? s : `https://${s}`
  return { label: 'Website ↗', url }
}

/** OSM permalink for editors — `osm.org/<osm_type>/<osm_id>`. */
function osmLink(p: Props): FeatureLink | null {
  const type = str(p.osm_type)
  const id = str(p.osm_id)
  if (!type || !id) return null
  return { label: 'OpenStreetMap ↗', url: `https://www.openstreetmap.org/${type}/${id}` }
}

/** Compact date like "12 Jul 2026" from an ISO string. */
function fmtDate(v: JsonValue | undefined): string | null {
  const s = str(v)
  if (!s) return null
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })
}

function dateRow(label: string, value: JsonValue | undefined): FeatureRow | null {
  const date = fmtDate(value)
  return date ? { label, value: date } : null
}

/** Provenance refresh date → "Aug 2026" (month granularity). Accepts full ISO,
 * "YYYY-MM", or a bare "YYYY" (returned as-is). */
function fmtMonth(v: JsonValue | undefined): string {
  const s = String(v ?? '')
  if (/^\d{4}$/.test(s)) return s
  const m = /^(\d{4})-(\d{2})/.exec(s)
  if (!m) return s
  const d = new Date(Number(m[1]), Number(m[2]) - 1, 1)
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString([], { year: 'numeric', month: 'short' })
}

export function formatFeature(
  groupId: string,
  groupLabel: string,
  p: Props,
  lngLat: { lng: number; lat: number },
): FeatureInfo {
  let title = groupLabel
  let detail: FeatureRow[] = []
  let link: FeatureInfo['link']
  let timeline: FeatureInfo['timeline']
  let linkList: FeatureLink[] | undefined
  let image: string | undefined
  let blurb: string | undefined

  if (groupId === 'developments') {
    title = str(p.name) ?? 'Development'
    detail = rows(
      { label: 'Type', value: humanize(p.type) },
      str(p.cost) ? { label: 'Investment', value: String(p.cost) } : null,
      str(p.note) ? { label: 'Note', value: String(p.note) } : null,
      str(p.source) ? { label: 'Source', value: String(p.source) } : null,
      str(p.updated) ? { label: 'Last checked', value: fmtMonth(p.updated) } : null,
    )
    timeline = buildTimeline(String(p.status), p.stages)
    linkList = links(googleNewsLink(title))
    const url = str(p.source_url)
    if (url) {
      const page = str(p.page)
      link = {
        label: `Read the source${page ? ` (p.${page})` : ''} ↗`,
        url: page ? `${url}#page=${page}` : url,
      }
    }
  } else if (groupId === 'boi-zones') {
    title = str(p.name) ?? 'BOI economic zone'
    detail = rows(
      { label: 'Type', value: humanize(p.kind) },
      { label: 'Status', value: humanize(p.status) },
      str(p.established) && p.established !== '—' ? { label: 'Established', value: String(p.established) } : null,
      p.extent_ha ? { label: 'Extent', value: `~${p.extent_ha} ha` } : null,
      str(p.note) ? { label: 'Note', value: String(p.note) } : null,
      { label: 'Boundary', value: 'Indicative (approximate)' },
      str(p.source) ? { label: 'Source', value: String(p.source) } : null,
      str(p.updated) ? { label: 'Last checked', value: fmtMonth(p.updated) } : null,
    )
    linkList = links(googleNewsLink(title))
    const url = str(p.source_url)
    if (url) link = { label: 'Board of Investment ↗', url }
  } else if (groupId === 'sea-routes') {
    const svc = str(p.service)
    const ferryLabel = new Map<string, string>([
      ['international', 'International ferry (India–Sri Lanka)'],
      ['lagoon', 'Lagoon / island ferry'],
      ['river', 'River / lake ferry'],
    ])
    const isCargo = svc === 'trunk' || svc === 'feeder'
    const typeLabel = isCargo
      ? svc === 'trunk'
        ? 'Trunk lane (hub port)'
        : 'Feeder route (regional)'
      : ferryLabel.get(str(p.ferry_class) ?? '') ?? 'Passenger ferry'
    const km = Number(p.distance_km)
    const dist = !p.distance_km ? null : km < 1 ? `${Math.round(km * 1000)} m` : `~${km.toLocaleString()} km`
    title = str(p.name) ?? 'Sea route'
    detail = rows(
      isCargo ? { label: 'From', value: str(p.from) ?? 'Colombo' } : null,
      isCargo && str(p.to) ? { label: 'To', value: String(p.to) } : null,
      { label: 'Type', value: typeLabel },
      dist ? { label: 'Distance', value: dist } : null,
      str(p.note) ? { label: 'Note', value: String(p.note) } : null,
      str(p.source) ? { label: 'Source', value: String(p.source) } : null,
      str(p.updated) ? { label: 'Last checked', value: fmtMonth(p.updated) } : null,
    )
    const url = str(p.source_url)
    if (url) link = { label: svc === 'ferry' ? 'View on OpenStreetMap ↗' : 'Source ↗', url }
  } else if (groupId === 'expressways') {
    const ref = normalizeRef(str(p.ref))
    const name = str(p.name)
    const isIC = p.type === 'interchange'
    title = [ref, name].filter(Boolean).join(' · ') || 'Expressway'
    detail = rows(
      isIC ? { label: 'Type', value: 'Interchange / exit' } : null,
      ref ? { label: 'Ref', value: ref } : null,
      isIC && str(p.exit) ? { label: 'Exit', value: String(p.exit) } : null,
      str(p.connects) ? { label: 'Connects', value: String(p.connects) } : null,
      str(p.cost) ? { label: 'Investment', value: String(p.cost) } : null,
      p.lanes ? { label: 'Lanes', value: String(p.lanes) } : null,
      str(p.opening_date) ? { label: 'Opening', value: String(p.opening_date) } : null,
      str(p.note) ? { label: 'Note', value: String(p.note) } : null,
      !isIC && str(p.source) ? { label: 'Source', value: String(p.source) } : null,
      str(p.updated) ? { label: 'Last checked', value: fmtMonth(p.updated) } : null,
    )
    timeline = buildTimeline(String(p.status), p.stages)
    // A named, curated project (not a bare OSM exit) gets a news shortcut.
    if (!isIC && name && (str(p.cost) || p.stages || p.curated)) linkList = links(googleNewsLink(name))
    const url = str(p.source_url)
    if (url) link = { label: 'Read the source ↗', url }
  } else if (groupId === 'roads') {
    const name = str(p.name)
    const tier = str(p.tier) ?? 'road'
    title = name || `${tier} road`
    const widthEst = str(p.width_est)
    const widthReal = str(p.width)
    const width = widthReal
      ? `${widthReal} m (surveyed)`
      : widthEst
        ? `${widthEst} m (estimated)`
        : null
    detail = rows(
      { label: 'Tier', value: tier },
      width ? { label: 'Width', value: width } : null,
      str(p.lanes) ? { label: 'Lanes', value: String(p.lanes) } : null,
      str(p.surface) ? { label: 'Surface', value: String(p.surface) } : null,
      str(p.ref) ? { label: 'Ref', value: String(p.ref) } : null,
    )
  } else if (groupId === 'popdensity' || groupId === 'population') {
    title = `${str(p.name) ?? 'District'} District`
    const pop = Number(p.population)
    detail = rows(
      str(p.province) ? { label: 'Province', value: `${p.province}` } : null,
      { label: 'Population', value: Number.isFinite(pop) ? pop.toLocaleString() : '—' },
      p.density != null ? { label: 'Density', value: `${Number(p.density).toLocaleString()} /km²` } : null,
      p.area_km2 != null ? { label: 'Area', value: `${Number(p.area_km2).toLocaleString()} km²` } : null,
    )
  } else if (groupId === 'metro_catchment') {
    const distance = Number(p.d)
    title = str(p.stop) ?? 'Metro walking access'
    detail = rows(
      { label: 'Walk band', value: Number.isFinite(distance) && distance <= 400 ? 'Within 5 minutes' : 'Within 10 minutes' },
      Number.isFinite(distance) ? { label: 'Network distance', value: `${Math.round(distance)} m` } : null,
      { label: 'Method', value: 'Along the mapped walking network' },
    )
  } else if (groupId === 'metro') {
    if (p.kind === 'stop') {
      title = str(p.name) ?? 'Metro stop'
      detail = rows(
        { label: 'Type', value: 'Metro bus stop' },
        str(p.road) ? { label: 'Road', value: String(p.road) } : null,
        str(p.routes) ? { label: 'Lines', value: String(p.routes) } : null,
        { label: 'Walk catchment', value: '5 & 10-min walksheds shown on map' },
      )
      linkList = links(googleMapsLink(lngLat))
    } else {
      const code = str(p.code)
      title = [code, str(p.name)].filter(Boolean).join(' · ') || 'Metro line'
      detail = rows(
        { label: 'From', value: str(p.from) ?? '—' },
        { label: 'To', value: str(p.to) ?? '—' },
        str(p.distance_km) ? { label: 'Distance', value: `${p.distance_km} km` } : null,
        str(p.stop_count) ? { label: 'Stops', value: String(p.stop_count) } : null,
        str(p.stops) ? { label: 'All stops', value: String(p.stops) } : null,
        { label: 'Note', value: 'Corridor approximate; stops & distance are surveyed' },
      )
    }
  } else if (groupId === 'water') {
    title = str(p.name) || 'Water body'
    detail = rows(
      str(p.water) ? { label: 'Type', value: String(p.water) } : null,
      str(p.waterway) ? { label: 'Waterway', value: String(p.waterway) } : null,
    )
  } else if (groupId === 'land-cover-grid') {
    const classLabel = str(p.class_label) ?? 'Land-cover class'
    const vegetated = p.vegetated === true || p.vegetated === 1 || str(p.vegetated)?.toLowerCase() === 'true'
    title = classLabel
    blurb = 'A categorical 2021 model summary. It does not measure current greenness, canopy health, or NDVI.'
    detail = rows(
      { label: 'Class', value: classLabel },
      p.class_code != null ? { label: 'WorldCover code', value: String(p.class_code) } : null,
      { label: 'Reference year', value: str(p.year) ?? '2021' },
      {
        label: 'Vegetation grouping',
        value: vegetated ? 'Vegetated land-cover class' : 'Not grouped as vegetated',
      },
      { label: 'Map reading', value: 'Dominant modeled class in a ~5 km cell' },
    )
    link = { label: 'ESA WorldCover methods ↗', url: 'https://esa-worldcover.org/en/data-access' }
  } else if (groupId === 'population-change') {
    const pop2012 = Number(p.pop_2012)
    const pop2024 = Number(p.pop)
    const change = pop2024 - pop2012
    const changePct = pop2012 > 0 ? (change / pop2012) * 100 : NaN
    const signedPct = Number.isFinite(changePct)
      ? `${changePct >= 0 ? '+' : ''}${changePct.toFixed(1)}%`
      : '—'
    const signedPeople = Number.isFinite(change)
      ? `${change >= 0 ? '+' : ''}${change.toLocaleString('en-US')}`
      : '—'
    title = str(p.name) ?? 'District'
    blurb = 'Census enumeration counts, not mid-year estimates. District grain only. 2012 totals follow the map geometries, not Final Report Table 6.1.11.'
    detail = rows(
      str(p.province ?? p.parent) ? { label: 'Province', value: String(p.province ?? p.parent) } : null,
      Number.isFinite(pop2012) ? { label: 'Census 2012', value: pop2012.toLocaleString('en-US') } : null,
      Number.isFinite(pop2024) ? { label: 'Census 2024', value: pop2024.toLocaleString('en-US') } : null,
      { label: 'Change', value: signedPeople },
      { label: 'Percent change', value: signedPct },
      p.area != null ? { label: 'Area', value: `${p.area} km²` } : null,
    )
    link = { label: 'Census 2024 tables ↗', url: 'https://www.statistics.gov.lk/Population/StaticalInformation/CPH2024' }
  } else if (groupId === 'attractions') {
    title = str(p.name) ?? 'Attraction'
    detail = rows({ label: 'Category', value: humanize(p.category) })
    linkList = links(googleMapsLink(lngLat), websiteLink(p.website), wikipediaLink(p.wikipedia))
  } else if (groupId === 'irrigation-gauges') {
    const metres = (value: JsonValue | undefined): string | null => {
      const n = Number(value)
      return Number.isFinite(n) ? `${n.toFixed(2)} m` : null
    }
    title = str(p.name) ?? 'River gauge'
    blurb = 'Published flood thresholds at this station. Live water levels are not in this layer.'
    detail = rows(
      str(p.river_name) ? { label: 'River', value: String(p.river_name) } : null,
      str(p.district_id) ? { label: 'District id', value: String(p.district_id) } : null,
      metres(p.alert_level_m) ? { label: 'Alert level', value: metres(p.alert_level_m)! } : null,
      metres(p.minor_flood_level_m) ? { label: 'Minor flood level', value: metres(p.minor_flood_level_m)! } : null,
      metres(p.major_flood_level_m) ? { label: 'Major flood level', value: metres(p.major_flood_level_m)! } : null,
    )
    link = {
      label: 'Irrigation Department hydrology ↗',
      url: 'https://www.irrigation.gov.lk/web/index.php?option=com_content&view=article&id=27&Itemid=128&lang=en',
    }
  } else if (groupId === 'waterfalls') {
    title = str(p.name) ?? 'Waterfall'
    detail = rows(
      { label: 'Type', value: 'Waterfall' },
      str(p.height) ? { label: 'Height', value: `${p.height} m` } : null,
    )
    linkList = links(googleMapsLink(lngLat), wikipediaLink(p.wikipedia))
  } else if (groupId === 'schools') {
    title = str(p.name) ?? 'School'
    detail = rows(
      { label: 'Kind', value: humanize(p.kind) || 'School' },
      { label: 'Coverage', value: 'OSM only — not an MoE register' },
    )
    linkList = links(googleMapsLink(lngLat), osmLink(p))
  } else if (groupId === 'hospitals') {
    title = str(p.name) ?? 'Hospital'
    detail = rows(
      { label: 'Kind', value: humanize(p.kind) || 'Hospital' },
      { label: 'Coverage', value: 'OSM only — not an MoH register' },
    )
    linkList = links(googleMapsLink(lngLat), osmLink(p))
  } else if (groupId === 'trails') {
    title = str(p.name) ?? 'Hiking trail'
    detail = rows(
      { label: 'Type', value: 'Hiking route' },
      str(p.ref) ? { label: 'Ref', value: String(p.ref) } : null,
      str(p.network) ? { label: 'Network', value: humanize(p.network) } : null,
      str(p.distance) ? { label: 'Distance', value: `${p.distance} km` } : null,
    )
    linkList = links(googleMapsLink(lngLat), websiteLink(p.website))
  } else if (groupId === 'cycling') {
    title = str(p.name) ?? 'Cycling route'
    detail = rows(
      { label: 'Type', value: 'Cycling route' },
      str(p.ref) ? { label: 'Ref', value: String(p.ref) } : null,
      str(p.distance) ? { label: 'Distance', value: `${p.distance} km` } : null,
    )
    linkList = links(googleMapsLink(lngLat))
  } else if (groupId === 'parks') {
    title = str(p.name) ?? 'Protected area'
    detail = rows(
      { label: 'Category', value: humanize(p.category) },
      str(p.protection_title) ? { label: 'Designation', value: humanize(p.protection_title) } : null,
    )
    linkList = links(googleMapsLink(lngLat), websiteLink(p.website), wikipediaLink(p.wikipedia))
  } else if (groupId === 'stepper') {
    title = str(p.name) ?? 'Stepper spot'
    blurb = str(p.desc) ?? undefined
    detail = rows(
      str(p.region) ? { label: 'Region', value: String(p.region) } : null,
      str(p.cat) ? { label: 'Category', value: humanize(p.cat) } : null,
    )
    linkList = links(
      googleMapsLink(lngLat),
      str(p.ytUrl) ? { label: '▶ Watch on YouTube', url: String(p.ytUrl) } : null,
      str(p.igUrl) ? { label: 'Instagram ↗', url: String(p.igUrl) } : null,
    )
  } else if (groupId === 'prospects') {
    title = str(p.title) ?? 'Prospect'
    image = str(p.og_image) ?? undefined
    blurb = str(p.og_description) ?? undefined
    detail = rows(
      str(p.verdict) ? { label: 'Verdict', value: humanize(p.verdict) } : null,
      str(p.visibility) ? { label: 'Visibility', value: humanize(p.visibility) } : null,
      str(p.notes) ? { label: 'Notes', value: String(p.notes) } : null,
      dateRow('Added', p.created_at),
    )
    linkList = links(googleMapsLink(lngLat))
    if (str(p.url)) link = { label: 'Open listing ↗', url: String(p.url) }
  } else if (groupId === 'analyses') {
    title = str(p.title) ?? 'Analysis'
    blurb = str(p.summary) ?? undefined
    const channel = str(p.source) === 'mcp' ? 'AI assistant (MCP)' : 'Analyze mode (web)'
    detail = rows(
      str(p.radius_km) ? { label: 'Radius', value: `${p.radius_km} km` } : null,
      { label: 'Run from', value: channel },
      dateRow('Analysed', p.created_at),
    )
    linkList = links(googleMapsLink(lngLat))
    if (str(p.source_url)) link = { label: 'Open listing ↗', url: String(p.source_url) }
  } else if (groupId === 'issues') {
    title = humanize(p.category) || 'Civic issue'
    detail = rows(
      { label: 'Status', value: humanize(p.status) },
      str(p.description) ? { label: 'Description', value: String(p.description) } : null,
      dateRow('Reported', p.created_at),
    )
    linkList = links(googleMapsLink(lngLat))
  }

  return {
    groupId,
    groupLabel,
    title,
    rows: detail,
    timeline,
    link,
    links: linkList && linkList.length ? linkList : undefined,
    image,
    blurb,
    lngLat,
  }
}

/** Clicked climate band -> readout for the active variable + month. */
export function formatClimate(
  variable: ClimateVariableId,
  month: number,
  p: Props,
  lngLat: { lng: number; lat: number },
): FeatureInfo {
  const v = CLIMATE_VARIABLES.find((c) => c.id === variable)!
  const monthLabel = CLIMATE_MONTHS[month] ?? 'Annual'
  const lo = Number(p.value)
  const hi = Number(p.value_max)
  const band = Number.isFinite(lo)
    ? Number.isFinite(hi) && hi !== lo
      ? `${Math.round(lo)}–${Math.round(hi)} ${v.unit}`
      : `${Math.round(lo)} ${v.unit}`
    : '—'
  const periodUnit = variable === 'rainfall' ? (month === 0 ? '/yr' : '/mo') : ''
  return {
    groupId: 'climate',
    groupLabel: 'Climate',
    title: `${v.label} · ${monthLabel === 'Annual' ? 'Annual mean' : monthLabel}`,
    rows: rows({ label: month === 0 ? 'Mean' : 'Monthly mean', value: `${band}${periodUnit}` }),
    lngLat,
  }
}

/** Population choropleth (a clicked province / district / division / GN). */
export function formatPopulation(
  level: PopLevelId,
  p: Props,
  lngLat: { lng: number; lat: number },
): FeatureInfo {
  const lvl = POP_LEVELS.find((l) => l.id === level)
  const pop = Number(p.pop)
  const dens = Number(p.dens)
  return {
    groupId: 'population',
    groupLabel: `Population · ${lvl?.label ?? level}`,
    title: str(p.name) ?? 'Area',
    id: str(p.id) ?? undefined,
    rows: rows(
      str(p.parent) ? { label: 'Within', value: String(p.parent) } : null,
      Number.isFinite(pop) ? { label: 'Population', value: pop.toLocaleString('en-US') } : null,
      Number.isFinite(dens) ? { label: 'Density', value: `${dens.toLocaleString('en-US')} /km²` } : null,
      p.area != null ? { label: 'Area', value: `${p.area} km²` } : null,
      { label: 'Census', value: str(p.vintage) ?? '2012' },
    ),
    lngLat,
  }
}

// --- Analyze composite -------------------------------------------------------

type AnyRec = JsonObject

/** "source · vintage" tag, from whatever the Worker stamped on the rows. */
function sourceTag(rec: AnyRec | undefined): string | undefined {
  if (!rec) return undefined
  const source = str(rec.source)
  const vintage = str(rec.vintage)
  return [source, vintage].filter(Boolean).join(' · ') || undefined
}

/** Top-N names from a nearby list, e.g. "Ravana Falls, Dunhinda Falls +6 more". */
function topNames(list: AnyRec[], n = 3): string {
  const names = list.map((x) => str(x.name)).filter((s): s is string => !!s)
  if (names.length === 0) return `${list.length}`
  const head = names.slice(0, n).join(', ')
  const extra = list.length - Math.min(n, names.length)
  return extra > 0 ? `${head} +${extra} more` : head
}

/** Build the flagship composite readout for the right-hand sheet. */
export function formatAnalyze(r: AnalyzeResult): FeatureInfo {
  const sections: FeatureSection[] = []

  // 1. District & demographics
  const demo = r.district_demographics ?? undefined
  sections.push({
    title: 'District & demographics',
    source: sourceTag(demo),
    empty: 'No district match at this point.',
    rows: demo
      ? rows(
          str(demo.name) ? { label: 'District', value: `${humanize(demo.name)}` } : null,
          str(demo.province) ? { label: 'Province', value: `${demo.province}` } : null,
          demo.population != null
            ? { label: 'Population', value: Number(demo.population).toLocaleString() }
            : null,
          demo.density != null
            ? { label: 'Density', value: `${Number(demo.density).toLocaleString()} /km²` }
            : null,
          demo.area_km2 != null
            ? { label: 'Area', value: `${Number(demo.area_km2).toLocaleString()} km²` }
            : demo.area != null
              ? { label: 'Area', value: `${Number(demo.area).toLocaleString()} km²` }
              : null,
        )
      : [],
  })

  // 1b. Nearest GND — centroid distance only (the index has no rings).
  const gnd = r.nearest_gnd ?? undefined
  sections.push({
    title: 'Nearest GN division',
    source: sourceTag(gnd),
    empty: 'No GND index at this point.',
    rows: gnd
      ? rows(
          str(gnd.name) ? { label: 'GN division', value: String(gnd.name) } : null,
          str(gnd.parent) ? { label: 'Division', value: String(gnd.parent) } : null,
          str(gnd.district) ? { label: 'District', value: String(gnd.district) } : null,
          gnd.pop != null ? { label: 'Population', value: Number(gnd.pop).toLocaleString() } : null,
          gnd.distance_km != null ? { label: 'Distance', value: `${gnd.distance_km} km` } : null,
          { label: 'Method', value: 'nearest centroid (not point-in-polygon)' },
        )
      : [],
  })

  // 2. Nearest expressway
  const exp = r.nearest_expressway ?? undefined
  sections.push({
    title: 'Nearest expressway',
    source: sourceTag(exp),
    empty: 'No expressway data.',
    rows: exp
      ? rows(
          { label: 'Route', value: [str(exp.ref), str(exp.name)].filter(Boolean).join(' · ') || '—' },
          str(exp.status) ? { label: 'Status', value: humanize(exp.status) } : null,
          exp.distance_km != null ? { label: 'Distance', value: `${exp.distance_km} km` } : null,
        )
      : [],
  })

  // 3. Planned developments nearby
  const dev = r.planned_developments_nearby ?? []
  sections.push({
    title: 'Planned developments nearby',
    source: sourceTag(dev[0]),
    empty: 'None within the search radius.',
    rows: dev.length ? rows({ label: `${dev.length} found`, value: topNames(dev) }) : [],
  })

  // 4. Nature nearby (attractions / waterfalls / trails / cycling / parks)
  const nature: FeatureRow[] = rows(
    r.attractions_nearby?.length
      ? { label: `Attractions (${r.attractions_nearby.length})`, value: topNames(r.attractions_nearby, 2) }
      : null,
    r.waterfalls_nearby?.length
      ? { label: `Waterfalls (${r.waterfalls_nearby.length})`, value: topNames(r.waterfalls_nearby, 2) }
      : null,
    r.trails_nearby?.length
      ? { label: `Trails (${r.trails_nearby.length})`, value: topNames(r.trails_nearby, 2) }
      : null,
    r.cycling_nearby?.length
      ? { label: `Cycling (${r.cycling_nearby.length})`, value: topNames(r.cycling_nearby, 2) }
      : null,
    r.parks_containing_or_near?.length
      ? { label: `Parks (${r.parks_containing_or_near.length})`, value: topNames(r.parks_containing_or_near, 2) }
      : null,
  )
  sections.push({
    title: 'Nature & tourism nearby',
    source: 'OpenStreetMap · 2026-07',
    empty: 'Nothing mapped within the search radius.',
    rows: nature,
  })

  // 5. Open civic issues nearby
  const issues = r.open_issues_nearby ?? []
  sections.push({
    title: 'Open civic issues nearby',
    source: sourceTag(issues[0]) ?? 'developing-country.org community',
    empty: 'No open issues reported nearby.',
    rows: issues.length
      ? issues.slice(0, 4).map((it) => ({
          label: humanize(it.category),
          value: `${it.distance_km ?? '?'} km${str(it.description) ? ` — ${str(it.description)}` : ''}`,
        }))
      : [],
  })

  // 6. Your prospects nearby
  const prospects = r.prospects_nearby ?? []
  if (prospects.length) {
    sections.push({
      title: 'Your prospects nearby',
      source: sourceTag(prospects[0]) ?? 'developing-country.org',
      rows: prospects.slice(0, 5).map((p) => ({
        label: str(p.title) ?? 'Prospect',
        value: `${p.distance_km ?? '?'} km`,
      })),
    })
  }

  return {
    groupId: 'analyze',
    groupLabel: '🔬 Location analysis',
    title: `${r.location.lat.toFixed(4)}, ${r.location.lng.toFixed(4)}`,
    blurb: `Everything within ${r.location.radius_km} km, in one readout.`,
    rows: [],
    sections,
    lngLat: { lng: r.location.lng, lat: r.location.lat },
  }
}
