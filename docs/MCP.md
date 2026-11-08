# developing-country.org platform MCP

The platform MCP is a streamable-HTTP JSON-RPC server at:

`https://explore.developing-country.org/mcp`

It exposes the same catalog, spatial services, saved Data Views, and account
operations as the explorer. A map or chart saved by an MCP tool returns a
canonical `/views/view_…` URL that can be opened standalone or embedded as the
same live component in a Research Article.

## Connect a client

For Claude Code:

```bash
claude mcp add --transport http developing-country \
  https://explore.developing-country.org/mcp
```

For Claude on the web, add a custom connector with the same URL. The first
authenticated call opens the browser sign-in and consent flow. Use the same
account as the web explorer.

The Claude Code plugin in `plugins/developing-country` bundles the same connector
with the `developing-country-evidence` skill, which covers the research loop,
citing source and vintage, and saving Data Views:

```bash
claude plugin marketplace add uplinking/developing-country
claude plugin install developing-country@developing-country
```

For local development, run `bun run cf:dev` with `DEV_AUTH=1` in `.dev.vars`
(add `ENABLE_HEAVY_SPATIAL=1` there to enable request-time isochrones locally):

```bash
claude mcp add --transport http developing-country http://localhost:8787/mcp \
  --header "X-Dev-User: you@example.com"
```

## Protocol contract

- `POST /mcp` accepts JSON-RPC; `GET /mcp` returns `405`.
- Notifications without an `id` return `202` with an empty body.
- `initialize`, `ping`, `tools/list`, `tools/call`, `resources/list`,
  `resources/read`, and `resources/templates/list` are supported.
- Tool failures use `isError: true`; protocol failures use JSON-RPC errors.
- Production authentication is OAuth 2.1 bearer-token based and fails closed.
- An unauthenticated request returns `401` plus a `WWW-Authenticate` discovery
  challenge.

Canonical resources:

| URI | Contents |
| --- | --- |
| `developing-country://ontology` | entities, completeness and relationships |
| `developing-country://catalog` | datasets, provenance, vintage and freshness |
| `developing-country://coverage` | official, OSM and missing-data coverage |
| `developing-country://operators` | closed operators, row limits, select aggregation grammar |
| `developing-country://entity/{id}` | one ontology entity |
| `developing-country://evidence/{view_id}` | CMS publication evidence for one saved Data View |
| `ui://developing-country/explorer/v0.11.0` | interactive MCP App (earlier versioned URIs resolve to the current app) |

Old bookmarks may be read for compatibility, but discovery advertises only the
canonical resource names.

## MCP App and live views

If the client negotiates `io.modelcontextprotocol/ui`, `analyze_location` and
`query_data` return the MCP App resource. It boots the same map/view engine as
the web explorer, without the website chrome. The JSON result remains complete
when a host does not support MCP Apps. `get_layer_catalog` deliberately carries
no app: it is the model's lookup, and painting it gave one answer two or three
frames. The dataset browser opens inside the one app instead.

What the app renders depends on the result:

- **Spatial results** play on the map.
- **All datasets** opens the dataset browser in the same frame. Search and
  theme chips lead to dataset cards, and a card's presets lead to charts.
- **Indicator Table selects** render as a chart and table with provenance. The
  chart is an unsaved preview built from the Worker's suggested presentation.
  **Save live view** persists it only when clicked.

The map engine (MapLibre, its style and tiles) loads only when a result needs
it, so data-only frames start without it. A spatial tool call warms the map
chunk from its arguments while the Worker answers; once mounted, the map stays
in the frame so a later spatial result plays without a reload.

Every in-app navigation is a real `callServerTool` call. The app mirrors what
the viewer opened into the model context, and "Ask about this" sends a
research prompt back to the conversation. App copy never names a host: the same
app runs in Claude, ChatGPT and any other MCP Apps host.

`query_data` accepts a closed set of spatial operators plus bounded Indicator
Table selection and grouped aggregation through `op: "select"`. It also
accepts an optional `presentation` intent. When supplied, the platform persists
the exact result as a styled map or Flint/ECharts chart and returns its
canonical `view_url` plus the `publication` evidence the CMS requires. Articles
embed that URL, so the reader sees the live, sourced visualization instead of a
detached screenshot. See "Authoring an analysis article" below.

