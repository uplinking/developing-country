import type { ChartViewSpec, DataViewSpec, MapViewSpec } from '@developing-country/views'
import fixture from './figure-fixture-rows.json'

/**
 * DEV-ONLY fake Data Views for /dev/figures. Ids and names are real Colombo GN
 * divisions (so the tile join is exercised against demographics.pmtiles); every
 * number is synthetic. Served only under `astro dev` (see the guarded routes).
 */

const checksum = (seed: string) => `sha256:${seed.repeat(64).slice(0, 64)}`
const evidence: DataViewSpec['evidence'] = {
  datasetVersions: [{
    datasetId: 'metro-coverage-gnd',
    versionId: `dsv_${'f'.repeat(32)}`,
    country: 'LK',
    sourceIds: ['source:dev-fixture'],
    vintage: 'synthetic',
    refreshedAt: '2026-10-01T00:00:00.000Z',
    checksum: checksum('e'),
    completeness: { status: 'derived', coverage: null, coverageNote: 'Synthetic development fixture.', knownGaps: ['Not real data'] },
  }],
  sourceIds: ['source:dev-fixture'],
  generatedAt: '2026-10-01T00:00:00.000Z',
}
const base = { version: 1 as const, country: 'LK' as const, theme: 'developing-country/v1' as const, createdAt: '2026-10-01T00:00:00.000Z', evidence }

type Row = (typeof fixture.gnd)[number]
const gnd: Row[] = fixture.gnd

const gndChoropleth: MapViewSpec = {
  ...base,
  id: 'view_devgnd',
  kind: 'map',
  title: 'Residents within ten minutes of a metro stop, by GN division (synthetic)',
  data: { queryId: 'query_devgnd', resultChecksum: checksum('a'), rowCount: gnd.length },
  camera: { center: [79.875, 6.9], zoom: 11.2 },
  layers: [{
    id: 'metro-coverage-gnd',
    visible: true,
    label: 'Coverage',
    join: { tileset: 'demographics', sourceLayer: 'gnd', rowKey: 'gnd_id' },
    style: {
      geometry: 'fill',
      colorBy: { field: 'share', scale: 'threshold', breaks: [25, 50, 75], colors: ['ink-dim', 'route-sun', 'route-flag', '#7a1f0b'], label: 'Residents within 10 min', unit: '%' },
      labelField: 'name',
    },
  }],
  annotations: [
    { id: 'fort', coordinates: [79.8437, 6.9344], text: 'Fort', anchor: 'top' },
    { id: 'kotte', coordinates: [79.9047, 6.8868], text: 'Kotte', anchor: 'right' },
  ],
}

const centroids: MapViewSpec = {
  ...base,
  id: 'view_devpoints',
  kind: 'map',
  title: 'GN divisions served within ten minutes (synthetic)',
  data: { queryId: 'query_devpoints', resultChecksum: checksum('b'), rowCount: gnd.length },
  camera: { center: [79.875, 6.9], zoom: 11.2 },
  layers: [{
    id: 'gnd-centroids',
    visible: true,
    label: 'Within 10 minutes',
    style: {
      geometry: 'circle',
      colorBy: { field: 'within_10min', scale: 'categorical', categories: { true: 'route-system', false: 'route-flag' }, label: 'Within 10 minutes' },
      radiusBy: { field: 'pop', range: [2, 11] },
    },
  }],
}

const walksheds: MapViewSpec = {
  ...base,
  id: 'view_devwalkshed',
  kind: 'map',
  title: 'Ten-minute walksheds around three stops (synthetic)',
  data: { queryId: 'query_devwalkshed', resultChecksum: checksum('c'), rowCount: 3 },
  camera: { center: [79.858, 6.915], zoom: 12.4 },
  layers: [{
    id: 'metro_walkshed',
    visible: true,
    label: 'Walkshed',
    filter: { minutes: 10 },
    style: { geometry: 'fill', colorBy: { field: 'method', scale: 'categorical', categories: { network: 'route-system', radius: 'route-info' }, label: 'Method' }, opacity: 0.55 },
  }],
}

const density: MapViewSpec = {
  ...base,
  id: 'view_devdensity',
  kind: 'map',
  title: 'Population density by GN division (synthetic subset)',
  data: { queryId: 'query_devdensity', resultChecksum: checksum('7'), rowCount: gnd.length },
  camera: { center: [79.875, 6.9], zoom: 11.2 },
  layers: [{
    id: 'gnd-density',
    visible: true,
    label: 'Density',
    join: { tileset: 'demographics', sourceLayer: 'gnd', rowKey: 'gnd_id' },
    style: { geometry: 'fill', colorBy: { field: 'dens', scale: 'sequential', label: 'People per km²' }, opacity: 0.7 },
  }],
}

const gapClusters: MapViewSpec = {
  ...base,
  id: 'view_devclusters',
  kind: 'map',
  title: 'Clusters of GN divisions beyond a ten-minute walk (synthetic)',
  data: { queryId: 'query_devclusters', resultChecksum: checksum('8'), rowCount: 3 },
  camera: { center: [79.885, 6.9], zoom: 11.6 },
  layers: [{
    id: 'gap-clusters',
    visible: true,
    label: 'Gap cluster',
    style: { geometry: 'line', color: 'ink', width: 2.5, labelField: 'name' },
  }],
  annotations: [{ id: 'east', coordinates: [79.905, 6.935], text: 'Largest cluster', anchor: 'top' }],
}

