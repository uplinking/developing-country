export const PUBLISHER_TYPES = [
  { id: 'government', label: 'Government' },
  { id: 'international', label: 'International' },
  { id: 'community', label: 'Community' },
  { id: 'platform', label: 'Platform' },
  { id: 'other', label: 'Other organisation' },
] as const

export type PublisherTypeId = typeof PUBLISHER_TYPES[number]['id']

export interface PublisherType {
  id: PublisherTypeId
  label: string
}

export const PUBLISHERS = [
  { id: 'sri-lanka-ntc', name: 'National Transport Commission, Sri Lanka', typeId: 'government' },
  { id: 'sri-lanka-pucsl', name: 'Public Utilities Commission of Sri Lanka', typeId: 'government' },
  { id: 'sri-lanka-ceb', name: 'Ceylon Electricity Board, Sri Lanka', typeId: 'government' },
  { id: 'sri-lanka-nwsdb', name: 'National Water Supply and Drainage Board, Sri Lanka', typeId: 'government' },
  { id: 'world-bank', name: 'World Bank', typeId: 'international' },
  { id: 'sri-lanka-fhb', name: 'Family Health Bureau, Sri Lanka', typeId: 'government' },
  { id: 'sri-lanka-treasury', name: 'Ministry of Finance, Sri Lanka', typeId: 'government' },
  { id: 'sri-lanka-nso', name: 'National System Operator (Private) Limited', typeId: 'government' },
  { id: 'developing-country-org', name: 'DevelopingCountry.org', typeId: 'platform' },
  { id: 'sri-lanka-dcs', name: 'Department of Census and Statistics, Sri Lanka', typeId: 'government' },
  { id: 'sri-lanka-cbsl', name: 'Central Bank of Sri Lanka', typeId: 'government' },
  { id: 'sri-lanka-moh', name: 'Ministry of Health, Sri Lanka', typeId: 'government' },
  { id: 'sri-lanka-boi', name: 'Board of Investment of Sri Lanka', typeId: 'government' },
  { id: 'sri-lanka-irrigation', name: 'Irrigation Department of Sri Lanka', typeId: 'government' },
  { id: 'esa-worldcover', name: 'European Space Agency / WorldCover consortium', typeId: 'international' },
  { id: 'openstreetmap', name: 'OpenStreetMap contributors', typeId: 'community' },
  { id: 'nuwan-senaratna', name: 'Nuwan Senaratna / nuuuwan', typeId: 'community' },
] as const satisfies readonly { id: string; name: string; typeId: PublisherTypeId }[]

export type PublisherId = typeof PUBLISHERS[number]['id']

/**
 * Dataset publication ownership is deliberately separate from upstream Source
 * attribution. A transformed Dataset can therefore be published by the
 * platform while retaining every input Source in its Dataset Version.
 */
