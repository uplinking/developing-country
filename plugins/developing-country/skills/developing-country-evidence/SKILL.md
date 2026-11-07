---
name: developing-country-evidence
description: Research Sri Lanka public statistics and places with the developing-country.org connector, cite every number with its source and vintage, and save charts or maps as live Data Views. Use when the developing-country.org tools (get_layer_catalog, query_data, analyze_location, search_places) are available and the user asks about Sri Lankan census, economy, districts, transport, land or civic data, or wants a sourced chart or map.
license: Apache-2.0
---

# Developing Country evidence

developing-country.org is an open evidence platform for Sri Lanka. Its connector exposes
official Indicator Tables (census, Central Bank, Treasury, Department of Census and
Statistics, World Bank and others) and spatial layers through a few intent-level tools.
Every result carries provenance. Your job is to keep that provenance attached to every
claim you make.

## Research loop

1. **Find the dataset.** Call `get_layer_catalog` with `{q}` (words, place names such as
   "Jaffna") or `{theme}` (for example `ECON`, `SOCI`, `REGI`, `TRAN`). With no arguments it
   returns a slim index.
2. **Open its card.** Call `get_layer_catalog {dataset_id}`. The card lists the exact field
   ids, their roles and units, every filterable value, the time span, caveats, provenance
   and ready-to-run preset calls. Never guess a dataset id or a field id.
3. **Query.** Call `query_data {op: "select", ...}`, starting from a preset's arguments.
   Aggregate with `group_by` + `aggregates` instead of `fields`. `sum` works only on fields
   the card marks summable; shares, rates and long-format `value` columns are not.
4. **Follow `next`.** Every result ends with a `next` list of ready-to-send calls: narrow a
   truncated result, chart it, open a related dataset, or map it.

For one point (an address, a listing, a coordinate) use `analyze_location {lat, lng}`. For a
named place use `search_places {q}` first to get coordinates. Spatial questions (what is
inside, nearest, not covered by) use `query_data` with `op` set to `bbox`, `nearest`,
`point_in_polygon`, `overlay`, `gap` or `choropleth_join`, plus an ontology entity in
`entities`.

If a call is rejected, read the error body: it returns `valid_fields` and `did_you_mean`.
Repair the call from those values instead of retrying blind.

## Citing sources

Each result has a `provenance` list. Every entry names a `source`, a `vintage` (the period
the data describes), a `licence`, and often a `url` and a `refreshed` date.

- Attach a citation to every number you report: **source, vintage**, and the link when there
  is one, in the form "{value} ({source}, {vintage})". Copy the source name and vintage
  from the result; never fill them in from memory.
- Say "as of {vintage}", not "currently", for anything that is not a live feed.
- When numbers come from more than one dataset, cite each one separately. Do not merge
  sources into one footnote.
- If `licence_status` is `permission_unclear` or `restricted`, say so when the user wants to
  republish the figures.

## Completeness is part of the answer

- `known_absent` means the platform has no geometry for that layer. Say so. Never invent
  polygons, buffers or boundaries to fill the gap.
- `osm_only` data comes from OpenStreetMap. It is not an official register; label it that way.
- Repeat material `completeness.known_gaps` and `coverage_note` values in your answer.
- A truncated result (`truncated: true`) is a sample. Narrow the query or aggregate before
  drawing conclusions from it.

## Saving a chart or map as a Data View

A `query_data` call without `presentation` returns a preview that the inline app can
chart. Add `presentation` to the same call to save a live, citable Data View. Saving needs a
signed-in account with a verified email, counts against an hourly quota, and creates a
link-shareable page, so save only when the user asks for a chart or map to keep or share.

- **Chart:** `{kind: "chart", title, family, dimension: {field, label}, measure: {field,
  label, unit}}`, with optional `series`, `orientation` and `highlight`. `family` is one of
  `trend`, `comparison`, `ranking`, `distribution`, `relationship`, `composition`. Highlight
  values must occur in the result.
- **Map:** `{kind: "map", title}` with optional `camera`, `annotations` (`{id, coordinates:
  [lng, lat], text}`) and `layers`. A select becomes a map when every row has numeric `lng`
  and `lat`, or when its layer has `join: {tileset: "demographics", sourceLayer: "gnd" |
  "dsd" | "district" | "province", rowKey}`.

Example: population by district in 2024 as a ranking chart.

```json
{
  "op": "select",
  "dataset_id": "census-age-sex-dsd",
  "where": [{ "field": "year", "op": "eq", "value": 2024 }],
  "group_by": ["district"],
  "aggregates": [{ "fn": "sum", "field": "population", "as": "population" }],
  "order_by": [{ "field": "population", "direction": "desc" }],
  "limit": 25,
  "presentation": {
    "kind": "chart",
    "title": "Population by district, 2024",
    "family": "ranking",
    "dimension": { "field": "district", "label": "District" },
    "measure": { "field": "population", "label": "Residents", "unit": "people" },
    "orientation": "horizontal"
  }
}
```

Check the dataset card first: the ids above are an example, not a contract.

A saved view returns `view_url` (give this link to the user; it can be embedded in an
article) and `publication: {dataView, datasetVersions, sourceManifest}`. Cite the
`sourceManifest` entries under the chart. To rebuild the evidence for an existing view,
read the resource `developing-country://evidence/{view_id}`.

## Writing and reporting tools

`add_prospect` and `update_prospect` write to the user's account, and either can make a
prospect public. Use them only when the user asks, and confirm the location and visibility
before saving a public prospect.
