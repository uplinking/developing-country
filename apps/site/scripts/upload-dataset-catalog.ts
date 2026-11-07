#!/usr/bin/env bun
import { resolve } from 'node:path'
import { DATASET_CATALOG_POINTER } from '../src/generated/datasetCatalogPointer'

const mode = process.argv[2]
if (mode !== '--local' && mode !== '--remote') {
  console.error('usage: bun scripts/upload-dataset-catalog.ts --local|--remote')
  process.exit(2)
}

const bucket = 'developing-country-data'
const artifact = resolve(import.meta.dir, '../data/dataset-catalog.json')
const command = [
  'bunx', 'wrangler', 'r2', 'object', 'put',
  `${bucket}/${DATASET_CATALOG_POINTER.key}`,
  mode,
  '--force',
  '--content-type', 'application/json; charset=utf-8',
  '--cache-control', 'public, max-age=31536000, immutable',
  '--file', artifact,
  '--config', resolve(import.meta.dir, '../wrangler.jsonc'),
]
const child = Bun.spawn(command, { cwd: resolve(import.meta.dir, '..'), stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' })
process.exit(await child.exited)
