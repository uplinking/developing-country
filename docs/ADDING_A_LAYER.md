# Adding a layer

This is the **one true path** to add a map layer to the explorer. If your layer
doesn't fit this recipe, fix the framework first, then add the layer — don't
special-case it (climate and sun are the only two sanctioned exceptions, and
they earned it with genuinely unique interactions).

Every layer must declare its **provenance**: `source`, `vintage`, `licence`, and
how to `refresh` it. A layer without provenance does not ship.

There are three kinds of layer. Pick the row that matches your data:

| Kind | Data lives in | Registry `source` | Example |
|---|---|---|---|
| **Static GeoJSON** (light, < a few MB) | `public/data/<name>.geojson` | `{ type: 'geojson', url: 'data/<name>.geojson' }` | attractions, waterfalls, parks |
| **Vector tiles** (heavy — roads, water, climate) | `*.pmtiles` on R2, served from `tiles.developing-country.org` | `{ type: 'vector-pmtiles', file: '<name>.pmtiles' }` | roads, water, climate |
| **Runtime API** (live / per-user data) | a same-origin endpoint under `/api/*` | `{ type: 'api', endpoint: '/api/<name>' }` | stepper, prospects, issues |

---

## Worked example — a static GeoJSON layer ("Viewpoints")

### 1. Fetch the data into `public/data/`

Fetch scripts live in `scripts/`. A fetch script must be **idempotent** and
**stamp provenance on the FeatureCollection root**:

```js
// scripts/fetch-explore.mjs (pattern)
const fc = {
  type: 'FeatureCollection',
  source: 'OpenStreetMap',
  vintage: '2026-07',
  licence: 'ODbL',
  features: rows.map((r) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [r.lon, r.lat] },
    // Keep property keys stable — the click formatter reads them by name.
    properties: { name: r.name, category: 'viewpoint', osm_type: r.type, osm_id: r.id, source: 'OpenStreetMap' },
  })),
}
fs.writeFileSync('public/data/viewpoints.geojson', JSON.stringify(fc))
```

Run it, and add a Bun script alias in `package.json` (`"fetch:explore": "bun scripts/fetch-explore.mjs"`).

### 2. Register it in `src/map/layers.ts`

Add one `LayerGroup` to `LAYER_GROUPS`. This is the single source of truth — the
map and the legend both read it, so they can never drift.

```ts
{
  id: 'viewpoints',
  category: 'explore',                       // see CATEGORIES; add one if needed
  label: 'Viewpoints',
  blurb: 'Scenic viewpoints across the hill country. Refresh: bun run fetch:explore',
  defaultVisible: false,
  interactive: true,                         // clicks open the detail sheet
  attribution: '© OpenStreetMap contributors',
  source: { type: 'geojson', url: 'data/viewpoints.geojson' },
  info: {                                    // ← the mandatory "i" provenance popover
    source: 'OpenStreetMap',
    detail: 'Scenic viewpoints (tourism=viewpoint).',
    year: '2026-07 · ODbL',
    url: 'https://www.openstreetmap.org/',
  },
  render: [
    // Point layers render as a pin from the icon registry — see "Giving a layer
    // an icon" below. Lines and fills stay ordinary MapLibre layer specs.
    pinLayer({ id: 'viewpoints-points', icon: iconId('viewpoint'), size: [0.4, 1] }),
  ],
  legend: [{ swatch: ICONS.viewpoint.color, label: 'Viewpoint', icon: iconId('viewpoint') }],
}
```

Then add `'viewpoints'` to `STACK_ORDER` in `src/map/MapView.tsx` at the right
height (points near the top, fills near the bottom). If your category is new,
add it to `CATEGORIES` in `layers.ts` and to the `LayerCategory` union.

That's it for rendering — `MapView.addGroup()` wires the source and layers, and
`LayerPanel` renders the toggle, legend and **"i" provenance popover** straight
off the registry entry. No panel edits needed for an ordinary layer.

Then keep the **LLM catalog** in lock-step (dual SSOT — do not scrape `layers.ts`):

1. Add the group id to `src/shared/registry-ids.json` `layer_groups` (same order as `LAYER_GROUPS`).
2. Add an `EntityType` in `src/worker/ontology.ts` with `layer_id` equal to that id, provenance, completeness, `searchable` (false unless the GeoJSON is a light name-scan; **never** mark a file ≳ 2 MB searchable), and `related` ids that already exist.
3. Add a row to `scripts/coverage-ledger.json` if this is civic/official-vs-OSM data.
4. Run `bun run check:ontology` — it fails if a paint id has no ontology row, if `related` ids dangle, or if a searchable GeoJSON is too big.

Missing either the JSON id or the ontology entity is a bug: `layers.ts` throws at module load when `LAYER_GROUPS` drifts from the JSON.

### 3. Teach the click formatter about it

In `src/map/featureFormat.ts`, add a branch to `formatFeature` keyed on your
`groupId`. Map the GeoJSON properties to sheet rows and links:

```ts
} else if (groupId === 'viewpoints') {
  title = str(p.name) ?? 'Viewpoint'
  detail = rows({ label: 'Category', value: 'Viewpoint' })
  linkList = links(wikipediaLink(p.wikipedia), osmLink(p))   // helpers already exist
}
```

The reusable link helpers are `websiteLink`, `wikipediaLink`, `osmLink`
(`osm.org/<osm_type>/<osm_id>`), and `fmtDate`.

### 4. Provenance popover — already done

