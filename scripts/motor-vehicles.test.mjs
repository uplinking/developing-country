import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseIndicatorTable } from '../packages/datasets/src/table.ts'
import {
  STOCK_CLASSES,
  buildNewRegistrationsFromText,
  buildRegisteredStockFromText,
} from './build-motor-vehicles.mjs'

const DATA = resolve(import.meta.dir, '../public/data')

const STOCK_FIXTURE = `
8.2 Registered Motor Vehicles, 2020 - 2024
Type of Vehicle                                           2020                      2021                   2022        2023        2024
Total                                               8,297,852                8,331,702                 8,352,213   8,380,103   8,454,513
Passenger Cars                                         896,885                   900,380                 901,869     903,685     905,329
Three Wheelers                                       1,182,227                 1,184,320               1,184,356   1,184,416   1,184,510
Buses (SLTB+ Private)                                  112,583                   112,864                 113,268     113,953     114,099
Motor Cycles                                         4,819,708                 4,827,719               4,836,779   4,856,979   4,922,268
Lorries(a)                                             375,487                   379,831                 381,555     382,069     383,335
Ambulances and Hearses                                    3,954                     4,042                  4,124       4,131       4,148
Dual Purpose Vehicles                                  448,552                   449,323                 450,083     450,669     451,696
Tractors & Engines(b)                                  456,011                   470,775                 477,704     481,724     486,649
Quadricycle                                               2,442                     2,442                  2,442       2,442       2,443
Motor Home                                                     3                         6                     6           6           6
Special Purpose vehicles                                        -                        -                    27          29          30
Passenger Cars Per 100 Population (%)                      4.09                      4.06                   4.07        4.10        4.13
8.3 Postal Services, 2020 - 2024
`

const NEW_FIXTURE = `
Table 7.3 : Number of new vehicles registered by class of vehicles and type of fuel used 2020 - 2024
Total 202,628 33,850 20,510 27,890 74,410
Motor cars Diesel 273 182 297 560 117
Petrol 19,021 2,990 1,093 1,080 939
Electric 77 41 17 124 543
Diesel/Electric 9 7 .. 3 3
Petrol/Electric 1,641 275 82 49 42
Motor Tricycles Diesel 78 41 15 16 42
Petrol 6,679 2,034 14 5 11
Electric .. 3 .. 1 30
Petrol/Electric .. .. .. 14 ..
Motor Tricycles Van Diesel 373 7 5 16 11
Petrol 20 8 1 7 ..
Electric .. .. 1 1 ..
Quadricycle Petrol 470 .. .. .. 1
Motor Home Electric .. 3 .. .. ..
Buses Diesel 578 281 404 685 146
Petrol .. .. .. .. ..
Motor Cycles Petrol 151,372 7,779 8,326 18,136 53,283
Electric 261 229 728 2,054 12,003
Petrol/Electric 1 3 6 10 3
Dual Purpose Vehicles Diesel 1,561 324 47 25 44
Petrol 4,057 249 44 56 81
Electric 2 .. .. 3 1
Petrol/Electric .. .. .. .. ..
Single Cab Diesel 3,095 104 649 486 835
Petrol 817 94 20 16 66
Electric .. .. .. .. ..
Special Purpose Vehicles Diesel 645 1,088 446 137 285
Petrol 4 5 12 4 16
Electric .. .. .. .. ..
Lorry- proper Diesel 2,986 2,544 929 278 704
Petrol .. .. .. .. ..
Diesel/Electric 14 49 10 10 11
LP Gas .. .. .. .. ..
Lorry - tractors (Prime mover) Diesel 149 359 136 36 106
Lorry - trailers Non Fuel 137 299 216 51 145
Ambulances and hearses Diesel 5 87 79 2 9
Petrol 1 1 3 5 8
Land vechicles - Tractor (4 wheel)
Diesel 4,482 8,272 2,725 1,759 1,821
Land vechicles - Trailer Non Fuel 2,277 4,344 2,560 1,236 1,887
Diesel .. .. .. .. ..
Land vechicles - Tractor (2 wheel) Diesel 1,543 2,148 1,644 1,025 1,217
Source - Department of Motor Traffic
`

describe('motor-vehicle builders', () => {
  test('keeps Pocket Book 8.2 national stock and treats unpublished special-purpose years as null', () => {
    const table = buildRegisteredStockFromText(STOCK_FIXTURE)
    expect(table.rows).toHaveLength(STOCK_CLASSES.length * 5)
    const total = table.rows.find((row) => row.year === 2024 && row.category === 'total')
    const cycles = table.rows.find((row) => row.year === 2024 && row.category === 'motor_cycles')
    const special = table.rows.find((row) => row.year === 2020 && row.category === 'special_purpose_vehicles')
    expect(total.vehicles).toBe(8_454_513)
    expect(cycles.vehicles).toBe(4_922_268)
    expect(special.vehicles).toBeNull()
    expect(table.rows.some((row) => row.category === 'passenger_cars_per_100')).toBe(false)
  })

  test('keeps Abstract 7.3 national new registrations and leaves the 2022 residual explicit', () => {
    const table = buildNewRegistrationsFromText(NEW_FIXTURE)
    const total = table.rows.find((row) => row.year === 2024 && row.category === 'total')
    const electricCycles = table.rows.find((row) => row.year === 2024 && row.category === 'motor_cycles' && row.fuel === 'electric')
    expect(total.vehicles).toBe(74_410)
    expect(electricCycles.vehicles).toBe(12_003)
    const parts2022 = table.rows
      .filter((row) => row.year === 2022 && row.category !== 'total')
      .reduce((sum, row) => sum + (row.vehicles ?? 0), 0)
    expect(parts2022).toBe(20_509)
    expect(table.rows.find((row) => row.year === 2022 && row.category === 'total').vehicles).toBe(20_510)
  })
})

describe('registered-motor-vehicles-annual artifact', () => {
  test('ships the national 2024 stock without inventing districts', () => {
    const table = parseIndicatorTable(JSON.parse(readFileSync(resolve(DATA, 'registered-motor-vehicles-annual.json'), 'utf8')))
    expect(table.rows).toHaveLength(STOCK_CLASSES.length * 5)
    expect(table.rows.every((row) => row.geography_id == null)).toBe(true)
    const total = table.rows.find((row) => row.year === 2024 && row.category === 'total')
    expect(total.vehicles).toBe(8_454_513)
  })
})

describe('new-vehicle-registrations-annual artifact', () => {
  test('ships national 2024 registrations and keeps the 2022 residual', () => {
    const table = parseIndicatorTable(JSON.parse(readFileSync(resolve(DATA, 'new-vehicle-registrations-annual.json'), 'utf8')))
    expect(table.rows.every((row) => row.geography_id == null)).toBe(true)
    const total = table.rows.find((row) => row.year === 2024 && row.category === 'total')
    const electricCycles = table.rows.find((row) => row.year === 2024 && row.category === 'motor_cycles' && row.fuel === 'electric')
    expect(total.vehicles).toBe(74_410)
    expect(electricCycles.vehicles).toBe(12_003)
    const parts2022 = table.rows
      .filter((row) => row.year === 2022 && row.category !== 'total')
      .reduce((sum, row) => sum + (row.vehicles ?? 0), 0)
    expect(parts2022).toBe(20_509)
    expect(table.rows.find((row) => row.year === 2022 && row.category === 'total').vehicles).toBe(20_510)
  })
})
