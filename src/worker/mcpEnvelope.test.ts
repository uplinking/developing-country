import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  STRUCTURED_MAX_BYTES,
  TEXT_GEOMETRY_MAX_BYTES,
  UI_GEOMETRY_MAX_BYTES,
  toolResultEnvelope,
} from './mcpEnvelope'
import { bboxGeometrySource, querySpatial } from './querySpatial'
import { parseGeometryRef, selectBboxGeometry, drawnFeature } from '../shared/bboxGeometry'
import type { JsonObject } from '../shared/json'
import { jsonObjectFromSerializable } from '../shared/json'
import type { Env } from './types'

const ORIGIN = 'https://explore.developing-country.org'
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength

function square(i: number, vertices: number) {
  const ring: number[][] = []
  for (let v = 0; v < vertices; v++) {
    const a = (v / vertices) * Math.PI * 2
    ring.push([79.85 + i * 0.001 + Math.cos(a) * 0.004123456, 6.92 + Math.sin(a) * 0.004123456])
  }
  ring.push(ring[0]!)
  return { type: 'Feature', id: `f${i}`, properties: { id: `f${i}`, kind: 'stop' }, geometry: { type: 'Polygon', coordinates: [ring] } }
}

function bboxResult(features: number, vertices: number): JsonObject {
  const polygons = Array.from({ length: features }, (_, i) => square(i, vertices))
  return {
    op: 'bbox',
    entities: ['metro_walkshed'],
    summary: `${features} walksheds in bbox`,
    count: features,
    truncated: false,
    features: polygons.map((s) => ({ id: s.id, kind: 'stop' })),
    geometry: { type: 'FeatureCollection', features: polygons },
    stage: [],
  }
}

const SOURCE = {
  entity: 'metro_walkshed',
  path: '/data/metro_walksheds.geojson',
  bbox: [79.8, 6.8, 80, 7] as [number, number, number, number],
  where: [['kind', 'stop'] as [string, string]],
  limit: 500,
  idField: 'id',
}

