# Scheduled API datasets

The ingestion Worker runs separately from the Astro/CMS Worker and the Explorer.
It uses the existing `developing-country-data` R2 bucket. No new database or CMS
collection is needed. Electricity is the first adapter, not a special case in
publishing, storage, queries, or catalogue loading.

```
Registered API adapter → validate daily tables → immutable R2 objects
                                               ↓ atomic source pointer
                          catalogue / previews / query_data → saved evidence
```

## Contract and layout

- `packages/ingestion/src/registry.ts`: browser-safe allowlist, source ID, dataset
  IDs, earliest report date, source timezone, correction window, backlog budget,
  and response-size limit. Source and dataset IDs must already be registered in
  the platform and CMS catalogue.
- `packages/ingestion/src/pipeline.ts`: bounded HTTP reads, raw archives,
  validation, daily partition publication, correction handling, concurrency
  control, and run records. It has no electricity-specific branches.
- `workers/ingestion/index.ts`: adapter wiring and scheduled entry point.
- `packages/ingestion/src/electricity.ts`: pure NSO normalization shared with
  the existing offline importer. MW and GWh remain separate tables. Missing
  observations remain absent/null; signed battery power remains signed.
- `packages/ingestion/src/storage.ts`: checksummed runtime reads and evidence.

Adapters implement `ApiAdapter.requests(date)` and `normalize(date, responses)`.
Normalization returns one nonempty `IndicatorTableV1` per registered dataset.
Every row must have a `report_date` equal to the requested calendar date; country
and source identities are verified before publication. This first contract is
for daily-partitioned Sri Lankan tables. A source with a different grain needs
an explicit contract extension, rather than pretending its records are daily.

R2 keys start with `ingestion/v1/<source-id>/`:

| Key | Purpose |
| --- | --- |
| `raw/<date>/<request-id>/<sha256>.json` | Original response bytes, including parseable/invalid revisions |
| `receipts/<date>/<sha256>.json` | Source URL, retrieval time and raw checksum |
| `tables/<dataset-id>/<date>/<sha256>.json` | Validated daily partitions |
| `versions/<dataset-id>/<version-id>.json` | Immutable partition index and evidence metadata |
| `manifests/<sha256>.json` | One source publication containing every dataset |
| `latest.json` | Checksummed reference to the published source manifest |
| `runs/<scheduled-time>-<uuid>.json` | Attempt lifecycle, dates, successes and failures |
| `status.json` | Most recent completed attempt |

All table writes for a date must succeed before that date is included. The
publisher then writes immutable versions and a manifest and changes `latest`
last, with an R2 ETag precondition. A concurrent publication fails the comparison
and retries on the next run; it cannot erase another run's dates. Identical data
keeps its version ID. Old partitions and versions remain readable after revisions.
Orphaned staging objects are harmless and are not public versions.

## Schedule and failures

`wrangler.ingestion.jsonc` runs at 00:23, 06:23, 12:23 and 18:23 UTC. Each source
revisits its last three completed local report dates and fills up to three other
missing dates per run, starting at its configured `startDate`. Backlog retries
rotate so permanently absent reports cannot block later gaps. Current local-day
observations are excluded. This records scheduled snapshots, not real-time data.

An upstream error, empty response, schema change or failed table write leaves
that report's previous partition intact. Other successfully validated dates may
publish. Run records distinguish success, partial success and failure. A run
killed before completion remains `running` in its run record. Inspect Worker
observability and R2 run records for details; no email/Slack notifications are
configured. The public read response exposes attempt status and timestamps,
without raw upstream error text.

The correction window does not detect revisions to already archived older dates.
Replay those dates explicitly. Never delete historical versions referenced by
published analysis or saved views; do not attach a blanket expiry rule to this
prefix.

## Readers and CMS

- `GET /api/datasets/<dataset-id>` on the Explorer serves the latest archived
  report date, actual Dataset Version, available dates and attempt status.
  Optional `date=YYYY-MM-DD` chooses a report and `version=dsv_…` pins an archived
  version. It is public, read-only, allowlisted and cached for 60 seconds.
- `query_data` / `op: select` use the same archived partitions. `version_id`
  optionally pins an ingestion version. Filter `report_date` with existing
  `eq`, `in`, `gte`, `lte` operators when an archive exceeds 31 dates; broad
  requests fail rather than silently truncating history. The normal 200-row
  query limit still applies.
