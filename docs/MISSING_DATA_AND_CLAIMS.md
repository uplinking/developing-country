# Data gaps and external reporting

`/data` contains available datasets; `/data?tab=missing` contains genuine data gaps. Both use DCAT themes, publisher type and publisher filters. Missing-data publisher means expected data holder. Gap badges and card surfaces are not links. Original-report links go directly to the publisher.

`/analysis` is exclusively for our own essays and opinion. External claims are excluded from its archive, homepage essay cards and RSS. Legacy claim URLs redirect to `/data?tab=missing`; no separate news article is rendered. `/research` redirects to `/analysis` for existing essay links.

## CMS content

The earlier schema retained external report metadata in `articles` with `analysis_kind: tracked_claim`. Those records now supply only the source title, URL and brief context on linked data-gap cards. Their bodies are not public Analysis pages. `missing_data` contains related `data_gaps` CMS content IDs; joins require published records in the same country.

`data_gaps` owns titles, summaries, themes, expected holders, availability, needed fields, existing evidence, next steps, dates and sources. Templates do not import editorial seed content. The seed and draft importer provision CMS records; editors can change them thereafter.

The remaining seeded gaps concern the complete Colombo housing construction inventory and the broader government-building inventory. Individual building dates are public, but the complete inventory and denominator behind the percentage were not located. The cards link directly to the [original News 1st report](https://english.newsfirst.lk/2026/09/12/40-of-colombo-housing-complexes-over-40-years-old).

## Electricity correction

The operator's generation and BESS telemetry are public. The energy gap and derivative claim draft were removed. The available catalogue now contains `electricity-generation-quarter-hourly` and `electricity-generation-daily`, with stored tables, source attribution, Dataset Versions, charts and CMS dataset notes. See [ELECTRICITY_GENERATION.md](./ELECTRICITY_GENERATION.md).

## Release

Apply the schema preflight and site migrations before CMS imports. `0007` installs gap/publication gates; `0008` extends the preview registry to the current catalogue without rewriting earlier migrations. Deploy site/explorer and upload the catalogue through the ordinary release path. No remote release was performed in this change.

The earlier production preflight returned `Collection 'data_gaps' not found`. Browser QA uses local fixtures, not production publication. `content:sync-claim-drafts --url=…` previews missing records; `--apply` creates drafts. Human editors review gap/report metadata and dataset notes before publication. No agency was contacted and no RTI request was filed.
