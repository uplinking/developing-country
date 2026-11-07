import { parseIndicatorTable, type IndicatorTableV1 } from '../../datasets/src/table'

export interface ReadStore { get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null> }
export interface ObjectRef { key: string; checksum: string }
export interface Partition extends ObjectRef { date: string; rowCount: number }
export interface DatasetSnapshot {
  datasetId: string; country: 'LK'; sourceIds: string[]; versionId: string;
  checksum: string; vintage: string; refreshedAt: string; rowCount: number;
  partitions: Partition[];
}
export interface SourceSnapshot {
  schemaVersion: 1; sourceId: string; publishedAt: string;
  datasets: DatasetSnapshot[];
}
export const latestKey = (sourceId: string) => `ingestion/v1/${sourceId}/latest.json`
export async function digest(body: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body))
  return 'sha256:' + [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('')
}
export async function readJson(store: ReadStore, key: string): Promise<unknown | null> {
  const object = await store.get(key)
  return object ? JSON.parse(new TextDecoder().decode(await object.arrayBuffer())) : null
}
export async function readVerified(store: ReadStore, ref: ObjectRef): Promise<unknown> {
  const object = await store.get(ref.key)
  if (!object) throw new Error('Published ingestion object missing')
  const body = new TextDecoder().decode(await object.arrayBuffer())
  if (await digest(body) !== ref.checksum) throw new Error('Ingestion checksum mismatch')
  return JSON.parse(body)
}
export async function readLatest(store: ReadStore, sourceId: string): Promise<SourceSnapshot | null> {
  const pointer = await store.get(latestKey(sourceId))
  if (!pointer) return null
  const ref = JSON.parse(new TextDecoder().decode(await pointer.arrayBuffer())) as ObjectRef | null
  if (!ref || !/^sha256:[a-f0-9]{64}$/.test(ref.checksum) || ref.key !== `ingestion/v1/${sourceId}/manifests/${ref.checksum.slice(7)}.json`) throw new Error('Invalid ingestion pointer')
  const snapshot = await readVerified(store, ref) as SourceSnapshot
  if (snapshot.schemaVersion !== 1 || snapshot.sourceId !== sourceId || !Array.isArray(snapshot.datasets)) throw new Error('Invalid ingestion manifest')
  return snapshot
}
/** Stable across JSON key/field order, but never across changes in meaning. */
export function tableSchema(table: IndicatorTableV1): string {
  return JSON.stringify({
    schemaVersion: table.schema_version,
    primaryKey: [...table.primary_key].sort(),
    fields: [...table.fields].sort((a, b) => a.id.localeCompare(b.id)).map(field => ({
      id: field.id, role: field.role, type: field.type, label: field.label,
      unit: field.unit ?? null, aggregation: field.aggregation ?? null,
    })),
  })
}
export async function readTable(store: ReadStore, version: DatasetSnapshot, dates?: string[]): Promise<IndicatorTableV1> {
  const partitions = dates ? version.partitions.filter(p => dates.includes(p.date)) : version.partitions
  if (partitions.length > 31) throw new Error('Select at most 31 report dates for an archived dataset query')
  // An empty selection still needs the schema, but must not return that partition's rows.
  const selected = partitions.length ? partitions : version.partitions.slice(-1)
  const tables = await Promise.all(selected.map(async p => {
    const table = parseIndicatorTable(await readVerified(store, p))
    if (table.dataset_id !== version.datasetId || table.country !== version.country ||
      table.source_ids.join() !== version.sourceIds.join() || table.rows.length !== p.rowCount ||
      table.rows.some(row => row.report_date !== p.date)) throw new Error('Partition identity mismatch')
    return table
  }))
  if (!tables[0]) throw new Error('Empty dataset manifest')
  const schema = tableSchema(tables[0])
  if (tables.some(table => tableSchema(table) !== schema)) throw new Error('Incompatible partition schemas')
  return { ...tables[0], vintage: version.vintage, rows: partitions.length ? tables.flatMap(t => t.rows) : [] }
}
export function versionEvidence(version: DatasetSnapshot) {
  return { datasetId: version.datasetId, country: version.country, sourceIds: version.sourceIds,
    versionId: version.versionId, checksum: version.checksum, vintage: version.vintage, refreshedAt: version.refreshedAt,
    completeness: { status: 'partial' as const, coverage: null,
      coverageNote: 'Archived source observations; missing dates and intervals are not inferred or filled.', knownGaps: [] } }
}
