import { expect, test } from 'bun:test'
import { normalizePower, normalizeEnergy, mergeDates, tableFor, POWER_ID, validDate } from './build-electricity-generation.mjs'

const date = '2026-09-11'
test('preserves signed power and absence without fabricating zeros or intervals', () => {
  const rows = normalizePower([{ DateTime: `${date} 18:45:00`, BESS: 9.996 }, { DateTime: `${date} 12:00:00`, BESS: -10.32 }], date)
  expect(rows.map((r) => r.bess_mw)).toEqual([-10.32, 9.996])
  expect(rows[0].coal_mw).toBeNull()
  expect(tableFor(POWER_ID, rows).rows).toHaveLength(2)
})
test('fails closed on missing responses, duplicates, schema drift and invalid readings', () => {
  expect(() => normalizePower([], date)).toThrow()
  const row = { DateTime: `${date} 18:45:00`, BESS: 9.996 }
  expect(() => normalizePower([row, row], date)).toThrow()
  expect(() => normalizePower([{ ...row, BESS: '9.996' }], date)).toThrow()
  expect(() => normalizePower([{ ...row, UnknownFuel: 3 }], date)).toThrow()
  expect(() => normalizePower([{ ...row, DateTime: `${date} 18:46:00` }], date)).toThrow()
  expect(validDate('2026-02-30')).toBe(false)
})
test('replaces revised dates and retains earlier history without duplicates', () => {
  const old = [{ report_date: '2026-09-10', timestamp: '2026-09-10 18:45:00', bess_mw: 0 }, { report_date: date, timestamp: `${date} 18:45:00`, bess_mw: 9 }]
  const revision = [{ report_date: date, timestamp: `${date} 18:45:00`, bess_mw: 9.996 }]
  expect(mergeDates(old, [revision])).toEqual([old[0], revision[0]])
  expect(mergeDates(old, [])).toEqual(old)
})
test('keeps reported GWh separate from MW and rejects mismatched daily records', () => {
  const payload = [{ stationGroupName: 'Hydro', displayName: 'Hydro', dateTime: `${date}T23:59:59`, energyGWh: 6.7 }]
  expect(normalizeEnergy(payload, date)[0].energy_gwh).toBe(6.7)
  expect(() => normalizeEnergy(payload, '2026-09-10')).toThrow()
  expect(() => normalizeEnergy([...payload, ...payload], date)).toThrow()
})
