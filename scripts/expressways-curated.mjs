// Curated proposed expressways not yet in OpenStreetMap. Shared single source of
// truth: fetch-expressways.mjs appends these after the Overpass pull, and
// apply-curated-expressways.mjs injects them into the built geojson without a
// network round-trip (Overpass is flaky). Vertices are INDICATIVE (town-to-town,
// digitised 2026-08 from the RDA programme / 2026 budget coverage), not surveyed
// centrelines — hence status "proposed" (drawn dotted) and the note.

/** Definitions; keep flat so both consumers build identical Features. */
export const PROPOSED_EXPRESSWAYS = [
  {
    id: 'ruwanpura-expressway',
    name: 'Ruwanpura Expressway',
    cost: 'Rs 15bn (Phase 1 contract)',
    stages: { proposed: '2020', approved: '2026', construction: '2026 (target)', operational: '2030 (target)' },
    note: 'Links the Western & Sabaragamuwa provinces (Kahathuduwa on the E01 → Ratnapura → Pelmadulla). Phase 1 (~24 km) contract awarded; construction to start 2026. Alignment indicative.',
    source: 'Road Development Authority',
    source_url: 'https://economynext.com/sri-lanka-to-award-rs15bn-contract-for-ruwanpura-expressway-phase-1-279530/',
    // Kahathuduwa (E01) → Ingiriya → Kuruwita → Ratnapura → Pelmadulla
    coordinates: [
      [79.976, 6.802], [80.045, 6.762], [80.128, 6.735], [80.230, 6.720],
      [80.330, 6.708], [80.400, 6.686], [80.480, 6.640], [80.542, 6.612],
    ],
  },
  // NOTE: the Kurunegala–Dambulla (Central Expressway northern extension) is NOT
  // curated here — OpenStreetMap already carries it as `E04 Central Expressway`
  // with the surveyed alignment, correctly split into a under-construction
  // Kurunegala→Galewela section and a proposed Galewela→Dambulla section. A
  // curated indicative line would just double-draw that corridor. Only add a
  // curated expressway when OSM has NO representation of it.
]

/** The ids we own — used to de-dupe before injecting (idempotency). */
export const CURATED_EXPRESSWAY_IDS = new Set(PROPOSED_EXPRESSWAYS.map((c) => c.id))

/** Build the GeoJSON Features (same shape the layer + featureFormat expect). */
export function curatedExpresswayFeatures() {
  return PROPOSED_EXPRESSWAYS.map((c) => ({
    type: 'Feature',
    id: c.id,
    properties: {
      ref: null,
      name: c.name,
      status: 'proposed',
      highway: 'proposed',
      lanes: 4,
      curated: true,
      cost: c.cost,
      stages: c.stages,
      note: c.note,
      source: c.source,
      source_url: c.source_url,
      updated: '2026-08',
    },
    geometry: { type: 'LineString', coordinates: c.coordinates },
  }))
}
