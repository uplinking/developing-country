# developing-country.org

An open evidence platform for understanding how countries develop, starting with Sri Lanka.
It brings official statistics, infrastructure, public projects and the money behind them into
one place, with the source, vintage and licence of every number on show.

- **Site:** [developing-country.org](https://developing-country.org): country pages, dataset
  notes, analysis, and the [initiatives ledger](https://developing-country.org/initiatives)
- **Explorer:** [explore.developing-country.org](https://explore.developing-country.org): a map
  and chart explorer over every dataset
- **API and MCP:** the explorer serves a JSON API and an [MCP server](docs/MCP.md), so AI
  assistants can query the same datasets and cite them

## What is in it

| Surface | Stack | Responsibility |
| --- | --- | --- |
| `developing-country.org` | Astro + [EmDash](https://github.com/emdash-cms/emdash) on a Cloudflare Worker | site, dataset notes, analysis, RSS, CMS |
| `explore.developing-country.org` | Vite + React + MapLibre on a Cloudflare Worker | explorer, data API, OAuth, MCP, saved Data Views |
| `tiles.developing-country.org` | Cloudflare R2 | public PMTiles served by range request |

Every dataset is registered once, with its sources, vintage, licence and known gaps. The site,
the explorer, the API and the MCP server all read that one registry, so they cannot disagree.

## Data and licences

- **Code:** [Apache-2.0](LICENSE).
- **Datasets we compile:** CC BY 4.0, or ODbL 1.0 where they are derived from OpenStreetMap.
  Each dataset page states its licence and how to credit it.
- **Third-party sources:** keep their own terms, which each dataset page lists beside the source.
  The registry is [`scripts/data-sources.json`](scripts/data-sources.json).

## Quick start

Requires [Bun](https://bun.sh) 1.3.14 or later.

```bash
bun install
bun run dev              # site on :4321 and explorer on :5173
bun run check            # every typecheck, test, catalogue check and build
```

Other entry points:

```bash
bun run dev:explore      # explorer only
bun run dev:site         # site only
bun run cf:dev           # platform Worker (API, MCP) on :8787
```

## Repository

```text
apps/site/                Astro + EmDash site and CMS
src/                      explorer (React)
src/worker/               platform Worker: API, MCP, OAuth, queries, saved views
packages/datasets/        dataset definitions, publishers, licences, counting rules
packages/domain/          evidence and provenance vocabulary
packages/views/           Data View contract shared by explorer, site and MCP
packages/figures/         chart and map figures for Data Views
packages/ui/              shared design tokens
scripts/                  idempotent fetch, build and check scripts
scripts/data-sources.json source registry: publisher, licence, vintage, refresh
public/data/              validated datasets served by the explorer
migrations/               append-only D1 migrations
docs/                     guides and architecture decisions
```

## Documentation

- [Domain glossary](CONTEXT.md)
- [Architecture decisions](docs/adr/)
- [Adding an indicator dataset](docs/ADDING_AN_INDICATOR_DATASET.md) and
  [adding a map layer](docs/ADDING_A_LAYER.md)
- [MCP server](docs/MCP.md) and [authentication](docs/AUTH_SETUP.md)
- [Initiatives ledger: data model](docs/initiatives/DATA_MODEL.md)
- [Deployment](docs/DEPLOY_DEVELOPING_COUNTRY.md)

## Keeping data fresh

```bash
bun scripts/refresh.mjs list     # every source and how stale it is
bun scripts/refresh.mjs due      # sources due for review
```

A weekly workflow re-pulls the sources that have deterministic adapters and opens one review
pull request per source. It never deploys.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). To report a vulnerability, see [SECURITY.md](SECURITY.md).
