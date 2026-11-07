# Initiatives ledger: data model and pipeline

Code: `scripts/initiatives/` (see its README), `packages/datasets/src/money.ts` and
`apps/site/src/pages/initiatives.astro`.

## One sentence

News and official records become **reports**. Reports of the same act collapse into one **event**.
Events sit on a **funding line**, which is one stream of money from one funder to one project. You
count events, never reports, and only one stage in one currency at a time.

```
source document ──< report >── event >── funding line >── project (>── parent programme)
   (article,          (one claim      (one real act:     (project × funder   (thing funded; may be
    Cabinet brief,     in one doc,     "Cabinet cleared   × instrument)       national: IMF, budget
    IMF ledger)        with span)      ADB $100m, 12 Oct")                    support, relief)
```

## Records

| Record | Key fields | Identity |
| --- | --- | --- |
| `source_document` | url, outlet, language, published, retrieved, sha256, upstream id (lk_news `doc_id`), kind (news / official / lender) | canonical URL + content hash; a changed body becomes a new version |
| `report` | document, event, quoted span, extracted amount/stage/date, extractor + prompt version, confidence | (document version, event) |
| `event` | line, **stage**, date + `date_basis` (decision / announcement / report), first_observed, amount, currency, raw text, **basis**, equivalents[], components[], supplier, agency, relation (new / update_of / correction_of / supersedes), **evidence** (machine_read / reviewed / disputed / retracted) | stable id; merges and splits are logged, never destructive |
| `funding_line` | project, funder, funder_type, **origin**, **instrument**, **purpose**, lender project id (ADB/WB/IATI) when known | (project, funder, instrument, facility id) |
| `project` | name, aliases (en/si/ta), sector, delivery status, place / geometry or `national`, parent, crosswalk to existing `developments` ids | stable id; crosswalks are explicit, never name equality |

An **initiative** (`project`) is the primary record, and money is optional. A plan, a launch or a
new service is an initiative with events but no amount. Those events use the delivery stages
`proposed`, `govt_authorised`, `launched`, `underway`, `completed` and `halted`. Money events and
delivery events sit on the same timeline but only money events enter totals.

## What the public page shows vs what MCP does

