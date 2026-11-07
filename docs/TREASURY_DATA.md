# Treasury publications: imported data and refresh

The import contains 17 queryable Indicator Tables (6,422 observations) from
19 English-language publications, including all 15 listed quarterly debt editions. They have dataset notes, chart presets,
Treasury publisher attribution, immutable Dataset Versions and Source freshness.
This is selected-table coverage, **not** a complete import of the Treasury archive.

| Dataset | Coverage | Observations |
| --- | --- | ---: |
| `treasury-public-debt` | 15 editions, 2022 Q3–2026 Q2, including published comparison periods | 662 |
| `treasury-domestic-debt` | Domestic instruments across all 15 quarterly editions | 258 |
| `treasury-external-creditors` | Creditor balances and reported unpaid principal across all 15 editions | 1,058 |
| `treasury-province-debt` | Seven quarterly local-authority tables, 2024 Q4–2026 Q2 | 189 |
| `treasury-soe-finances` | Selected enterprise financial rows, 2021–2025 | 1,795 |
| `treasury-soe-sector-outturn` | SOE sector count, revenue and profit | 64 |
| `treasury-revenue-budget-outturn` | 2025 revenue budget, actual and deviation by department/item | 78 |
| `treasury-fiscal-performance` | 2025 budget/actual/deviation and GDP shares | 100 |
| `treasury-fiscal-in-year` | 2025/2026 budgets, Jan–Apr actuals and reported percentage comparisons | 126 |
| `treasury-financial-soundness` | Banking and finance-company indicators, 2024–2025 | 48 |
| `treasury-procurement-status` | Six procurement statuses across ten reporting institutions | 360 |
| `treasury-procurement-bids` | Ten bid-count bands across ten institutions | 300 |
| `treasury-procurement-competitiveness` | Competitive/noncompetitive counts and reported award values | 120 |
| `treasury-province-transfers` | 2025 recurrent/capital transfers | 20 |
| `treasury-women-msme-finance` | WMSME/non-WMSME loan/deposit counts, values, reporting institutions | 12 |
| `treasury-guarantees` | All 143 June 2026 numbered facilities plus 16 separately recorded shared-balance groups | 1,208 |
| `treasury-letters-of-comfort` | All three June 2026 facilities | 24 |

Local-authority debt is also backfilled for all seven provincial tables published
from Q4 2024 through Q2 2026 (including the scanned Q4 2025 table). September
2025 Central Province prints LKR 200.4 million but USD 0.07 million; that source
conversion discrepancy is retained with a review note.

## Historical coverage and complex tables

Public-debt composition, domestic instruments and country/organization creditors
cover **every quarterly edition listed in the archive**: September 2022;
March/June/September/December 2023, 2024 and 2025; March/June 2026. No Q4 2022
bulletin is listed. Its December position is preserved where published as a
comparison in Q1 2023. The September 2022 report also supplies December 2021
comparisons. These are not invented missing editions.

`reporting_period` identifies the edition separately from the observation
`period`. `observation_role` distinguishes its current period from comparisons;
revisions remain separate observations. `debt_scope` records the reported
perimeter. Abbreviations for the main multilateral creditors and Paris/non-Paris
clubs are expanded in `subject`, while `category` retains the source label.
The `domestic-history` chart uses one current-period observation per available
edition. Currency translation, debt assumptions and restructuring still affect
comparability.

The image-only Q4 2025 summary, domestic and creditor tables were rendered,
read and transcribed into reviewed cells. Wrapped historical rows were reviewed
visually. The June 2026 guarantee annex was reconstructed using word coordinates
and checked against all eleven printed pages (22–32). Original facilities keep
bank names and issue/expiry dates; the 16 merged outstanding cells are separate
shared records with comma-separated `instrument_id` members. They are not copied
onto each loan. The three letters of comfort retain their printed facility data.

Reviewed cells have stable row IDs, page locators and review notes. Refreshes
verify the **whole PDF hash** before using them. Text rows additionally verify
the extracted line hash. This makes manual reading reproducible without requiring
OCR on every build. Changed PDFs still require new review; a matching hash does
not claim that an unreviewed new edition has been imported.

### Source discrepancies retained

- Guarantee serial 23 (page 24) prints outstanding 61.85 under LKR. The page-32
  currency totals differ from the summed rows by exactly 61.85 between USD and
  LKR. The printed placement is retained, not moved to make totals match.
- Listed guarantee original commitments sum to USD 2,934.26 million and LKR
  715,566.90 million, versus printed totals of 2,934.24 and 713,539.89. EUR/JPY
  columns reconcile. Outstanding rows sum to USD 1,131.22, EUR 112.12, JPY
  25,754.32 and LKR 472,285.54 million. These discrepancies are source-quality
  limitations; do not treat the annex as an independently reconciled balance sheet.
- Guarantee serial 105 has a malformed printed expiry `31-30`; it remains raw.
  Serial 112 has no printed expiry. Past expiry dates are not automatically
  changed to imply a facility was discharged.
