export interface DatasetVersionRecord {
  checksum: string
  country: string
  datasetId: string
  refreshedAt: string
  rowCount?: number
  sourceIds: string[]
  versionId: string
  vintage: string
}

export interface DatasetSourceRecord {
  id: string
  name: string
  publisher: string
  url: string
  licence?: string
  licence_status?: string
  vintage: string
  refreshed: string
}

export interface KnownDataGap {
  id: string
  title: string
  summary: string
  lastChecked: string
}

export interface DatasetCatalog {
  schemaVersion: 1
  country: 'LK'
  versions: DatasetVersionRecord[]
  sources: DatasetSourceRecord[]
  knownDataGaps: KnownDataGap[]
}

export interface DatasetCatalogPointer {
  key: string
  sha256: string
  bytes: number
}

export interface DatasetCatalogObject {
  arrayBuffer(): Promise<ArrayBuffer>
}

export interface DatasetCatalogStore {
  get(key: string): Promise<DatasetCatalogObject | null>
}

export class DatasetCatalogError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DatasetCatalogError'
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function requiredText(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    throw new DatasetCatalogError(`${path} must be a non-empty unpadded string`)
  }
  return value
}

function stringList(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new DatasetCatalogError(`${path} must contain at least one id`)
  }
  const ids = value.map((entry, index) => requiredText(entry, `${path}[${index}]`))
  if (new Set(ids).size !== ids.length) throw new DatasetCatalogError(`${path} contains duplicate ids`)
  return ids
}

function parseVersion(value: unknown, index: number): DatasetVersionRecord {
  const item = record(value)
  if (!item) throw new DatasetCatalogError(`versions[${index}] must be an object`)
  const rowCount = item.rowCount
  if (rowCount !== undefined && (!Number.isSafeInteger(rowCount) || (rowCount as number) < 0)) {
    throw new DatasetCatalogError(`versions[${index}].rowCount must be a non-negative integer`)
  }
  return {
    checksum: requiredText(item.checksum, `versions[${index}].checksum`),
    country: requiredText(item.country, `versions[${index}].country`),
    datasetId: requiredText(item.datasetId, `versions[${index}].datasetId`),
    refreshedAt: requiredText(item.refreshedAt, `versions[${index}].refreshedAt`),
    ...(rowCount === undefined ? {} : { rowCount: rowCount as number }),
    sourceIds: stringList(item.sourceIds, `versions[${index}].sourceIds`),
    versionId: requiredText(item.versionId, `versions[${index}].versionId`),
    vintage: requiredText(item.vintage, `versions[${index}].vintage`),
  }
}

function parseSource(value: unknown, index: number): DatasetSourceRecord {
  const item = record(value)
  if (!item) throw new DatasetCatalogError(`sources[${index}] must be an object`)
  const licence = item.licence
  const status = item.licence_status
  if (licence !== undefined && typeof licence !== 'string') {
    throw new DatasetCatalogError(`sources[${index}].licence must be a string`)
  }
  if (status !== undefined && typeof status !== 'string') {
    throw new DatasetCatalogError(`sources[${index}].licence_status must be a string`)
  }
  return {
    id: requiredText(item.id, `sources[${index}].id`),
    name: requiredText(item.name, `sources[${index}].name`),
    publisher: requiredText(item.publisher, `sources[${index}].publisher`),
    url: requiredText(item.url, `sources[${index}].url`),
    ...(licence === undefined ? {} : { licence }),
    ...(status === undefined ? {} : { licence_status: status }),
    vintage: requiredText(item.vintage, `sources[${index}].vintage`),
    refreshed: requiredText(item.refreshed, `sources[${index}].refreshed`),
  }
}