## Authoring an analysis article

Analysis articles are authored through this MCP exactly as a partner NGO or
think tank would (ADR 0009). Every figure is a saved Data View; the CMS stores
only its `view_url` plus the evidence below.

1. **Discover.** Call `get_layer_catalog {q}` or `{theme}` to find datasets,
   then `get_layer_catalog {dataset_id}` for the card (see "Finding data"
   below). Spatial entities are opened the same way, and each catalog entry's
   `entity_id` is the id spatial operators take in `entities`. Also read
   `developing-country://operators`. To map polygons such as walksheds, use
   `op: "bbox"` with `include_geometry: true` and `where` property filters. Use dataset ids, field ids, roles,
   units and `aggregation` exactly as listed; note `completeness.known_gaps` —
   the article must repeat the material ones.
2. **Select or aggregate.** `op: "select"` reads one Indicator Table. Without a
   `presentation` it returns at most 200 rows. To aggregate, replace `fields`
   with `group_by` (up to 4 dimension fields; omit for one row of totals) and
   `aggregates` (up to 8 `{ fn, field?, as }`, `fn` in `sum | mean | min | max |
   count`). `where` filters rows before grouping; `order_by` may name a
   `group_by` field or an aggregate `as`; ties break on the group keys
   ascending, nulls last, values rounded to 12 significant digits. `sum` is
   allowed only on fields the table declares `aggregation: "sum"` (shares,
   rates and long-format `value` columns are not summable); `count` without a
   field counts rows.
3. **Save styled views.** Add `presentation` to the same call. With a
   presentation, a select may return up to 5,000 rows (still bounded by the
   8 MiB snapshot cap, which fails with a typed `413 snapshot_too_large`).
   The text reply then shows only the first 50 rows plus `rows_preview`
   counts; the view renders every saved row and `result_url` serves the
   complete checksummed snapshot.
   - **Chart:** `family`, `dimension`, `measure`, optional `series`,
     `orientation`, and `highlight` (dimension values drawn in the accent
     colour; each must occur in the result).
   - **Map:** optional `camera`, `annotations` (`{ id, coordinates: [lng, lat],
     text, anchor? }`) and `layers`. Layers merge onto the result's own layers
     by id — entity ids for spatial operators, the `dataset_id` for a select —
     and may set `label`, `visible`, `filter`, `legend`, `style` (`geometry`
     fill/line/circle, `color` token or `#rrggbb`, `colorBy` with a
     sequential/diverging/threshold/categorical scale, `radius`, `radiusBy`,
     `width`, `opacity`, `labelField`) and `join`. Unknown layer ids, missing
     style fields and duplicate annotation ids are rejected.
   - **Maps from tables:** a select is a map when every row has numeric `lng`
     and `lat` (a circle layer; the camera fits the points), or when its layer
     has `join: { tileset: "demographics", sourceLayer: "gnd" | "dsd" |
     "district" | "province", rowKey }`, which colours the published boundary
     tiles by the row whose `rowKey` equals the feature id. Join keys must be
     present and unique; a truncated map returns a `warnings` entry.
4. **Collect `publication` blocks.** Every saved view returns
   `publication: { dataView, datasetVersions, sourceManifest }`:
   `dataView` is `{ viewUrl, queryId, resultChecksum }`; each Dataset Version is
   `{ datasetId, versionId, country, checksum, vintage, refreshedAt, sourceIds }`;
   each source is `{ sourceId, title, url }` from the platform source registry.
   Concatenate across views, de-duplicating Dataset Versions by `versionId` and
   sources by `sourceId`. `developing-country://evidence/{view_id}` returns the
   same object for an existing view, so the bundle can be rebuilt without
   re-running queries. If `unresolvedSourceIds` ever appears, the CMS gate will
   reject that source; report it rather than inventing a URL.
