import { URBAN_DATASETS } from '../../packages/datasets/src/urban'
import { RECOVERY_DATASETS } from '../../packages/datasets/src/recovery'
import { TREASURY_TABLES } from '../../packages/datasets/src/treasury'
import { METRO_COVERAGE_DATASETS } from '../../packages/datasets/src/metroCoverage'
import { METRO_ALTERNATIVES_DATASETS } from '../../packages/datasets/src/metroAlternatives'
// LLM-facing SSOT: entity types, operators, completeness, relatedness.
// Paint lives in src/map/layers.ts; this file must not import MapLibre.

import type { StageEvent } from '../shared/stage'
import { SRI_LANKA } from '@developing-country/countries'
import {
  aggregateFreshness,
  freshnessOf,
  type FreshnessPolicy,
  type FreshnessState,
  type RefreshKind,
} from '../shared/freshness'
import type {
  Completeness as DomainCompleteness,
  CompletenessStatus,
  CountryCode,
} from '@developing-country/domain'
import coverageLedger from '../../scripts/coverage-ledger.json' with { type: 'json' }
import dataSourceRegistry from '../../scripts/data-sources.json' with { type: 'json' }
import registryIds from '../shared/registry-ids.json' with { type: 'json' }

const PUBLIC_TILE_ORIGIN = 'https://tiles.developing-country.org'

export type GeometryKind = 'point' | 'line' | 'polygon' | 'raster' | 'network' | 'statute' | 'none'
export type AdminLevel = 'country' | 'province' | 'district' | 'dsd' | 'gnd'
export type LicenceStatus = 'open' | 'permission_unclear' | 'restricted' | 'unknown'
export type OperatorId =
  | 'select'
  | 'bbox'
  | 'point_in_polygon'
  | 'nearest'
  | 'overlay'
  | 'gap'
  | 'isochrone'
  | 'choropleth_join'
  | 'region.upsert'

export interface Provenance {
  source: string
  vintage: string
  licence: string
  refresh: string
  refreshed?: string
  url?: string
  licence_status?: LicenceStatus
}

export type { CompletenessStatus }

export interface Completeness extends Omit<DomainCompleteness, 'coverageNote' | 'knownGaps'> {
  coverage_note: string
  known_gaps: string[]
}

export interface RelatedRef {
  id: string
  rel:
    | 'contained_in'
    | 'contains'
    | 'served_by'
    | 'serves'
    | 'nearest'
    | 'regulates'
    | 'derived_from'
    | 'same_as'
  note?: string
}

export type Storage =
  | { kind: 'geojson'; path: string }
  | { kind: 'table'; path: string }
  | { kind: 'pmtiles'; file: string; sourceLayer: string }
  | { kind: 'index'; path: string }
  | { kind: 'd1'; table: string }
  | { kind: 'adapter'; endpoint: string }
  | { kind: 'r2'; key: string }
  | { kind: 'none' }

export interface EntityType {
  id: string
  source_ids: string[]
  dataset_ids?: string[]
  title: string
  description: string
  title_si?: string
  title_ta?: string
  geometry: GeometryKind
  admin_level?: AdminLevel
  id_field: string
  name_field: string
  operators: OperatorId[]
  related: RelatedRef[]
  completeness: Completeness
  provenance: Provenance
  layer_id?: string
  catalog_id?: string
  searchable: boolean
  storage: Storage
  tags?: string[]
}

export interface OperatorDef {
  id: OperatorId
  title: string
  description: string
  applies_to: string[] | '*'
  cost: 'cheap' | 'moderate' | 'expensive'
  auth: 'public' | 'user'
  notes: string
}

export interface Ontology {
  version: string
  country: CountryCode
  generated_at: string
  admin_hierarchy: { id: AdminLevel; parent: AdminLevel | null; approx_count: number }[]
  operators: OperatorDef[]
  entities: EntityType[]
  start_here: string[]
}

export interface CatalogEntry {
  id: string
  /** The id query_data takes in `entities` (differs from `id` when an entity has a catalog_id). */
  entity_id: string
  dataset_ids: string[]
  title: string
  description: string
  country: CountryCode
  kind: Storage['kind'] | 'tiles' | 'db'
  source: string
  source_ids: string[]
  sources: Array<{
    id: string
    name: string
    publisher: string
    url: string
    licence: string
    licence_status: LicenceStatus
    vintage: string
    refreshed_at: string
    how_to_refresh: string
    freshness: FreshnessState
  }>
  source_url?: string
  vintage: string
  refreshed_at?: string
  freshness: FreshnessState
  licence: string
  licence_status: LicenceStatus
  how_to_refresh: string
  path?: string
  storage: Storage
  field_schema: {
    id_field: string
    name_field: string
    geometry: GeometryKind
    admin_level?: AdminLevel
  }
  completeness: Completeness
  searchable: boolean
  operators: OperatorId[]
  related: RelatedRef[]
  geometry: GeometryKind
  layer_id?: string
}

const OSM: Provenance = {
  source: 'OpenStreetMap',
  vintage: '2026',
  licence: 'ODbL',
  refresh: 'bun run fetch:explore',
  url: 'https://www.openstreetmap.org/',
}

const GIG: Provenance = {
  source: 'Dept. of Census & Statistics via nuuuwan/lk_census_2024 + gig-data',
  vintage: 'Census 2024 (population, id join) · geometries Census 2012',
  licence: 'MIT (lk_census_2024 parser, gig-data geometries); DCS official census (figures)',
  refresh: 'bun run build:admin-index',
  url: 'https://github.com/nuuuwan/lk_census_2024',
}

const CENSUS_PARTIAL: Completeness = {
  status: 'partial',
  coverage: 0.974,
  coverage_note:
    'Census 2024 Person-Sex total_value joined on gig-data id = region_id. GND id match 97.43% (below the 98% gate) because Nuwara Eliya / Galle / Ratnapura DSD recodes changed GND ids; district 100%, DSD 100%. Choropleth tiles carry properties.id and 2024 pop where joined. Population attribute only — not a complete census of households/ethnicity/services.',
  known_gaps: [
    'GND id match 97.43% < 98% (scripts/census-2024-known-gaps.md)',
    'unmatched GNDs keep Census 2012 pop (vintage 2012 on the feature)',
    'GND lookup is nearest centroid, not point-in-polygon',
  ],
}

const KNOWN_ABSENT = (note: string, gaps: string[]): Completeness => ({
  status: 'known_absent',
  coverage: 0,
  coverage_note: note,
  known_gaps: gaps,
})

interface IndicatorEntityOptions {
  id: string
  datasetId: string
  title: string
  description: string
  sourceIds: string[]
  source: string
  vintage: string
  licence: string
  licenceStatus: LicenceStatus
  url: string
  path: string
  refresh?: string
  idField: string
  nameField: string
  adminLevel?: AdminLevel
  coverageNote: string
  partial?: boolean
  knownGaps?: string[]
  tags: string[]
}

function indicatorEntity(options: IndicatorEntityOptions): EntityType {
  return {
    id: options.id,
    source_ids: options.sourceIds,
    dataset_ids: [options.datasetId],
    title: options.title,
    description: options.description,
    geometry: 'none',
    ...(options.adminLevel ? { admin_level: options.adminLevel } : {}),
    id_field: options.idField,
    name_field: options.nameField,
    operators: ['select'],
    related: [],
    completeness: {
      status: options.partial ? 'partial' : 'complete',
      coverage: options.partial ? null : 1,
      coverage_note: options.coverageNote,
      known_gaps: options.knownGaps ?? [],
    },
    provenance: {
      source: options.source,
      vintage: options.vintage,
      licence: options.licence,
      licence_status: options.licenceStatus,
      refresh: options.refresh ?? 'bun scripts/build-official-indicators.mjs',
      url: options.url,
    },
    searchable: false,
    storage: { kind: 'table', path: options.path },
    tags: options.tags,
  }
}

const METRO_COVERAGE_SOURCE_IDS = [...METRO_COVERAGE_DATASETS[0]!.sourceIds]

const METRO_COVERAGE_PROVENANCE: Provenance = {
  source: 'developing-country.org analysis of lk_metro stops, the OpenStreetMap walking network, Census 2024 GN population, gig-data GN boundaries and Overture Maps Places',
  vintage: '2026-10',
  licence: 'ODbL (derived from OpenStreetMap); inputs MIT (lk_metro, gig-data), CDLA-Permissive-2.0 (Overture) and DCS Census 2024 figures',
  licence_status: 'permission_unclear',
  refresh: 'bun scripts/build-metro-coverage.mjs',
  url: 'https://developing-country.org/data/metro-coverage-lines',
}

const METRO_COVERAGE_COMPLETENESS: Completeness = {
  status: 'derived',
  coverage: 1,
  coverage_note:
    'All 110 CM stops and 7 lines; study area = the 568 GN divisions within 2 km of a line (2.58 M residents). Walk 80 m/min (5 min = 400 m, 10 min = 800 m) on the OSM foot graph; reached streets buffered 50 m; 5 m equal-area raster.',
  known_gaps: [
    'Uniform population density within each GN division (area-weighted shares), so roadside clustering is not modelled',
    'Residential census population only: no workplace, student or daytime population',
    'OSM street and path completeness: missing lanes shrink walksheds, gated or unsafe mapped paths enlarge them; slope, crossings and footpath quality ignored',
    'Stop locations as compiled by nuuuwan/lk_metro, not surveyed kerbside stops',
    'Offices and businesses are Overture Maps Places listings (confidence ≥ 0.5, not closed), not employment counts: no headcount or floor area, and coverage is uneven',
    'GN boundaries are the Census 2012 gig-data polygons; GND population is Census 2024 joined on gig-data ids',
  ],
}

const METRO_COVERAGE_KEYS: Record<string, { idField: string; nameField: string; adminLevel?: AdminLevel }> = {
  'metro-coverage-lines': { idField: 'line_code', nameField: 'line_name' },
  'metro-coverage-stops': { idField: 'stop_id', nameField: 'stop' },
  'metro-coverage-gnd': { idField: 'gnd_id', nameField: 'gnd', adminLevel: 'gnd' },
  'metro-coverage-deciles': { idField: 'density_decile', nameField: 'density_decile' },
  'metro-coverage-facilities': { idField: 'facility_id', nameField: 'name' },
  'metro-gap-clusters': { idField: 'cluster_id', nameField: 'name' },
  'metro-stop-uniqueness': { idField: 'stop_id', nameField: 'stop' },
  'metro-route-candidates': { idField: 'candidate_id', nameField: 'name' },
  'metro-route-scenarios': { idField: 'scenario_id', nameField: 'scenario' },
}

const METRO_ALTERNATIVES_COMPLETENESS: Completeness = {
  status: 'derived',
  coverage: 1,
  coverage_note:
    'Same model and study area as the metro coverage tables. Gap clusters: adjacent GN divisions with density ≥ 10,000/km² (tier 1) or ≥ 5,000/km² away from tier 1 (tier 2) and < 10% of area within a 10-min walk, kept at ≥ 15,000 unserved residents. Candidates: rule-generated links (nearest interchange) and extensions (nearest terminus ≤ 10 km by road) along OSM main roads, new stops every median CM stop spacing (~1 km), scored on marginal coverage.',
  known_gaps: [
    'Coverage-only scoring: no travel demand, origin–destination data, road capacity, bus operations, terminal space or cost',
    'Candidate routes are illustrative outputs of a mechanical rule, not recommendations',
    ...METRO_COVERAGE_COMPLETENESS.known_gaps,
  ],
}

const METRO_ALTERNATIVES_PROVENANCE: Provenance = {
  ...METRO_COVERAGE_PROVENANCE,
  source: `${METRO_COVERAGE_PROVENANCE.source}; candidate routing on OpenStreetMap main roads`,
  refresh: 'bun scripts/build-metro-alternatives.mjs',
  url: 'https://developing-country.org/data/metro-gap-clusters',
}

