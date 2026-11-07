# developing-country.org public site

This Astro app owns the landing page, country pages, analysis, dataset notes, RSS,
and the EmDash admin/MCP surface. It does not own platform datasets or live-view
results; those are referenced by canonical URLs from the platform Worker.

Dataset ids and canonical preview URLs stay in the bundled registry because
publication must fail closed without remote I/O. Dataset Version, Source,
licence and known-gap metadata is generated into `data/dataset-catalog.json`
and loaded from the content-addressed `DATASETS` R2 object. Run
`bun run --cwd apps/site data:catalog` after changing dataset/source manifests;
never upload the object without explicit remote authorization. The full
`seed/seed.json` is for validation/provisioning; EmDash bundles only the
generated `seed/runtime.json`.

For indicator datasets, edit the single definition in
`packages/datasets/src/presets.ts`, then run `bun run datasets:sync` from the
repository root. This projects the definition into the lightweight bundled
registry, CMS dataset note, runtime seed and immutable catalogue without remote
writes. See `docs/ADDING_AN_INDICATOR_DATASET.md`.

## Landing camera films

The landing page films real UI through `CameraFilm.astro` (engine: `src/lib/cameraFilm.ts`).
Explorer stills live in `public/films/` and their tour points in `src/lib/films.ts`.
To recapture one after the explorer UI changes:

1. Open the production explorer with the layer(s) on, e.g.
   `https://explore.developing-country.org/?layers=schools&lng=80.58&lat=7.27`. Outside embed
   mode the explorer reads `lng`/`lat` but not `zoom`, so set the zoom with its zoom buttons.
2. Use a viewport of the shot's width × (height + 62px header) at device scale 2. Scroll
   `.rail-body` so the layer's card title sits 16px below the rail top, then select one feature
   so its readout sheet opens.
3. Screenshot, crop the 62px site header (124 device px), and encode both widths with
   `cwebp -q 72 -crop 0 124 <2w> <2h> -resize <large|small> …`.
4. Update the shot's `legend` / `feature` / `sheet` points in `src/lib/films.ts` (CSS pixels on
   the cropped capture) and run `bun test src/cameraFilm.test.ts`.

Films must stay inert (`aria-hidden`, `inert`) with a text `label`, lazy-load their media,
and never add a runtime dependency.

## Editorial workflow

- Call EmDash MCP `developing-country-blocks__publication_requirements` before
  drafting. It is the machine-readable contract; do not infer the JSON shape
  from an older article. The CMS admin must enable and consent to this plugin
  tool before it appears in an MCP client.
- Read the platform catalog and perform research through the platform MCP first.
- Save charts/maps through `query_data.presentation`; keep the returned `view_url`.
- Choose `format: analysis` for an argued essay or `format: dataset_note` for
  documentation of one platform dataset. A dataset note also needs the exact
  platform `dataset_id`.
- Assemble the complete article, evidence bundle, sources, and live-view blocks,
  then call EmDash MCP `content_create` once. It creates a draft by default.
- Put live views in `dcLiveView` Portable Text blocks. Never copy renderer JSON,
  query result rows, screenshots, or iframe HTML into an article.
- Use `primary_view_url` for the lead figure. Do not repeat that same URL in a
  `dcLiveView` body block; reserve body blocks for additional figures.
- Add the platform evidence bundle to `evidence_bundle` and sources to
  `source_manifest` so an editor can audit the draft.
- Use evidence bundle version 1. `kind: "platform-query"` requires the exact
  Dataset Version records and Source ids returned by the platform, plus every
  embedded Data View as `{ viewUrl, queryId, resultChecksum }`. A non-empirical
  `kind: "design-note"` may have no Dataset Versions but still needs a
  `platform-design` Source manifest entry. Never synthesize ids or checksums.
- Every Dataset Version `sourceIds` entry must resolve to a `source_manifest`
  row with the same `sourceId`, a title, and an HTTPS primary URL.
- Connect agent identities with the EmDash **Contributor** role. RBAC then
  permits draft creation but denies publication even when the OAuth token has
  `content:write`; instruction text is not the security boundary.
- Contributor is intentionally a submission role, not an iterative editor:
  after creation, requested revisions belong to the human editorial desk.
- Do not call `content_publish`. Publication is the human editor's final gate.
  D1 rejects every invalid insert, publish, or governed content-field update of
  a `published` row, regardless of whether it came from admin, REST, MCP, or a
  future transport.
  Article scheduling is disabled so evidence is reviewed at the final
  publish transition.

## Commands

Run from the repository root with Bun only:

- `bun run dev:site`
- `bun run typecheck:site`
- `bun run build:site`
- `bun run check:site`

The admin is at `/_emdash/admin`; the site MCP is at `/_emdash/api/mcp`.
