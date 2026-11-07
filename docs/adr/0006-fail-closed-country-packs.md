# ADR 0006: Add countries through fail-closed Country Packs

- Status: accepted
- Date: 2026-08-26

## Context

The product begins with Sri Lanka but must add countries without cloning its
Cloudflare Worker, MCP server, explorer, or editorial site. Pretending the
current Sri Lanka administrative identifiers, data adapters, and spatial
algorithms are already generic would create abstractions based on one example.
Conversely, leaving country as an unvalidated string risks silently answering a
request for another country with Sri Lankan evidence.

## Decision

`@developing-country/countries` is a small typed registry of Country Profiles.
A profile owns only stable product framing: ISO alpha-2 code, slug, display
name, default locale, data bounds, map bounds, and initial camera. The Worker
extends the profile with its ontology in `src/worker/country.ts` and verifies
that both country stamps match. Absence selects the explicit product default;
any supplied unsupported or case-wrong code fails closed.

REST and MCP catalog, search, analysis, and spatial-query boundaries resolve a
country before reading data. Query results and immutable Data Views are
country-stamped. Dataset Versions already carry their country, the Source
registry is bounded by a top-level country, and stored Data Views with an
unregistered or mismatched country do not render. The explorer takes its map
framing from the same shared profile.

Sri Lanka remains the only registered pack. Its ontology, administrative ID
grammar, spatial operators, assets, and build adapters remain deliberately
specific. Country #2 will widen `CountryCode`, add a profile and evidence pack,
then generalize only the implementation seams its contract tests expose.

## Consequences

- One Cloudflare deployment and one UI continue to serve the product.
- Adding a country is an explicit, additive registry and evidence change.
- Unknown country requests cannot fall back to plausible but wrong LK results.
- We avoid a plugin runtime, per-country Workers, and premature algorithm DSLs.