export const DATASET_PUBLISHER_IDS = {
  'lk-initiative-events': 'developing-country-org',
  'lk-initiative-funding': 'developing-country-org',
  'public-transport-capacity': 'sri-lanka-ntc',
  'external-trade-indices': 'sri-lanka-dcs',
  'gdp-expenditure': 'sri-lanka-dcs',
  'school-examination-results': 'sri-lanka-dcs',
  'vocational-training': 'sri-lanka-dcs',
  'tourism-activity': 'sri-lanka-dcs',
  'paddy-irrigation': 'sri-lanka-dcs',
  'vital-statistics': 'sri-lanka-dcs',
  'bank-branches-density': 'sri-lanka-cbsl',
  'administrative-units-district': 'sri-lanka-dcs',
  'weather-station-observations': 'sri-lanka-dcs',
  'housing-condition-materials': 'sri-lanka-dcs',
  'functional-difficulties-disability': 'sri-lanka-dcs',
  'language-literacy': 'sri-lanka-dcs',
  'computer-digital-literacy': 'sri-lanka-dcs',
  'electricity-supply-reliability': 'sri-lanka-pucsl',
  'electricity-customers-sales': 'sri-lanka-ceb',
  'housing-occupancy-tenure': 'sri-lanka-dcs',
  'household-equipment-use': 'sri-lanka-dcs',
  'road-crashes-fatalities': 'developing-country-org',
  'household-waste-disposal': 'sri-lanka-dcs',
  'water-operating-performance': 'sri-lanka-nwsdb',
  'water-supply-connections-coverage': 'sri-lanka-nwsdb',
  'colombo-port-performance': 'sri-lanka-dcs',
  'port-traffic-cargo': 'sri-lanka-dcs',
  'building-construction-district': 'sri-lanka-dcs',
  'national-road-length': 'sri-lanka-dcs',
  'poverty-depth-severity': 'sri-lanka-dcs',
  'household-expenditure': 'sri-lanka-dcs',
  'household-income-inequality': 'sri-lanka-dcs',
  'unemployment-by-province': 'sri-lanka-dcs',
  'employment-by-occupation': 'sri-lanka-dcs',
  'foreign-employment-departures': 'sri-lanka-dcs',
  'natural-disaster-impacts': 'sri-lanka-dcs',
  'food-nutrient-availability': 'sri-lanka-dcs',
  'livestock-production': 'sri-lanka-dcs',
  'crop-production-costs': 'sri-lanka-dcs',
  'crop-area-production': 'sri-lanka-dcs',
  'fisheries-production-capacity': 'sri-lanka-dcs',
  'minimum-wage-indices': 'sri-lanka-dcs',
  'energy-supply-consumption': 'sri-lanka-dcs',
  'transport-passengers-freight': 'sri-lanka-dcs',
  'informal-sector-employment-district': 'sri-lanka-dcs',
  'school-resources': 'sri-lanka-dcs',
  'government-health-services': 'sri-lanka-dcs',
  'local-government-expenditure': 'sri-lanka-dcs',
  'local-government-revenue': 'sri-lanka-dcs',
  'building-material-prices': 'sri-lanka-dcs',
  'telecom-services': 'sri-lanka-dcs',
  'local-government-services': 'sri-lanka-dcs',
  'worldbank-economic-outlook': 'world-bank',
  'worldbank-poverty-estimates': 'world-bank',
  'worldbank-poverty-province': 'world-bank',
  'labour-force-sex-history': 'sri-lanka-dcs',
  'labour-employment-profile-history': 'sri-lanka-dcs',
  'ncpi-monthly': 'sri-lanka-dcs',
  'child-nutrition-annual': 'sri-lanka-fhb',
  'agricultural-production-index': 'sri-lanka-dcs',
  'paddy-sown-area-history': 'sri-lanka-dcs',
  'paddy-harvested-area-history': 'sri-lanka-dcs',
  'paddy-yield-history': 'sri-lanka-dcs',
  'paddy-production-history': 'sri-lanka-dcs',

  'treasury-guarantees': 'sri-lanka-treasury',
  'treasury-letters-of-comfort': 'sri-lanka-treasury',
  'treasury-public-debt': 'sri-lanka-treasury',
  'treasury-domestic-debt': 'sri-lanka-treasury',
  'treasury-external-creditors': 'sri-lanka-treasury',
  'treasury-province-debt': 'sri-lanka-treasury',
  'treasury-soe-finances': 'sri-lanka-treasury',
  'treasury-soe-sector-outturn': 'sri-lanka-treasury',
  'treasury-revenue-budget-outturn': 'sri-lanka-treasury',
  'treasury-fiscal-performance': 'sri-lanka-treasury',
  'treasury-fiscal-in-year': 'sri-lanka-treasury',
  'treasury-financial-soundness': 'sri-lanka-treasury',
  'treasury-procurement-status': 'sri-lanka-treasury',
  'treasury-procurement-bids': 'sri-lanka-treasury',
  'treasury-procurement-competitiveness': 'sri-lanka-treasury',
  'treasury-province-transfers': 'sri-lanka-treasury',
  'treasury-women-msme-finance': 'sri-lanka-treasury',

  'electricity-generation-quarter-hourly': 'sri-lanka-nso',
  'electricity-generation-daily': 'sri-lanka-nso',
  attractions: 'openstreetmap',
  'boi-zones': 'sri-lanka-boi',
  'census-age-sex-dsd': 'sri-lanka-dcs',
  'census-basic-services-district': 'sri-lanka-dcs',
  'census-ethnicity-district': 'sri-lanka-dcs',
  'census-religion-district': 'sri-lanka-dcs',
  'census-households-dsd': 'sri-lanka-dcs',
  'census-housing-structure-district': 'sri-lanka-dcs',
  'ccpi-monthly': 'sri-lanka-dcs',
  'central-government-debt-annual': 'sri-lanka-cbsl',
  'colombo-asking-price-indices': 'sri-lanka-cbsl',
  'colombo-land-valuation-indicator': 'sri-lanka-cbsl',
  cycling: 'openstreetmap',
  demographics: 'sri-lanka-dcs',
  developments: 'developing-country-org',
  'effective-exchange-rate-indices': 'sri-lanka-cbsl',
  'employment-by-industry': 'sri-lanka-dcs',
  'exchange-rates-monthly': 'sri-lanka-cbsl',
  expressways: 'developing-country-org',
  'gdp-by-industry': 'sri-lanka-dcs',
  'government-fiscal-operations-annual': 'sri-lanka-cbsl',
  'government-revenue-annual': 'sri-lanka-cbsl',
  hospitals: 'openstreetmap',
  'irrigation-gauges': 'sri-lanka-irrigation',
  'inpatient-morbidity-mortality': 'sri-lanka-moh',
  'labour-force': 'sri-lanka-dcs',
  'land-cover-district': 'developing-country-org',
  'land-cover-grid': 'esa-worldcover',
  'merchandise-trade-category-annual': 'sri-lanka-cbsl',
  'merchandise-trade-monthly': 'sri-lanka-cbsl',
  metro: 'nuwan-senaratna',
  metro_catchment: 'developing-country-org',
  metro_walksheds: 'developing-country-org',
  'metro-coverage-deciles': 'developing-country-org',
  'metro-coverage-facilities': 'developing-country-org',
  'metro-coverage-gnd': 'developing-country-org',
  'metro-coverage-lines': 'developing-country-org',
  'metro-coverage-stops': 'developing-country-org',
  'metro-gap-clusters': 'developing-country-org',
  'metro-route-candidates': 'developing-country-org',
  'metro-route-scenarios': 'developing-country-org',
  'metro-stop-uniqueness': 'developing-country-org',
  'new-vehicle-registrations-annual': 'sri-lanka-dcs',
  osm_foot_graph: 'developing-country-org',
  parks: 'openstreetmap',
  'population-change': 'sri-lanka-dcs',
  'population-change-district': 'sri-lanka-dcs',
  'population-estimates-district': 'sri-lanka-dcs',
  'poverty-headcount-district': 'sri-lanka-dcs',
  'registered-motor-vehicles-annual': 'sri-lanka-dcs',
  schools: 'openstreetmap',
  'sea-routes': 'developing-country-org',
  'tourism-earnings-monthly': 'sri-lanka-cbsl',
  trails: 'openstreetmap',
  waterfalls: 'openstreetmap',
  workplaces: 'developing-country-org',
  'workers-remittances-monthly': 'sri-lanka-cbsl',
} as const satisfies Record<string, PublisherId>

