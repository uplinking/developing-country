import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { serveTables, toCsv, listTables } from './tableExport'
import type { Env } from './types'

const PUBLIC_DIR = fileURLToPath(new URL('../../public', import.meta.url))

function env(): Env {
  return {
    ASSETS: {
      async fetch(request: Request) {
        const path = new URL(request.url).pathname
        try {
          return new Response(readFileSync(`${PUBLIC_DIR}${path}`), { headers: { 'Content-Type': 'application/json' } })
        } catch {
          return new Response('not found', { status: 404 })
        }
      },
    },
  } as unknown as Env
}

function get(path: string): Promise<Response> {
  return serveTables(new Request(`https://explore.developing-country.org${path}`), env(), new URL(`https://x${path}`).pathname)
}

function parseCsv(text: string): string[][] {
  return text.trimEnd().split('\r\n').map((line) => line.split(','))
}

describe('table export', () => {
  test('lists every Indicator Table with CSV and metadata URLs', () => {
    const { tables, count } = listTables()
    expect(count).toBe(tables.length)
    expect(count).toBeGreaterThanOrEqual(100)
    const ccpi = tables.find((table) => table.dataset_id === 'ccpi-monthly')!
    expect(ccpi.csv_url).toBe('https://explore.developing-country.org/api/tables/ccpi-monthly.csv')
    expect(ccpi.reuse?.status).toBe('all_rights_reserved')
  })

  test('serves the whole table as CSV with tidy headers and provenance headers', async () => {
    const response = await get('/api/tables/ccpi-monthly.csv')
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('text/csv; charset=utf-8')
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(response.headers.get('Link')).toContain('rel="describedby"')
    expect(response.headers.get('Link')).toContain('https://www.statistics.gov.lk/')
    expect(response.headers.get('X-Licence-Status')).toBe('all_rights_reserved')
    const rows = parseCsv(await response.text())
    const table = JSON.parse(readFileSync(`${PUBLIC_DIR}/data/ccpi-monthly.json`, 'utf8'))
    expect(rows[0]).toEqual(table.fields.map((field: { id: string }) => field.id))
    expect(rows.length - 1).toBe(table.rows.length)
    expect(response.headers.get('X-Row-Count')).toBe(String(table.rows.length))
  })

  test('filters, subsets and sorts through URL parameters', async () => {
    const response = await get('/api/tables/ccpi-monthly.csv?fields=period,headline_index&period.gte=2026-01&order_by=-period')
    expect(response.status).toBe(200)
    const rows = parseCsv(await response.text())
    expect(rows[0]).toEqual(['period', 'headline_index'])
    expect(rows[1]![0]! > rows[2]![0]!).toBe(true)
    expect(rows.slice(1).every((row) => row[0]! >= '2026-01')).toBe(true)
  })

  test('rejects an unknown parameter with the valid field ids', async () => {
    const response = await get('/api/tables/ccpi-monthly.csv?year=2024')
    expect(response.status).toBe(400)
    const body = await response.json() as { error: string; valid_fields: string[] }
    expect(body.error).toBe('unknown_parameter')
    expect(body.valid_fields).toContain('period')
  })

  test('metadata sidecar carries fields, sources, reuse terms and a citation', async () => {
    const response = await get('/api/tables/ccpi-monthly')
    expect(response.status).toBe(200)
    const body = await response.json() as Record<string, unknown>
    expect(body.csv_url).toBe('https://explore.developing-country.org/api/tables/ccpi-monthly.csv')
    expect((body.reuse as { terms_url: string }).terms_url).toBe('https://www.statistics.gov.lk/')
    expect(String(body.citation)).toContain('Department of Census and Statistics, Sri Lanka')
    expect((body.fields as unknown[]).length).toBeGreaterThan(1)
    expect((body.sources as unknown[]).length).toBeGreaterThan(0)
  })

  test('every listed table exports as CSV', async () => {
    const failures: string[] = []
    for (const table of listTables().tables) {
      const response = await get(`/api/tables/${table.dataset_id}.csv`)
      if (response.status !== 200) failures.push(`${table.dataset_id}: ${response.status} ${await response.text()}`)
    }
    expect(failures).toEqual([])
  })

  test('unknown table is a 404 pointing at the list', async () => {
    const response = await get('/api/tables/no-such-table.csv')
    expect(response.status).toBe(404)
  })

  test('quotes cells that need it and leaves null empty', () => {
    const csv = toCsv(
      [{ id: 'a', role: 'dimension', type: 'string', label: 'A' }, { id: 'b', role: 'measure', type: 'number', label: 'B' }],
      [{ a: 'Colombo, Western', b: null }, { a: 'say "hi"', b: 2 }],
    )
    expect(csv).toBe('a,b\r\n"Colombo, Western",\r\n"say ""hi""",2\r\n')
  })
})
