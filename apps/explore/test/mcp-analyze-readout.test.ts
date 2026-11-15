import { describe, expect, test } from 'bun:test'
import type { AnalyzeResult } from '../src/map/analyzeClient'

// src/base.ts reads BASE_URL when first loaded, and bun shares that module across
// test files, so set it before importing anything that pulls it in.
process.env.BASE_URL = process.env.BASE_URL ?? '/'
const { bodyFromResult } = await import('../src/mcpResult')
const { formatAnalyze } = await import('../src/map/featureFormat')

// Trimmed from a real analyze_location result for Colombo Fort railway station.
const result = {
  location: { lat: 6.93352, lng: 79.85004, radius_km: 1 },
  generated_at: '2026-11-08T19:11:11.309Z',
  summary: 'Colombo District · Slave Island GND · 0 developments nearby',
  saved: { id: 'anl_test', url: 'https://explore.developing-country.org/?lat=6.93352&lng=79.85004' },
  district_demographics: { id: 'LK-11', name: 'Colombo', population: 2375415, density: 3468, area: 685 },
  nearest_gnd: { id: 'LK-1103130', name: 'Slave Island', parent: 'Colombo', district: 'Colombo', pop: 3189, distance_km: 0.898 },
  nearest_expressway: { name: 'Port Access Elevated Highway', ref: null, status: 'construction', distance_km: 0.443 },
  planned_developments_nearby: [],
  attractions_nearby: [{ name: 'Pettah Market', category: 'attraction', distance_km: 0.304 }],
  waterfalls_nearby: [],
  trails_nearby: [],
  cycling_nearby: [],
  parks_containing_or_near: [],
  prospects_nearby: [],
}

describe('MCP App analyze readout', () => {
  test('structuredContent keeps every analyze section', () => {
    const body = bodyFromResult({ structuredContent: result })
    expect(body.nearest_gnd?.name).toBe('Slave Island')
    expect(body.nearest_expressway?.name).toBe('Port Access Elevated Highway')
    expect(body.attractions_nearby?.map((a) => a.name)).toEqual(['Pettah Market'])
    expect(body.saved?.id).toBe('anl_test')
    expect(body.generated_at).toBe(result.generated_at)
  })

  test('text-only results are parsed the same way', () => {
    const body = bodyFromResult({ content: [{ type: 'text', text: JSON.stringify(result) }] })
    expect(body.nearest_gnd?.name).toBe('Slave Island')
  })

  test('every list the analyze sheet renders survives parsing', () => {
    const body = bodyFromResult({ structuredContent: result })
    for (const key of [
      'planned_developments_nearby',
      'attractions_nearby',
      'waterfalls_nearby',
      'trails_nearby',
      'cycling_nearby',
      'parks_containing_or_near',
      'prospects_nearby',
    ] as const) {
      expect(Array.isArray(body[key])).toBe(true)
    }
  })

  test('the sheet shows the GND and expressway instead of empty states', () => {
    // SAFETY: the parsed body carries every AnalyzeResult field asserted above.
    const info = formatAnalyze(bodyFromResult({ structuredContent: result }) as unknown as AnalyzeResult)
    const text = JSON.stringify(info)
    expect(text).toContain('Slave Island')
    expect(text).toContain('Port Access Elevated Highway')
    expect(text).toContain('Pettah Market')
    // Each section keeps its `empty` text; the sheet shows it only when rows are empty.
    for (const title of ['Nearest GN division', 'Nearest expressway', 'Nature & tourism nearby']) {
      const section = info.sections?.find((s) => s.title === title)
      expect(section?.rows.length ?? 0).toBeGreaterThan(0)
    }
  })

  test('malformed analyze fields are dropped, not passed through', () => {
    const body = bodyFromResult({
      structuredContent: { ...result, nearest_gnd: 'Slave Island', attractions_nearby: [1, { name: 'ok' }], saved: { id: 3 } },
    })
    expect(body.nearest_gnd).toBeUndefined()
    expect(body.attractions_nearby).toEqual([{ name: 'ok' }])
    expect(body.saved).toBeUndefined()
  })
})
