import { describe, expect, test } from 'bun:test'
import { DEFAULT_COUNTRY, SRI_LANKA, getCountryProfile } from '../src'

describe('country profiles', () => {
  test('uses Sri Lanka only when country is absent', () => {
    expect(getCountryProfile()).toBe(SRI_LANKA)
    expect(DEFAULT_COUNTRY).toBe('LK')
  })

  test('fails closed for unsupported or case-wrong codes', () => {
    expect(() => getCountryProfile('XX')).toThrow('Unsupported country code: XX')
    expect(() => getCountryProfile('lk')).toThrow('Unsupported country code: lk')
    expect(() => getCountryProfile('constructor')).toThrow('Unsupported country code: constructor')
    expect(() => getCountryProfile('__proto__')).toThrow('Unsupported country code: __proto__')
  })
})
