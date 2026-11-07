import {
  getCountryProfile,
  UnsupportedCountryError,
  type CountryProfile,
} from '@developing-country/countries'
import { ApiError } from './errors'
import { ONTOLOGY, type Ontology } from './ontology'
import type { JsonObject } from '../shared/json'
import { isJsonString } from '../shared/json'

export interface WorkerCountryPack {
  profile: CountryProfile
  ontology: Ontology
}

/** JSON boundary rule: absent may default, but supplied malformed input cannot. */
export function countryFromJson(args: JsonObject): string | undefined {
  if (!Object.hasOwn(args, 'country')) return undefined
  if (!isJsonString(args.country)) throw new ApiError(400, 'country must be a string')
  return args.country
}

/** Resolve once at a public service boundary. Missing defaults; invalid never does. */
export function getWorkerCountry(code?: string): WorkerCountryPack {
  let profile: CountryProfile
  try {
    profile = getCountryProfile(code)
  } catch (error) {
    if (error instanceof UnsupportedCountryError) {
      throw new ApiError(404, `country not supported: ${error.code}`)
    }
    throw error
  }
  if (profile.code !== ONTOLOGY.country) {
    throw new Error(`country pack ${profile.code} does not match ontology ${ONTOLOGY.country}`)
  }
  return { profile, ontology: ONTOLOGY }
}
