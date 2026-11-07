import { describe, expect, test } from 'bun:test'
import {
  buildGndHouseholdsFromWorksheetRows,
  buildGndPopulationFromWorksheetRows,
} from './build-official-indicators.mjs'

const EXPECTED_GND_ROWS = 14_008

function codes(index) {
  const withinDistrict = index % 10_000
  return {
    district: Math.floor(index / 10_000) + 1,
    dsd: Math.floor(withinDistrict / 1_000) + 1,
    gnd: withinDistrict % 1_000,
  }
}

function populationRow(index) {
  const { district, dsd, gnd } = codes(index)
  const population = index === 0 ? 0 : 20
  const row = Array(17).fill(null)
  row[1] = 'Test Province'
  row[2] = district
  row[3] = `District ${district}`
  row[4] = dsd
  row[5] = `DSD ${district}-${dsd}`
  row[6] = gnd
  row[7] = `GN ${index}`
  row[9] = population
  row[10] = population / 2
  row[11] = population / 2
  row[13] = population === 0 ? 0 : 4
  row[14] = population === 0 ? 0 : 12
  row[15] = population === 0 ? 0 : 2
  row[16] = population === 0 ? 0 : 2
  return row
}

function householdRow(index) {
  const { district, dsd, gnd } = codes(index)
  const row = Array(47).fill(0)
  row[1] = 'Test Province'
  row[2] = district
  row[3] = `District ${district}`
  row[4] = dsd
  row[5] = `DSD ${district}-${dsd}`
  row[6] = gnd
  row[7] = `GN ${index}`
  row[9] = index === 0 ? 0 : 5
  return row
}

const populationWorksheet = [[], [], [], [], [], ...Array.from({ length: EXPECTED_GND_ROWS }, (_, index) => populationRow(index))]
const householdWorksheet = [[], [], [], [], [], [], ...Array.from({ length: EXPECTED_GND_ROWS }, (_, index) => householdRow(index))]
const populationTable = buildGndPopulationFromWorksheetRows(populationWorksheet)

describe('official indicator GN import gates', () => {
  test('accepts exactly 14,008 one-to-one GN rows and preserves derived nulls for zero denominators', () => {
    const households = buildGndHouseholdsFromWorksheetRows(householdWorksheet, populationTable)
    expect(populationTable.rows).toHaveLength(EXPECTED_GND_ROWS)
    expect(households.rows).toHaveLength(EXPECTED_GND_ROWS)
    expect(households.rows[0].average_household_size).toBeNull()
    expect(households.rows[0].piped_water_share_pct).toBeNull()
  })

  test('rejects a missing GN source row instead of silently publishing incomplete coverage', () => {
    expect(() => buildGndPopulationFromWorksheetRows(populationWorksheet.slice(0, -1)))
      .toThrow('Expected 14,008 non-empty GN population rows, found 14,007')
  })

  test('rejects a malformed non-empty population row instead of skipping it', () => {
    const malformed = populationWorksheet.slice()
    malformed[5] = populationWorksheet[5].slice()
    malformed[5][7] = null
    expect(() => buildGndPopulationFromWorksheetRows(malformed)).toThrow('GN population row 6 GN name is not text')
  })

  test('rejects duplicate population GN ids even when the worksheet row count is exact', () => {
    const duplicated = populationWorksheet.slice()
    duplicated[6] = populationWorksheet[6].slice()
    duplicated[6][2] = populationWorksheet[5][2]
    duplicated[6][4] = populationWorksheet[5][4]
    duplicated[6][6] = populationWorksheet[5][6]
    expect(() => buildGndPopulationFromWorksheetRows(duplicated))
      .toThrow('GN population workbook contains duplicate GN id LK-0101000')
  })

  test('rejects a non-numeric required household category instead of coercing it to zero', () => {
    const malformed = householdWorksheet.slice()
    malformed[6] = householdWorksheet[6].slice()
    malformed[6][15] = null
    expect(() => buildGndHouseholdsFromWorksheetRows(malformed, populationTable))
      .toThrow('GN household row 7 National Water Supply Board households is not numeric')
  })

  test('rejects a household GN id without an exact population join', () => {
    const unmatched = householdWorksheet.slice()
    unmatched[6] = householdWorksheet[6].slice()
    unmatched[6][2] = 99
    expect(() => buildGndHouseholdsFromWorksheetRows(unmatched, populationTable))
      .toThrow('GN household row 7 GN id LK-9901000 has no matching population row')
  })

  test('rejects an incomplete accepted population table before joining households', () => {
    const incompletePopulation = { ...populationTable, rows: populationTable.rows.slice(0, -1) }
    expect(() => buildGndHouseholdsFromWorksheetRows(householdWorksheet, incompletePopulation))
      .toThrow('Expected 14,008 accepted GN population rows for the household join, found 14,007')
  })
})
