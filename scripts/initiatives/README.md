# Initiatives ledger

Public initiatives and the money behind them, read from Sri Lankan news
([`nuuuwan/lk_news`](https://github.com/nuuuwan/lk_news)) in English, Sinhala and Tamil and from
official records (IMF, World Bank, reviewed Cabinet and ADB items). The data model and counting
rules are in [`docs/initiatives/DATA_MODEL.md`](../../docs/initiatives/DATA_MODEL.md).

| File | Role |
| --- | --- |
| `extraction.ts` | The reading prompt and output schema, shared by every run |
| `backfill.ts` | Reads months (`--from/--to`) or recent days (`--since`) with a local LLM command-line tool (Codex or Claude Code); one batch file per month or week and language in `news/` |
| `weekly.ts` | The weekly run: recent weeks, then older months while usage allows; rebuilds, runs the full check and opens a draft PR |
| `build.ts` | Deterministic merge of batches, official records and `overrides.json` into `public/data/lk-initiative*.json` |
| `overrides.json` | Review decisions: aliases, merges, retractions, disputed amounts, sectors |

News events are machine-read and marked so until someone reviews them. The newspapers' own text
is never committed: batches keep the extracted facts, the article link and our summary. Every PR
the weekly run opens should be reviewed before merging, because merging releases it.

`backfill.ts` and `weekly.ts` need `codex` (or `claude`) and `gh` signed in.