function parseGap(value: unknown, index: number): KnownDataGap {
  const item = record(value)
  if (!item) throw new DatasetCatalogError(`knownDataGaps[${index}] must be an object`)
  return {
    id: requiredText(item.id, `knownDataGaps[${index}].id`),
    title: requiredText(item.title, `knownDataGaps[${index}].title`),
    summary: requiredText(item.summary, `knownDataGaps[${index}].summary`),
    lastChecked: requiredText(item.lastChecked, `knownDataGaps[${index}].lastChecked`),
  }
}

function unique(values: string[], path: string): void {
  if (new Set(values).size !== values.length) throw new DatasetCatalogError(`${path} contains duplicate ids`)
}

export function parseDatasetCatalog(value: unknown, expectedDatasetIds: readonly string[]): DatasetCatalog {
  const root = record(value)
  if (!root) throw new DatasetCatalogError('catalog must be an object')
  if (root.schemaVersion !== 1) throw new DatasetCatalogError('schemaVersion must equal 1')
  if (root.country !== 'LK') throw new DatasetCatalogError('country must equal LK')
  if (!Array.isArray(root.versions) || !Array.isArray(root.sources) || !Array.isArray(root.knownDataGaps)) {
    throw new DatasetCatalogError('versions, sources and knownDataGaps must be arrays')
  }

  const versions = root.versions.map(parseVersion)
  const sources = root.sources.map(parseSource)
  const knownDataGaps = root.knownDataGaps.map(parseGap)
  unique(versions.map((version) => version.datasetId), 'versions.datasetId')
  unique(versions.map((version) => version.versionId), 'versions.versionId')
  unique(sources.map((source) => source.id), 'sources.id')
  unique(knownDataGaps.map((gap) => gap.id), 'knownDataGaps.id')

  const actualIds = versions.map((version) => version.datasetId).sort()
  const expectedIds = [...expectedDatasetIds].sort()
  if (actualIds.length !== expectedIds.length || actualIds.some((id, index) => id !== expectedIds[index])) {
    throw new DatasetCatalogError('catalog Dataset Versions do not match the registered dataset ids')
  }

  const sourceIds = new Set(sources.map((source) => source.id))
  for (const version of versions) {
    if (version.country !== 'LK') throw new DatasetCatalogError(`Dataset Version ${version.datasetId} has the wrong country`)
    for (const sourceId of version.sourceIds) {
      if (!sourceIds.has(sourceId)) {
        throw new DatasetCatalogError(`Dataset Version ${version.datasetId} references missing source ${sourceId}`)
      }
    }
  }
  return { schemaVersion: 1, country: 'LK', versions, sources, knownDataGaps }
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const input = Uint8Array.from(bytes).buffer
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', input))
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function readDatasetCatalog(
  store: DatasetCatalogStore,
  pointer: DatasetCatalogPointer,
  expectedDatasetIds: readonly string[],
): Promise<DatasetCatalog> {
  const object = await store.get(pointer.key)
  if (!object) throw new DatasetCatalogError(`dataset catalog object is missing: ${pointer.key}`)
  const bytes = new Uint8Array(await object.arrayBuffer())
  if (bytes.byteLength !== pointer.bytes) {
    throw new DatasetCatalogError(`dataset catalog byte length mismatch: expected ${pointer.bytes}, got ${bytes.byteLength}`)
  }
  const digest = await sha256(bytes)
  if (digest !== pointer.sha256) throw new DatasetCatalogError('dataset catalog checksum mismatch')
  let raw: unknown
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes)) as unknown
  } catch {
    throw new DatasetCatalogError('dataset catalog is not valid JSON')
  }
  return parseDatasetCatalog(raw, expectedDatasetIds)
}

export function createDatasetCatalogReader(
  store: DatasetCatalogStore,
  pointer: DatasetCatalogPointer,
  expectedDatasetIds: readonly string[],
): () => Promise<DatasetCatalog> {
  let pending: Promise<DatasetCatalog> | undefined
  return () => {
    pending ??= readDatasetCatalog(store, pointer, expectedDatasetIds).catch((error) => {
      pending = undefined
      throw error
    })
    return pending
  }
}