- Q1 2025's NDF value is printed `13,0`; the reviewed numeric interpretation is
  13.0 USD million with the original token retained. Q3 2023's domestic comparison
  heading prints `31-06-2023`; the period is June 30, with a review note.

Tests reconcile domestic debt between the independently printed summary and
instrument tables in all 15 editions; test scanned/wrapped cells, retained
revisions, facility identities and shared-balance non-duplication.

## Evidence and interpretation

`public/data/treasury-*.json` contains numeric cells with their source PDF URL,
SHA-256, physical page and extracted line. `source_value` preserves the printed
number; source dashes and ND remain null. The `unit` dimension distinguishes
currency, percentage and counts. `value` is explicitly nonadditive: many rows
are overlapping totals and components. Presets select one period, metric and
unit; procurement presets also select one status/bid band.

All observations use the publication's definitions and rounding. These debt
positions must not be spliced into the existing CBSL annual series without
reconciling their perimeter. Local-authority debt is not provincial-council debt.
SOE accounting years and statements differ. Procurement covers selected
high-value procurements; the 2022–2024 interval is pooled and its award value is
an average. Award currency units were not explicit in the reviewed procurement
tables, so they are labelled `reported currency units`, not assumed LKR.

Coverage is partial in the ontology. The original non-debt imports remain selected-row coverage. Historical debt
rows with wrapped labels and the scanned Q4 2025 tables now use reviewed cells
where text layout alone is insufficient.
SOE ratios and outlet/dealer counts carry separate units. Revenue rows retain
department context. The source province-transfer total includes a ministry
project amount outside the nine provincial rows, so it is not their simple sum.
Public availability does not establish an open reuse licence; licence status is
`permission_unclear`.

## Reproduce and refresh

The single Source registry is `scripts/data-sources.json`. Five Treasury source
families opt into the existing weekly refresh-PR workflow with a 30-day review
interval. Run:

```sh
bun scripts/refresh.mjs due
bun scripts/refresh.mjs run treasury-debt
# Only after a successful live refresh:
bun scripts/refresh.mjs touch treasury-debt
git add public/data
bun run build:dataset-versions
bun run datasets:sync
bun run check
```

Install Poppler (`pdftotext`) for extraction. No Python or application runtime
PDF dependency is required. `bun scripts/build-treasury.mjs` verifies all five
families. `--source <id>` scopes a run to one registered family.

`--source-dir .context/treasury-catalog/reports` rebuilds from downloaded PDFs
without networking. This verifies reproducibility, **not freshness**; never
stamp a Source after an offline-only run.

The adapter checks the publication index, follows the family's year navigation
(including newer years even if the default redirect selects an older year),
requires the selected PDFs to remain linked, then verifies document hashes and
reviewed text-line hashes and column counts. It validates the whole selected
batch before writing any tables. Network failure, an unseen edition, changed
PDF or layout is a failed refresh, not permission to carry forward unchecked
values. Poppler-version layout differences can also require review.

The workflow caps concurrent jobs, retains failure logs, regenerates Dataset
Versions **and** site artifacts, runs repository checks, and prepares review
PRs. It does not deploy or publish. Scheduling begins once the changes are on
the trusted main branch; successful checks alone do not merge refresh PRs.

## Expand the catalog

`scripts/treasury/recipes.json` pins reviewed source rows and their column
semantics; `discovery.json` records reviewed publication links. These are adapter
inputs, not another Source registry. For a new edition: download it, inspect
its tables/footnotes, update recipes and publication metadata, check new links,
and validate extracted totals and preset queries. Do not blindly accept a new
hash or suppress a discovery failure. Keep historical editions distinct and
review revisions before extending a time series.

The research bundle in `.context/treasury-catalog/` retains 153 PDF links,
50 downloaded documents and the 95 candidate-dataset inventory. Remaining intake:

- Additional historical debt tables: debt service/disbursements, named-lender
  annexes, securities maturities and earlier guarantee/LC editions. The three
  historical core tables and June 2026 guarantees/LCs above are already loaded.
- Major public investment projects: project scope, dates, total cost, cumulative
  expenditure and domestic/foreign budgets/projections. Dense merged tables need
  a reviewed table extractor; they are not represented by this import.
- Arrears clearance targets and outturns; tax expenditures by sector; BOI/SDP/Port
  City beneficiary lists; annual statistical appendices and public employment.
- Statutory and non-statutory fund statements, scanned debt reports and other
  image-only tables need OCR plus visual verification; the scanned Q4 2025
  core debt tables have already been transcribed and loaded.
- Climate/social-protection strategies mix targets with narrative commitments;
  establish an indicator definition before representing them as numeric series.

New source families require the registry, ontology, dataset definition and
publisher mapping described in `ADDING_AN_INDICATOR_DATASET.md`. The due-source
matrix derives its work from the registry; no fixed list of Treasury sources
is embedded in the workflow. Keep `scheduled` opt-in and add meaningful source
reconciliation tests as coverage grows.
