import { describe, expect, test } from 'bun:test'
import { DATASET_PUBLISHER_IDS, PUBLISHERS } from './publishers'
import { PUBLISHER_TERMS, datasetReuseTerms, type PublisherTerms } from './reuseTerms'

describe('dataset reuse terms', () => {
  test('every Publisher records terms with a source URL and check date', () => {
    for (const publisher of PUBLISHERS) {
      const terms: PublisherTerms = PUBLISHER_TERMS[publisher.id]
      expect(terms, publisher.id).toBeDefined()
      expect(terms.termsUrl).toMatch(/^https:\/\//)
      expect(terms.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(terms.statement.length).toBeGreaterThan(20)
      if (terms.status === 'open_licence') expect(terms.licenceId).toBeDefined()
      else expect(terms.licenceId).toBeUndefined()
    }
  })

  test('every registered Dataset resolves to terms', () => {
    for (const datasetId of Object.keys(DATASET_PUBLISHER_IDS)) {
      const terms = datasetReuseTerms(datasetId)
      expect(terms, datasetId).not.toBeNull()
      expect(terms!.attribution.length).toBeGreaterThan(0)
    }
  })

  test('never names a licence a Publisher has not stated', () => {
    const dcs = datasetReuseTerms('ccpi-monthly')!
    expect(dcs.status).toBe('all_rights_reserved')
    expect(dcs.licence).toBeNull()
    expect(dcs.label).toBe('All rights reserved')
    expect(dcs.terms_url).toBe('https://www.statistics.gov.lk/')
  })

  test('platform Datasets carry the licence developing-country.org releases them under', () => {
    expect(datasetReuseTerms('road-crashes-fatalities')!.licence?.id).toBe('cc-by-4.0')
    expect(datasetReuseTerms('metro-coverage-gnd')!.licence?.id).toBe('odbl-1.0')
    expect(datasetReuseTerms('workplaces')!.licence?.id).toBe('cdla-permissive-2.0')
  })

  test('returns null for an unregistered id', () => {
    expect(datasetReuseTerms('not-a-dataset')).toBeNull()
  })
})