Because you filled `info` in step 2, the "i" button and its popover render
automatically. There is no separate step; a missing `info` is a type error.


---

## Giving a layer an icon

Every point marker on the map comes from **`src/map/icons.ts`** — one registry
of hand-drawn pins. It is *original artwork*: no icon pack, no npm
dependency, no runtime fetch, and therefore no third-party licence to carry. If
you ever do vendor a glyph from an open pack, paste the path data in as static
source and record the pack + licence in the spec's comment — the provenance rule
applies to artwork exactly like it applies to data.

**Adding an icon is a one-file change:**

```ts
// src/map/icons.ts — add one entry to ICONS
kollam: {
  label: 'Kollam',                       // used by the legend + a11y label
  color: '#8b5cf6',                      // the pin body; this is also the palette
  fill: ['M12 5.4 …z'],                  // filled glyph paths (white)
  stroke: ['M8 12h8', 'M12 8v8'],        // stroked glyph paths (white, 1.9 weight)
},
```

House rules so the set stays one family:

- Author inside the pin head: **centre (12, 10.6), radius ≈ 5.5**, in the 24×29
  `ICON_BOX`. The pin silhouette (`PIN_PATH`) and the white ring are drawn for
  you; you only draw the glyph.
- One stroke weight (1.9), round caps and joins. Keep it to ~4 strokes — the
  target size is **16 px**, where anything busier turns to porridge. Check it:
  a closed shape drawn with `stroke` at this size often fills in solid, so use
  `fill` for anything chunky (see `archaeological_site`).
- Glyphs are always white. The coloured body is what carries contrast, which is
  why one icon works on both the light and the dark basemap — never author a
  per-theme variant.

**Then reference it from the layer registry** with `pinLayer()`:

```ts
render: [
  pinLayer({ id: 'kollams-points', icon: iconId('kollam'), size: [0.4, 1] }),
]
```

`icon` also takes an expression, which is how one layer gets many pins — reuse
the *same* property key the colour used to key off, so colour and glyph agree:

```ts
// icon ids are the category names, so this is an identity match + a fallback
['match', ['get', 'category'], ...cats.flatMap((c) => [c, iconId(c)]), iconId('attraction')]
```

Gotchas that have already bitten:

- **Namespace the id.** `iconId()` prefixes `fm-` because the basemap sprite
  already ships images called `attraction`, `museum`, `park`… An un-prefixed id
  makes the idempotency guard think the image exists and your layer silently
  draws the *basemap's* icon.
- **Collision is off by default.** Symbol placement runs bottom-up through the
  style, so the basemap's own labels are placed first and win; with collision on,
  an overlay layer over a busy town can be suppressed to nothing. Control density
  with the low end of `size` instead. Only opt in with `collide: true` where the
  *data* makes duplicates (route layers, which arrive as many short segments —
  pair it with a fat `padding`).
- **Theme swap.** `map.setStyle()` drops images along with sources and layers.
  `registerMapIcons(map)` is the first thing `buildOverlays()` does, so this is
  already handled — but if you ever add another style-rebuild path, call it there
  too, *before* `addLayer`.
- Set `legend: [{ swatch: ICONS.kollam.color, label: 'Kollam', icon: iconId('kollam') }]`
  and the panel renders the identical pin as inline SVG. No panel edits.

## Variant — a runtime API layer (`type: 'api'`)

Use this when the data is live or per-user (a creator feed, the user's
prospects, civic issues). The registry entry is the same shape, but:

- `source: { type: 'api', endpoint: '/api/<name>' }`.
- `MapView` adds an **empty** GeoJSON source on load, then `loadApiLayers()`
  fetches the endpoint and `setData()`s it. Failure is non-fatal — the layer
  renders nothing and its card shows an **"unavailable"** badge.
- Add an adapter case in `src/map/apiLayers.ts` (`fetchApiLayer`) that converts
  the endpoint's JSON into a `FeatureCollection`. If the endpoint already
  returns GeoJSON (like `/api/stepper`), reuse `adaptFeatureCollection`.
- The panel shows a live **count badge** / **loading** / **unavailable** state
  automatically via `ApiLayerStatus` — no extra panel code.
- For a **creator layer**, set `creator: { label, url }` on the group to render
  the attribution footer, and surface the same credit in the detail sheet
  (`attribution` field on the `FeatureInfo` your formatter returns).

## Variant — a vector-tile layer (`type: 'vector-pmtiles'`)

Heavy layers ship as PMTiles built by `data/pipeline.sh` (owned by the data
pipeline) and uploaded to R2. Set `requiresPipeline: true` and reference the
tile `file`; add the filename to `VITE_TILES` so the card un-locks once the tile
is live. Every render layer needs a `'source-layer'`.

## Checklist

- [ ] Data fetched into `public/data/` (GeoJSON, provenance on the root) **or** endpoint under `/api/*` **or** PMTiles on R2
- [ ] `package.json` refresh script alias, if a fetch script
- [ ] `LayerGroup` added to `LAYER_GROUPS` with a filled `info` block
- [ ] (point layers) icon added to `ICONS` in `src/map/icons.ts`, declared with `pinLayer()`, and mirrored in the `legend`
- [ ] `id` added to `STACK_ORDER`; new `category` added to `CATEGORIES` + the union if needed
- [ ] `formatFeature` branch for click → detail sheet
- [ ] (API layers) adapter case in `apiLayers.ts`
- [ ] `bunx tsc -b` and `bun run build` pass