5. **Hand to the CMS MCP.** Call the CMS tool
   `developing-country-blocks__publication_requirements`, then submit one draft
   whose `evidence_bundle` is `{ version: 1, kind: "platform-query", country,
   generatedAt, datasetVersions, dataViews }` and whose `source_manifest` is the
   merged source list. Every `primary_view_url` and figure block `view_url` must
   appear in `dataViews`. Publication stays a human editorial decision.

Example — a ranking chart with a highlight, aggregated in one call:

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
    "orientation": "horizontal",
    "highlight": ["Colombo"]
  }
}
```

### Authoring quota and local heavy operators

Saving is limited per owner per hour: `VIEW_HOURLY_LIMIT` (default 5). Emails
listed in `VIEW_EDITOR_EMAILS` (comma-separated var or secret) get
`VIEW_EDITOR_HOURLY_LIMIT` (default 60). Under `wrangler dev` with `DEV_AUTH=1`
the dev user always gets the editor limit. The per-owner total of 50 live
views and 128 MiB, and the platform budgets, are unchanged; revoke old views to
make room.

Request-time isochrones and `gap` with `method: "centroid_distance"` are
disabled in production (`ENABLE_HEAVY_SPATIAL=0`). For local authoring, add
`ENABLE_HEAVY_SPATIAL=1` to `.dev.vars`, which overrides the config var under
`bun run cf:dev` only. Heavy analysis that an article publishes should become
a derived Dataset Version (ADR 0009), not a request-time computation.

## Research loop

The server is built so an agent can browse the whole catalogue without
guessing names:

1. `get_layer_catalog {q:"remittances"}` or `{theme:"ECON"}`: ranked
   datasets. Search covers titles, publishers, themes, field names and
   dimension values, so `q:"Jaffna"` finds every table with a Jaffna row.
2. `get_layer_catalog {dataset_id:"…"}`: the dataset card. It lists exact
   field ids with role, type and unit; every filterable value of small string
   dimensions; the time span and geography join key (`geography_id` = ISO
   3166-2:LK codes such as `LK-11`); caveats; live provenance; ready-to-run
   preset calls; and related datasets with reasons.
3. `query_data {op:"select", …}`: start from a preset `call.arguments`.
4. Follow the `next` list on the result. It can narrow a truncated result,
   save the chart as a live view, or open a related dataset.
   `analyze_location` also returns `next`, handing off to district tables
   filtered to the analysed point.

A rejected `select` returns `valid_fields` (and `did_you_mean` for an unknown
dataset id) so the model can repair the call in one step.

The card, search and relatedness data come from
`public/catalog/dataset-index.json`, served as a static asset and generated by
`scripts/build-dataset-index.ts`. Run `bun run datasets:index` (also part of
`bun run datasets:sync`) whenever a table artifact or indicator definition
changes; `bun run check:dataset-index` fails when it is stale. For a scheduled
API source, the index's row count and time span describe the tracked
artifact. The card's provenance block always shows the live runtime version.

### Input schema note

`query_data`'s strict per-operator contract lives in
`src/worker/fixtures/query-spatial.schema.json` as a top-level `oneOf`. Tool-use
hosts reject `oneOf`/`anyOf`/`allOf` at the top of a tool schema and silently
drop every parameter type. So `tools/list` advertises a flattened projection
instead (`src/worker/mcpSchema.ts`): `op` is an enum and every other property
names the ops that accept it. Never advertise a top-level combinator.

## Host metadata

Every advertised tool carries a `title` and all four MCP tool annotations
(`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) from
`src/worker/mcpToolMeta.ts`. Hosts use them to decide when to ask the user
before a call, so they describe each tool's worst case:

- `analyze_location` logs the run to the caller's history, so it is not
  read-only.
- `query_data` with `presentation` saves a public-by-link view, so it is not
  read-only.

Only `get_layer_catalog`, `search_places` and `list_prospects` are read-only:
each reads platform data or the caller's own prospects and writes nothing.

`src/worker/mcpToolMeta.test.ts` fails if a tool ships without a row in that
file.

