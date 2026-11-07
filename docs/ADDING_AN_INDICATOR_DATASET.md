# Add an indicator dataset

The product-facing seam for an indicator dataset is one entry in
`packages/datasets/src/presets.ts`. Keep its identity, source semantics, CMS
dataset-note copy and default branded chart together in that definition.

## Required inputs

Before registering a dataset, add its reproducible public table, Source records
and immutable Dataset Version through the existing ingestion workflow. The
definition must then include:

- stable `id`, public `title` and short `label`;
- a source-backed description, `sourceIds` and honest `vintage`;
- complete `note` copy, including the main caveat;
- at least one chart preset whose first entry is the public highlight.

The chart preset stores semantic intent only. Use human labels, explicit units
and an honest query slice; Flint/ECharts remains the renderer adapter behind the
product-owned Data View contract.

Use subject names for datasets and chart titles: `Poverty estimates`,
`Employment by industry`, or `Government budget balance`. Put the selected
threshold, units, report date and comparison method in the chart description or
axis labels. Add a date or definition to a title only when it distinguishes
otherwise identical views. Descriptions should say what the figures measure;
extraction steps, checksums and import terminology belong in source metadata
and methods notes.

## Generate every projection

From the repository root, run:

```bash
bun run datasets:sync
```

That one command regenerates the small fail-closed site registry, the complete
reviewed CMS seed, the non-dataset runtime seed, and the content-addressed R2
catalogue. It performs no remote writes. `bun run check` fails when a generated
projection drifts from its definition.

## Verify and publish

Run `bun run check`, both Cloudflare dry-runs and the bundle guards. Uploading
the R2 object, synchronizing a remote CMS, applying migrations, deploying and
publishing remain separate explicitly authorized operations. Agents may prepare
the deterministic dataset note; humans retain the publication decision.

## Append the CMS preview registration

New dataset IDs also need a new numbered SQL migration under
`apps/site/migrations/`. Generate its contents with
`datasetPreviewExtensionSql(newIds)` from `apps/site/src/datasetPreviewSql.ts`.
The migration tests apply every extension after 0008 and compare the resulting
registry with the current catalog. Never rewrite an applied migration to add
IDs. Prepare the migration locally; applying it remotely remains a separate
authorized step before syncing those dataset notes.

For API sources that need automatic refreshes and retained history, use the
[scheduled ingestion contract](API_INGESTION.md). Add a source adapter to the
shared pipeline; catalogue metadata and previews then read published R2 versions
without rebuilding or publishing CMS content on each refresh.
