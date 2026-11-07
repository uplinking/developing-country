import type { IndicatorDatasetDefinition } from './presets'

/**
 * Derived Colombo Metro Bus walking-coverage tables built by
 * scripts/build-metro-coverage.mjs. Every table carries the same source chain:
 * the derived analysis record plus each input it was computed from.
 */
export const METRO_COVERAGE_SOURCE_IDS = [
  'metro-coverage',
  'lk-metro',
  'osm-walk-colombo',
  'lk-census-2024',
  'gig-data-gnd-boundaries',
  'osm',
  'overture-places',
]

const VINTAGE = 'Walk graph 2026-10 · Census 2024 · CM stops 2026-08 · Overture 2026-09-23.1'
const LIMIT =
  'Population is spread evenly within each GN division, so homes clustered along roads are not modelled. Residents only: workers, students and visitors are not counted. Walks follow mapped OpenStreetMap streets and paths at 80 m a minute and ignore slope, crossings and footpath quality; stop locations are as compiled by lk_metro. Offices and businesses are Overture Maps listings, not jobs: no headcount or floor area, and coverage is uneven.'

const CM_LINES = ['CM01', 'CM02', 'CM03', 'CM04', 'CM05', 'CM06', 'CM08']

export const METRO_COVERAGE_DATASETS: readonly IndicatorDatasetDefinition[] = [
  {
    id: 'metro-coverage-lines',
    title: 'Metro Bus walking coverage by line',
    label: 'Metro coverage by line',
    themeIds: ['TRAN', 'REGI'],
    description: 'Residents within a 5- and 10-minute walk of each Colombo Metro Bus line and of the whole network, compared with 800 m circles.',
    sourceIds: METRO_COVERAGE_SOURCE_IDS,
    vintage: VINTAGE,
    note: {
      dek: 'How many residents live within a 5- or 10-minute walk of the seven Colombo Metro Bus lines, counted along the real street network.',
      question: 'How many people can walk to a Colombo Metro Bus stop in ten minutes?',
      contains: 'One row per CM line and one network row. Walksheds follow the OpenStreetMap walking network from every stop for 400 m and 800 m, keep 50 m of frontage either side of each reached street and are compared with 800 m circles. Population comes from Census 2024 GN divisions within 2 km of a line, 2.58 million people.',
      use: 'About 510,000 residents, 19.7% of the study area, live within a 10-minute walk of a stop; 800 m circles would claim 898,000. Offices are better served: 2,203 of 3,650 mapped office listings, 60.4%, are within a 10-minute walk. The chart ranks lines by residents within a 10-minute walk per route kilometre. Line rows overlap, so only the ALL row is a unique network total.',
      limit: LIMIT,
    },
    presets: [
      {
        id: 'residents-per-route-km',
        title: 'Residents within a 10-minute walk per route kilometre',
        description: 'Unique residents within a 10-minute walk of each CM line’s stops, divided by the line’s published route length.',
        query: {
          fields: ['line_code', 'line_name', 'pop_per_route_km'],
          where: [{ field: 'line_code', op: 'in', value: CM_LINES }],
          order_by: [{ field: 'pop_per_route_km', direction: 'desc' }],
          limit: 7,
        },
        chart: {
          family: 'ranking',
          dimension: { field: 'line_code', label: 'CM line' },
          measure: { field: 'pop_per_route_km', label: 'Residents within 10 minutes per km', unit: 'people per km' },
          orientation: 'horizontal',
        },
      },
      {
        id: 'offices-within-10-minutes',
        title: 'Offices within a 10-minute walk',
        description: 'Overture Maps office listings within a 10-minute walk of each CM line’s stops.',
        query: {
          fields: ['line_code', 'line_name', 'offices_10min'],
          where: [{ field: 'line_code', op: 'in', value: CM_LINES }],
          order_by: [{ field: 'offices_10min', direction: 'desc' }],
          limit: 7,
        },
        chart: {
          family: 'ranking',
          dimension: { field: 'line_code', label: 'CM line' },
          measure: { field: 'offices_10min', label: 'Offices within a 10-minute walk', unit: 'offices' },
          orientation: 'horizontal',
        },
      },
      {
        id: 'walk-versus-circle',
        title: 'Residents within a 10-minute walk and within 800 m',
        description: 'Unique residents within a 10-minute walk of each line, compared with the population inside 800 m circles around the same stops.',
        query: {
          fields: ['line_code', 'pop_10min', 'pop_circle_800m'],
          where: [{ field: 'line_code', op: 'in', value: CM_LINES }],
          order_by: [{ field: 'pop_10min', direction: 'desc' }],
          limit: 7,
        },
        chart: {
          family: 'comparison',
          dimension: { field: 'line_code', label: 'CM line' },
          measure: { field: 'pop_10min', label: 'Residents within a 10-minute walk', unit: 'people' },
          orientation: 'horizontal',
        },
      },
    ],
  },
  {
    id: 'metro-coverage-stops',
    title: 'Metro Bus walking coverage by stop',
    label: 'Metro coverage by stop',
    themeIds: ['TRAN', 'REGI'],
    description: 'Residents within a 5- and 10-minute walk of each of the 110 Colombo Metro Bus stops, compared with an 800 m circle.',
    sourceIds: METRO_COVERAGE_SOURCE_IDS,
    vintage: VINTAGE,
    note: {
      dek: 'Residents, schools and hospitals within a 5- and 10-minute walk of each Colombo Metro Bus stop.',
      question: 'Which Colombo Metro Bus stops can the most residents walk to?',
      contains: 'One row per stop with its routes, coordinates, walkshed area, residents within 400 m and 800 m of walking, residents inside an 800 m circle, and the share by which the circle overstates the walk.',
      use: 'The chart ranks the 25 stops with the most residents within a 10-minute walk; Maradana R.way leads with about 22,400. For the typical stop the 800 m circle claims 91% more residents than the street network reaches.',
      limit: `${LIMIT} Walksheds of neighbouring stops overlap, so stop rows must not be added together.`,
    },
    presets: [
      {
        id: 'residents-within-10-minutes',
        title: 'Residents within a 10-minute walk of a stop',
        description: 'The 25 Colombo Metro Bus stops with the most residents within 800 m of walking along the street network.',
        query: {
          fields: ['stop', 'routes', 'pop_10min'],
          order_by: [{ field: 'pop_10min', direction: 'desc' }],
          limit: 25,
        },
        chart: {
          family: 'ranking',
          dimension: { field: 'stop', label: 'Stop' },
          measure: { field: 'pop_10min', label: 'Residents within a 10-minute walk', unit: 'people' },
          orientation: 'horizontal',
        },
      },
      {
        id: 'circle-overstatement',
        title: 'How far an 800 m circle overstates walking reach',
        description: 'Extra residents an 800 m circle counts compared with a 10-minute walk, as a percentage, for the 25 stops where the gap is largest.',
        query: {
          fields: ['stop', 'circle_overstatement_pct'],
          order_by: [{ field: 'circle_overstatement_pct', direction: 'desc' }],
          limit: 25,
        },
        chart: {
          family: 'ranking',
          dimension: { field: 'stop', label: 'Stop' },
          measure: { field: 'circle_overstatement_pct', label: 'Circle overstatement', unit: '%' },
          orientation: 'horizontal',
        },
      },
    ],
  },
  {
    id: 'metro-coverage-gnd',
    title: 'Metro Bus walking coverage by GN division',
    label: 'Metro coverage by GN division',
    themeIds: ['TRAN', 'SOCI', 'REGI'],
    description: 'Share and number of each GN division’s residents within a 5- and 10-minute walk of a Colombo Metro Bus stop.',
    sourceIds: METRO_COVERAGE_SOURCE_IDS,
    vintage: VINTAGE,
    note: {
      dek: 'For each Grama Niladhari division within 2 km of a CM line, the residents within a 5- and 10-minute walk of a stop and the walk to the nearest stop.',
      question: 'Which densely populated neighbourhoods near the Metro Bus lines are beyond a 10-minute walk?',
      contains: 'One row for each of the 568 GN divisions within 2 km of a line: Census 2024 population, area and density, the share of the division inside the network 5-minute, 10-minute and 800 m walksheds, the residents served and unserved, the nearest stop by walking and a study-area density decile.',
      use: 'The chart ranks the 25 divisions with the most residents beyond a 10-minute walk. Modara and Mattakkuliya in Colombo North lead; 800 m circles from the Peliyagoda stops cover 29% of Mattakkuliya across the Kelani, but no 10-minute walk reaches it. gnd_id matches the GN map tiles, so rows can colour the map.',
      limit: `${LIMIT} GN boundaries are the Census 2012 boundaries published by gig-data.`,
    },
    presets: [
      {
        id: 'largest-unserved-divisions',
        title: 'Residents beyond a 10-minute walk by GN division',
        description: 'The 25 GN divisions within 2 km of a CM line with the most residents beyond a 10-minute walk of any stop.',
        query: {
          fields: ['gnd', 'dsd', 'unserved_pop_10min'],
          order_by: [{ field: 'unserved_pop_10min', direction: 'desc' }],
          limit: 25,
        },
        chart: {
          family: 'ranking',
          dimension: { field: 'gnd', label: 'GN division' },
          measure: { field: 'unserved_pop_10min', label: 'Residents beyond a 10-minute walk', unit: 'people' },
          orientation: 'horizontal',
        },
      },
    ],
  },
  {
    id: 'metro-coverage-deciles',
    title: 'Metro Bus walking coverage by population density',
    label: 'Metro coverage by density',
    themeIds: ['TRAN', 'SOCI'],
    description: 'Share of residents within a 10-minute walk of a Colombo Metro Bus stop, by density decile of GN divisions near the lines.',
    sourceIds: METRO_COVERAGE_SOURCE_IDS,
    vintage: VINTAGE,
    note: {
      dek: 'Whether the Metro Bus walksheds reach the densest neighbourhoods near the lines, in ten equal groups of GN divisions.',
      question: 'Do the Metro Bus stops serve the densest neighbourhoods near the lines?',
      contains: 'Ten rows that split the 568 study-area GN divisions into equal-count density deciles, with the density range, population, residents within and beyond a 10-minute walk, and the share within.',
      use: 'The chart compares the share of residents within a 10-minute walk across density deciles: about 12% in the sparsest tenth of divisions and 26% in the two densest.',
      limit: LIMIT,
    },
    presets: [
      {
        id: 'coverage-by-density-decile',
        title: 'Residents within a 10-minute walk by density decile',
        description: 'Share of residents within a 10-minute walk of a stop for each tenth of study-area GN divisions, from sparsest (1) to densest (10).',
        query: {
          fields: ['density_decile', 'share_10min_pct'],
          order_by: [{ field: 'density_decile', direction: 'asc' }],
          limit: 10,
        },
        chart: {
          family: 'comparison',
          dimension: { field: 'density_decile', label: 'Density decile (10 = densest)' },
          measure: { field: 'share_10min_pct', label: 'Residents within a 10-minute walk', unit: '%' },
          orientation: 'vertical',
        },
      },
    ],
  },
  {
    id: 'metro-coverage-facilities',
    title: 'Schools, hospitals and offices near Metro Bus stops',
    label: 'Facilities near Metro stops',
    themeIds: ['TRAN', 'EDUC', 'HEAL', 'ECON'],
    description: 'Walking distance from each mapped school, hospital and office near the Colombo Metro Bus lines to its nearest stop.',
    sourceIds: METRO_COVERAGE_SOURCE_IDS,
    vintage: VINTAGE,
    note: {
      dek: 'Mapped schools, colleges, hospitals, clinics and offices near the Metro Bus lines, with the walk to the nearest stop.',
      question: 'Which schools, hospitals and offices near the Metro Bus lines are within a 10-minute walk of a stop?',
      contains: 'One row for each OpenStreetMap school, college, university, kindergarten, hospital and clinic, and each Overture Maps office listing (with its office type), inside the study-area GN divisions, with its nearest stop by walking, the walk in metres and whether it is within a 5- or 10-minute walk.',
      use: 'The chart ranks hospitals by the walk to their nearest stop. Of 500 mapped schools, 220 are within a 10-minute walk; of 124 hospitals, 74 are; of 3,650 office listings, 2,203 are.',
      limit: `${LIMIT} OpenStreetMap is not an official register of schools or health facilities, and Overture office listings are not a business register, so the list is incomplete.`,
    },
    presets: [
      {
        id: 'hospital-walk-to-stop',
        title: 'Walk from hospitals to the nearest Metro Bus stop',
        description: 'The 25 mapped hospitals near the CM lines with the longest walk to a stop, in metres.',
        query: {
          fields: ['name', 'nearest_stop', 'walk_m'],
          where: [{ field: 'kind', op: 'eq', value: 'hospital' }],
          order_by: [{ field: 'walk_m', direction: 'desc' }],
          limit: 25,
        },
        chart: {
          family: 'ranking',
          dimension: { field: 'name', label: 'Hospital' },
          measure: { field: 'walk_m', label: 'Walk to nearest stop', unit: 'm' },
          orientation: 'horizontal',
        },
      },
    ],
  },
]
