import { parseIndicatorTable, type IndicatorRow } from '../../datasets/src/table'
export const POWER_ID = 'electricity-generation-quarter-hourly'
export const ENERGY_ID = 'electricity-generation-daily'
export const SOURCE_ID = 'nso-generation-api'
export const POWER_FIELDS = {
  BESS: 'bess_mw', 'Major Hydro': 'major_hydro_mw', 'SPP Minihydro': 'minihydro_mw',
  Coal: 'coal_mw', 'Thermal-Oil': 'thermal_oil_mw', Wind: 'wind_mw', Solar: 'solar_mw', 'SPP Biomass': 'biomass_mw',
}
const dimension = (id: string, label: string) => ({ id, label, role: 'dimension', type: 'string' })
const measure = (id: string, label: string, unit: string) => ({ id, label, unit, role: 'measure', type: 'number', aggregation: 'none' })
export function validDate(date: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date
}
function number(value: unknown) {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Expected finite numeric observation or explicit null')
  return value
}
export function normalizePower(payload: unknown, date: string) {
  if (!validDate(date) || !Array.isArray(payload) || !payload.length) throw new Error(`No valid load curve for ${date}; retaining previous snapshot`)
  const seen = new Set()
  return payload.map((row) => {
    if (!row || typeof row !== 'object') throw new Error('Invalid power row')
    const stamp = row.DateTime
    if (typeof stamp !== 'string' || !stamp.startsWith(date + ' ') || !/^\d{4}-\d{2}-\d{2} (?:[01]\d|2[0-3]):(?:00|15|30|45):00$/.test(stamp) || seen.has(stamp)) throw new Error(`Invalid/duplicate quarter-hour timestamp: ${stamp}`)
    seen.add(stamp)
    if (!Object.keys(POWER_FIELDS).some((key) => typeof row[key] === 'number' && Number.isFinite(row[key]))) throw new Error('Power row contains no numeric observations')
    for (const key of Object.keys(row)) if (key !== 'DateTime' && !Object.hasOwn(POWER_FIELDS, key)) throw new Error(`New source field ${key}; review schema before importing`)
    return { report_date: date, timestamp: stamp, time: stamp.slice(11, 16), ...Object.fromEntries(Object.entries(POWER_FIELDS).map(([key, field]) => [field, Object.hasOwn(row, key) ? number(row[key]) : null])) }
  }).sort((a, b) => a.timestamp.localeCompare(b.timestamp))
}
export function normalizeEnergy(payload: unknown, date: string) {
  if (!validDate(date) || !Array.isArray(payload) || !payload.length) throw new Error(`No daily energy for ${date}; retaining previous snapshot`)
  const seen = new Set()
  return payload.map((row) => {
    if (!row || typeof row !== 'object') throw new Error('Invalid energy row')
    if (row.displayName != null && typeof row.displayName !== 'string') throw new Error('Invalid station label')
    if (typeof row.stationGroupName !== 'string' || !row.stationGroupName.trim() || seen.has(row.stationGroupName) || typeof row.dateTime !== 'string' || !row.dateTime.startsWith(date + 'T')) throw new Error('Invalid or duplicate daily station group')
    seen.add(row.stationGroupName)
    return { report_date: date, station_group: row.stationGroupName, station_label: row.displayName || row.stationGroupName, energy_gwh: number(row.energyGWh) }
  }).sort((a, b) => a.station_group.localeCompare(b.station_group))
}
export function mergeDates(oldRows: IndicatorRow[], batches: IndicatorRow[][]) {
  const replaced = new Set(batches.flatMap((rows) => rows.map((row) => row.report_date)))
  return [...oldRows.filter((row) => !replaced.has(row.report_date)), ...batches.flat()].sort((a, b) => String(a.timestamp || `${a.report_date}/${a.station_group}`).localeCompare(String(b.timestamp || `${b.report_date}/${b.station_group}`)))
}
export function tableFor(id: string, rows: IndicatorRow[]) {
  const dates = [...new Set(rows.map((row) => row.report_date))].sort()
  const power = id === POWER_ID
  return parseIndicatorTable({
    schema_version: 1, country: 'LK', dataset_id: id, source_ids: [SOURCE_ID],
    title: power ? 'Electricity generation and battery power' : 'Daily electricity generation',
    description: power ? 'Stored NSO national generation and aggregate battery active-power readings in MW.' : 'Stored NSO daily energy by published station group in GWh.',
    grain: power ? 'One row per source quarter-hour timestamp.' : 'One row per report date and station group.',
    vintage: `${dates[0]}–${dates.at(-1)}`, primary_key: power ? ['timestamp'] : ['report_date', 'station_group'],
    notes: ['Source timestamps are retained verbatim without inventing a UTC offset.', 'Refreshes replace only successfully validated dates and retain older report dates. Raw response revisions are archived by checksum.'],
    caveats: power ? ['BESS is a signed aggregate power reading, not nameplate capacity or stored energy.', 'Source solar coverage includes estimation; consult the operator dashboard notes.', 'Dates may have fewer than 96 quarter-hour observations. Missing readings are not filled with zero; confirm interval and timezone semantics before integrating MW into MWh.'] : ['Station groups are not individual plants. Do not infer a missing BESS energy row from power samples.', 'Source daily energy coverage includes estimated components; consult the operator dashboard notes.'],
    fields: power ? [dimension('report_date', 'Report date'), dimension('timestamp', 'Source timestamp'), dimension('time', 'Source clock time'), ...Object.entries(POWER_FIELDS).map(([name, field]) => measure(field, name, 'MW'))] : [dimension('report_date', 'Report date'), dimension('station_group', 'Station group'), dimension('station_label', 'Station group label'), measure('energy_gwh', 'Daily energy', 'GWh')], rows,
  })
}
