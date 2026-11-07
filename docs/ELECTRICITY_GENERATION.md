# Electricity generation storage

The catalogue serves validated snapshots from our storage, not a proxy to the upstream API. This preserves history, allows reproducible Dataset Versions and keeps charts working during upstream outages or revisions.

## Datasets

| Dataset | Grain | Unit | Initial coverage |
| --- | --- | --- | --- |
| `electricity-generation-quarter-hourly` | Source timestamp with columns for each fuel and BESS | MW | 95 timestamps on 11 September 2026, 00:15–23:45 |
| `electricity-generation-daily` | Date and station group | GWh | 11 station groups on 11 September 2026 |

These are one-day snapshots, not a backfilled archive or live feed. No automatic refresh job is enabled (`scheduled: false`).

## Public sources

The [NSO dashboard](https://edlcare.edl.lk/gensum/details) uses these unauthenticated endpoints:

- [Quarter-hour load curve](https://edlcare.edl.lk/api/gensum/load-curve?date=2026-09-11)
- [Daily energy](https://edlcare.edl.lk/api/gensum/energy-data?date=2026-09-11)

At 18:45 on 11 September, BESS is 9.996 MW, matching the screenshot's rounded 10 MW. The catalogue documents available measurements without republishing a news story as Analysis.

## Ingest and refresh

```bash
bun run build:electricity-generation --date=2026-09-11
# Backfill in batches of at most 31 days:
bun run build:electricity-generation --from=2026-09-01 --to=2026-09-10
bun run build:dataset-versions
bun run datasets:sync
```

The importer fetches both endpoints, checks dates, duplicates, numeric values and unexpected power fields, then validates normalized tables. Raw responses are archived under `data/sources/nso-generation/<date>/` with SHA-256 filenames and URL/retrieval-time sidecars. Revisions produce new raw files. Validated dates replace corresponding served rows; all other dates remain. Empty or invalid responses fail the batch before served files change. No interpolation, zero filling or conversion of MW samples into invented daily energy occurs.

Normalized tables live in `public/data/`, following the existing platform table/ASSETS path. They are registered in the ontology, source registry, immutable Dataset Version manifest and R2-backed site catalogue. CMS notes and charts derive from the definitions in `packages/datasets`. The normal release process publishes each validated version.

For offline replay, `--source-dir=<dir>` expects `load-curve-YYYY-MM-DD.json` and `energy-data-YYYY-MM-DD.json`. `--output-dir=<dir>` avoids changing served tables and the source registry; validated inputs are still archived locally.

For an unattended production feed, the next step is scheduled ingestion using this validation contract, content-addressed raw objects in R2 and date-partitioned normalized history. Re-fetch recent dates for revisions, advance a latest-version pointer only after validation, and serve the last good version on failure. This change supplies the importer and initial catalogue entries; it does not enable a scheduler or claim historical backfill.

## Semantics

- Source timestamps lack an explicit timezone offset; retain the clock text.
- The initial curve has 95 samples, not an assumed complete set of 96 intervals.
- BESS is signed aggregate power, distinct from rated MW and usable MWh.
- Daily station-group energy is separate. The initial response has no separately named BESS energy row; do not infer one.
- Source renewable coverage includes estimated components described in dashboard notes.
- The source states no open reuse licence; metadata records `permission_unclear`.
