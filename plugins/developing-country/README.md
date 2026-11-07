# developing-country plugin

This plugin pairs the developing-country.org connector with a skill that teaches Claude how
to use it well. The connector is the remote MCP server at
`https://explore.developing-country.org/mcp`. It gives Claude bounded access to Sri Lanka's
official Indicator Tables (census, Central Bank, Treasury, Department of Census and
Statistics, World Bank and others) and to spatial layers such as administrative boundaries,
transport and planned developments. Signing in uses OAuth with a developing-country.org
account.

The `developing-country-evidence` skill covers three things:

- the research loop: find a dataset, open its card, query it, then follow `next`;
- citing every number with its source and vintage, and reporting completeness gaps instead
  of filling them;
- saving a chart or map as a live, citable Data View with `query_data.presentation`.

## Install

In Claude Code:

```bash
claude plugin marketplace add uplinking/developing-country
claude plugin install developing-country@developing-country
```

On claude.ai, add the connector by URL. To add the skill, upload a zip of
`skills/developing-country-evidence` under Settings, then Capabilities, then Skills.

The skill and this plugin are Apache-2.0. Data returned by the connector keeps the licence
recorded for its source. See [docs/MCP.md](../../docs/MCP.md) for the full tool contract.