const ranking: ChartViewSpec = {
  ...base,
  id: 'view_devrank',
  kind: 'chart',
  title: 'Divisional secretariats ranked by coverage (synthetic)',
  data: { queryId: 'query_devrank', resultChecksum: checksum('d'), rowCount: 5 },
  intent: { family: 'ranking', dimension: { field: 'dsd', label: 'Divisional secretariat' }, measure: { field: 'share', label: 'Residents within 10 min', unit: '%' } },
  presentation: { orientation: 'horizontal', highlight: ['Colombo'] },
}

function blob(lng: number, lat: number, km: number): number[][][] {
  const ring = Array.from({ length: 25 }, (_, i) => {
    const a = (i / 24) * Math.PI * 2
    const wobble = 1 + 0.18 * Math.sin(a * 3)
    return [lng + (Math.cos(a) * km * wobble) / 110.6, lat + (Math.sin(a) * km * wobble) / 110.6]
  })
  return [ring]
}

const dsdShares = [...new Set(gnd.map((row) => row.dsd))].map((dsd) => {
  const rows = gnd.filter((row) => row.dsd === dsd)
  const pop = rows.reduce((sum, row) => sum + row.pop, 0)
  const served = rows.reduce((sum, row) => sum + (row.pop * row.share) / 100, 0)
  return { dsd, share: Math.round((served / pop) * 1000) / 10, pop }
}).sort((a, b) => b.share - a.share)

const walkshedRows = [
  { id: 'ws-fort', name: 'Fort', method: 'network', minutes: 10, area_km2: 1.1 },
  { id: 'ws-maradana', name: 'Maradana', method: 'network', minutes: 10, area_km2: 0.9 },
  { id: 'ws-kollupitiya', name: 'Kollupitiya', method: 'radius', minutes: 10, area_km2: 1.6 },
  { id: 'ws-old', name: 'Fort (15 min)', method: 'network', minutes: 15, area_km2: 2.4 },
]
const walkshedCenters: Record<string, [number, number, number]> = {
  'ws-fort': [79.8437, 6.9344, 0.6], 'ws-maradana': [79.8655, 6.9285, 0.55], 'ws-kollupitiya': [79.8497, 6.9114, 0.72], 'ws-old': [79.8437, 6.9344, 1.1],
}

const clusterRows = [
  { id: 'gap-east', name: 'Kolonnawa east', pop: 48210, area_km2: 4.1, at: [79.905, 6.932, 1.5] },
  { id: 'gap-kotte', name: 'Kotte', pop: 39120, area_km2: 3.2, at: [79.912, 6.885, 1.25] },
  { id: 'gap-south', name: 'Dehiwala south', pop: 28750, area_km2: 2.4, at: [79.872, 6.842, 1.1] },
] as const

export const DEV_VIEWS: Record<string, { view: DataViewSpec; result: Record<string, unknown>; inline: boolean }> = {
  view_devdensity: { view: density, result: { rows: gnd, features: gnd }, inline: true },
  view_devclusters: {
    view: gapClusters,
    result: {
      features: clusterRows.map(({ at: _at, ...row }) => row),
      geometry: {
        type: 'FeatureCollection',
        features: clusterRows.map(({ at, ...row }) => ({ type: 'Feature', id: row.id, geometry: { type: 'Polygon', coordinates: blob(at[0], at[1], at[2]) }, properties: row })),
      },
    },
    inline: true,
  },
  view_devgnd: { view: gndChoropleth, result: { rows: gnd, features: gnd }, inline: false },
  view_devpoints: { view: centroids, result: { features: gnd.map((row) => ({ ...row, id: row.gnd_id })) }, inline: true },
  view_devwalkshed: {
    view: walksheds,
    result: {
      features: walkshedRows,
      geometry: {
        type: 'FeatureCollection',
        features: walkshedRows.map((row) => {
          const [lng, lat, km] = walkshedCenters[row.id] ?? [79.85, 6.92, 0.5]
          return { type: 'Feature', id: row.id, geometry: { type: 'Polygon', coordinates: blob(lng, lat, km) }, properties: row }
        }),
      },
    },
    inline: true,
  },
  view_devrank: { view: ranking, result: { rows: dsdShares }, inline: true },
}

/** Fixture views use whichever Data View origin the dev server is configured for (PUBLIC_DATA_VIEW_ORIGIN). */
export const DEV_VIEW_ORIGIN = (import.meta.env.PUBLIC_DATA_VIEW_ORIGIN as string | undefined) || 'https://explore.developing-country.org'
export const devViewUrl = (id: keyof typeof DEV_VIEWS) => `${new URL(DEV_VIEW_ORIGIN).origin}/views/${id}`
const distanceToFort = (row: Row) => Math.hypot(row.lng - 79.8437, row.lat - 6.9344)
export const DEV_GND_HIGHLIGHT = [...gnd].sort((a, b) => distanceToFort(a) - distanceToFort(b)).slice(0, 6).map((row) => row.gnd_id)
