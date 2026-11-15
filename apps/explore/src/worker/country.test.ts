import { describe, expect, test } from 'bun:test'
import { ApiError } from './errors'
import { countryFromJson, getWorkerCountry } from './country'
import querySpatialSchema from './fixtures/query-spatial.schema.json' with { type: 'json' }
import { SUPPORTED_COUNTRY_CODES } from '@developing-country/countries'

describe('Worker country boundary', () => {
  test('binds the registered profile to the matching ontology', () => {
    const pack = getWorkerCountry('LK')
    expect(pack.profile.code).toBe('LK')
    expect(pack.ontology.country).toBe(pack.profile.code)
  })

  test('does not silently route an unsupported country to Sri Lanka', () => {
    try {
      getWorkerCountry('IN')
      throw new Error('expected getWorkerCountry to reject')
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError)
      expect((error as ApiError).status).toBe(404)
    }
  })

  test('advertises the same supported countries on every spatial operation', () => {
    for (const operation of querySpatialSchema.oneOf) {
      expect(operation.properties.country.$ref).toBe('#/$defs/country')
    }
    expect(querySpatialSchema.$defs.country.enum).toEqual([...SUPPORTED_COUNTRY_CODES])
  })

  test('defaults only absent JSON country input, never malformed input', () => {
    expect(countryFromJson({})).toBeUndefined()
    expect(() => countryFromJson({ country: 42 })).toThrow('country must be a string')
    expect(() => countryFromJson({ country: null })).toThrow('country must be a string')
  })
})
