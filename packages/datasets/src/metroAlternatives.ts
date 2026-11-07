import { METRO_COVERAGE_SOURCE_IDS } from './metroCoverage'
import type { IndicatorDatasetDefinition } from './presets'

/**
 * "Where Colombo's metro buses don't go": gap clusters, stop duplication and
 * illustrative candidate routes built by scripts/build-metro-alternatives.mjs on
 * the same walking model and source chain as the metro coverage tables.
 */
const VINTAGE = 'Walk graph 2026-10 · Census 2024 · CM stops 2026-08 · Overture 2026-09-23.1'
const MODEL_LIMIT =
  'Coverage only: no travel demand, origin–destination data, road capacity, bus operations, terminal space or cost. Population is spread evenly within each GN division and counts residents only; offices are Overture listings, not jobs; walks follow mapped OpenStreetMap streets and paths at 80 m a minute.'

export const METRO_ALTERNATIVES_DATASETS: readonly IndicatorDatasetDefinition[] = [
  {
    id: 'metro-gap-clusters',
    title: 'Dense neighbourhoods beyond Metro Bus walking reach',
    label: 'Metro gap clusters',
    themeIds: ['TRAN', 'SOCI', 'REGI'],
    description: 'Contiguous groups of dense GN divisions near the Colombo Metro Bus lines where fewer than one in ten residents live within a 10-minute walk of a stop.',
    sourceIds: METRO_COVERAGE_SOURCE_IDS,
    vintage: VINTAGE,
    note: {
      dek: 'Seven clusters of dense neighbourhoods near the Metro Bus lines where almost nobody lives within a 10-minute walk of a stop.',
      question: 'Where do the most people near the Metro Bus lines live beyond a 10-minute walk of a stop?',
      contains: 'Each cluster joins neighbouring GN divisions with at least 10,000 residents per km² (tier 1), or at least 5,000 per km² away from any tier-1 cluster (tier 2), where less than 10% of the area is within a 10-minute walk. It records residents, residents beyond the walk, offices, schools and hospitals beyond the walk, density, the nearest stop and a dissolved outline.',
      use: 'The chart ranks clusters by residents beyond a 10-minute walk. Colombo North around Modara and Mattakkuliya leads with about 199,000 people, more than the next four clusters together; Kolonnawa follows with 73,000.',
      limit: `${MODEL_LIMIT} Cluster boundaries follow Census 2012 GN polygons and depend on the chosen density and coverage thresholds.`,
    },
    presets: [
      {
        id: 'unserved-residents-by-cluster',
        title: 'Residents beyond a 10-minute walk by gap cluster',
        description: 'Residents of each dense gap cluster who live beyond a 10-minute walk of a Colombo Metro Bus stop.',
        query: {
          fields: ['name', 'unserved_residents'],
          order_by: [{ field: 'unserved_residents', direction: 'desc' }],
          limit: 20,
        },
        chart: {
          family: 'ranking',
          dimension: { field: 'name', label: 'Gap cluster' },
          measure: { field: 'unserved_residents', label: 'Residents beyond a 10-minute walk', unit: 'people' },
          orientation: 'horizontal',
        },
      },
    ],
  },
  {
    id: 'metro-stop-uniqueness',
    title: 'Metro Bus stops by residents no other stop reaches',
    label: 'Stop uniqueness',
    themeIds: ['TRAN', 'REGI'],
    description: 'Residents and offices within a 10-minute walk of each Colombo Metro Bus stop that no other stop reaches.',
    sourceIds: METRO_COVERAGE_SOURCE_IDS,
    vintage: VINTAGE,
    note: {
      dek: 'How much of each Metro Bus stop’s walking catchment no other stop covers, a measure of where the network duplicates itself.',
      question: 'Which Metro Bus stops reach people no other stop does, and which mostly repeat their neighbours?',
      contains: 'One row per stop with residents and offices within a 10-minute walk, the part that no other stop’s 10-minute walk reaches, and that unique part as a share of the stop’s residents.',
      use: 'The chart ranks the 25 stops with the lowest unique share. Central stops on the CM06 circular, such as Jawatta and Independence Square, add almost nobody that a neighbouring stop does not already reach, while outer stops such as Dematagoda, Kadawatha and Ekala are wholly unique.',
      limit: `${MODEL_LIMIT} A low unique share is not by itself a reason to remove a stop: it ignores where riders are going and which lines stop there.`,
    },
    presets: [
      {
        id: 'least-unique-stops',
        title: 'Stops whose walking reach others already cover',
        description: 'Share of each stop’s residents within a 10-minute walk that no other stop reaches, for the 25 stops where it is lowest.',
        query: {
          fields: ['stop', 'routes', 'unique_share_pct'],
          order_by: [{ field: 'unique_share_pct', direction: 'asc' }],
          limit: 25,
        },
        chart: {
          family: 'ranking',
          dimension: { field: 'stop', label: 'Stop' },
          measure: { field: 'unique_share_pct', label: 'Residents only this stop reaches', unit: '%' },
          orientation: 'horizontal',
        },
      },
    ],
  },
  {
    id: 'metro-route-candidates',
    title: 'Illustrative Metro Bus route candidates',
    label: 'Route candidates',
    themeIds: ['TRAN', 'REGI'],
    description: 'Rule-generated links and extensions from existing Colombo Metro Bus stops into dense unserved neighbourhoods, scored on the residents, offices, schools and hospitals they would add.',
    sourceIds: METRO_COVERAGE_SOURCE_IDS,
    vintage: VINTAGE,
    note: {
      dek: 'Ten mechanically generated links and extensions into the gap clusters, scored on what each would add to the existing network’s walking reach.',
      question: 'Which short additions would bring the most new residents within a 10-minute walk of a Metro Bus stop?',
      contains: 'For each gap cluster, a link from the nearest interchange stop and, where it differs and is within 10 km, an extension from the nearest line terminus, routed along OpenStreetMap main roads with a new stop about every kilometre. Each candidate records its length, new stops and the residents, offices, schools and hospitals it adds within 5 and 10 minutes beyond what the network already reaches.',
      use: 'The chart ranks candidates by new residents within a 10-minute walk per route kilometre. A 3.7 km CM04 extension from Dematagoda into Modara adds about 40,000 residents, roughly 10,800 per km.',
      limit: `${MODEL_LIMIT} The candidates are illustrations of a rule, not recommendations or planned routes.`,
    },
    presets: [
      {
        id: 'new-residents-per-km',
        title: 'New residents within a 10-minute walk per route km',
        description: 'Residents each illustrative candidate would newly bring within a 10-minute walk of a stop, per kilometre of route.',
        query: {
          fields: ['name', 'new_pop_per_km'],
          order_by: [{ field: 'new_pop_per_km', direction: 'desc' }],
          limit: 10,
        },
        chart: {
          family: 'ranking',
          dimension: { field: 'name', label: 'Candidate' },
          measure: { field: 'new_pop_per_km', label: 'New residents per route km', unit: 'people per km' },
          orientation: 'horizontal',
        },
      },
    ],
  },
  {
    id: 'metro-route-scenarios',
    title: 'Metro Bus coverage with candidate routes',
    label: 'Route scenarios',
    themeIds: ['TRAN', 'REGI'],
    description: 'Residents and offices within a 10-minute walk of the current Colombo Metro Bus network and with the three best illustrative candidates added.',
    sourceIds: METRO_COVERAGE_SOURCE_IDS,
    vintage: VINTAGE,
    note: {
      dek: 'How much of the study area would be within a 10-minute walk if the three best illustrative candidates were added to the network.',
      question: 'How far would three short additions move the share of residents within a 10-minute walk of a Metro Bus stop?',
      contains: 'Two rows: the current network and the network with the three candidates that add the most residents per route km, with the residents and offices within a 10-minute walk and their shares of the study area.',
      use: 'Adding about 8.9 km of route in three candidates would raise the share of study-area residents within a 10-minute walk from 19.7% to 22.6%, about 73,000 more people.',
      limit: `${MODEL_LIMIT} The scenario counts overlap among the added candidates once; it says nothing about ridership or cost.`,
    },
    presets: [
      {
        id: 'share-within-10-minutes',
        title: 'Residents within a 10-minute walk by scenario',
        description: 'Share of study-area residents within a 10-minute walk of a stop, for the current network and with the three best candidates added.',
        query: {
          fields: ['scenario', 'share_10min_pct'],
          order_by: [{ field: 'share_10min_pct', direction: 'asc' }],
          limit: 2,
        },
        chart: {
          family: 'comparison',
          dimension: { field: 'scenario', label: 'Scenario' },
          measure: { field: 'share_10min_pct', label: 'Residents within a 10-minute walk', unit: '%' },
          orientation: 'horizontal',
        },
      },
    ],
  },
]
