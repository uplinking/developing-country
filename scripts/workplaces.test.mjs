import { describe, expect, test } from 'bun:test'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { OFFICE_TYPES, ROOT, classifyPlace } from './build-workplaces.mjs'

const place = (over) => ({
  basic_category: 'corporate_or_business_office',
  taxonomy_hierarchy: ['services_and_business', 'corporate_or_business_office'],
  confidence: 0.8,
  operating_status: null,
  licenses: ['CDLA-Permissive-2.0'],
  ...over,
})

describe('Overture place classification', () => {
  test('offices by basic_category and by taxonomy hierarchy', () => {
    expect(classifyPlace(place())).toEqual({ keep: true, cls: 'office', officeType: 'corporate' })
    expect(classifyPlace(place({ basic_category: 'bank_or_credit_union' })).officeType).toBe('financial')
    expect(classifyPlace(place({ basic_category: 'government_office' })).officeType).toBe('government')
    const marketing = place({
      basic_category: 'marketing_agency',
      taxonomy_hierarchy: ['services_and_business', 'professional_service', 'marketing_agency'],
    })
    expect(classifyPlace(marketing)).toEqual({ keep: true, cls: 'office', officeType: 'professional' })
  })

  test('other categorised places are businesses; heritage, worship, geography and blanks are dropped', () => {
    expect(classifyPlace(place({ basic_category: 'restaurant', taxonomy_hierarchy: ['food_and_drink', 'restaurant'] })).cls).toBe('business')
    expect(classifyPlace(place({ basic_category: 'buddhist_place_of_worship', taxonomy_hierarchy: ['cultural_and_historic', 'place_of_worship'] })).keep).toBe(false)
    expect(classifyPlace(place({ basic_category: 'island', taxonomy_hierarchy: ['geographic_entities', 'island'] })).keep).toBe(false)
    expect(classifyPlace(place({ basic_category: null, taxonomy_hierarchy: [] })).reason).toBe('uncategorised')
  })

  test('licence, confidence and closure filters', () => {
    expect(classifyPlace(place({ licenses: ['CDLA-Permissive-2.0', 'ODbL-1.0'] })).reason).toBe('licence')
    expect(classifyPlace(place({ licenses: ['Apache-2.0', 'CC0-1.0'] })).keep).toBe(true)
    expect(classifyPlace(place({ confidence: 0.49 })).reason).toBe('confidence')
    expect(classifyPlace(place({ operating_status: 'closed' })).reason).toBe('closed')
  })
})

describe('workplaces artifact', () => {
  const fc = JSON.parse(readFileSync(join(ROOT, 'public/data/workplaces.geojson'), 'utf8'))

  test('offices only, with provenance and a valid office type', () => {
    expect(fc.vintage).toBe('2026-09-23.1')
    expect(fc.features.length).toBeGreaterThan(3000)
    const types = new Set(Object.values(OFFICE_TYPES))
    for (const f of fc.features) {
      expect(f.properties.kind).toBe('office')
      expect(types.has(f.properties.office_type)).toBe(true)
      expect(f.properties.confidence).toBeGreaterThanOrEqual(0.5)
    }
  })

  test('stays under the searchable GeoJSON cap', () => {
    expect(statSync(join(ROOT, 'public/data/workplaces.geojson')).size).toBeLessThan(2.1 * 1024 * 1024)
  })
})
