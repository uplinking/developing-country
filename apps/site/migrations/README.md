# CMS migration boundary

EmDash applies its core schema migrations at runtime. This directory contains
append-only, site-owned D1 migrations and is deliberately separate so Wrangler
can never mistake the platform migrations at the monorepo root for CMS
migrations. Apply these only after EmDash has created `ec_articles`.

Migration `0005` must be applied before syncing the indicator dataset notes to
an existing database. The preceding map-only triggers reject unknown published
dataset ids by design; `0005` replaces them with the generated map-or-chart
preview registry and then backfills existing notes.

Migration `0006` appends the derived `land-cover-grid` map contract to that
registry. Apply it before syncing the corresponding note; do not edit the
already-applied `0005` snapshot to add later datasets.

Migration `0009` appends the 15 Treasury indicator contracts. Apply it before
syncing their dataset notes. Future additions use `datasetPreviewExtensionSql`
with an explicit ID list in a new numbered migration; historical migrations
are immutable. Migration tests apply subsequent `*preview*` extensions automatically.

Migration `0010` appends the Treasury guarantee and letter-of-comfort datasets.

Migration `0063` re-creates the `dc_articles_evidence_*` triggers from `0007`
for interactive analysis articles (ADR 0009): views may be reused across body
blocks and `primary_view_url`, and every `view_url` in `dcFigure`, `dcStat`,
`dcGuess`, `dcExplorer` and each `dcScrolly` step must be in
`evidence_bundle.dataViews`. `src/figureEvidenceMigration.test.ts` checks the
derivation from `0007`.

Migration `0066` adds two triggers (0063 is unchanged) that require every
`underlay_urls` entry on `dcFigure` and on each `dcScrolly` step to be one of
the article's `evidence_bundle.dataViews` URLs.
