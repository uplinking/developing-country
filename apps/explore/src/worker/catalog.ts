// Catalog is a projection of the ontology — never a second list of layers.
// Keep getLayerCatalog() as the body of the MCP tool and of GET /api/catalog.

import { catalogEntries, ONTOLOGY, type CatalogEntry } from './ontology'
import { getWorkerCountry } from './country'

export type { CatalogEntry }

// Retained for internal analysis lookups. Public catalog requests are projected
// at request time so long-lived Worker isolates do not freeze freshness state.
export const CATALOG: CatalogEntry[] = catalogEntries()

export function getLayerCatalog(country?: string, heavySpatial = false) {
  const pack = getWorkerCountry(country)
  const layers = catalogEntries()
  return {
    schema_version: 2,
    product: 'developing-country.org',
    layers,
    count: layers.length,
    ontology_version: ONTOLOGY.version,
    generated_at: ONTOLOGY.generated_at,
    country: pack.profile.code,
    runtime_capabilities: {
      heavy_spatial: heavySpatial,
      isochrone: heavySpatial,
      gap_centroid_distance: heavySpatial,
    },
    start_here: ONTOLOGY.start_here,
    field_guide:
      'Each entry is an agent-queryable Dataset/Entity contract. dataset_ids join Entities to refreshable Datasets; field_schema names stable identifiers; storage/path says where the platform reads it; sources and source_ids are projected from the source registry; freshness is computed review urgency (never evidence validity); refreshed_at is the oldest verification date across required sources; and completeness states what is missing. Presentation layers are not datasets.',
    completeness:
      'Every layer/entity carries completeness.status. known_absent means the platform holds no geometry for that class (e.g. silent-zone polygons). osm_only (schools, hospitals) is not an official register. The same graph is available as resource developing-country://ontology.',
  }
}
