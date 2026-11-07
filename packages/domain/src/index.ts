// Supported platform countries. Adding a country is an explicit contract
// change: widen this union and register its CountryProfile in countries/.
export type CountryCode = 'LK'
export type DatasetId = string
export type DatasetVersionId = string
export type SourceId = string
export type EntityId = string
export type PlaceId = string

export type CompletenessStatus =
  | 'complete'
  | 'partial'
  | 'osm_only'
  | 'derived'
  | 'known_absent'
  | 'unverified'

export interface Completeness {
  status: CompletenessStatus
  coverage: number | null
  coverageNote: string
  knownGaps: string[]
  comparator?: string
}

export interface SourceRef {
  id: SourceId
  title: string
  publisher: string
  url: string
  licence: string
}

export interface DatasetVersionRef {
  datasetId: DatasetId
  versionId: DatasetVersionId
  country: CountryCode
  sourceIds: SourceId[]
  vintage: string
  refreshedAt: string
  checksum: string
  completeness: Completeness
}

export interface EvidenceRef {
  datasetVersions: DatasetVersionRef[]
  sourceIds: SourceId[]
  queryId?: string
  generatedAt: string
}

export type SubjectRef =
  | { kind: 'entity'; id: EntityId }
  | { kind: 'place'; id: PlaceId }

export interface Observation {
  subject: SubjectRef
  measure: string
  value: number | string | boolean | null
  unit?: string
  period?: string
  evidence: EvidenceRef
}

export interface DomainEvent {
  id: string
  subject: SubjectRef
  occurredAt: string
  kind: string
  title: string
  description?: string
  evidence: EvidenceRef
}

export interface Relationship {
  from: SubjectRef
  relation: string
  to: SubjectRef
  evidence: EvidenceRef
}