export const ONTOLOGY: Ontology = {
  version: '0.4.0',
  country: SRI_LANKA.code,
  generated_at: '2026-08-31',
  start_here: [
    'gnd',
    'census_age_sex_dsd',
    'gdp_observation',
    'merchandise_trade_monthly_observation',
    'central_government_debt_observation',
    'land_cover_cell',
    'metro_stop',
    'development',
  ],
  admin_hierarchy: [
    { id: 'country', parent: null, approx_count: 1 },
    { id: 'province', parent: 'country', approx_count: 9 },
    { id: 'district', parent: 'province', approx_count: 25 },
    { id: 'dsd', parent: 'district', approx_count: 331 },
    { id: 'gnd', parent: 'dsd', approx_count: 14000 },
  ],
  operators: [
    {
      id: 'select',
      title: 'Select indicator observations',
      description: 'Project, filter and deterministically order rows from a registered Indicator Table.',
      applies_to: [
        ...URBAN_DATASETS.map(d => d.id.replaceAll('-', '_')),
        ...RECOVERY_DATASETS.map(d => d.id.replaceAll('-', '_')),
        ...METRO_COVERAGE_DATASETS.map(d => d.id.replaceAll('-', '_')),
        ...METRO_ALTERNATIVES_DATASETS.map(d => d.id.replaceAll('-', '_')),
        'census_age_sex_dsd', 'census_households_dsd', 'census_basic_services_district',
        'population_estimate', 'labour_force_observation', 'employment_industry_observation',
        'poverty_observation', 'gdp_observation', 'inpatient_observation', 'land_cover_observation',
        'merchandise_trade_monthly_observation', 'merchandise_trade_category_annual_observation',
        'workers_remittance_observation', 'fiscal_operations_observation',
        'government_revenue_observation', 'central_government_debt_observation',
      ],
      cost: 'cheap',
      auth: 'public',
      notes: 'Registered fields only; at most 8 predicates, 500 values per in-filter and 8 sort fields. Returns at most 200 rows, or up to 5,000 when the result is saved as a Data View (presentation). group_by (up to 4 dimension fields) + aggregates [{fn: sum|mean|min|max|count}] replaces fields; sum only on measures the table declares aggregation: sum.',
    },
    {
      id: 'bbox',
      title: 'Bbox scan',
      description: 'Return searchable/light features whose coordinates fall in [west,south,east,north]. With include_geometry: true, return any GeoJSON entity\'s features whose extent intersects the bbox, with their own geometry, optionally filtered by property equality (`where`).',
      applies_to: '*',
      cost: 'cheap',
      auth: 'public',
      notes: 'Without include_geometry, does not scan non-searchable stores (catchment, admin rings, walk graph). include_geometry returns up to 500 features; a saved view still obeys the snapshot byte cap.',
    },
    {
      id: 'nearest',
      title: 'Nearest',
      description: 'n nearest features of one entity type to an origin, optional radius_km.',
      applies_to: '*',
      cost: 'cheap',
      auth: 'public',
      notes: 'Points and line vertices. n default 10, max 50; radius_km max 100.',
    },
    {
      id: 'point_in_polygon',
      title: 'Point in polygon',
      description: 'Which polygon of this entity contains the origin.',
      applies_to: ['province', 'district', 'dsd', 'gnd', 'boi_zone', 'park'],
      cost: 'cheap',
      auth: 'public',
      notes:
        'District uses full rings. GND/DSD currently stamp method nearest_gnd_centroid until simplified rings exist — never call that PIP.',
    },
    {
      id: 'overlay',
      title: 'Overlay',
      description: 'Entities inside a district / DSD / GND / caller polygon. Requires method.',
      applies_to: '*',
      cost: 'cheap',
      auth: 'public',
      notes:
        'method is required: centroid_in_polygon | point_in_polygon. within.district is the English name ("Colombo"), not LK-11. Point overlay vs a district uses PIP on /data/demographics.geojson. Overlay of points vs dsd_id/gnd_id is operator_unavailable (no rings in the isolate).',
    },
    {
      id: 'gap',
      title: 'Coverage gap',
      description: 'Entities of type A not covered by type B under a stamped method.',
      applies_to: ['gnd', 'dsd'],
      cost: 'cheap',
      auth: 'public',
      notes:
        'centroid_distance: GND centroids × covering points and may be disabled on cost-capped deployments; prefer a published precomputed distance index. street_intersect (request): reads served_10min; response method is centroid_near_catchment_vertex (200 m). Null flags are unknown, not unserved. Aggregates are over the full scored set, not the truncated page. Flagship: gnd vs metro_stop, within Colombo.',
    },
    {
      id: 'isochrone',
      title: 'Walk isochrone',
      description: 'Streets reachable on foot from origin in 5 or 10 minutes (Colombo graph).',
      applies_to: ['osm_foot_graph'],
      cost: 'expensive',
      auth: 'user',
      notes:
        'Authenticated and may be disabled on cost-capped deployments. Colombo CM envelope only — origin outside the graph is origin_outside_graph, not an empty hull. Graph is cached on the isolate (not dropped per call). Dijkstra clips to origin + 1.2× walk cap. MCP/API omit street geometry over 2 MB (hull always returned). Drive/bike → operator_unavailable.',
    },
    {
      id: 'choropleth_join',
      title: 'Choropleth join',
      description: 'Admin-unit attributes at a point or inside a within clause.',
      applies_to: ['province', 'district', 'dsd', 'gnd'],
      cost: 'cheap',
      auth: 'public',
      notes: 'Requires origin xor within.',
    },
    {
      id: 'region.upsert',
      title: 'Author a region',
      description: 'Session-scoped polygon the user or agent draws. Subsequent queries pass within.region_id.',
      applies_to: ['region'],
      cost: 'cheap',
      auth: 'user',
      notes: 'Phase B. Not in the v1 query_spatial schema.',
    },
  ],
  entities: [
    ...(['lk-initiative-events', 'lk-initiative-funding'] as const).map(datasetId => indicatorEntity({
      id: datasetId.replaceAll('-', '_'), datasetId,
      title: datasetId === 'lk-initiative-events' ? 'Initiative events' : 'Initiative funding by stage',
      description: datasetId === 'lk-initiative-events'
        ? 'One real act per row (proposal, approval, contract, payment, launch, halt) with funder, instrument, origin, stage, amount in its original currency and sources. Repeated news reports are folded into one event.'
        : 'Totals per year, grouping (funder, origin, instrument, sector), money stage and original currency. Each funding line counts once per stage; tranches add; cumulative positions never add.',
      sourceIds: ['lk-initiatives-ledger'], source: 'developing-country.org money ledger (lk_news, Cabinet, ADB, IMF, World Bank)',
      vintage: 'News read from Jan 2024 (English, Sinhala, Tamil); IMF and World Bank since 2023', licence: 'CC BY 4.0 (compilation by developing-country.org); linked articles and official documents keep their publishers’ rights',
      licenceStatus: 'open', url: 'https://github.com/nuuuwan/lk_news', path: `/data/${datasetId}.json`,
      refresh: 'bun scripts/initiatives/weekly.ts (weekly: reads the week\'s news, rebuilds and opens a review PR)',
      idField: 'id', nameField: datasetId === 'lk-initiative-events' ? 'project_name' : 'group_label', partial: true,
      coverageNote: 'English, Sinhala and Tamil news from Jan 2024 (as collected by lk_news; Feb–Jun 2025 and some later weeks are thin) plus official IMF, World Bank, ADB and Cabinet records. Not a national inventory.',
      knownGaps: [
        'Sinhala and Tamil news are not read yet; English news before Aug 2026 is not read yet.',
        'lk_news collected almost nothing from Feb to Jun 2025.',
        'Events marked machine_read are extracted from news and not yet reviewed.',
        'Never sum amounts across stages, currencies or overlapping total rows.',
      ],
      tags: ['money', 'funding', 'projects', 'public-finance', 'ADB', 'IMF', 'World Bank', 'government'],
    })),
    ...URBAN_DATASETS.map(d => indicatorEntity({
      id: d.id.replaceAll('-', '_'), datasetId: d.id, title: d.title,
      description: d.description, sourceIds: d.sourceIds,
      source: dataSourceRegistry.sources.find(s => s.id === d.sourceIds[0])!.publisher,
      vintage: d.vintage, licence: 'Public government publication; reuse terms not specified',
      licenceStatus: 'permission_unclear',
      url: dataSourceRegistry.sources.find(s => s.id === d.sourceIds[0])!.url,
      path: `/data/${d.id}.json`, refresh: 'bun scripts/build-urban-data.mjs --fetch',
      idField: 'record_id', nameField: 'record_id', partial: true,
      coverageNote: d.note.contains, knownGaps: [d.note.limit],
      tags: [...d.themeIds, 'indicator'],
    })),
    ...RECOVERY_DATASETS.map(d => indicatorEntity({
      id: d.id.replaceAll('-', '_'), datasetId: d.id, title: d.title,
      description: d.description, sourceIds: d.sourceIds,
      source: d.id.startsWith('worldbank-') ? 'World Bank' : d.id.startsWith('child-') ? 'Family Health Bureau, Sri Lanka' : 'Department of Census and Statistics, Sri Lanka',
      vintage: d.vintage, licence: 'Publicly accessible publication; reuse terms require review',
      licenceStatus: 'permission_unclear',
      url: dataSourceRegistry.sources.find(s => s.id === d.sourceIds[0])!.url,
      path: `/data/${d.id}.json`, refresh: d.id.startsWith('worldbank-') ? 'bun scripts/build-sldu.mjs' : 'bun scripts/build-recovery-data.mjs',
      idField: 'record_id', nameField: 'record_id', partial: true,
      coverageNote: d.note.contains, knownGaps: [d.note.limit],
      tags: [...d.themeIds, 'historical', 'indicator'],
    })),
    ...TREASURY_TABLES.map(d => indicatorEntity({
      id: d.id.replaceAll('-', '_'), datasetId: d.id, title: d.title,
      description: d.description, sourceIds: [d.source], source: 'Ministry of Finance, Sri Lanka',
      vintage: d.vintage, licence: 'Public government publication; reuse terms not specified',
      licenceStatus: 'permission_unclear', url: d.url, path: `/data/${d.id}.json`,
      refresh: `bun scripts/build-treasury.mjs --source ${d.source}`,
      idField: 'record_id', nameField: 'label', partial: true,
      coverageNote: 'Selected reviewed numeric rows; not a complete publication or historical archive.',
      knownGaps: [d.caveat, 'Coverage is specific to each dataset; other publication tables and annex histories are not implied.'],
      tags: ['treasury', 'public-finance', 'indicator'],
    })),
    {
      id: 'province',
      source_ids: ['lk-census-2012', 'lk-census-2024'],
      dataset_ids: ['demographics'],
      title: 'Province',
      description: 'Nine provinces. Coarse choropleth grain.',
      geometry: 'polygon',
      admin_level: 'province',
      id_field: 'id',
      name_field: 'name',
      operators: ['point_in_polygon', 'overlay', 'choropleth_join'],
      related: [
        { id: 'district', rel: 'contains' },
        { id: 'gnd', rel: 'contains' },
      ],
      completeness: CENSUS_PARTIAL,
      provenance: GIG,
      searchable: false,
      storage: { kind: 'pmtiles', file: 'demographics.pmtiles', sourceLayer: 'province' },
      tags: ['admin', 'population'],
    },
    {
      id: 'district',
      source_ids: ['lk-census-2012', 'lk-census-2024'],
      dataset_ids: ['demographics'],
      title: 'District',
      description:
        '25 districts. analyze_location does point-in-polygon on /data/demographics.geojson. within.district takes the English name (e.g. "Colombo"), not the LK- code.',
      geometry: 'polygon',
      admin_level: 'district',
      id_field: 'id',
      name_field: 'name',
      operators: ['point_in_polygon', 'overlay', 'choropleth_join', 'bbox'],
      related: [
        { id: 'province', rel: 'contained_in' },
        { id: 'dsd', rel: 'contains' },
        { id: 'gnd', rel: 'contains' },
      ],
      completeness: CENSUS_PARTIAL,
      provenance: GIG,
      catalog_id: 'demographics',
      searchable: false,
      storage: { kind: 'geojson', path: '/data/demographics.geojson' },
      tags: ['admin', 'population'],
    },
    {
      id: 'dsd',
      source_ids: ['lk-census-2012', 'lk-census-2024'],
      dataset_ids: ['demographics'],
      title: 'Divisional Secretariat',
      description: 'DS divisions (~331) — town / suburb grain.',
      geometry: 'polygon',
      admin_level: 'dsd',
      id_field: 'id',
      name_field: 'name',
      operators: ['point_in_polygon', 'overlay', 'choropleth_join', 'gap'],
      related: [
        { id: 'district', rel: 'contained_in' },
        { id: 'gnd', rel: 'contains' },
      ],
      completeness: CENSUS_PARTIAL,
      provenance: GIG,
      searchable: false,
      storage: { kind: 'pmtiles', file: 'demographics.pmtiles', sourceLayer: 'dsd' },
      tags: ['admin', 'population'],
    },
    {
      id: 'gnd',
      source_ids: ['lk-census-2012', 'lk-census-2024'],
      dataset_ids: ['demographics'],
      title: 'Grama Niladhari division',
      description:
        'Sri Lanka\'s civic atom (~14,000). Population overlay/gap uses /data/gnd-index.json (Census 2024 Person-Sex, nearest centroid — not PIP). Highlight on the map requires properties.id on the tiles.',
      geometry: 'polygon',
      admin_level: 'gnd',
      id_field: 'id',
      name_field: 'name',
      operators: ['point_in_polygon', 'overlay', 'gap', 'choropleth_join'],
      related: [
        { id: 'dsd', rel: 'contained_in' },
        { id: 'district', rel: 'contained_in' },
        { id: 'metro_stop', rel: 'served_by', note: 'gap centroid_distance threshold_m 800 ≈ 10 min walk; street_intersect is the 200 m served_10min flag' },
        { id: 'school', rel: 'nearest' },
        { id: 'hospital', rel: 'nearest' },
      ],
      completeness: CENSUS_PARTIAL,
      provenance: GIG,
      searchable: false,
      storage: { kind: 'index', path: '/data/gnd-index.json' },
      tags: ['admin', 'population', 'civic'],
    },
    {
      id: 'metro_line',
      source_ids: ['lk-metro'],
      title: 'Colombo Metro Bus line',
      description: 'The seven Lanka Metro Transit CM lines (CM01–CM08). Corridors are OSRM-snapped; stops and distances are surveyed.',
      geometry: 'line',
      id_field: 'code',
      name_field: 'name',
      operators: ['bbox', 'nearest'],
      related: [
        { id: 'metro_stop', rel: 'contains' },
        { id: 'metro_catchment', rel: 'derived_from' },
        { id: 'gnd', rel: 'serves' },
      ],
      completeness: {
        status: 'complete',
        coverage: 1,
        coverage_note: 'Seven official CM lines as compiled by nuuuwan/lk_metro.',
        known_gaps: ['LMT has not published official polylines; drawn corridors are OSRM approximations'],
      },
      provenance: {
        source: 'Lanka Metro Transit via nuuuwan/lk_metro',
        vintage: '2026-08',
        licence: 'MIT (lk_metro) · ODbL (OSRM geometry)',
        refresh: 'bun run fetch:metro',
        url: 'https://github.com/nuuuwan/lk_metro',
      },
      layer_id: 'metro',
      catalog_id: 'metro',
      searchable: true,
      storage: { kind: 'geojson', path: '/data/metro.geojson' },
      tags: ['transit', 'colombo'],
    },
    {
      id: 'metro_stop',
      source_ids: ['lk-metro'],
      title: 'Colombo Metro Bus stop',
      description:
        '110 surveyed CM stops (name + road). searchable: yes. Use gap against gnd to ask whether buses serve the dense GNDs (Kotahena, Mattakkuliya, …).',
      geometry: 'point',
      id_field: 'name',
      name_field: 'name',
      operators: ['bbox', 'nearest', 'overlay'],
      related: [
        { id: 'metro_line', rel: 'contained_in' },
        { id: 'metro_catchment', rel: 'derived_from' },
        { id: 'gnd', rel: 'serves' },
      ],
      completeness: {
        status: 'complete',
        coverage: 1,
        coverage_note: '110 surveyed stops from nuuuwan/lk_metro.',
        known_gaps: [],
      },
      provenance: {
        source: 'Lanka Metro Transit via nuuuwan/lk_metro',
        vintage: '2026-08',
        licence: 'MIT (lk_metro)',
        refresh: 'bun run fetch:metro',
        url: 'https://github.com/nuuuwan/lk_metro',
      },
      layer_id: 'metro',
      catalog_id: 'metro_stop',
      searchable: true,
      storage: { kind: 'geojson', path: '/data/metro.geojson' },
      tags: ['transit', 'colombo'],
    },
    {
      id: 'metro_catchment',
      source_ids: ['lk-metro', 'osm-walk-colombo'],
      title: 'Metro walk coverage',
      description:
        'Precomputed 5/10 min walk streets from each CM stop (Dijkstra over OSM foot ways). 11 MB — never name-scan or load in analyze.',
      geometry: 'line',
      id_field: 'stop',
      name_field: 'stop',
      operators: [],
      related: [
        { id: 'metro_stop', rel: 'derived_from' },
        { id: 'osm_foot_graph', rel: 'derived_from' },
      ],
      completeness: {
        status: 'derived',
        coverage: 1,
        coverage_note: 'Streets, not blobs. 5 min ≈ 400 m, 10 min ≈ 800 m at 80 m/min.',
        known_gaps: ['Last-mile 3 km rings are geodesic estimates'],
      },
      provenance: {
        source: 'OpenStreetMap walking network — walkshed computed by developing-country.org',
        vintage: '2026-10',
        licence: 'ODbL',
        refresh: 'bun run build:metro-catchment',
        url: 'https://www.openstreetmap.org/',
      },
      layer_id: 'metro_catchment',
      catalog_id: 'metro_catchment',
      searchable: false,
      storage: { kind: 'geojson', path: '/data/metro_catchment.geojson' },
      tags: ['transit', 'derived'],
    },
    {
      id: 'metro_walkshed',
      source_ids: METRO_COVERAGE_SOURCE_IDS,
      dataset_ids: ['metro_walksheds'],
      title: 'Metro walksheds and 800 m circles',
      description:
        '5- and 10-min network walksheds (reached streets buffered 50 m, unioned) and 800 m straight-line circles, per CM stop, per line and for the whole network. Properties: kind (stop|line|network), id (stop_id slug, line code or ALL), name, routes, color, minutes (5|10), method (network|circle_800m), area_km2, pop_est, schools, hospitals, offices. 2.6 MB — not name-scanned; use bbox with include_geometry + where (e.g. kind, method, minutes) to map it.',
      geometry: 'polygon',
      id_field: 'id',
      name_field: 'name',
      operators: ['point_in_polygon', 'bbox'],
      related: [
        { id: 'metro_stop', rel: 'derived_from' },
        { id: 'metro_line', rel: 'derived_from' },
        { id: 'workplace', rel: 'serves', note: 'offices = Overture office listings within the walk' },
        { id: 'osm_foot_graph', rel: 'derived_from' },
        { id: 'gnd', rel: 'serves', note: 'pop_est = Σ GND pop × area share (uniform density)' },
        { id: 'metro_catchment', rel: 'same_as', note: 'same walking rules; catchment draws streets, walkshed draws areas' },
      ],
      completeness: METRO_COVERAGE_COMPLETENESS,
      provenance: METRO_COVERAGE_PROVENANCE,
      layer_id: 'metro_walksheds',
      catalog_id: 'metro_walksheds',
      searchable: false,
      storage: { kind: 'geojson', path: '/data/metro_walksheds.geojson' },
      tags: ['transit', 'colombo', 'derived'],
    },
    ...METRO_COVERAGE_DATASETS.map((d): EntityType => ({
      ...indicatorEntity({
        id: d.id.replaceAll('-', '_'), datasetId: d.id, title: d.title,
        description: d.description, sourceIds: d.sourceIds,
        source: METRO_COVERAGE_PROVENANCE.source, vintage: d.vintage,
        licence: METRO_COVERAGE_PROVENANCE.licence, licenceStatus: 'permission_unclear',
        url: METRO_COVERAGE_PROVENANCE.url!, path: `/data/${d.id}.json`,
        refresh: METRO_COVERAGE_PROVENANCE.refresh,
        ...METRO_COVERAGE_KEYS[d.id]!,
        coverageNote: d.note.contains,
        tags: [...d.themeIds, 'transit', 'colombo', 'derived', 'indicator'],
      }),
      related: [
        { id: 'metro_walkshed', rel: 'derived_from' },
        { id: 'metro_stop', rel: 'derived_from' },
        { id: 'gnd', rel: 'derived_from' },
      ],
      completeness: METRO_COVERAGE_COMPLETENESS,
    })),
    ...METRO_ALTERNATIVES_DATASETS.map((d): EntityType => ({
      ...indicatorEntity({
        id: d.id.replaceAll('-', '_'), datasetId: d.id, title: d.title,
        description: d.description, sourceIds: d.sourceIds,
        source: METRO_ALTERNATIVES_PROVENANCE.source, vintage: d.vintage,
        licence: METRO_ALTERNATIVES_PROVENANCE.licence, licenceStatus: 'permission_unclear',
        url: METRO_ALTERNATIVES_PROVENANCE.url!, path: `/data/${d.id}.json`,
        refresh: METRO_ALTERNATIVES_PROVENANCE.refresh,
        ...METRO_COVERAGE_KEYS[d.id]!,
        coverageNote: d.note.contains,
        tags: [...d.themeIds, 'transit', 'colombo', 'derived', 'indicator'],
      }),
      related: [
        { id: 'metro_walkshed', rel: 'derived_from' },
        { id: 'metro_stop', rel: 'derived_from' },
        { id: 'gnd', rel: 'derived_from' },
      ],
      completeness: METRO_ALTERNATIVES_COMPLETENESS,
    })),
    {
      id: 'metro_gap_cluster',
      source_ids: METRO_COVERAGE_SOURCE_IDS,
      dataset_ids: ['metro-gap-clusters'],
      title: 'Metro Bus gap clusters (outlines)',
      description:
        'Dissolved outlines of the dense GN-division clusters beyond a 10-min walk of any CM stop (same ids and properties as the metro-gap-clusters table: id = cluster_id, name, tier, residents, unserved_residents, offices_beyond_10min, nearest_stop, label_lng/label_lat …). Use bbox with include_geometry to return polygons.',
      geometry: 'polygon',
      id_field: 'id',
      name_field: 'name',
      operators: ['bbox', 'point_in_polygon'],
      related: [
        { id: 'metro_gap_clusters', rel: 'same_as', note: 'Indicator Table with the same ids' },
        { id: 'gnd', rel: 'contains' },
        { id: 'metro_walkshed', rel: 'derived_from' },
      ],
      completeness: METRO_ALTERNATIVES_COMPLETENESS,
      provenance: METRO_ALTERNATIVES_PROVENANCE,
      layer_id: 'metro-gap-clusters',
      catalog_id: 'metro_gap_cluster_outlines',
      searchable: false,
      storage: { kind: 'geojson', path: '/data/metro-gap-clusters.geojson' },
      tags: ['transit', 'colombo', 'derived'],
    },
    {
      id: 'metro_route_candidate',
      source_ids: METRO_COVERAGE_SOURCE_IDS,
      dataset_ids: ['metro-route-candidates'],
      title: 'Illustrative Metro Bus route candidates (lines and stops)',
      description:
        'Rule-generated candidate links/extensions as LineStrings (part=route, same properties as the metro-route-candidates table: id = candidate_id, name, kind, color, new_pop_10min …) plus their proposed stops (part=stop, candidate_id). Illustrative, not recommendations. Use bbox with include_geometry and where {part: "route"} for the lines.',
      geometry: 'line',
      id_field: 'id',
      name_field: 'name',
      operators: ['bbox'],
      related: [
        { id: 'metro_route_candidates', rel: 'same_as', note: 'Indicator Table with the same ids' },
        { id: 'metro_gap_cluster', rel: 'serves' },
        { id: 'metro_stop', rel: 'derived_from' },
      ],
      completeness: METRO_ALTERNATIVES_COMPLETENESS,
      provenance: METRO_ALTERNATIVES_PROVENANCE,
      layer_id: 'metro-route-candidates',
      catalog_id: 'metro_route_candidate_lines',
      searchable: false,
      storage: { kind: 'geojson', path: '/data/metro-route-candidates.geojson' },
      tags: ['transit', 'colombo', 'derived'],
    },
    {
      id: 'osm_foot_graph',
      source_ids: ['osm-walk-colombo'],
      title: 'Colombo walk graph',
      description: 'Request-time walk isochrone substrate. One R2 object, Colombo envelope. Not a map layer.',
      geometry: 'network',
      id_field: 'id',
      name_field: 'id',
      operators: ['isochrone'],
      related: [
        { id: 'metro_catchment', rel: 'same_as', note: 'same algorithm; catchment is precomputed per stop' },
      ],
      completeness: {
        status: 'partial',
        coverage: null,
        coverage_note: 'Colombo CM envelope + 3 km only. Island-wide / drive / bike wait.',
        known_gaps: ['Outside Colombo', 'Drive and bike modes'],
      },
      provenance: {
        source: 'OpenStreetMap foot ways',
        vintage: '2026',
        licence: 'ODbL',
        refresh: 'bun run build:walk-graph',
      },
      searchable: false,
      storage: { kind: 'r2', key: 'graphs/walk/colombo.json' },
      tags: ['network'],
    },
    {
      id: 'expressway',
      source_ids: ['osm', 'rda'],
      title: 'Highways & projected expressways',
      description: 'E-class motorways open / under construction / proposed, plus curated corridors OSM lacks.',
      geometry: 'line',
      id_field: 'ref',
      name_field: 'name',
      operators: ['bbox', 'nearest'],
      related: [{ id: 'development', rel: 'nearest' }],
      completeness: {
        status: 'partial',
        coverage: null,
        coverage_note: 'OSM live network plus curated proposed corridors (Kandy Link, Ruwanpura).',
        known_gaps: ['Some proposed interchanges still missing'],
      },
      provenance: {
        source: 'OpenStreetMap + Road Development Authority',
        vintage: '2026',
        licence: 'ODbL (OSM) + public planning docs',
        refresh: 'bun run fetch:expressways',
        url: 'https://www.openstreetmap.org/',
      },
      layer_id: 'expressways',
      catalog_id: 'expressways',
      searchable: true,
      storage: { kind: 'geojson', path: '/data/expressways.geojson' },
    },
    {
      id: 'road',
      source_ids: ['osm'],
      title: 'Roads by tier',
      description: 'Expressway / A / B / C / Other. Vector tiles; not name-searchable.',
      geometry: 'line',
      id_field: 'id',
      name_field: 'name',
      operators: [],
      related: [{ id: 'expressway', rel: 'contains' }],
      completeness: {
        status: 'partial',
        coverage: null,
        coverage_note: 'OSM extract tiled by the offline pipeline.',
        known_gaps: ['Width often estimated'],
      },
      provenance: {
        source: 'OpenStreetMap',
        vintage: '2026',
        licence: 'ODbL',
        refresh: 'bun run data',
      },
      layer_id: 'roads',
      catalog_id: 'roads',
      searchable: false,
      storage: { kind: 'pmtiles', file: 'roads.pmtiles', sourceLayer: 'roads' },
    },
    {
      id: 'water',
      source_ids: ['osm'],
      title: 'Water bodies',
      description: 'Rivers, canals, reservoirs/tanks (wewa), lagoons.',
      geometry: 'polygon',
      id_field: 'id',
      name_field: 'name',
      operators: [],
      related: [],
      completeness: {
        status: 'partial',
        coverage: null,
        coverage_note: 'OSM water tiled by the offline pipeline.',
        known_gaps: [],
      },
      provenance: {
        source: 'OpenStreetMap',
        vintage: '2026',
        licence: 'ODbL',
        refresh: 'bun run data',
      },
      layer_id: 'water',
      catalog_id: 'water',
      searchable: false,
      storage: { kind: 'pmtiles', file: 'water.pmtiles', sourceLayer: 'water' },
    },
    {
      id: 'development',
      source_ids: ['kdp-2025', 'cpcec', 'rda', 'slpa', 'aasl', 'mot', 'moe', 'irrigation', 'boi'],
      title: 'Planned developments',
      description: 'National megaprojects, UDA plan sites, Port City — status, budget where public, source PDFs.',
      geometry: 'point',
      id_field: 'id',
      name_field: 'name',
      operators: ['bbox', 'nearest', 'overlay'],
      related: [
        { id: 'gnd', rel: 'contained_in' },
        { id: 'expressway', rel: 'nearest' },
      ],
      completeness: {
        status: 'partial',
        coverage: null,
        coverage_note: 'Curated from gazettes, EIAs, ministry announcements. Not a complete capital-budget extract.',
        known_gaps: ['Many gazetted projects have no geometry yet'],
      },
      provenance: {
        source: 'UDA / RDA / CPCEC / ministries (compiled)',
        vintage: '2025–2035',
        licence: 'public planning documents',
        refresh: 'bun run build:developments',
        url: 'https://www.uda.gov.lk/',
      },
      layer_id: 'developments',
      catalog_id: 'developments',
      searchable: true,
      storage: { kind: 'geojson', path: '/data/developments.geojson' },
    },
    {
      id: 'boi_zone',
      source_ids: ['boi'],
      title: 'BOI economic zones',
      description: 'Board of Investment Export Processing Zones & Industrial Parks. Boundaries indicative.',
      geometry: 'polygon',
      id_field: 'id',
      name_field: 'name',
      operators: ['bbox', 'nearest', 'point_in_polygon', 'overlay'],
      related: [{ id: 'development', rel: 'same_as' }],
      completeness: {
        status: 'partial',
        coverage: null,
        coverage_note: '15 zones; hand-placed to published extent.',
        known_gaps: ['Boundaries are indicative, not cadastral'],
      },
      provenance: {
        source: 'Board of Investment of Sri Lanka',
        vintage: '2026',
        licence: 'curated from public BOI materials',
        refresh: 'bun run build:boi',
        url: 'https://investsrilanka.com/',
      },
      layer_id: 'boi-zones',
      catalog_id: 'boi-zones',
      searchable: true,
      storage: { kind: 'geojson', path: '/data/boi-zones.geojson' },
    },
    {
      id: 'sea_route',
      source_ids: ['sea-routes', 'osm'],
      title: 'Sea routes',
      description: 'Colombo container lanes (marnet) plus OSM ferries. Trunk geometry is not name-scanned.',
      geometry: 'line',
      id_field: 'id',
      name_field: 'name',
      operators: ['bbox', 'nearest'],
      related: [],
      completeness: {
        status: 'partial',
        coverage: null,
        coverage_note: 'Not AIS/vessel-track data. Ferries from OSM route=ferry.',
        known_gaps: ['No live vessel positions'],
      },
      provenance: {
        source: 'Eurostat marnet (searoute) · OpenStreetMap',
        vintage: '2026',
        licence: 'marnet + ODbL',
        refresh: 'bun run build:sea-routes',
        url: 'https://github.com/eurostat/searoute',
      },
      layer_id: 'sea-routes',
      catalog_id: 'sea-routes',
      searchable: false,
      storage: { kind: 'geojson', path: '/data/sea-routes.geojson' },
    },
    {
      id: 'hillshade',
      source_ids: ['aws-terrain'],
      title: 'Terrain / elevation',
      description: 'SRTM shaded relief + 3D terrain toggle.',
      geometry: 'raster',
      id_field: 'id',
      name_field: 'name',
      operators: [],
      related: [],
      completeness: {
        status: 'complete',
        coverage: 1,
        coverage_note: 'NASA SRTM via AWS Terrain Tiles.',
        known_gaps: [],
      },
      provenance: {
        source: 'NASA SRTM (AWS Terrain Tiles)',
        vintage: 'SRTM 2000',
        licence: 'public domain',
        refresh: 'bun run data',
      },
      layer_id: 'hillshade',
      catalog_id: 'terrain',
      searchable: false,
      storage: { kind: 'pmtiles', file: 'terrain.pmtiles', sourceLayer: 'hillshade' },
    },
    {
      id: 'climate',
      source_ids: ['worldclim'],
      title: 'Climate normals',
      description: 'WorldClim rainfall / temperature / humidity, annual + 12 months. Not a LAYER_GROUPS entry — panel exception.',
      geometry: 'raster',
      id_field: 'id',
      name_field: 'name',
      operators: [],
      related: [],
      completeness: {
        status: 'complete',
        coverage: 1,
        coverage_note: '1970–2000 normals. Not a forecast.',
        known_gaps: ['No annual-range / dry-month-count summary on click yet'],
      },
      provenance: {
        source: 'WorldClim 2.1',
        vintage: '1970–2000 normals',
        licence: 'CC-BY 4.0',
        refresh: 'bun run data',
        url: 'https://www.worldclim.org/',
      },
      catalog_id: 'climate',
      searchable: false,
      storage: { kind: 'pmtiles', file: 'climate.pmtiles', sourceLayer: 'climate' },
      tags: ['rainfall', 'temperature', 'humidity'],
    },
    {
      id: 'sun',
      source_ids: ['suncalc'],
      title: 'Sun & shadow',
      description: 'On-device sun geometry (SunCalc). Not a dataset.',
      geometry: 'point',
      id_field: 'id',
      name_field: 'name',
      operators: [],
      related: [],
      completeness: {
        status: 'complete',
        coverage: 1,
        coverage_note: 'Astronomical, not weather. Computed in the browser.',
        known_gaps: [],
      },
      provenance: {
        source: 'SunCalc (on-device)',
        vintage: 'live',
        licence: 'BSD-2-Clause',
        refresh: 'none — computed',
        url: 'https://github.com/mourner/suncalc',
      },
      searchable: false,
      storage: { kind: 'none' },
    },
    {
      id: 'attraction',
      source_ids: ['osm'],
      title: 'Tourist attractions',
      description: 'Temples, forts, museums, beaches, viewpoints from OSM.',
      geometry: 'point',
      id_field: 'osm_id',
      name_field: 'name',
      operators: ['bbox', 'nearest', 'overlay'],
      related: [{ id: 'park', rel: 'nearest' }],
      completeness: {
        status: 'osm_only',
        coverage: null,
        coverage_note: 'OSM tourism extract — not a Tourist Board register.',
        known_gaps: ['Tourist Board GIS not ingested'],
      },
      provenance: { ...OSM, refresh: 'bun run fetch:explore (attractions)' },
      layer_id: 'attractions',
      catalog_id: 'attractions',
      searchable: true,
      storage: { kind: 'geojson', path: '/data/attractions.geojson' },
    },
    {
      id: 'waterfall',
      source_ids: ['osm'],
      title: 'Waterfalls',
      description: 'OSM waterfalls.',
      geometry: 'point',
      id_field: 'osm_id',
      name_field: 'name',
      operators: ['bbox', 'nearest'],
      related: [{ id: 'trail', rel: 'nearest' }],
      completeness: {
        status: 'osm_only',
        coverage: null,
        coverage_note: 'OSM extract.',
        known_gaps: [],
      },
      provenance: { ...OSM, refresh: 'bun run fetch:explore (waterfalls)' },
      layer_id: 'waterfalls',
      catalog_id: 'waterfalls',
      searchable: true,
      storage: { kind: 'geojson', path: '/data/waterfalls.geojson' },
    },
    {
      id: 'river_gauge',
      source_ids: ['lk-irrigation-hydrology-stations'],
      dataset_ids: ['irrigation-gauges'],
      title: 'River gauges',
      description: 'Irrigation Department hydrology stations with published alert, minor-flood and major-flood levels.',
      geometry: 'point',
      id_field: 'id',
      name_field: 'name',
      operators: ['bbox', 'nearest'],
      related: [{ id: 'water', rel: 'nearest' }],
      completeness: {
        status: 'partial',
        coverage: 40 / 42,
        coverage_note: 'Forty compiled stations. The Irrigation Department describes 42 permanent gauging stations; live water levels are not in this extract.',
        known_gaps: [
          'Live water levels are not wired.',
          'This is not a flood-hazard zonation map.',
          'Two permanent gauges described by the department are not in the compiled station list.',
        ],
      },
      provenance: {
        source: 'Irrigation Department of Sri Lanka via nuuuwan/lk_irrigation',
        vintage: '2026-09',
        licence: 'MIT compiler (lk_irrigation); government hydrology figures, reuse permission not explicitly stated',
        licence_status: 'permission_unclear',
        refresh: 'bun scripts/fetch-irrigation-gauges.mjs',
        url: 'https://www.irrigation.gov.lk/web/index.php?option=com_content&view=article&id=27&Itemid=128&lang=en',
      },
      layer_id: 'irrigation-gauges',
      catalog_id: 'irrigation-gauges',
      searchable: true,
      storage: { kind: 'geojson', path: '/data/irrigation-gauges.geojson' },
    },
    {
      id: 'trail',
      source_ids: ['osm'],
      title: 'Nature trails & hikes',
      description: 'OSM route=hiking relations (Pekoe Trail, Knuckles, …).',
      geometry: 'line',
      id_field: 'osm_id',
      name_field: 'name',
      operators: ['bbox', 'nearest'],
      related: [{ id: 'park', rel: 'contained_in' }],
      completeness: {
        status: 'osm_only',
        coverage: null,
        coverage_note: 'OSM hiking relations.',
        known_gaps: [],
      },
      provenance: { ...OSM, refresh: 'bun run fetch:explore (trails)' },
      layer_id: 'trails',
      catalog_id: 'trails',
      searchable: true,
      storage: { kind: 'geojson', path: '/data/trails.geojson' },
    },
    {
      id: 'cycling',
      source_ids: ['osm'],
      title: 'Biking trails',
      description: 'OSM route=bicycle.',
      geometry: 'line',
      id_field: 'osm_id',
      name_field: 'name',
      operators: ['bbox', 'nearest'],
      related: [{ id: 'trail', rel: 'same_as' }],
      completeness: {
        status: 'osm_only',
        coverage: null,
        coverage_note: 'OSM bicycle routes.',
        known_gaps: [],
      },
      provenance: { ...OSM, refresh: 'bun run fetch:explore (cycling)' },
      layer_id: 'cycling',
      catalog_id: 'cycling',
      searchable: true,
      storage: { kind: 'geojson', path: '/data/cycling.geojson' },
    },
    {
      id: 'park',
      source_ids: ['osm'],
      title: 'National parks & forest reserves',
      description: 'OSM protected areas.',
      geometry: 'polygon',
      id_field: 'osm_id',
      name_field: 'name',
      operators: ['bbox', 'nearest', 'point_in_polygon', 'overlay'],
      related: [{ id: 'attraction', rel: 'contains' }],
      completeness: {
        status: 'osm_only',
        coverage: null,
        coverage_note: 'OSM protected areas — not the DWC gazetteer.',
        known_gaps: ['DWC official GIS not ingested'],
      },
      provenance: { ...OSM, refresh: 'bun run fetch:explore (parks)' },
      layer_id: 'parks',
      catalog_id: 'parks',
      searchable: true,
      storage: { kind: 'geojson', path: '/data/parks.geojson' },
    },
    {
      id: 'stepper',
      source_ids: ['stepper'],
      title: 'Stepper curated spots',
      description: 'Creator layer — steppermap.com spots with permission, live proxy.',
      geometry: 'point',
      id_field: 'id',
      name_field: 'name',
      operators: ['bbox', 'nearest'],
      related: [{ id: 'waterfall', rel: 'same_as' }],
      completeness: {
        status: 'partial',
        coverage: null,
        coverage_note: 'Live adapter; content © @Stepper9210.',
        known_gaps: [],
      },
      provenance: {
        source: 'steppermap.com by @Stepper9210',
        vintage: 'live',
        licence: 'shared with permission — © @Stepper9210',
        refresh: 'live proxy GET /api/stepper (cached ~6h)',
        url: 'https://steppermap.com/',
      },
      layer_id: 'stepper',
      catalog_id: 'stepper',
      searchable: false,
      storage: { kind: 'adapter', endpoint: '/api/stepper' },
    },
    {
      id: 'school',
      source_ids: ['osm'],
      title: 'Schools',
      description:
        'Named OSM schools, colleges, universities and kindergartens. Official MoE GIS is not ingested — this extract is osm_only, not an MoE register.',
      geometry: 'point',
      id_field: 'osm_id',
      name_field: 'name',
      operators: ['bbox', 'nearest', 'overlay'],
      related: [
        { id: 'silent_zone', rel: 'regulates', note: 'Gazette 924/12: 100 m facility class includes schools' },
        { id: 'gnd', rel: 'contained_in' },
      ],
      completeness: {
        status: 'osm_only',
        coverage: null,
        coverage_note:
          'OSM amenity=school|college|university|kindergarten (named). Not a Ministry of Education register. Do not treat as MoE-complete.',
        known_gaps: ['MoE official GIS not ingested', 'unnamed OSM schools omitted'],
      },
      provenance: {
        ...OSM,
        vintage: '2026-10',
        refresh: 'bun run fetch:civic (schools)',
      },
      layer_id: 'schools',
      catalog_id: 'schools',
      searchable: true,
      storage: { kind: 'geojson', path: '/data/schools.geojson' },
      tags: ['civic', 'education'],
    },
    {
      id: 'workplace',
      source_ids: ['overture-places'],
      dataset_ids: ['workplaces'],
      title: 'Offices (Overture Maps)',
      description:
        'Office listings in the Colombo Metro Bus study area (lng 79.82–80.06, lat 6.62–7.12) from Overture Maps Places release 2026-09-23.1. Properties: id (overture/<gers id>), name, kind=office, office_type (corporate|government|financial|professional|real_estate|media|design|logistics), category (Overture basic_category), confidence. Classification: basic_category corporate_or_business_office, government_office, financial_service, bank_or_credit_union, professional_service, real_estate_service, media_service, design_service or b2b_transportation_and_storage_service, or taxonomy.hierarchy containing corporate_or_business_office or professional_service; confidence ≥ 0.5; operating_status not closed; every source licence CDLA-Permissive-2.0, Apache-2.0 or CC0.',
      geometry: 'point',
      id_field: 'id',
      name_field: 'name',
      operators: ['bbox', 'nearest'],
      related: [
        { id: 'metro_stop', rel: 'nearest', note: 'walk to nearest stop in metro-coverage-facilities (kind=office)' },
        { id: 'gnd', rel: 'contained_in' },
      ],
      completeness: {
        status: 'partial',
        coverage: null,
        coverage_note:
          '4,057 office listings in the study bbox (3,650 inside the 568 study-area GN divisions) after dropping listings with confidence < 0.5 (40% of all places), closed listings and non-open source licences. Other businesses (27,918) are counted in the metro coverage tables but not drawn.',
        known_gaps: [
          'Listings, not employment counts: no headcount or floor area',
          'Coverage is uneven (aggregated from web and app sources) and confidence-filtered; government and small offices may be missing or duplicated',
          'Colombo study area only, not island-wide',
          'Pinned to Overture release 2026-09-23.1; refresh is a manual release bump',
        ],
      },
      provenance: {
        source: 'Overture Maps Foundation — Places',
        vintage: '2026-09-23.1',
        licence: 'CDLA-Permissive-2.0',
        licence_status: 'open',
        refresh: 'uvx --with duckdb python -I scripts/fetch-overture-places.py && bun scripts/build-workplaces.mjs',
        url: 'https://docs.overturemaps.org/guides/places/',
      },
      layer_id: 'workplaces',
      catalog_id: 'workplaces',
      searchable: true,
      storage: { kind: 'geojson', path: '/data/workplaces.geojson' },
      tags: ['economy', 'employment', 'colombo'],
    },
    {
      id: 'hospital',
      source_ids: ['osm'],
      title: 'Hospitals',
      description:
        'Named OSM hospitals and clinics. Official MoH GIS is not ingested — this extract is osm_only, not a complete facility register. OSM clinics are not the MoH clinic_moh class.',
      geometry: 'point',
      id_field: 'osm_id',
      name_field: 'name',
      operators: ['bbox', 'nearest', 'overlay'],
      related: [
        { id: 'silent_zone', rel: 'regulates' },
        { id: 'clinic_moh', rel: 'same_as' },
        { id: 'gnd', rel: 'contained_in' },
      ],
      completeness: {
        status: 'osm_only',
        coverage: null,
        coverage_note:
          'OSM amenity=hospital|clinic (named). Not a Ministry of Health register. OSM clinics ≠ MoH clinic_moh.',
        known_gaps: ['MoH official GIS not ingested', 'OSM clinics are not the MoH clinic class'],
      },
      provenance: {
        ...OSM,
        vintage: '2026-10',
        refresh: 'bun run fetch:civic (hospitals)',
      },
      layer_id: 'hospitals',
      catalog_id: 'hospitals',
      searchable: true,
      storage: { kind: 'geojson', path: '/data/hospitals.geojson' },
      tags: ['civic', 'health'],
    },
    {
      id: 'clinic_moh',
      source_ids: ['moh-register'],
      title: 'MoH clinics',
      description: 'Official Ministry of Health clinic register. No GIS ingested.',
      geometry: 'point',
      id_field: 'id',
      name_field: 'name',
      operators: [],
      related: [{ id: 'hospital', rel: 'same_as' }],
      completeness: KNOWN_ABSENT('No MoH clinic GIS. Do not substitute OSM hospitals as this class.', [
        'MoH facility GIS',
      ]),
      provenance: {
        source: 'Ministry of Health (not ingested)',
        vintage: 'none',
        licence: 'unknown',
        refresh: 'blocked — no published GIS',
      },
      searchable: false,
      storage: { kind: 'none' },
      tags: ['civic', 'health'],
    },
    {
      id: 'courthouse',
      source_ids: ['jsc-register'],
      title: 'Courthouses',
      description: 'Courts of law. OSM is sparse; no Judicial Service Commission GIS.',
      geometry: 'point',
      id_field: 'osm_id',
      name_field: 'name',
      operators: ['bbox', 'nearest'],
      related: [{ id: 'silent_zone', rel: 'regulates' }],
      completeness: KNOWN_ABSENT('No court GIS. OSM amenity=courthouse is incomplete and not shipped.', [
        'JSC official locations',
        'OSM courthouse extract not shipped',
      ]),
      provenance: {
        source: 'none',
        vintage: 'none',
        licence: 'none',
        refresh: 'blocked — no national GIS',
      },
      searchable: false,
      storage: { kind: 'none' },
      tags: ['civic', 'justice'],
    },
    {
      id: 'silent_zone',
      source_ids: ['cea-noise'],
      title: 'Silent zones',
      description:
        'National Environmental (Noise Control) Regulations No. 1 of 1996, Gazette 924/12: an area within 100 metres of a courthouse, hospital, school, place of worship, public library, zoo, and areas marked for recreation or environment. 50 dB day / 45 dB night. We have the legal class, not the polygons. Do not invent buffers and call them law.',
      geometry: 'polygon',
      id_field: 'id',
      name_field: 'name',
      operators: [],
      related: [
        { id: 'noise_ordinance', rel: 'derived_from' },
        { id: 'school', rel: 'regulates' },
        { id: 'hospital', rel: 'regulates' },
        { id: 'courthouse', rel: 'regulates' },
      ],
      completeness: {
        status: 'known_absent',
        coverage: 0,
        coverage_note:
          'Geometry we possess is none. The 1996 regulation defines a 100 m facility class (Gazette 924/12) with 50 dB day / 45 dB night. Estimated OSM-school buffers are OFF — they would not be an ordinance overlay (incomplete facilities, missing classes, ministerial declaration).',
        known_gaps: [
          'No national silent-zone GIS',
          'OSM is missing facility classes listed in the gazette',
          'No ministerial "declared silent zone" layer',
        ],
        comparator: 'Gazette 924/12 100 m facility class',
      },
      provenance: {
        source: 'National Environmental (Noise Control) Regulations No. 1 of 1996, Gazette No. 924/12 of 23 May 1996',
        vintage: '1996 (amended 1997)',
        licence: 'Sri Lanka government publication',
        refresh: 'statute — no GIS to refresh',
        url: 'https://www.cea.lk/',
      },
      searchable: false,
      storage: { kind: 'none' },
      tags: ['civic', 'noise', 'statute'],
    },
    {
      id: 'noise_ordinance',
      source_ids: ['cea-noise'],
      title: 'Noise Control Regulations 1996',
      description:
        'The statute behind silent_zone. query_spatial on silent_zone returns a typed miss plus this legal_class, never an empty feature array.',
      geometry: 'statute',
      id_field: 'gazette',
      name_field: 'title',
      operators: [],
      related: [{ id: 'silent_zone', rel: 'regulates' }],
      completeness: {
        status: 'partial',
        coverage: null,
        coverage_note:
          'We record the 100 m facility class + dB limits (Sunday Times, 12 Sep 2010, citing Gazette 924/12). Full statutory text is not stored.',
        known_gaps: ['Full gazette text not in-repo', 'No geometry'],
      },
      provenance: {
        source: 'Gazette 924/12 · CEA',
        vintage: '1996',
        licence: 'Sri Lanka government publication',
        refresh: 'statute',
      },
      searchable: false,
      storage: { kind: 'none' },
      tags: ['statute'],
    },
    {
      id: 'prospect',
      source_ids: ['platform-live'],
      title: 'Property prospects',
      description: 'User-owned analysed listings. Private by default.',
      geometry: 'point',
      id_field: 'id',
      name_field: 'title',
      operators: ['bbox', 'nearest'],
      related: [{ id: 'analysis', rel: 'derived_from' }],
      completeness: {
        status: 'partial',
        coverage: null,
        coverage_note: 'Live D1 rows scoped to the caller.',
        known_gaps: [],
      },
      provenance: {
        source: 'user-contributed (developing-country.org)',
        vintage: 'live',
        licence: 'private to owner unless shared',
        refresh: 'GET /api/prospects (authenticated)',
      },
      layer_id: 'prospects',
      catalog_id: 'prospects',
      searchable: false,
      storage: { kind: 'd1', table: 'prospects' },
    },
    {
      id: 'analysis',
      source_ids: ['platform-live'],
      title: 'Analysis runs',
      description: 'Saved analyze_location runs (web + MCP) for the caller.',
      geometry: 'point',
      id_field: 'id',
      name_field: 'title',
      operators: ['bbox', 'nearest'],
      related: [{ id: 'prospect', rel: 'same_as' }],
      completeness: {
        status: 'partial',
        coverage: null,
        coverage_note: 'Live D1 rows scoped to the caller.',
        known_gaps: [],
      },
      provenance: {
        source: 'developing-country.org — your own analyze_location runs (web + MCP)',
        vintage: 'live',
        licence: 'private to you',
        refresh: 'automatic on every analyze; GET /api/analyses (authenticated)',
      },
      layer_id: 'analyses',
      catalog_id: 'analyses',
      searchable: false,
      storage: { kind: 'd1', table: 'analyses' },
    },
    {
      id: 'data_view',
      source_ids: ['platform-live'],
      title: 'Saved Data Views',
      description: 'Immutable, provenance-bearing map or chart instructions with a bounded query-result snapshot.',
      geometry: 'none',
      id_field: 'id',
      name_field: 'title',
      operators: [],
      related: [{ id: 'analysis', rel: 'derived_from' }],
      completeness: {
        status: 'derived',
        coverage: 1,
        coverage_note: 'Every saved view contains a validated semantic spec, checksum, evidence reference, and bounded result snapshot.',
        known_gaps: ['Detailed geometry may be omitted when the immutable snapshot reaches its storage bound'],
      },
      provenance: {
        source: 'developing-country.org platform queries',
        vintage: 'live',
        licence: 'inherits the cited Dataset Versions',
        refresh: 'immutable on create; create a new Data View for a refreshed query',
        url: 'https://explore.developing-country.org',
      },
      catalog_id: 'data_views',
      searchable: false,
      storage: { kind: 'd1', table: 'data_views' },
      tags: ['presentation', 'evidence'],
    },
    {
      id: 'land_cover_cell',
      source_ids: ['esa-worldcover-2021'],
      dataset_ids: ['land-cover-grid'],
      title: 'Dominant land-cover grid',
      description: 'A compact 0.05° display grid showing the modal ESA WorldCover 2021 class over Sri Lanka.',
      geometry: 'polygon',
      id_field: 'grid_id',
      name_field: 'class_label',
      operators: ['bbox', 'overlay'],
      related: [],
      completeness: {
        status: 'derived',
        coverage: 1,
        coverage_note: 'Every coarse cell intersecting the Sri Lanka district cutline retains its dominant classified WorldCover class.',
        known_gaps: [
          'A dominant class hides smaller and mixed patches inside each coarse display cell.',
          'Vegetated is a categorical class grouping, not NDVI or a claim about current vegetation condition.',
        ],
      },
      provenance: {
        source: 'ESA WorldCover 2021 v200',
        vintage: '2021 v200',
        licence: 'CC BY 4.0',
        licence_status: 'open',
        refresh: 'bun scripts/build-land-cover.mjs',
        url: 'https://esa-worldcover.org/en/data-access',
      },
      layer_id: 'land-cover-grid',
      searchable: false,
      storage: { kind: 'geojson', path: '/data/land-cover-grid.geojson' },
      tags: ['land-cover', 'satellite', 'vegetation'],
    },
    {
      id: 'population_change_district',
      source_ids: ['lk-census-2012-2024-district-change'],
      dataset_ids: ['population-change'],
      title: 'District population change 2012 to 2024',
      description: 'Percent change in resident population between Census 2012 and Census 2024 for Sri Lanka’s 25 districts.',
      geometry: 'polygon',
      admin_level: 'district',
      id_field: 'id',
      name_field: 'name',
      operators: ['bbox', 'overlay', 'choropleth_join'],
      related: [{ id: 'district', rel: 'derived_from' }],
      completeness: {
        status: 'complete',
        coverage: 1,
        coverage_note: 'All 25 districts have Census 2012 and joined Census 2024 Person-Sex totals. District id match is 100%.',
        known_gaps: [
          'This is district grain only. DSD and GN 2012→2024 comparisons are misleading where those codes were recoded.',
          'Every district grew; the paint scale is how much, not growth versus decline.',
        ],
      },
      provenance: {
        source: 'Dept. of Census & Statistics via nuuuwan/lk_census_2024 + gig-data',
        vintage: 'Census 2012 and Census 2024',
        licence: 'MIT (lk_census_2024 parser, gig-data geometries); DCS official census (figures)',
        licence_status: 'permission_unclear',
        refresh: 'bun scripts/build-demographics.mjs && bun scripts/build-population-change.mjs',
        url: 'https://www.statistics.gov.lk/Population/StaticalInformation/CPH2024',
      },
      layer_id: 'population-change',
      searchable: false,
      storage: { kind: 'geojson', path: '/data/demographics.geojson' },
      tags: ['census', 'population', 'change', 'district'],
    },
    indicatorEntity({
      id: 'land_cover_observation',
      datasetId: 'land-cover-district',
      title: 'Land cover by district',
      description: 'Estimated area and share of each observed ESA WorldCover 2021 class within all 25 Sri Lanka districts.',
      sourceIds: ['esa-worldcover-2021'],
      source: 'ESA WorldCover 2021 v200',
      vintage: '2021 v200',
      licence: 'CC BY 4.0',
      licenceStatus: 'open',
      url: 'https://esa-worldcover.org/en/data-access',
      path: '/data/land-cover-district.json',
      refresh: 'bun scripts/build-land-cover.mjs',
      idField: 'geography_id',
      nameField: 'geography_name',
      adminLevel: 'district',
      coverageNote: 'All 25 districts contain area/share rows for every WorldCover class observed inside their repaired boundary.',
      knownGaps: ['Modeled 100 m area estimates are not cadastral measurements and local classification accuracy varies.'],
      tags: ['land-cover', 'satellite', 'district'],
    }),
    indicatorEntity({
      id: 'census_age_sex_dsd',
      datasetId: 'census-age-sex-dsd',
      title: 'Population by age and sex at Divisional Secretariat level',
      description: 'Census 2024 population, sex and broad age-group observations aggregated from all published GN rows to 340 source DSD codes.',
      sourceIds: ['dcs-cph-2024-population-gnd'],
      source: 'Department of Census and Statistics Census 2024 GN population workbook',
      vintage: 'Census 2024 (provisional)',
      licence: 'Sri Lanka government aggregate publication; reuse permission is not explicitly stated',
      licenceStatus: 'permission_unclear',
      url: 'https://www.statistics.gov.lk/Population/StaticalInformation/CPH2024/',
      path: '/data/census-age-sex-dsd.json',
      idField: 'geography_id',
      nameField: 'geography_name',
      adminLevel: 'dsd',
      coverageNote: 'All 14,008 published GN rows aggregate to the 340 DSD codes present in the 2024 source workbook.',
      knownGaps: ['The 340 source DSD codes are not silently forced onto the platform’s older 331-boundary geometry set.'],
      tags: ['census', 'population', 'age', 'sex'],
    }),
    indicatorEntity({
      id: 'census_households_dsd',
      datasetId: 'census-households-dsd',
      title: 'Households and basic services at Divisional Secretariat level',
      description: 'Census 2024 household counts and directly reported water, cooking, lighting and toilet categories, household-weighted to DSD grain.',
      sourceIds: ['dcs-cph-2024-households-gnd', 'dcs-cph-2024-population-gnd'],
      source: 'Department of Census and Statistics Census 2024 GN housing and population workbooks',
      vintage: 'Census 2024 (provisional)',
      licence: 'Sri Lanka government aggregate publication; reuse permission is not explicitly stated',
      licenceStatus: 'permission_unclear',
      url: 'https://www.statistics.gov.lk/Population/StaticalInformation/CPH2024/',
      path: '/data/census-households-dsd.json',
      idField: 'geography_id',
      nameField: 'geography_name',
      adminLevel: 'dsd',
      coverageNote: 'All 14,008 published GN household rows aggregate to the 340 DSD codes present in the 2024 source workbook.',
      knownGaps: ['The 340 source DSD codes are not silently forced onto the platform’s older 331-boundary geometry set.'],
      tags: ['census', 'households', 'water', 'energy', 'sanitation'],
    }),
    indicatorEntity({
      id: 'census_basic_services_district',
      datasetId: 'census-basic-services-district',
      title: 'Household services by district',
      description: 'Published district counts and shares for drinking-water source, cooking fuel, lighting and toilet arrangements.',
      sourceIds: ['dcs-cph-2024-basic-housing'],
      source: 'Department of Census and Statistics Census 2024 district housing tables',
      vintage: 'Census 2024',
      licence: 'Sri Lanka government aggregate publication; reuse permission is not explicitly stated',
      licenceStatus: 'permission_unclear',
      url: 'https://www.statistics.gov.lk/Population/StaticalInformation/CPH2024/',
      path: '/data/census-basic-services-district.json',
      idField: 'geography_id',
      nameField: 'geography_name',
      adminLevel: 'district',
      coverageNote: 'The national total and all 25 districts are retained for every category published in the four source tables.',
      tags: ['census', 'households', 'water', 'energy', 'sanitation'],
    }),
    indicatorEntity({
      id: 'census_ethnicity_observation',
      datasetId: 'census-ethnicity-district',
      title: 'Population by ethnic group and district',
      description: 'Census 2012 and Census 2024 resident population by published ethnic group for Sri Lanka and its 25 districts.',
      sourceIds: ['dcs-cph-2024-ethnicity'],
      source: 'Department of Census and Statistics Census 2024 Final Report Table 6.1.11',
      vintage: 'Census 2012 and Census 2024',
      licence: 'Sri Lanka government aggregate publication; reuse permission is not explicitly stated',
      licenceStatus: 'permission_unclear',
      url: 'https://www.statistics.gov.lk/Resource/en/Population/CPH_2024/CPH2024_Final_Eng.pdf',
      path: '/data/census-ethnicity-district.json',
      refresh: 'bun scripts/build-census-identity.mjs',
      idField: 'geography_id',
      nameField: 'geography_name',
      adminLevel: 'district',
      coverageNote: 'The national total and all 25 districts are retained for both census years and every published ethnic-group column in Table 6.1.11.',
      knownGaps: [
        'Chetty, Bharatha and Veddas are grouped as Other in this table.',
        'Ethnic group is as declared by the respondent.',
      ],
      tags: ['census', 'ethnicity', 'district'],
    }),
    indicatorEntity({
      id: 'census_religion_observation',
      datasetId: 'census-religion-district',
      title: 'Population by religion and district',
      description: 'Census 2012 and Census 2024 resident population by published religion for Sri Lanka and its 25 districts.',
      sourceIds: ['dcs-cph-2024-religion'],
      source: 'Department of Census and Statistics Census 2024 Final Report Tables 6.1.14 and 6.1.15',
      vintage: 'Census 2012 and Census 2024',
      licence: 'Sri Lanka government aggregate publication; reuse permission is not explicitly stated',
      licenceStatus: 'permission_unclear',
      url: 'https://www.statistics.gov.lk/Resource/en/Population/CPH_2024/CPH2024_Final_Eng.pdf',
      path: '/data/census-religion-district.json',
      refresh: 'bun scripts/build-census-identity.mjs',
      idField: 'geography_id',
      nameField: 'geography_name',
      adminLevel: 'district',
      coverageNote: 'The national total and all 25 districts are retained for both census years and every published religion column.',
      knownGaps: ['Religion is as declared by the respondent.'],
      tags: ['census', 'religion', 'district'],
    }),
    indicatorEntity({
      id: 'census_housing_structure_observation',
      datasetId: 'census-housing-structure-district',
      title: 'Housing unit structure by district',
      description: 'Census 2024 occupied housing units by published structure type, including single houses by storeys and attached houses by floor band.',
      sourceIds: ['dcs-cph-2024-housing-structure'],
      source: 'Department of Census and Statistics Census 2024 Table A1',
      vintage: 'Census 2024',
      licence: 'Sri Lanka government aggregate publication; reuse permission is not explicitly stated',
      licenceStatus: 'permission_unclear',
      url: 'https://www.statistics.gov.lk/Population/StaticalInformation/CPH2024/HousingA/A1',
      path: '/data/census-housing-structure-district.json',
      refresh: 'bun scripts/build-census-housing.mjs',
      idField: 'geography_id',
      nameField: 'geography_name',
      adminLevel: 'district',
      coverageNote: 'The national total and all 25 districts are retained for every published structure class in Table A1.',
      knownGaps: [
        'These are occupied housing units, not households or resident population.',
        'Floor bands are census structure classes, not a building-height survey.',
      ],
      tags: ['census', 'housing', 'storeys', 'district'],
    }),
    indicatorEntity({
      id: 'population_estimate',
      datasetId: 'population-estimates-district',
      title: 'Estimated mid-year population by district and sex',
      description: 'Annual Registrar General population estimates for 2020–2024, distinct from Census 2024 enumeration counts.',
      sourceIds: ['dcs-population-estimates-2025'],
      source: 'Department of Census and Statistics Statistical Abstract 2025',
      vintage: '2020–2024 estimates',
      licence: 'Sri Lanka government aggregate publication; reuse permission is not explicitly stated',
      licenceStatus: 'permission_unclear',
      url: 'https://www.statistics.gov.lk/abstract2025/CHAP2/2.1a.pdf',
      path: '/data/population-estimates-district.json',
      idField: 'geography_id',
      nameField: 'geography_name',
      adminLevel: 'district',
      coverageNote: 'The national total and all 25 districts are present for total, male and female estimates in each published year.',
      tags: ['population', 'estimate', 'sex', 'district'],
    }),
    indicatorEntity({
      id: 'population_change_observation',
      datasetId: 'population-change-district',
      title: 'Population change 2012 to 2024',
      description: 'Census 2012 and Census 2024 resident population for Sri Lanka’s 25 districts, with the arithmetic change between those enumerations.',
      sourceIds: ['lk-census-2012-2024-district-change'],
      source: 'Dept. of Census & Statistics via nuuuwan/lk_census_2024 + gig-data',
      vintage: 'Census 2012 and Census 2024',
      licence: 'MIT (lk_census_2024 parser, gig-data geometries); DCS official census (figures)',
      licenceStatus: 'permission_unclear',
      url: 'https://www.statistics.gov.lk/Population/StaticalInformation/CPH2024',
      path: '/data/population-change-district.json',
      refresh: 'bun scripts/build-population-change.mjs',
      idField: 'geography_id',
      nameField: 'geography_name',
      adminLevel: 'district',
      coverageNote: 'All 25 districts are retained. District id match on Census 2024 Person-Sex is 100%.',
      knownGaps: [
        'This is district grain only. DSD and GN 2012→2024 comparisons are misleading where those codes were recoded.',
        'These are census enumeration counts, not Registrar General mid-year estimates.',
        'Gig-data 2012 district totals differ from Final Report Table 6.1.11 in Colombo, Kurunegala, Vavuniya and Mullaitivu; 2024 totals match the final-report identity tables.',
      ],
      tags: ['census', 'population', 'change', 'district'],
    }),
    indicatorEntity({
      id: 'labour_force_observation',
      datasetId: 'labour-force',
      title: 'Labour-force participation and unemployment',
      description: 'National labour-force participation, employment, unemployment and population outside the labour force from 2016–2024.',
      sourceIds: ['dcs-statistical-abstract-2025-labour'],
      source: 'Department of Census and Statistics Statistical Abstract 2025',
      vintage: '2016–2024 (2024 provisional)',
      licence: 'Sri Lanka government aggregate publication; reuse permission is not explicitly stated',
      licenceStatus: 'permission_unclear',
      url: 'https://www.statistics.gov.lk/abstract2025/CHAP4/4.1a.pdf',
      path: '/data/labour-force.json',
      idField: 'year',
      nameField: 'year',
      adminLevel: 'country',
      coverageNote: 'Every annual national row in the source table from 2016 through 2024 is represented.',
      tags: ['labour', 'employment', 'unemployment'],
    }),
    indicatorEntity({
      id: 'employment_industry_observation',
      datasetId: 'employment-by-industry',
      title: 'Employment by industry',
      description: 'National employed population across the 17 major industry groups reported for 2018–2024.',
      sourceIds: ['dcs-statistical-abstract-2025-employment'],
      source: 'Department of Census and Statistics Statistical Abstract 2025',
      vintage: '2018–2024 (2024 provisional)',
      licence: 'Sri Lanka government aggregate publication; reuse permission is not explicitly stated',
      licenceStatus: 'permission_unclear',
      url: 'https://www.statistics.gov.lk/abstract2025/CHAP4/4.2a.pdf',
      path: '/data/employment-by-industry.json',
      idField: 'industry_id',
      nameField: 'industry',
      adminLevel: 'country',
      coverageNote: 'All 17 published industry groups are present for every source year from 2018 through 2024.',
      tags: ['labour', 'employment', 'industry'],
    }),
    indicatorEntity({
      id: 'poverty_observation',
      datasetId: 'poverty-headcount-district',
      title: 'Poverty headcount ratio by district',
      description: 'Household Income and Expenditure Survey poverty headcount ratios across seven survey periods from 1995/96 to 2019.',
      sourceIds: ['dcs-hies-poverty'],
      source: 'Department of Census and Statistics Statistical Abstract 2025',
      vintage: '1995/96–2019',
      licence: 'Sri Lanka government aggregate publication; reuse permission is not explicitly stated',
      licenceStatus: 'permission_unclear',
      url: 'https://www.statistics.gov.lk/abstract2025/CHAP4/4.6.pdf',
      path: '/data/poverty-headcount-district.json',
      idField: 'geography_id',
      nameField: 'geography_name',
      adminLevel: 'district',
      coverageNote: 'The national total and all 25 districts are represented; source exclusions are explicit null observations, never zeros.',
      knownGaps: ['The latest observation is 2019 and must not be presented as a current post-crisis poverty estimate.'],
      tags: ['poverty', 'households', 'district'],
    }),
    indicatorEntity({
      id: 'gdp_observation',
      datasetId: 'gdp-by-industry',
      title: 'GDP by economic activity',
      description: 'National-accounts component, subcomponent, subtotal, adjustment and total lines at both current prices and constant 2015 prices for 2019–2024.',
      sourceIds: ['dcs-statistical-abstract-2025-gdp-current', 'dcs-statistical-abstract-2025-gdp-constant'],
      source: 'Department of Census and Statistics Statistical Abstract 2025 national accounts',
      vintage: '2019–2024',
      licence: 'Sri Lanka government aggregate publication; reuse permission is not explicitly stated',
      licenceStatus: 'permission_unclear',
      url: 'https://www.statistics.gov.lk/abstract2025/CHAP10/10.2.pdf',
      path: '/data/gdp-by-industry.json',
      idField: 'activity_id',
      nameField: 'activity',
      adminLevel: 'country',
      coverageNote: 'All 15 published series lines are represented under each price basis for all six years, with their hierarchy and accounting role explicit.',
      knownGaps: [
        'Rows are not mutually exclusive: manufacturing is nested within industry, and GVA, taxes, subsidies and GDP are accounting subtotal, adjustment and total lines. Values must not be summed across rows.',
        'Current-price and constant-price observations answer different questions and must not be combined into one series.',
      ],
      tags: ['economy', 'gdp', 'industry'],
    }),
    indicatorEntity({
      id: 'inpatient_observation',
      datasetId: 'inpatient-morbidity-mortality',
      title: 'Inpatient morbidity and mortality by disease group',
      description: 'Government-facility inpatient live discharges and deaths across 276 published IMMR/ICD disease groups.',
      sourceIds: ['moh-immr-2024'],
      source: 'Ministry of Health Indoor Morbidity and Mortality Return',
      vintage: 'Live discharges 2024; deaths 2023',
      licence: 'Sri Lanka government publication; Ministry site reserves rights and does not state an open-data licence',
      licenceStatus: 'permission_unclear',
      url: 'https://www.health.gov.lk/wp-content/uploads/2025/12/IMMR-Report-2024-final.xlsx',
      path: '/data/inpatient-morbidity-mortality.json',
      idField: 'immr_code',
      nameField: 'disease',
      adminLevel: 'country',
      coverageNote: 'All 276 disease-group rows in the workbook are retained with sex totals and the workbook’s distinct reference years.',
      knownGaps: ['Inpatient events are not population prevalence and primarily represent reporting government facilities.'],
      tags: ['health', 'morbidity', 'mortality'],
    }),
    indicatorEntity({
      id: 'ccpi_observation',
      datasetId: 'ccpi-monthly',
      title: 'Colombo Consumer Price Index',
      description: 'Monthly headline and core Colombo Consumer Price Index (2021=100) compiled by the Department of Census and Statistics.',
      sourceIds: ['dcs-ccpi-2021'],
      source: 'Department of Census and Statistics Prices and Wages Division',
      vintage: '2022-01–2026-08; core excludes volatile food, energy and transport',
      licence: 'Sri Lanka government aggregate publication; reuse permission is not explicitly stated',
      licenceStatus: 'permission_unclear',
      url: 'https://www.statistics.gov.lk/Resource/en/InflationAndPrices/CCPI/Movements_of_CCPI-CCPI_Core_2021.pdf',
      path: '/data/ccpi-monthly.json',
      refresh: 'bun scripts/build-official-indicators.mjs',
      idField: 'period',
      nameField: 'period',
      adminLevel: 'district',
      coverageNote: 'All 56 published months from January 2022 through August 2026 are retained for the Colombo urban index, with null rate fields where the source table has not yet published that rate.',
      knownGaps: [
        'This is a Colombo urban index, not a national CPI.',
        'Year-on-year rates begin in February 2023 in the source table.',
      ],
      tags: ['economy', 'prices', 'inflation', 'ccpi'],
    }),
    indicatorEntity({
      id: 'merchandise_trade_monthly_observation',
      datasetId: 'merchandise-trade-monthly',
      title: 'Monthly merchandise exports and imports',
      description: 'National monthly merchandise exports and imports in US dollars, normalized from the official CBSL category workbooks.',
      sourceIds: ['cbsl-external-sector-exports-table-2-02', 'cbsl-external-sector-imports-table-2-04'],
      source: 'Central Bank of Sri Lanka External Sector Tables 2.02 and 2.04',
      vintage: '2007-01–2026-08; 2024-01 onward provisional',
      licence: 'Official aggregate workbooks; freely downloadable, but CBSL does not state an open-data reuse licence',
      licenceStatus: 'permission_unclear',
      url: 'https://www.cbsl.gov.lk/en/statistics/statistical-tables/External-Sector',
      path: '/data/merchandise-trade-monthly.json',
      refresh: 'bun scripts/build-cbsl-indicators.mjs',
      idField: 'period',
      nameField: 'flow',
      adminLevel: 'country',
      coverageNote: 'All 472 published monthly flow observations from January 2007 through August 2026 are represented; period plus flow is the table primary key.',
      knownGaps: [
        'The 2010 trade-classification revision can create a break in long-run comparisons.',
        'Observations from January 2024 onward are provisional and may be revised by CBSL.',
      ],
      tags: ['economy', 'trade', 'exports', 'imports', 'monthly'],
    }),
    indicatorEntity({
      id: 'merchandise_trade_category_annual_observation',
      datasetId: 'merchandise-trade-category-annual',
      title: 'Annual merchandise trade by category',
      description: 'Annualized national merchandise-trade categories with source hierarchy, subtotal, provisional and partial-year semantics preserved.',
      sourceIds: ['cbsl-external-sector-exports-table-2-02', 'cbsl-external-sector-imports-table-2-04'],
      source: 'Central Bank of Sri Lanka External Sector Tables 2.02 and 2.04',
      vintage: '2007–2026; 2026 is year to date',
      licence: 'Official aggregate workbooks; freely downloadable, but CBSL does not state an open-data reuse licence',
      licenceStatus: 'permission_unclear',
      url: 'https://www.cbsl.gov.lk/en/statistics/statistical-tables/External-Sector',
      path: '/data/merchandise-trade-category-annual.json',
      refresh: 'bun scripts/build-cbsl-indicators.mjs',
      idField: 'category_id',
      nameField: 'category',
      adminLevel: 'country',
      coverageNote: 'All 1,780 annualized category rows derived from the published monthly workbooks are retained; year, flow and category_id form the primary key.',
      knownGaps: [
        'Totals, subtotals and components overlap and must not be summed across hierarchy levels.',
        'The 2026 rows cover January through August only; months_observed and partial_year expose that boundary.',
        'Months marked negligible in the source contribute zero at published precision, so affected annual sums are lower-bound displays.',
        'The 2010 trade-classification revision can create a break in long-run category comparisons.',
      ],
      tags: ['economy', 'trade', 'exports', 'imports', 'composition'],
    }),
    indicatorEntity({
      id: 'workers_remittance_observation',
      datasetId: 'workers-remittances-monthly',
      title: 'Monthly workers’ remittances',
      description: 'National monthly workers’ remittances in US dollars, based on data reported by licensed banks to CBSL.',
      sourceIds: ['cbsl-workers-remittances-table-2-14-2'],
      source: 'Central Bank of Sri Lanka External Sector Table 2.14.2',
      vintage: '2009-01–2026-08',
      licence: 'Official aggregate workbook; freely downloadable, but CBSL does not state an open-data reuse licence',
      licenceStatus: 'permission_unclear',
      url: 'https://www.cbsl.gov.lk/sites/default/files/cbslweb_documents/statistics/sheets/table2.14.2_20260930_e.xlsx',
      path: '/data/workers-remittances-monthly.json',
      refresh: 'bun scripts/build-cbsl-indicators.mjs',
      idField: 'period',
      nameField: 'period',
      adminLevel: 'country',
      coverageNote: 'All 212 monthly observations from January 2009 through August 2026 are retained.',
      knownGaps: ['CBSL notes that workers’ remittances can include other remittances, including receipts following Cyclone Ditwah.'],
      tags: ['economy', 'remittances', 'external-sector', 'monthly'],
    }),
    indicatorEntity({
      id: 'fiscal_operations_observation',
      datasetId: 'government-fiscal-operations-annual',
      title: 'Annual government fiscal operations',
      description: 'National government revenue, grants, expenditure, balances and financing reported by CBSL from Ministry of Finance data.',
      sourceIds: ['cbsl-fiscal-operations-table-3-01'],
      source: 'Central Bank of Sri Lanka Fiscal Sector Table 3.01',
      vintage: '1990–2025; 2025 provisional',
      licence: 'Official aggregate workbook; freely downloadable, but CBSL does not state an open-data reuse licence',
      licenceStatus: 'permission_unclear',
      url: 'https://www.cbsl.gov.lk/sites/default/files/cbslweb_documents/statistics/sheets/table3.01_20260720.xlsx',
      path: '/data/government-fiscal-operations-annual.json',
      refresh: 'bun scripts/build-cbsl-indicators.mjs',
      idField: 'year',
      nameField: 'source_year_label',
      adminLevel: 'country',
      coverageNote: 'Every annual source row from 1990 through 2025 is retained across revenue, expenditure, balance and financing measures.',
      knownGaps: [
        'The 2025 observation is provisional.',
        'The source leaves 2025 privatisation financing blank; the value is preserved as null rather than inferred as zero.',
        'GDP-share comparisons span revisions to the DCS national-accounts series.',
      ],
      tags: ['economy', 'fiscal', 'budget', 'government'],
    }),
    indicatorEntity({
      id: 'government_revenue_observation',
      datasetId: 'government-revenue-annual',
      title: 'Annual government revenue composition',
      description: 'National direct-tax, indirect-tax and non-tax revenue reported by CBSL from Ministry of Finance data.',
      sourceIds: ['cbsl-government-revenue-table-3-02'],
      source: 'Central Bank of Sri Lanka Fiscal Sector Table 3.02',
      vintage: '1990–2025; 2025 provisional',
      licence: 'Official aggregate workbook; freely downloadable, but CBSL does not state an open-data reuse licence',
      licenceStatus: 'permission_unclear',
      url: 'https://www.cbsl.gov.lk/sites/default/files/cbslweb_documents/statistics/sheets/table3.02_20260720.xlsx',
      path: '/data/government-revenue-annual.json',
      refresh: 'bun scripts/build-cbsl-indicators.mjs',
      idField: 'year',
      nameField: 'source_year_label',
      adminLevel: 'country',
      coverageNote: 'Every annual source row from 1990 through 2025 is retained with published components, totals and derived shares.',
      knownGaps: [
        'The 2025 observation is provisional.',
        'Published totals differ slightly from the sum of published components in some years; the residual is exposed instead of silently altering source values.',
      ],
      tags: ['economy', 'fiscal', 'revenue', 'tax'],
    }),
    indicatorEntity({
      id: 'central_government_debt_observation',
      datasetId: 'central-government-debt-annual',
      title: 'Annual central government debt',
      description: 'Year-end domestic, foreign and total central-government debt published by CBSL for continuity using Ministry of Finance data.',
      sourceIds: ['cbsl-central-government-debt-table-3-05'],
      source: 'Central Bank of Sri Lanka Fiscal Sector Table 3.05',
      vintage: '1990–2025; 2024–2025 provisional',
      licence: 'Official aggregate workbook; freely downloadable, but CBSL does not state an open-data reuse licence',
      licenceStatus: 'permission_unclear',
      url: 'https://www.cbsl.gov.lk/sites/default/files/cbslweb_documents/statistics/sheets/table3.05_20260720.xlsx',
      path: '/data/central-government-debt-annual.json',
      refresh: 'bun scripts/build-cbsl-indicators.mjs',
      idField: 'year',
      nameField: 'source_year_label',
      adminLevel: 'country',
      coverageNote: 'Every annual year-end source row from 1990 through 2025 is retained, including explicit methodology and value-status flags.',
      knownGaps: [
        'This is central-government debt, not a broader public-sector debt measure.',
        'Debt-perimeter, residency, classification and restructuring changes—especially from 2022 onward—prevent naive comparison across all years.',
        'The 2024 and 2025 observations are provisional and reflect external-debt restructuring.',
        'Following establishment of the Public Debt Management Office, its debt bulletin is the official source; CBSL retains this table for continuity.',
      ],
      tags: ['economy', 'fiscal', 'debt', 'government'],
    }),
    indicatorEntity({
      id: 'colombo_land_valuation_observation',
      datasetId: 'colombo-land-valuation-indicator',
      title: 'Colombo Land Valuation Indicator',
      description: 'Half-yearly Land Valuation Indicator for Colombo District (2017 H1=100), with residential, commercial, industrial and overall sub-indices.',
      sourceIds: ['cbsl-land-valuation-indicator'],
      source: 'Central Bank of Sri Lanka Land Valuation Indicator',
      vintage: '2017 H1–2025 H2; 2017 H1=100 series revised in June 2022',
      licence: 'Official aggregate series and press table; freely downloadable, but CBSL does not state an open-data reuse licence',
      licenceStatus: 'permission_unclear',
      url: 'https://www.cbsl.gov.lk/en/news/land-valuation-indicator-second-half-of-2025',
      path: '/data/colombo-land-valuation-indicator.json',
      refresh: 'bun scripts/build-cbsl-indicators.mjs',
      idField: 'period',
      nameField: 'segment',
      adminLevel: 'district',
      coverageNote: 'All 18 published half-years from 2017 H1 through 2025 H2 are retained for each of the four sub-indices.',
      knownGaps: [
        'Coverage is Colombo District, not Sri Lanka as a whole.',
        'This is a valuation indicator, not a transaction-price or island-wide house-price index.',
        'The June 2022 methodology revision applies to the whole 2017 H1=100 series.',
      ],
      tags: ['economy', 'property', 'land', 'colombo'],
    }),
    indicatorEntity({
      id: 'colombo_asking_price_observation',
      datasetId: 'colombo-asking-price-indices',
      title: 'Colombo asking-price indices',
      description: 'Monthly asking-price indices for land, houses and condominiums in Colombo District (2019=100).',
      sourceIds: ['cbsl-real-estate-asking-prices'],
      source: 'Central Bank of Sri Lanka Real Estate Market Analysis',
      vintage: '2022-10–2026-03; 2019=100',
      licence: 'Official aggregate series; freely downloadable, but CBSL does not state an open-data reuse licence',
      licenceStatus: 'permission_unclear',
      url: 'https://www.cbsl.gov.lk/en/statistics/business-surveys/condominium-market-survey',
      path: '/data/colombo-asking-price-indices.json',
      refresh: 'bun scripts/build-cbsl-real-estate.mjs',
      idField: 'period',
      nameField: 'property_type_label',
      adminLevel: 'district',
      coverageNote: 'All 42 published months from October 2022 through March 2026 are retained for land, houses and condominiums, using the latest quarterly report for each month.',
      knownGaps: [
        'Coverage is Colombo District.',
        'These are asking-price indices, not transaction prices or the Land Valuation Indicator.',
        'The developer-survey Price Index for New Condominiums is a different series and is not in this table.',
      ],
      tags: ['economy', 'property', 'asking-prices', 'colombo'],
    }),
    indicatorEntity({
      id: 'exchange_rate_observation',
      datasetId: 'exchange-rates-monthly',
      title: 'Monthly exchange rates',
      description: 'Monthly average and month-end Sri Lanka rupee rates against published foreign currencies.',
      sourceIds: ['cbsl-monthly-average-exchange-rates', 'cbsl-end-of-month-exchange-rates'],
      source: 'Central Bank of Sri Lanka monthly average and end-of-month exchange-rate workbooks',
      vintage: 'Monthly average 1986-01–2026-08; month-end 1995-01–2026-08',
      licence: 'Official aggregate workbook; freely downloadable, but CBSL does not state an open-data reuse licence',
      licenceStatus: 'permission_unclear',
      url: 'https://www.cbsl.gov.lk/en/rates-and-indicators/exchange-rates',
      path: '/data/exchange-rates-monthly.json',
      refresh: 'bun scripts/build-cbsl-indicators.mjs',
      idField: 'period',
      nameField: 'currency',
      adminLevel: 'country',
      coverageNote: 'USD monthly-average observations are contiguous from January 1986 through August 2026; month-end USD from January 1995. Other currencies appear when the source publishes a number.',
      knownGaps: [
        'Euro and several other currencies are absent in earlier years; those months are omitted rather than stored as zero.',
        'These are CBSL published rates, not a parallel-market series.',
      ],
      tags: ['economy', 'exchange-rates', 'monthly'],
    }),
    indicatorEntity({
      id: 'effective_exchange_rate_observation',
      datasetId: 'effective-exchange-rate-indices',
      title: 'Nominal and real effective exchange-rate indices',
      description: 'Monthly NEER and REER indices (2017=100, 24-currency basket) published by CBSL.',
      sourceIds: ['cbsl-neer-reer-indices'],
      source: 'Central Bank of Sri Lanka NEER and REER workbook',
      vintage: '2013-01–2026-07; latest months provisional',
      licence: 'Official aggregate workbook; freely downloadable, but CBSL does not state an open-data reuse licence',
      licenceStatus: 'permission_unclear',
      url: 'https://www.cbsl.gov.lk/sites/default/files/cbslweb_documents/statistics/sheets/IF_REER.xlsx',
      path: '/data/effective-exchange-rate-indices.json',
      refresh: 'bun scripts/build-cbsl-indicators.mjs',
      idField: 'period',
      nameField: 'index_id',
      adminLevel: 'country',
      coverageNote: 'NEER and REER observations are contiguous from January 2013 through the latest published month.',
      knownGaps: [
        'REER is not a bilateral rupee/dollar rate.',
        'Partner-CPI and CCPI rebases create breaks that limit naive comparison across the full series.',
      ],
      tags: ['economy', 'exchange-rates', 'neer', 'reer'],
    }),
    indicatorEntity({
      id: 'tourism_earnings_observation',
      datasetId: 'tourism-earnings-monthly',
      title: 'Monthly earnings from tourism',
      description: 'Monthly earnings from tourism in US dollars, published by CBSL from SLTDA survey estimates.',
      sourceIds: ['cbsl-tourism-earnings-table-2-14-1'],
      source: 'Central Bank of Sri Lanka External Sector Table 2.14.1',
      vintage: '2009-01–2026-08; 2026 onward provisional and methodologically revised',
      licence: 'Official aggregate workbook; freely downloadable, but CBSL does not state an open-data reuse licence',
      licenceStatus: 'permission_unclear',
      url: 'https://www.cbsl.gov.lk/sites/default/files/cbslweb_documents/statistics/sheets/table2.14.1_20260930_e.xlsx',
      path: '/data/tourism-earnings-monthly.json',
      refresh: 'bun scripts/build-cbsl-indicators.mjs',
      idField: 'period',
      nameField: 'period',
      adminLevel: 'country',
      coverageNote: 'All published monthly observations from January 2009 through August 2026 are retained.',
      knownGaps: [
        'January 2026 onward uses SLTDA’s May 2026 methodology and is not directly comparable with 2009–2025.',
        'These are survey-based earnings estimates, not tourist-arrival counts or audited operator receipts.',
      ],
      tags: ['economy', 'tourism', 'monthly'],
    }),
    indicatorEntity({
      id: 'electricity_generation_power_observation', datasetId: 'electricity-generation-quarter-hourly',
      title: 'Electricity generation and battery power', description: 'National quarter-hour generation and aggregate battery active-power readings in MW.',
      sourceIds: ['nso-generation-api'], source: 'National System Operator public Generation Summary API',
      vintage: 'Stored daily API snapshots', licence: 'Publicly accessible operator data; an open reuse licence is not stated', licenceStatus: 'permission_unclear',
      url: 'https://edlcare.edl.lk/gensum/details', path: '/data/electricity-generation-quarter-hourly.json', refresh: 'bun scripts/build-electricity-generation.mjs --date=2026-09-11',
      idField: 'timestamp', nameField: 'timestamp', adminLevel: 'country',
      coverageNote: 'Stored report dates only; initial import has 95 timestamps on 11 September 2026. This is not a complete historical archive.',
      knownGaps: ['Source timestamps lack an explicit timezone offset.', 'Missing intervals remain missing. Power is not energy or nameplate capacity.', 'Aggregate BESS readings do not identify the individual installation.'], tags: ['energy', 'electricity', 'battery', 'national'],
    }),
    indicatorEntity({
      id: 'electricity_generation_energy_observation', datasetId: 'electricity-generation-daily',
      title: 'Daily electricity generation', description: 'Daily energy in GWh by published station group.',
      sourceIds: ['nso-generation-api'], source: 'National System Operator public Generation Summary API',
      vintage: 'Stored daily API snapshots', licence: 'Publicly accessible operator data; an open reuse licence is not stated', licenceStatus: 'permission_unclear',
      url: 'https://edlcare.edl.lk/gensum/details', path: '/data/electricity-generation-daily.json', refresh: 'bun scripts/build-electricity-generation.mjs --date=2026-09-11',
      idField: 'station_group', nameField: 'station_label', adminLevel: 'country',
      coverageNote: 'Stored report dates only, initially 11 September 2026; station groups are not individual plants.',
      knownGaps: ['Coverage includes estimated components; consult operator notes.', 'No separately named BESS energy row was present in the initial daily response.'], tags: ['energy', 'electricity', 'national'],
    }),
    indicatorEntity({
      id: 'registered_motor_vehicle_observation',
      datasetId: 'registered-motor-vehicles-annual',
      title: 'Registered motor vehicles',
      description: 'National stock of registered motor vehicles by published class, 2020–2024.',
      sourceIds: ['dcs-pocket-book-2025-vehicles'],
      source: 'Department of Census and Statistics Statistical Pocket Book 2025 Table 8.2',
      vintage: '2020–2024',
      licence: 'Sri Lanka government aggregate publication; reuse permission is not explicitly stated',
      licenceStatus: 'permission_unclear',
      url: 'https://www.statistics.gov.lk/Publication/PocketBook2025',
      path: '/data/registered-motor-vehicles-annual.json',
      refresh: 'bun scripts/build-motor-vehicles.mjs',
      idField: 'year',
      nameField: 'category_label',
      adminLevel: 'country',
      coverageNote: 'Every published class in Table 8.2 is retained for 2020–2024, including the national total.',
      knownGaps: [
        'This is a national stock table, not a district series.',
        'Special-purpose vehicles are unpublished for 2020–2021 and stored as null.',
        'These are registered vehicles, not a count of vehicles in use.',
      ],
      tags: ['transport', 'vehicles', 'national'],
    }),
    indicatorEntity({
      id: 'new_vehicle_registration_observation',
      datasetId: 'new-vehicle-registrations-annual',
      title: 'New vehicle registrations',
      description: 'National new motor-vehicle registrations by published class and fuel type, 2020–2024.',
      sourceIds: ['dcs-statistical-abstract-2025-new-vehicles'],
      source: 'Department of Census and Statistics Statistical Abstract 2025 Table 7.3',
      vintage: '2020–2024',
      licence: 'Sri Lanka government aggregate publication; reuse permission is not explicitly stated',
      licenceStatus: 'permission_unclear',
      url: 'https://www.statistics.gov.lk/abstract2025/CHAP7/7.3.pdf',
      path: '/data/new-vehicle-registrations-annual.json',
      refresh: 'bun scripts/build-motor-vehicles.mjs',
      idField: 'year',
      nameField: 'category_label',
      adminLevel: 'country',
      coverageNote: 'Every published class and fuel cell in Table 7.3 is retained for 2020–2024, including the national total.',
      knownGaps: [
        'This is a national table of newly registered vehicles, not a district series.',
        'The 2022 published total is one vehicle above the sum of published class/fuel cells.',
        'Road-length tables 7.1 and 7.2 were not published at this URL.',
      ],
      tags: ['transport', 'vehicles', 'fuel', 'national'],
    }),
    {
      id: 'region',
      source_ids: ['platform-live'],
      title: 'Authored region',
      description: 'Session-scoped polygon (agent or human draw). Phase B. Query via within.region_id.',
      geometry: 'polygon',
      id_field: 'id',
      name_field: 'title',
      operators: ['region.upsert', 'overlay', 'gap'],
      related: [],
      completeness: {
        status: 'unverified',
        coverage: null,
        coverage_note: 'Not persisted as a map layer. Phase B Durable Object SQLite.',
        known_gaps: ['Not in v1'],
      },
      provenance: {
        source: 'session (developing-country.org)',
        vintage: 'live',
        licence: 'caller-authored',
        refresh: 'region.upsert',
      },
      catalog_id: 'regions',
      searchable: false,
      storage: { kind: 'none' },
      tags: ['session'],
    },
  ],
}

