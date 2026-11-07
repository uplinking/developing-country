import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseIndicatorTable } from '@developing-country/datasets'
import { ONTOLOGY } from './ontology'
import { queryData } from './queryData'
import type { Env } from './types'

const ROOT = resolve(import.meta.dir, '../..')

const localAssets = {
  async fetch(request: Request) {
    const path = new URL(request.url).pathname
    if (!path.startsWith('/data/') || path.includes('..')) return new Response('missing', { status: 404 })
    try {
      const bytes = await readFile(resolve(ROOT, 'public', path.slice(1)))
      return new Response(bytes, { headers: { 'content-type': 'application/json' } })
    } catch {
      return new Response('missing', { status: 404 })
    }
  },
}

describe('ontology Indicator Tables', () => {
  test('every registered table can be selected through the Worker adapter', async () => {
    const entities = ONTOLOGY.entities.filter((entity) => entity.storage.kind === 'table')
    expect(entities.length).toBeGreaterThan(0)
    for (const entity of entities) {
      if (entity.storage.kind !== 'table') continue
      const datasetId = entity.dataset_ids?.[0]
      if (!datasetId) throw new Error(`${entity.id} has no dataset id`)
      const artifact = parseIndicatorTable(JSON.parse(
        await readFile(resolve(ROOT, 'public', entity.storage.path.slice(1)), 'utf8'),
      ))
      const fields = artifact.fields.slice(0, 2).map((field) => field.id)
      const result = await queryData({ ASSETS: localAssets } as unknown as Env, {
        op: 'select',
        dataset_id: datasetId,
        fields,
        limit: 1,
      })
      expect(result.dataset_id).toBe(datasetId)
      expect(result.rows).toHaveLength(1)
      expect(result.field_schema.map((field) => field.id)).toEqual(fields)
      expect(result.provenance).toEqual([entity.provenance])
    }
  })
})