- Preset charts use the latest report date and the returned version evidence.
  Before ingestion is initialized, they use the existing checked-in snapshot.
  Upstream/runtime failures do not silently fall back to an older bundled file.
- Persistent Data Views retain the exact runtime Dataset Version and result
  checksum they used. Later imports do not rewrite those saved results.
- The site's immutable catalogue is overlaid with published runtime version,
  row count, vintage and source-refresh metadata. The home page and `/data` pages have a 60-second
  cache lifetime. Filters, themes, publishers and badges retain their CMS and
  registry relationships.
- CMS dataset notes, titles and editorial content stay under the existing
  editorial workflow. Ingestion never creates or publishes articles. `/analysis`
  stays for original editorial work.

The legacy GitHub `refresh-data.yml` job remains a review-PR pipeline. Electricity
keeps `scheduled: false` in that registry to avoid a second scheduler running its
old offline command. Its operational scheduler is this Worker; runtime catalogue
freshness reports that schedule once the first snapshot is published.

## Adding a source

1. Register its provenance/licence, dataset IDs, table fields, themes and CMS
   dataset notes using `docs/ADDING_AN_INDICATOR_DATASET.md`.
2. Add a browser-safe source entry in `registry.ts`. Choose a conservative start
   date, response bound and correction/backlog budgets.
3. Implement a pure adapter in this directory. Validate dates, keys, units,
   duplicates, null handling and upstream schema changes explicitly. Do not
   infer zeros or unit conversions without a documented source contract.
4. Wire it into the Worker adapter list. Add fixture tests for valid responses,
   malformed responses, revisions and source-specific gaps. The shared pipeline
   and reader tests already cover atomic publication, concurrent writers,
   immutable replay, corruption and runtime evidence.
5. Run `bun run datasets:sync`, `bun run check`, and all Worker dry runs.
   Deploy the reader changes and ingestion Worker together. No per-refresh
   deployment, CMS publication or review PR is needed after activation.

## Local validation and replay

```sh
bunx wrangler dev --config wrangler.ingestion.jsonc --test-scheduled \
  --port 8893 --persist-to .wrangler/ingestion-validation
curl 'http://localhost:8893/cdn-cgi/local/scheduled?format=json'
```

This calls the real public API but writes **local R2 only**. Run the Explorer
Worker with the same `--persist-to` directory to test reads of those objects.
The normal Vite frontend proxies `/api` to the local Explorer Worker on 8787.

For a bounded historical replay, start the same local Worker with:

```sh
bunx wrangler dev --config wrangler.ingestion.jsonc --test-scheduled \
  --port 8893 --persist-to .wrangler/ingestion-validation \
  --var BACKFILL_SOURCE:nso-generation-api \
  --var BACKFILL_FROM:2026-09-11 --var BACKFILL_TO:2026-09-13
```

Invoke the scheduled endpoint above. Bounds are inclusive, historical and at
most 31 days. These overrides are for operator replay; do not leave them in the
production schedule. Production replay uses the same local command with an
explicitly authorized remote R2 binding (`remote: true` in a temporary Wrangler
config). That changes real published data; inspect source/date bounds first.
There is no public HTTP ingestion or backfill endpoint.

## Deployment

Run `bun run dry-run:ingestion`, `bun run dry-run:explore`, and
`bun run dry-run:site`. Successful main-branch CI automatically deploys the Explorer, site, then ingestion Worker. Deploying ingestion activates the configured cron on Cloudflare. For manual recovery, use `bun scripts/deploy-production.ts`. It does not upload CMS content. The first scheduled run initializes
R2 from the API; until then existing bundled data remains available. Verify
`/api/datasets/electricity-generation-quarter-hourly`, the `ENER` catalogue
filter, and Worker logs after that run. The source has no stated open reuse
licence; catalogue licence badges continue to reflect that limitation.

Cloudflare references: [Cron triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
and [R2 conditional writes](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/#conditional-operations).

Schema changes (including units, field types and primary keys) are rejected for an existing dataset ID. Register a new dataset for incompatible changes; old versions remain readable. Readers also reject mixed-schema legacy partitions. Backfill coverage is checked across every registered dataset, so adding a dataset to an existing source fills its historical gaps. Manual replay and automatic scheduling both use the source timezone to exclude the current report day.