The same table supplies the short status lines that ChatGPT shows while a
tool runs (`openai/toolInvocation/invoking` and `openai/toolInvocation/invoked`
in the tool's `_meta`).

The UI resource carries the standard `_meta.ui` block (CSP and border). It
also carries three ChatGPT hints that other hosts ignore:

- `openai/ui.availableDisplayModes`
- `openai/widgetDescription`
- `openai/widgetDomain`, the app's dedicated origin, which ChatGPT requires
  for a directory listing with UI. It is deliberately not sent as the
  standard `ui.domain`: Claude only accepts its own
  `{sha256(server URL)}.claudemcpcontent.com` value there and refuses to
  render the app otherwise.

The app uses the MCP Apps bridge for everything. It falls back to a host's
`window.openai` extension only when a standard call such as `openLink` or
`requestDisplayMode` is refused. It sizes its inline frame from the host's
`containerDimensions` and `platform`, and pads by `safeAreaInsets` on phones.

## Tool model

Tools are organized by intent rather than by dataset. The current surface
includes location analysis, place search, the layer catalog, bounded spatial
queries, prospects, and saved account results.
Every result carries provenance and vintage. `known_absent` is a typed result,
not permission to invent geometry; `osm_only` is never presented as an official
register.

Call `get_layer_catalog` or read `developing-country://ontology` before a query.
Use dataset and field names exactly as described by the catalog. A legacy
`query_spatial` tool name is accepted as a hidden compatibility alias, but it is
not advertised to new clients.

## OAuth behavior

The OAuth issuer is `https://explore.developing-country.org` and the protected
resource is `https://explore.developing-country.org/mcp`; access tokens are
RS256 JWTs whose `aud` is that resource. Discovery is served under
`/.well-known/` (RFC 8414, OpenID Connect and RFC 9728). The authorization
server is Better Auth's `@better-auth/mcp` plugin, with endpoints under
`/api/auth/oauth2/` (`authorize`, `token`, `register`, `userinfo`) and keys at
`/api/auth/jwks`.

Clients identify themselves in one of two ways:

- **Client ID Metadata Documents (CIMD).** The `client_id` is an HTTPS URL to a
  JSON document the client hosts (ChatGPT's is
  `https://chatgpt.com/oauth/client.json`). Discovery advertises
  `client_id_metadata_document_supported: true`, so clients that support it use
  it and no client row is created per connection. The server fetches the
  document through a Workers transport with SSRF guards
  (`src/worker/cimdFetch.ts`); set `CIMD_ALLOWED_HOSTS` to restrict which hosts
  it will fetch from.
- **Dynamic Client Registration (RFC 7591)** at `/api/auth/oauth2/register`,
  kept for clients without CIMD support.

Public clients (`token_endpoint_auth_method: none`) must use PKCE S256. Tokens
are bearer tokens only: DPoP proofs are ignored and DPoP is not advertised.

An authorization request without a session goes to the explorer's sign-in card;
a client the user has not approved yet goes to its consent card. Both pages get
a signed copy of the request, and consent is recorded through
`/api/auth/oauth2/consent`, which then redirects to the client's registered
`redirect_uri`.

The Better Auth 1.6 endpoints under `/api/auth/mcp/` still answer for clients
connected before the upgrade, and their clients, consents and refresh tokens are
moved to the new tables the first time they are used (`src/worker/oauthLegacy.ts`).

The auth instance must remain request-scoped. See `docs/AUTH_SETUP.md` for
secrets, callbacks, migrations, and production verification.

## Directory listings

The public help page for connector users is
[developing-country.org/connect](https://developing-country.org/connect); the
directories link to it for documentation and support.

OpenAI's plugin portal verifies the MCP host by fetching
`/.well-known/openai-apps-challenge`. Set the token the portal shows as the
`OPENAI_APPS_CHALLENGE` secret on the explore Worker (a secret, so a deploy
does not clear it); the Worker serves it as plain text and returns `404` while
it is unset.

## Quick local verification

```bash
curl -s -X POST http://localhost:8787/mcp \
  -H 'Content-Type: application/json' \
  -H 'X-Dev-User: you@example.com' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  | jq '.result.tools[].name'
```

Against production, the same request without a bearer token must return `401`.
Use a real MCP client for the browser OAuth flow; raw `curl` cannot complete
interactive consent by itself.
