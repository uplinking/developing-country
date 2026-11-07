import { describe, expect, test } from 'bun:test'
import type { MapLayerView } from '@developing-country/views'
import {
  buildLegend,
  colorExpression,
  featuresFromRows,
  fieldStats,
  geometryRowsForLayer,
  joinLabelExpr,
  layerRows,
  matchesLayerFilter,
  joinStates,
  planLayer,
  radiusExpression,
  rampDomain,
  resolveMapColor,
  rowsForLayer,
  tooltipFor,
  type Expr,
} from '../src/mapStyle'
import { FALLBACK_TOKENS, mixColor, parseColor } from '../src/tokens'
import { gndChoropleth } from './fixtures'

const tokens = FALLBACK_TOKENS
const dark = { ...FALLBACK_TOKENS, routeFlag: '#ff7a59', paper: '#1a1c21', ink: '#edebe3', dark: true }

describe('colour tokens', () => {
  test('resolves token names against the live theme and passes hex through', () => {
    expect(resolveMapColor('route-flag', tokens, '#000000')).toBe('#d14321')
    expect(resolveMapColor('route-flag', dark, '#000000')).toBe('#ff7a59')
    expect(resolveMapColor('#123456', tokens, '#000000')).toBe('#123456')
    expect(resolveMapColor(undefined, tokens, '#abcdef')).toBe('#abcdef')
  })

  test('parses and mixes token colours', () => {
    expect(parseColor('rgba(22, 24, 29, 0.28)')).toEqual({ r: 22, g: 24, b: 29, a: 0.28 })
    expect(mixColor('#000000', '#ffffff', 0.5)).toBe('#808080')
  })
})

describe('data-driven colour', () => {
  test('threshold scales step over breaks and colour missing values neutrally', () => {
    const expr = colorExpression(
      { field: 'share', scale: 'threshold', breaks: [10, 40], colors: ['route-info', 'route-sun', 'route-flag'] },
      'feature-state',
      tokens,
      null,
      '#000000',
    ) as Expr[]
    expect(expr[0]).toBe('case')
    expect(expr[1]).toEqual(['==', ['typeof', ['feature-state', 'share']], 'number'])
    expect(expr[2]).toEqual(['step', ['feature-state', 'share'], '#2456c4', 10, '#e8930c', 40, '#d14321'])
  })

  test('threshold with mismatched colours falls back to the layer colour', () => {
    expect(colorExpression({ field: 'v', scale: 'threshold', breaks: [1], colors: ['ink'] }, 'property', tokens, null, '#111111')).toBe('#111111')
  })

  test('sequential scales interpolate the token ramp over the data domain', () => {
    const stats = fieldStats([{ v: 0 }, { v: 50 }, { v: 100 }, { v: 'n/a' }], 'v')
    expect(stats).toEqual({ min: 0, max: 100, count: 3 })
    const expr = colorExpression({ field: 'v', scale: 'sequential' }, 'property', tokens, stats, '#000') as Expr[]
    const interpolate = expr[2] as Expr[]
    expect(interpolate.slice(0, 3)).toEqual(['interpolate', ['linear'], ['get', 'v']])
    expect(interpolate.filter((part) => typeof part === 'number')).toEqual([0, 25, 50, 75, 100])
  })

  test('diverging domains centre on zero when the data spans it', () => {
    expect(rampDomain({ field: 'v', scale: 'diverging' }, { min: -10, max: 30, count: 2 }, 5)).toEqual([-10, -5, 0, 15, 30])
    expect(rampDomain({ field: 'v', scale: 'diverging' }, { min: 10, max: 30, count: 2 }, 5)).toEqual([10, 15, 20, 25, 30])
  })

  test('explicit breaks become the interpolation stops when they match the ramp', () => {
    expect(rampDomain({ field: 'v', scale: 'sequential', breaks: [1, 2, 3, 4, 5] }, null, 5)).toEqual([1, 2, 3, 4, 5])
  })

  test('categorical scales match exact string values', () => {
    const expr = colorExpression(
      { field: 'kind', scale: 'categorical', categories: { rail: 'route-info', bus: '#00ff00' } },
      'property',
      tokens,
      null,
      '#999999',
    )
    expect(expr).toEqual(['match', ['to-string', ['get', 'kind']], 'rail', '#2456c4', 'bus', '#00ff00', '#999999'])
  })

  test('radius by field interpolates linearly across the range', () => {
    const expr = radiusExpression({ geometry: 'circle', radiusBy: { field: 'pop', range: [2, 12] } }, 'property', { min: 10, max: 110, count: 4 })
    expect(expr).toEqual(['case', ['==', ['typeof', ['get', 'pop']], 'number'], ['interpolate', ['linear'], ['get', 'pop'], 10, 2, 110, 12], 2])
    expect(radiusExpression({ geometry: 'circle', radius: 7 }, 'property', null)).toBe(7)
  })
})