const entityById = new Map(ONTOLOGY.entities.map((e) => [e.id, e]))

export function getEntity(id: string): EntityType | undefined {
  return entityById.get(id)
}

export function getCoverageLedger() {
  return coverageLedger
}

export function getRegistryIds() {
  return registryIds
}

function catalogKind(storage: Storage): CatalogEntry['kind'] {
  if (storage.kind === 'pmtiles') return 'tiles'
  if (storage.kind === 'd1') return 'db'
  return storage.kind
}

function catalogPath(e: EntityType): string | undefined {
  if (e.storage.kind === 'geojson') return e.storage.path
  if (e.storage.kind === 'table') return e.storage.path
  if (e.storage.kind === 'pmtiles') return `${PUBLIC_TILE_ORIGIN}/${e.storage.file}`
  if (e.storage.kind === 'index') return e.storage.path
  if (e.storage.kind === 'r2') return e.storage.key
  if (e.storage.kind === 'adapter') return e.storage.endpoint
  return undefined
}

interface SourceRegistryEntry {
  id: string
  name: string
  publisher: string
  url: string
  licence: string
  licence_status?: Exclude<LicenceStatus, 'unknown'>
  vintage: string
  refreshed: string
  refresh: string
  refresh_mode?: RefreshKind
  freshness_days?: number
  scheduled?: boolean
  layers: string[]
}

