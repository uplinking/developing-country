import type { CountryCode } from '@developing-country/domain'

export type Bounds = readonly [west: number, south: number, east: number, north: number]

export interface CountryProfile {
  code: CountryCode
  slug: string
  name: string
  defaultLocale: string
  dataBounds: Bounds
  mapBounds: Bounds
  initialView: Readonly<{ longitude: number; latitude: number; zoom: number }>
}

export class UnsupportedCountryError extends Error {
  readonly code: string

  constructor(code: string) {
    super(`Unsupported country code: ${code}`)
    this.name = 'UnsupportedCountryError'
    this.code = code
  }
}

export const SRI_LANKA = Object.freeze({
  code: 'LK',
  slug: 'sri-lanka',
  name: 'Sri Lanka',
  defaultLocale: 'en-LK',
  dataBounds: [74.5, 5.5, 82.5, 13.5] as const,
  mapBounds: [62, -8, 98, 28] as const,
  initialView: Object.freeze({ longitude: 80.7, latitude: 7.85, zoom: 7.1 }),
}) satisfies CountryProfile

export const DEFAULT_COUNTRY: CountryCode = 'LK'
export const COUNTRY_PROFILES: Readonly<Record<CountryCode, CountryProfile>> = Object.freeze({
  LK: SRI_LANKA,
})
export const SUPPORTED_COUNTRY_CODES = Object.freeze(Object.keys(COUNTRY_PROFILES) as CountryCode[])

/** Missing selects the product default; any supplied unknown/case-wrong code fails closed. */
export function getCountryProfile(code?: string): CountryProfile {
  if (code === undefined || code === '') return COUNTRY_PROFILES[DEFAULT_COUNTRY]
  if (!isCountryCode(code)) throw new UnsupportedCountryError(code)
  return COUNTRY_PROFILES[code]
}

export function isCountryCode(code: string): code is CountryCode {
  return Object.hasOwn(COUNTRY_PROFILES, code)
}