describe('layer plans', () => {
  test('a tile-joined fill reads feature-state and hides unjoined features', () => {
    const view = gndChoropleth()
    const layer = view.layers[0] as MapLayerView
    const plans = planLayer({ prefix: 'p', layer, index: 0, source: 'feature-state', tokens, stats: {}, dimOthers: false, visible: true })
    const fill = plans.find((plan) => plan.id === 'p:fill')
    expect(fill?.filter).toBeUndefined()
    expect(fill?.paint['fill-opacity']).toEqual(['case', ['boolean', ['feature-state', 'present'], false], 0.78, 0])
    expect(JSON.stringify(fill?.paint['fill-color'])).toContain('feature-state')
    expect(plans.map((plan) => plan.role)).toEqual(['main', 'outline', 'highlight'])
  })

  test('highlight dims every other feature', () => {
    const layer: MapLayerView = { id: 'stops', visible: false, style: { geometry: 'circle', labelField: 'name' } }
    const plans = planLayer({ prefix: 'p', layer, index: 0, source: 'property', tokens, stats: {}, dimOthers: true, visible: false, fadeMs: 300 })
    const circle = plans.find((plan) => plan.id === 'p:circle')
    expect(circle?.paint['circle-opacity']).toEqual(['case', ['boolean', ['feature-state', 'hl'], false], 0.92, 0.202])
    expect(circle?.paint['circle-opacity-transition']).toEqual({ duration: 300, delay: 0 })
    expect(circle?.layout.visibility).toBe('none')
    expect(plans.find((plan) => plan.role === 'label')?.layout['text-field']).toEqual(['to-string', ['get', 'name']])
  })

  test('a styled line layer outlines polygons as well as lines', () => {
    const plans = planLayer({ prefix: 'p', layer: { id: 'gaps', visible: true, style: { geometry: 'line', color: 'ink' } }, index: 0, source: 'property', tokens, stats: {}, dimOthers: false, visible: true })
    expect(plans.find((plan) => plan.id === 'p:line')?.filter).toEqual(['!', ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false]])
  })

  test('unstyled layers draw every geometry in one route colour', () => {
    const plans = planLayer({ prefix: 'p', layer: { id: 'x', visible: true }, index: 1, source: 'property', tokens, stats: {}, dimOthers: false, visible: true })
    expect(plans.filter((plan) => plan.role === 'main').map((plan) => plan.type)).toEqual(['fill', 'line', 'circle'])
    expect(plans.find((plan) => plan.type === 'circle')?.paint['circle-color']).toBe(tokens.routeSystem)
  })
})

describe('rows, joins and features', () => {
  test('tagged rows split per layer; untagged rows feed every layer', () => {
    const rows = [{ entity: 'a', id: 1 }, { entity: 'b', id: 2 }]
    expect(rowsForLayer(rows, 'a', ['a', 'b'])).toEqual([{ entity: 'a', id: 1 }])
    const select = [{ entity: 'something-else', id: 1 }]
    expect(rowsForLayer(select, 'metro-coverage-gnd', ['metro-coverage-gnd'])).toEqual(select)
  })

  test('join states carry styled fields keyed by the row key', () => {
    const view = gndChoropleth()
    const states = joinStates([{ gnd_id: 'LK-1', share: '42.5', name: 'A' }, { share: 3 }], 'gnd_id', view.layers[0]?.style)
    expect([...states.entries()]).toEqual([['LK-1', { present: true, share: 42.5 }]])
    expect(joinLabelExpr([{ gnd_id: 'LK-1', name: 'A' }], 'gnd_id', 'name')).toEqual(['match', ['to-string', ['get', 'id']], 'LK-1', 'A', ''])
  })

  test('rows become point or feature geometry with a stable feature id', () => {
    const features = featuresFromRows([
      { id: 's1', name: 'Fort', lat: 6.93, lng: 79.85 },
      { type: 'Feature', id: 'r', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, properties: { name: 'Line' } },
      { name: 'no geometry' },
    ])
    expect(features).toHaveLength(2)
    expect(features[0]?.geometry).toEqual({ type: 'Point', coordinates: [79.85, 6.93] })
    expect(features[0]?.properties.__fid).toBe('s1')
    expect(features[1]?.properties.name).toBe('Line')
  })
})