const sourceRegistry = dataSourceRegistry.sources as SourceRegistryEntry[]
const freshnessPolicy = dataSourceRegistry.freshness_policy as FreshnessPolicy
const sourceById = new Map(sourceRegistry.map((source) => [source.id, source]))

function sourcesForEntity(entity: EntityType): SourceRegistryEntry[] {
  return entity.source_ids.map((id) => {
    const source = sourceById.get(id)
    if (!source) throw new Error(`ontology entity ${entity.id} references unknown source ${id}`)
    return source
  })
}

function datasetIdsForEntity(entity: EntityType): string[] {
  return entity.dataset_ids ?? [entity.layer_id ?? entity.catalog_id ?? entity.id]
}

function distinct(values: string[]): string {
  return [...new Set(values)].join(' · ')
}

function aggregateLicenceStatus(rows: SourceRegistryEntry[]): LicenceStatus {
  const priority: Record<LicenceStatus, number> = { open: 0, unknown: 1, permission_unclear: 2, restricted: 3 }
  return rows
    .map((row) => row.licence_status ?? 'unknown')
    .reduce((strictest, status) => priority[status] > priority[strictest] ? status : strictest, 'open')
}

export function catalogEntries(assessedAt = new Date().toISOString().slice(0, 10)): CatalogEntry[] {
  return ONTOLOGY.entities.map((e) => {
    const sourceRows = sourcesForEntity(e)
    const freshnessStates = sourceRows.map((source) => freshnessOf(source, freshnessPolicy, assessedAt))
    return {
      id: e.catalog_id ?? e.id,
      entity_id: e.id,
      dataset_ids: datasetIdsForEntity(e),
      title: e.title,
      description: e.description,
      country: ONTOLOGY.country,
      kind: catalogKind(e.storage),
      source: distinct(sourceRows.map((source) => source.name)),
      source_ids: sourceRows.map((source) => source.id),
      sources: sourceRows.map((source, index) => ({
        id: source.id,
        name: source.name,
        publisher: source.publisher,
        url: source.url,
        licence: source.licence,
        licence_status: source.licence_status ?? 'unknown',
        vintage: source.vintage,
        refreshed_at: source.refreshed,
        how_to_refresh: source.refresh,
        freshness: freshnessStates[index],
      })),
      source_url: sourceRows[0]?.url,
      vintage: distinct(sourceRows.map((source) => source.vintage)),
      refreshed_at: [...sourceRows.map((source) => source.refreshed)].sort()[0],
      freshness: aggregateFreshness(freshnessStates),
      licence: distinct(sourceRows.map((source) => source.licence)),
      licence_status: aggregateLicenceStatus(sourceRows),
      how_to_refresh: distinct(sourceRows.map((source) => source.refresh)),
      path: catalogPath(e),
      storage: e.storage,
      field_schema: {
        id_field: e.id_field,
        name_field: e.name_field,
        geometry: e.geometry,
        admin_level: e.admin_level,
      },
      completeness: e.completeness,
      searchable: e.searchable,
      operators: e.operators,
      related: e.related,
      geometry: e.geometry,
      layer_id: e.layer_id,
    }
  })
}

