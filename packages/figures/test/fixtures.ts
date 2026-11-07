import type { ChartViewSpec, MapViewSpec } from '@developing-country/views'

const checksum = `sha256:${'a'.repeat(64)}`

export const evidence: MapViewSpec['evidence'] = {
  datasetVersions: [{
    datasetId: 'demographics',
    versionId: `dsv_${'b'.repeat(32)}`,
    country: 'LK',
    sourceIds: ['source:lk-census-2024'],
    vintage: '2024',
    refreshedAt: '2026-08-20T00:00:00.000Z',
    checksum: `sha256:${'c'.repeat(64)}`,
    completeness: { status: 'derived', coverage: 0.97, coverageNote: 'GND joined by id.', knownGaps: [] },
  }],
  sourceIds: ['source:lk-census-2024'],
  generatedAt: '2026-10-01T00:00:00.000Z',
}

export function gndChoropleth(): MapViewSpec {
  return {
    version: 1,
    id: 'view_fixturegnd',
    kind: 'map',
    country: 'LK',
    title: 'Share of residents within 10 minutes of a metro stop',
    data: { queryId: 'query_gnd', resultChecksum: checksum, rowCount: 3 },
    evidence,
    theme: 'developing-country/v1',
    createdAt: '2026-10-01T00:00:00.000Z',
    camera: { center: [79.9, 6.93], zoom: 10.5 },
    layers: [{
      id: 'metro-coverage-gnd',
      visible: true,
      label: 'Coverage by GN division',
      join: { tileset: 'demographics', sourceLayer: 'gnd', rowKey: 'gnd_id' },
      style: {
        geometry: 'fill',
        colorBy: { field: 'share', scale: 'threshold', breaks: [10, 40, 70], colors: ['ink-dim', 'route-sun', 'route-flag', '#7a1f0b'], label: 'Residents served', unit: '%' },
        labelField: 'name',
      },
    }],
    annotations: [{ id: 'fort', coordinates: [79.85, 6.93], text: 'Fort', anchor: 'top' }],
  }
}

export function chartRanking(): ChartViewSpec {
  return {
    version: 1,
    id: 'view_fixturerank',
    kind: 'chart',
    country: 'LK',
    title: 'Districts ranked by coverage',
    data: { queryId: 'query_rank', resultChecksum: checksum, rowCount: 3 },
    evidence,
    theme: 'developing-country/v1',
    createdAt: '2026-10-01T00:00:00.000Z',
    intent: { family: 'ranking', dimension: { field: 'district' }, measure: { field: 'share', unit: '%' } },
    presentation: { orientation: 'horizontal', highlight: ['Colombo'] },
  }
}
