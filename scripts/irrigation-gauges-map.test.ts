import { describe, expect, test } from 'bun:test'

process.env.BASE_URL = process.env.BASE_URL ?? '/'
const { formatFeature } = await import('../src/map/featureFormat')
const { LAYER_GROUPS, groupUnits } = await import('../src/map/layers')

describe('Explorer irrigation-gauges layer', () => {
  test('is a default-off environment point layer with provenance', () => {
    const group = LAYER_GROUPS.find((candidate) => candidate.id === 'irrigation-gauges')
    expect(group).toBeDefined()
    expect(group?.category).toBe('environment')
    expect(group?.defaultVisible).toBe(false)
    expect(group?.interactive).toBe(true)
    expect(group?.source).toEqual({ type: 'geojson', url: '/data/irrigation-gauges.geojson' })
    expect(group?.info.source).toContain('Irrigation Department')
    expect(groupUnits(group!)[0].defaultVisible).toBe(false)
  })

  test('formats published flood thresholds without a live water level', () => {
    const info = formatFeature(
      'irrigation-gauges',
      'River gauges',
      {
        id: 'nagalagam-street',
        name: 'Nagalagam Street',
        river_name: 'Kelani Ganga',
        district_id: 'LK-11;LK-12',
        alert_level_m: 1.2192,
        minor_flood_level_m: 1.524,
        major_flood_level_m: 2.1336,
      },
      { lng: 79.8786, lat: 6.9603 },
    )
    expect(info.title).toBe('Nagalagam Street')
    expect(info.blurb).toContain('Live water levels are not in this layer')
    expect(info.rows).toContainEqual({ label: 'River', value: 'Kelani Ganga' })
    expect(info.rows).toContainEqual({ label: 'Alert level', value: '1.22 m' })
    expect(info.rows).toContainEqual({ label: 'Major flood level', value: '2.13 m' })
    expect(info.rows.every((row) => !/live/i.test(row.label))).toBe(true)
  })
})