/** Unique geojson paths that search_places may load. Dedupes metro_line/metro_stop. */
export function searchableGeojsonStores(): { id: string; path: string; source: string; vintage: string }[] {
  const seen = new Set<string>()
  const out: { id: string; path: string; source: string; vintage: string }[] = []
  for (const e of ONTOLOGY.entities) {
    if (!e.searchable || e.storage.kind !== 'geojson') continue
    if (seen.has(e.storage.path)) continue
    seen.add(e.storage.path)
    out.push({ id: e.id, path: e.storage.path, source: e.provenance.source, vintage: e.provenance.vintage })
  }
  return out
}

export const SILENT_ZONE_LEGAL_CLASS = {
  radius_m: 100,
  facilities: [
    'courthouse',
    'hospital',
    'school',
    'place_of_worship',
    'public_library',
    'zoo',
    'recreation_or_environment',
  ],
  db_day: 50,
  db_night: 45,
  gazette: '924/12',
  cite: 'National Environmental (Noise Control) Regulations No. 1 of 1996, Gazette No. 924/12 of 23 May 1996',
} as const

export type KnownAbsentError = {
  error: 'entity_known_absent'
  entity: string
  completeness: Completeness
  legal_class?: typeof SILENT_ZONE_LEGAL_CLASS
}

export function knownAbsentResponse(id: string): KnownAbsentError {
  const e = getEntity(id)
  const body: KnownAbsentError = {
    error: 'entity_known_absent',
    entity: id,
    completeness: e?.completeness ?? KNOWN_ABSENT('unknown entity', []),
  }
  if (id === 'silent_zone' || id === 'noise_ordinance') body.legal_class = SILENT_ZONE_LEGAL_CLASS
  return body
}

/** Stage events are data. Callers attach them to tool results; this helper only types the array. */
export function asStage(events: StageEvent[]): StageEvent[] {
  return events
}

export { coverageLedger, registryIds }