export interface DatasetPublisher {
  id: PublisherId
  name: string
  type: PublisherType
}

export function isPublisherTypeId(value: string): value is PublisherTypeId {
  return PUBLISHER_TYPES.some((type) => type.id === value)
}

export function datasetPublisher(datasetId: string): DatasetPublisher {
  const publisherId = DATASET_PUBLISHER_IDS[datasetId as keyof typeof DATASET_PUBLISHER_IDS]
  if (!publisherId) throw new Error(`Missing Publisher for Dataset ${datasetId}`)
  const publisher = PUBLISHERS.find((candidate) => candidate.id === publisherId)
  if (!publisher) throw new Error(`Unknown Publisher ${publisherId}`)
  const type = PUBLISHER_TYPES.find((candidate) => candidate.id === publisher.typeId)
  if (!type) throw new Error(`Unknown Publisher Type ${publisher.typeId}`)
  return { id: publisher.id, name: publisher.name, type }
}

/**
 * The licence a Dataset published by developing-country.org is released under.
 * It covers our compilation (selection, structure, ids, classifications and
 * our own text); every input Source keeps its own terms, shown beside it.
 * Datasets derived from OpenStreetMap stay ODbL, as its share-alike requires.
 */
export const DATASET_LICENCES = [
  { id: 'cc-by-4.0', name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' },
  { id: 'odbl-1.0', name: 'ODbL 1.0', url: 'https://opendatacommons.org/licenses/odbl/1-0/' },
  { id: 'cdla-permissive-2.0', name: 'CDLA-Permissive-2.0', url: 'https://cdla.dev/permissive-2-0/' },
] as const

export type DatasetLicenceId = typeof DATASET_LICENCES[number]['id']
export type DatasetLicence = typeof DATASET_LICENCES[number]

export const PLATFORM_DATASET_LICENCE_IDS = {
  'lk-initiative-events': 'cc-by-4.0',
  'lk-initiative-funding': 'cc-by-4.0',
  'road-crashes-fatalities': 'cc-by-4.0',
  developments: 'cc-by-4.0',
  'land-cover-district': 'cc-by-4.0',
  expressways: 'odbl-1.0',
  metro_catchment: 'odbl-1.0',
  metro_walksheds: 'odbl-1.0',
  'metro-coverage-deciles': 'odbl-1.0',
  'metro-coverage-facilities': 'odbl-1.0',
  'metro-coverage-gnd': 'odbl-1.0',
  'metro-coverage-lines': 'odbl-1.0',
  'metro-coverage-stops': 'odbl-1.0',
  'metro-gap-clusters': 'odbl-1.0',
  'metro-route-candidates': 'odbl-1.0',
  'metro-route-scenarios': 'odbl-1.0',
  'metro-stop-uniqueness': 'odbl-1.0',
  osm_foot_graph: 'odbl-1.0',
  'sea-routes': 'odbl-1.0',
  workplaces: 'cdla-permissive-2.0',
} as const satisfies Partial<Record<keyof typeof DATASET_PUBLISHER_IDS, DatasetLicenceId>>

/** The licence of a Dataset developing-country.org publishes; null for Datasets other publishers own. */
export function datasetLicence(datasetId: string): DatasetLicence | null {
  const publisherId = DATASET_PUBLISHER_IDS[datasetId as keyof typeof DATASET_PUBLISHER_IDS]
  if (publisherId !== 'developing-country-org') return null
  const licenceId = PLATFORM_DATASET_LICENCE_IDS[datasetId as keyof typeof PLATFORM_DATASET_LICENCE_IDS]
  if (!licenceId) throw new Error(`Missing licence for platform Dataset ${datasetId}`)
  return DATASET_LICENCES.find((licence) => licence.id === licenceId)!
}
