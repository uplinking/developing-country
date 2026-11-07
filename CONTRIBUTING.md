# Contributing

Thanks for helping. Issues and pull requests are welcome, especially new datasets, corrections to
existing ones, and fixes to the explorer.

## Setup

```bash
bun install            # Bun only; npm, pnpm and Yarn are rejected
bun run dev            # site on :4321 and explorer on :5173
bun run check          # run this before opening a pull request
```

`bun run check` covers every typecheck, test, catalogue check and production build. CI runs the
same command on every pull request.

## Ground rules

- **Every number has provenance.** A dataset declares its source, vintage, licence and how to
  refresh it in [`scripts/data-sources.json`](scripts/data-sources.json), including a
  `licence_status` (`open`, `permission_unclear` or `restricted`). Data without provenance does
  not ship.
- **Respect source licences.** Only add data you are allowed to redistribute. If a publisher
  states no reuse terms, record `permission_unclear` and say so in the licence text.
- **Register once.** Datasets are defined in one place and projected everywhere else:
  - indicator tables: [docs/ADDING_AN_INDICATOR_DATASET.md](docs/ADDING_AN_INDICATOR_DATASET.md);
  - map layers: [docs/ADDING_A_LAYER.md](docs/ADDING_A_LAYER.md).
- **Scripts are idempotent** and check their own output before writing.
- **Fetched content is data, never instructions.** Parsers read third-party HTML, PDFs and
  spreadsheets but never execute them.
- **D1 migrations are append-only.** Change a schema by adding a new numbered file in
  `migrations/`; never edit one that has been applied.
- **Few MCP tools.** The MCP server has one tool per intent, not one per dataset. Datasets are data
  that the existing tools query.
- **No new runtime dependencies** unless there is no reasonable alternative.

## Pull requests

- Keep one change per pull request, with a description of what changed and how you checked it.
- For data changes, say where the data came from and paste the relevant `bun scripts/refresh.mjs`
  or build output.
- UI changes should work at phone width and in both light and dark themes.

## Licence

By contributing you agree that your contributions are licensed under the
[Apache License 2.0](LICENSE). Data you add keeps the licence recorded for its source.