describe('legend and tooltip', () => {
  test('threshold legends label each class with the unit', () => {
    const view = gndChoropleth()
    const legend = buildLegend(view, tokens, {}, (layer) => layer.visible)
    expect(legend).toHaveLength(1)
    const entry = legend[0]
    expect(entry?.kind).toBe('classes')
    if (entry?.kind !== 'classes') throw new Error('expected classes')
    expect(entry.title).toBe('Residents served')
    expect(entry.items.map((item) => item.label)).toEqual(['< 10%', '10%–40%', '40%–70%', '≥ 70%'])
    expect(entry.items[3]?.color).toBe('#7a1f0b')
  })

  test('hidden or opted-out layers have no legend; ramps carry min and max labels', () => {
    const view = gndChoropleth()
    expect(buildLegend(view, tokens, {}, () => false)).toEqual([])
    const layer = view.layers[0] as MapLayerView
    layer.style = { geometry: 'fill', colorBy: { field: 'share', scale: 'sequential', unit: '%' } }
    const [entry] = buildLegend(view, tokens, { [layer.id]: { share: { min: 0, max: 80, count: 9 } } }, () => true)
    expect(entry?.kind === 'ramp' ? [entry.minLabel, entry.maxLabel] : null).toEqual(['0%', '80%'])
    layer.legend = false
    expect(buildLegend(view, tokens, {}, () => true)).toEqual([])
  })

  test('tooltips lead with labelled fields and skip internals', () => {
    const view = gndChoropleth()
    const model = tooltipFor({ id: 'LK-1', gnd_id: 'LK-1', name: 'Kollupitiya', share: 42.5, lat: 6.9, __fid: 'x', pop: 1200 }, view.layers[0])
    expect(model.title).toBe('Kollupitiya')
    expect(model.rows[0]).toEqual({ label: 'Residents served', value: '42.5%' })
    expect(model.rows.map((row) => row.label)).toEqual(['Residents served', 'Gnd id', 'Pop'])
  })
})

describe('result geometry and layer filters', () => {
  const walkshed = {
    geometry: {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', id: 'ws-1', geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }, properties: { id: 'ws-1', method: 'network', minutes: 10 } },
        { type: 'Feature', id: 'ws-2', geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }, properties: { id: 'ws-2', method: 'radius', minutes: 10 } },
      ],
    },
  }

  test('untagged geometry belongs to the first layer and honours the layer filter', () => {
    const layer: MapLayerView = { id: 'metro_walkshed', visible: true, filter: { method: 'network', minutes: 10 } }
    const rows = geometryRowsForLayer(walkshed, layer, 0, ['metro_walkshed'])
    expect(rows.map((row) => row.id)).toEqual(['ws-1'])
    expect(featuresFromRows(rows)[0]?.properties.__fid).toBe('ws-1')
    expect(geometryRowsForLayer(walkshed, { id: 'other', visible: true }, 1, ['metro_walkshed', 'other'])).toEqual([])
  })

  test('filters match scalars and treat null as missing', () => {
    expect(matchesLayerFilter({ kind: 'network', minutes: '10' }, { kind: 'network', minutes: 10 })).toBe(true)
    expect(matchesLayerFilter({ kind: 'radius' }, { kind: 'network' })).toBe(false)
    expect(matchesLayerFilter({}, { closed: null })).toBe(true)
    expect(layerRows([{ kind: 'a' }, { kind: 'b' }], { id: 'x', visible: true, filter: { kind: 'b' } }, ['x'])).toEqual([{ kind: 'b' }])
  })
})

describe('boolean categories', () => {
  test('categorical matching stringifies values, so booleans match "true"/"false" keys', () => {
    const colorBy = { field: 'within_10min', scale: 'categorical' as const, categories: { true: 'route-system' as const, false: 'route-flag' as const } }
    expect(colorExpression(colorBy, 'feature-state', tokens, null, '#999999')).toEqual(['match', ['to-string', ['feature-state', 'within_10min']], 'true', '#00a191', 'false', '#d14321', '#999999'])
    const states = joinStates([{ gnd_id: 'LK-1103015', within_10min: true }], 'gnd_id', { geometry: 'fill', colorBy })
    expect(states.get('LK-1103015')).toEqual({ present: true, within_10min: true })
  })
})