The dashboard answers three questions, with one filter sentence ("Everything from ADB in transport ·
2026"):

1. **What happened**: a feed of events, newest first, with a weekly band and play-the-week.
2. **Where an initiative is at**: an inline track of its events, with sources.
3. **How much, from whom, for what**: four public money stages with one figure per currency,
   optionally split by source, sector or type.

Everything else, including custom joins, odd filters and bespoke visuals, is left to the user's AI
through MCP `query_data` over the same datasets. The page hands over the current question with a
copy button.

**Public money stages** map the detailed `stage` onto four columns:

| Column | Stages |
| --- | --- |
| Announced | proposed, pledged, cost_estimate |
| Approved | funder_approved, govt_authorised, allocated |
| Contracted | contract_awarded, agreement_signed |
| Paid | disbursed, released, spent |

Within Announced, Approved and Contracted, each funding line counts once per column: its latest
event in the period. A lender approval followed by Cabinet clearance of the same money is one
approved amount. In Paid, tranches add up and cumulative positions never add to them. The
implementation is `moneyTotals` in `packages/datasets/src/money.ts`, shared by the build, the page and the tests.

## Vocabularies

Kept as independent axes, never one overloaded category.

- **stage**: what the money act is. `proposed`, `cost_estimate`, `funder_approved` (lender board),
  `govt_authorised` (Cabinet clears borrowing, signing or a project), `allocated` (appropriation,
  supplementary estimate, provision), `contract_awarded`, `agreement_signed`, `disbursed` (lender
  paid out), `released` (Treasury to agency), `spent`, `pledged`. Not a ladder. A stage without
  evidence is unknown, not skipped.
- **instrument**: `loan`, `grant`, `govt_funds`, `equity`, `guarantee`, `in_kind`, `mixed`, `unknown`.
- **funder** and **funder_type**: `adb`, `world_bank`, `imf`, `japan`, `china`, `india`, `eu`, `usa`,
  `opec_fund`, `aiib`, `korea`, `un`, `gosl`, `private`, `other:*`, `unknown`. Types are
  multilateral, bilateral, government, private and unknown.
- **origin**: `overseas`, `domestic`, `unknown`. Never inferred from currency or contractor nationality.
- **purpose**: `project`, `programme`, `budget_support`, `balance_of_payments`, `relief`, `budget`, `debt`, `unknown`.
  `budget` is a whole budget or estimate that funds many initiatives (an Appropriation Act, a vote on
  account, an interim or council budget, a capital expenditure plan, a supplementary estimate,
  transfers to provincial councils); `debt` is repaying, restructuring, issuing or auctioning debt.
  `build.ts` sets both from the initiative's name (text in brackets ignored), and `overrides.set_line`
  can set or correct them by hand.
  IMF money is `balance_of_payments` and has no map location.
- **basis**: `total`, `tranche`, `cumulative`, `annual`, `component`, `rate` (per person, per unit or per month; never a total).
- **sector** and **delivery status**: as in the extraction spec. Status is only set when a source states it.

Currencies stay as published: LKR, USD, SDR, JPY, EUR, CNY, INR. SDR is the IMF's unit of account.
It is not a dollar and is never converted silently. If we later add a converted view, it is a separate
derived measure with a named rate source and value date, labelled as an estimate.

## Counting contract

Totals are computed by one shared function (as `src/shared/projectFunding.ts` did) and
materialised. UI code never adds two amounts.

1. A total is always one **stage** in one **currency** for an explicit filter. There is no
   cross-stage or cross-currency grand total anywhere.
2. Count **events**, not reports. Five articles about one decision add up to one amount.
3. `update_of` at a later stage is a new event on the same line and goes into a different stage's total.
   A revised `cost_estimate` replaces the earlier one for that line.
4. `cumulative` positions use the latest value per line and are never added to `tranche`s. A `rate`
   (Rs 110 per meal, Rs 6,000 a month) is listed with the missing amounts and never added.
5. Equivalents (a "Rs. 30bn" gloss on "USD 100m") and `components` (LKR 52.44m + USD 122,859 inside
   LKR 91.21m) are alternative representations of the same money, not extra money.
6. A parent programme and its child lines are alternative aggregation levels. Overlap that can't be
   resolved is excluded and disclosed in the count.
7. National lines (`balance_of_payments`, `budget_support`) never enter a place's total.
8. `budget` and `debt` lines are listed beside each total ("budget or debt, not added") and never
   added: an Appropriation Act already contains the projects it funds, and debt service is not an
   initiative.
9. A missing amount is "not reported" and never zero. `machine_read` events count separately from
   `reviewed` ones until review. The total shows both: "USD 400m approved, of which 250m reviewed".

## Duplicate detection vs genuine updates

Deterministic first, models second, a person for the hard cases.

1. **Same document**: canonical URL plus body hash. Upstream `doc_id` is kept only as provenance.
2. **Same act** (collapse into one event): same funder, same currency and an amount within 1%, the same or
   a compatible stage, and dates within 10 days. Or the same Cabinet decision number / lender
   project id. Headline similarity is only a retrieval signal.
3. **Later act on the same money** (new event, `update_of`): same line but a different stage, e.g.
   lender approved, then Cabinet cleared, then signed, then paid out. Same stage with a new amount
   means a revision (`supersedes`), not new money.
4. **Same project, different money**: a new line. Examples are a second tranche facility, additional
   financing, or a government counterpart contribution alongside a grant.
5. Any merge below the deterministic bar goes to review with both candidates side by side. We tune for
   merge precision because a false merge corrupts history.

Real examples: the ADB USD 100m recovery loan reported four times (one event), ADB approval
followed by Cabinet clearance (two events, one line), and One Health's grant plus a government
contribution (two lines).

## Pipeline, built on what exists

| Step | Where | Notes |
| --- | --- | --- |
| Weekly read | `scripts/initiatives/weekly.ts` | Reads unread lk_news articles from the past three weeks in English, Sinhala and Tamil (`backfill.ts --since`), then older months while the reader's usage allows. Runs in its own worktree. |
| Official records | Same review job | World Bank Projects API snapshot (`scripts/initiatives/fetch-world-bank.ts`) and the reviewed Cabinet / ADB / IMF records (`scripts/initiatives/reviewed.json`). Next sources: Cabinet decisions archive, IATI, ERD, NPD/Treasury budget execution. |
| Review | Same run | Rebuilds, runs `bun run check` and opens a draft PR with what it read. Merging it is the release (main auto-deploys). |
| Build & dedup | `scripts/initiatives/build.ts` (deterministic) | Matches news to official records, folds repeated reports, collapses the same act across batches, applies `overrides.json`, validates, and writes `lk-initiatives.json` plus the two tables. |
| Backfill | `scripts/initiatives/backfill.ts` | Runs a local LLM command-line tool (Codex or Claude Code) with the prompt and schema in `scripts/initiatives/extraction.ts`. One batch per month and language; resumes where it stopped; stops cleanly at the tool's usage limit. Sinhala and Tamil headlines are screened by the model before reading. |
| Publish | Existing dataset registry | Registered via `packages/datasets` presets, `scripts/data-sources.json`, dataset versions and `datasets:sync`, then queried with `get_layer_catalog` / `query_data`. Published under CC BY 4.0. |
| Health | `coverage.json` and batch metadata | Articles per week per outlet and language. Weeks the ledger has not read stay hatched on the page. |

## Queryable datasets

| Dataset | Grain | Money aggregation |
| --- | --- | --- |
| `lk-initiative-events` | one event | `none` (rows mix stages and currencies) |
| `lk-initiative-funding` | reconciled total per stage × currency × funder × period × evidence | `sum` only within one stage and currency |
