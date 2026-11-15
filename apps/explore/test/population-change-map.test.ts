import { describe, expect, test } from 'bun:test'

process.env.BASE_URL = process.env.BASE_URL ?? '/'
const { formatFeature } = await import('../src/map/featureFormat')
const { LAYER_GROUPS, groupUnits } = await import('../src/map/layers')

describe('Explorer population-change layer', () => {
  test('is a default-off lazy district fill in the demographics category', () => {
    const group = LAYER_GROUPS.find((candidate) => candidate.id === 'population-change')
    expect(group).toBeDefined()
    expect(group?.category).toBe('demographics')
    expect(group?.defaultVisible).toBe(false)
    expect(group?.interactive).toBe(true)
    expect(group?.source).toEqual({
      type: 'geojson',
      url: '/data/demographics.geojson',
      lazy: true,
    })
    expect(groupUnits(group!)[0].defaultVisible).toBe(false)
    const paint = JSON.stringify(group?.render[0].paint)
    expect(paint).toContain('pop_2012')
    expect(paint).toContain('#006d2c')
  })

  test('formats a district readout from both census years', () => {
    const info = formatFeature(
      'population-change',
      'Population change',
      {
        id: 'LK-44',
        name: 'Mullaitivu',
        province: 'Northern',
        pop: 122619,
        pop_2012: 92193,
        area: 2703.7,
      },
      { lng: 80.8, lat: 9.2 },
    )
    expect(info.title).toBe('Mullaitivu')
    expect(info.blurb).toContain('District grain only')
    expect(info.blurb).toContain('Table 6.1.11')
    expect(info.rows).toContainEqual({ label: 'Province', value: 'Northern' })
    expect(info.rows).toContainEqual({ label: 'Census 2012', value: '92,193' })
    expect(info.rows).toContainEqual({ label: 'Census 2024', value: '122,619' })
    expect(info.rows).toContainEqual({ label: 'Change', value: '+30,426' })
    expect(info.rows).toContainEqual({ label: 'Percent change', value: '+33.0%' })
  })
})