describe('MCP tool result envelope', () => {
  test('strips geometry unless include_geometry was asked for', () => {
    const rec = bboxResult(3, 8)
    const out = toolResultEnvelope('query_data', { op: 'bbox' }, rec, { origin: ORIGIN, geometrySource: null })
    expect(out.structuredContent?.geometry).toBeUndefined()
    expect(out.content[0]!.text).not.toContain('coordinates')
  })

  test('keeps small geometry inline in both blocks', () => {
    const rec = bboxResult(3, 8)
    const out = toolResultEnvelope('query_data', { op: 'bbox', include_geometry: true }, rec, { origin: ORIGIN, geometrySource: SOURCE })
    expect(out.structuredContent?.geometry).toEqual(rec.geometry)
    expect(JSON.parse(out.content[0]!.text).geometry).toEqual(rec.geometry)
    expect(out.structuredContent?.geometry_ref).toBeUndefined()
  })

  test('hands multi-megabyte geometry to the widget by reference and keeps every row', () => {
    const rec = bboxResult(400, 400)
    expect(bytes(rec.geometry)).toBeGreaterThan(2 * 1024 * 1024)
    const out = toolResultEnvelope('query_data', { op: 'bbox', include_geometry: true }, rec, { origin: ORIGIN, geometrySource: SOURCE })
    const ui = out.structuredContent!
    expect(ui.geometry).toBeUndefined()
    expect(ui.geometry_omitted).toBe('size_limit')
    const ref = parseGeometryRef(ui.geometry_ref)
    expect(ref).not.toBeNull()
    expect(ref!.path).toBe('/data/metro_walksheds.geojson')
    expect(ref!.features).toBe(400)
    expect(ref!.bytes).toBe(bytes(rec.geometry))
    expect(bytes(ui)).toBeLessThan(STRUCTURED_MAX_BYTES)
    expect(ui.features).toHaveLength(400)

    const text = JSON.parse(out.content[0]!.text) as JsonObject
    expect(text.geometry).toBeUndefined()
    expect(text.features).toHaveLength(400)
    expect(String(text.geometry_note)).toContain('400 shapes')
    expect((text.geometry_ref as JsonObject).url).toBe(`${ORIGIN}/data/metro_walksheds.geojson`)
    expect(out.content[0]!.text.length).toBeLessThan(64 * 1024)
  })

  test('mid-sized geometry stays in structuredContent but leaves the model text', () => {
    const rec = bboxResult(40, 60)
    const size = bytes(rec.geometry)
    expect(size).toBeGreaterThan(TEXT_GEOMETRY_MAX_BYTES)
    expect(size).toBeLessThan(UI_GEOMETRY_MAX_BYTES)
    const out = toolResultEnvelope('query_data', { op: 'bbox', include_geometry: true }, rec, { origin: ORIGIN, geometrySource: SOURCE })
    expect(out.structuredContent?.geometry).toEqual(rec.geometry)
    expect(JSON.parse(out.content[0]!.text).geometry).toBeUndefined()
  })

  test('trims structured rows to the hard ceiling and says so', () => {
    const rows = Array.from({ length: 5000 }, (_, i) => ({ id: `r${i}`, note: 'x'.repeat(200) }))
    const rec: JsonObject = { op: 'overlay', count: rows.length, truncated: false, features: rows }
    const out = toolResultEnvelope('query_data', { op: 'overlay' }, rec, { origin: ORIGIN, geometrySource: null })
    const ui = out.structuredContent!
    expect(bytes(ui)).toBeLessThanOrEqual(STRUCTURED_MAX_BYTES)
    expect(ui.truncated).toBe(true)
    expect((ui.structured_rows_trimmed as JsonObject).returned).toBe(5000)
    // The model still reads every row.
    expect(JSON.parse(out.content[0]!.text).features).toHaveLength(5000)
  })

  test('saved views keep their preview bounds', () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({ year: 2000 + i, value: i }))
    const rec: JsonObject = { op: 'select', rows, features: rows, view_url: 'https://x/views/view_1', total_count: 1000 }
    const out = toolResultEnvelope('query_data', { op: 'select' }, rec, { origin: ORIGIN, geometrySource: null })
    expect(out.structuredContent?.rows).toHaveLength(200)
    expect(JSON.parse(out.content[0]!.text).rows).toHaveLength(50)
  })
})

describe('real walkshed asset', () => {
  const root = join(import.meta.dir, '../..')
  const env = {
    ENABLE_HEAVY_SPATIAL: '0',
    ASSETS: {
      async fetch(request: Request) {
        const path = new URL(request.url).pathname
        try {
          return new Response(readFileSync(join(root, 'public', path)))
        } catch {
          return new Response('not found', { status: 404 })
        }
      },
    },
  } as unknown as Env

  test('a 10-minute stop walkshed map fits the envelope and the widget can rebuild it exactly', async () => {
    const args: JsonObject = {
      op: 'bbox',
      entities: 'metro_walkshed',
      bbox: [79.8, 6.8, 80, 7],
      include_geometry: true,
      where: { kind: 'stop', minutes: 10 },
    }
    const rec = jsonObjectFromSerializable(await querySpatial(env, null, args))!
    // The raw answer is the size that broke ChatGPT: well over half a megabyte of coordinates.
    expect(bytes(rec.geometry)).toBeGreaterThan(UI_GEOMETRY_MAX_BYTES)

    const out = toolResultEnvelope('query_data', args, rec, { origin: ORIGIN, geometrySource: bboxGeometrySource(args) })
    const total = bytes({ jsonrpc: '2.0', id: 1, result: out })
    expect(total).toBeLessThan(256 * 1024)

    const ref = parseGeometryRef(out.structuredContent!.geometry_ref)!
    const asset = JSON.parse(readFileSync(join(root, 'public', ref.path), 'utf8')) as { features: Parameters<typeof selectBboxGeometry>[0] }
    const { picked } = selectBboxGeometry(asset.features, ref)
    const rebuilt = { type: 'FeatureCollection', features: picked.map(({ feature, id }) => drawnFeature(feature, id)) }
    expect(rebuilt).toEqual(rec.geometry as object)
  })
})
