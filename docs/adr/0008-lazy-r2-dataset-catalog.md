# ADR 0008: Load public dataset metadata from immutable R2 catalogues

- Status: accepted
- Date: 2026-09-01

## Context

The Astro/EmDash Worker was at 95.7% of its repository bundle guard after the
first indicator expansion. Dataset rows already belonged to the Explorer data
plane, but the site still bundled every Dataset Version, Source record,
freshness gap and chart preset. EmDash also embedded the complete operational
content seed in the runtime Worker even though established environments read
published content from D1.

## Decision

The site keeps one small, synchronous registry of dataset ids and canonical
preview URLs because the publication validator and D1 trigger need that
security-sensitive contract without remote I/O. Version, Source, licence and
known-gap metadata is generated as one deterministic catalogue, addressed by
its SHA-256 digest in the `developing-country-data` R2 bucket, and read through
one cached module interface. The reader verifies object length, checksum,
schema, country, dataset coverage and Source references before returning data.
Missing or altered objects fail closed.

The full `seed/seed.json` remains the reviewed operational seed used by
validation, provisioning and dataset-note synchronization. EmDash embeds only
generated `seed/runtime.json`, which retains schemas and non-dataset starter
content. Dataset notes are synchronized explicitly after CMS initialization;
they are not a permanent runtime dependency.

## Consequences

- Adding Sources or Dataset Versions no longer grows the site Worker bundle.
- A fresh isolate performs at most one small R2 read; public Workers Cache
  absorbs repeat page traffic.
- The immutable catalogue must be uploaded before deploying a site build that
  points at it. Upload and deployment remain separately authorized operations.
- Publication validation does not depend on R2 availability and cannot accept
  a dataset or preview URL absent from the bundled registry/D1 contract.
- The catalogue interface has an R2 adapter in production and an in-memory
  adapter in tests; storage details stay behind the module seam.
