# Data pipeline

Generates the PMTiles overlays the map consumes. All sources are free/open, no
API keys. Run once; re-run to refresh. Outputs land in `data/build/`.

```bash
# install tools (macOS)
brew install osmium-tool tippecanoe gdal go-pmtiles

# generate everything it can from OSM automatically
./data/pipeline.sh
```

The **expressways** overlay ships in the repo already
(`public/data/expressways.geojson`, produced by
`node scripts/fetch-expressways.mjs` from the Overpass API). Everything else is
built by `pipeline.sh`.

## Layers & expected property schema

The app (`src/map/layers.ts`) expects these tileset layer names and properties.
If you change the pipeline, keep these in sync.

| PMTiles | source-layer | key properties |
|---|---|---|
| `basemap.pmtiles` | (Protomaps schema) | — |
| `roads.pmtiles` | `roads` | `tier` (`expressway`\|`A`\|`B`\|`C`\|`other`), `width`, `width_est`, `lanes`, `surface`, `ref`, `name` |
| `water.pmtiles` | `water` (polygons), `waterways` (lines) | `name`, `water`, `waterway` |
| `climate.pmtiles` | `rainfall`, `temperature`, `humidity` | `value` (numeric: mm/yr, °C, % RH) |

## Roads: width

OSM's `width` tag is effectively empty for Sri Lanka, so `classify-roads.mjs`
adds `width_est` from `lanes × 3.5 m`, or a per-tier default when lanes are
unknown. The app labels these "estimated" vs "surveyed" (`width`) on click.

## Climate normals (WorldClim 2.1, ~1 km)

`pipeline.sh` clips + contours rasters you place in `data/src/`. Download the
30-arc-second GeoTIFFs from https://worldclim.org/data/worldclim21.html:

- **Rainfall** — `wc2.1_30s_bio_12.tif` (annual precipitation, from the *bioclim* zip).
- **Temperature** — `wc2.1_30s_bio_1.tif` (annual mean temperature, *bioclim* zip).
- **Humidity** — WorldClim has no relative-humidity layer. Derive it from vapour
  pressure (`vapr`) + mean temp (`tavg`) with the saturation-vapour formula and
  save as `humidity_rh.tif`:

  ```bash
  # annual-mean vapour pressure (kPa) and temperature (°C) from the 12 monthly files
  gdal_calc.py -A wc2.1_30s_vapr_*.tif --outfile=vapr_mean.tif --calc="mean(A,axis=0)"
  gdal_calc.py -A wc2.1_30s_tavg_*.tif --outfile=tavg_mean.tif --calc="mean(A,axis=0)"
  # RH% = 100 * e_actual / e_sat ; e_sat(T)=0.61121*exp(17.502*T/(240.97+T)) kPa
  gdal_calc.py -A vapr_mean.tif -B tavg_mean.tif --outfile=data/src/humidity_rh.tif \
    --calc="minimum(100, 100*A/(0.61121*exp(17.502*B/(240.97+B))))"
  ```

  (CHELSA v2.1 is a drop-in upgrade for the central highlands if WorldClim's
  interpolation looks coarse there.)

## Uploading to Cloudflare R2

```bash
# one-time: create the bucket (see ../worker for the Worker that serves it)
npx wrangler r2 bucket create sl-scout-tiles

# upload (rclone handles large files better than the dashboard's 300 MB cap)
for f in data/build/*.pmtiles; do
  npx wrangler r2 object put "sl-scout-tiles/$(basename "$f")" --file "$f" --remote
done
```

Then set `VITE_TILE_BASE` to your Worker's `/tiles` route and `VITE_TILES_READY=1`
so the roads/water/climate layers switch on in the UI.

## Explore layers (nature & tourism — Pillar B)

Five lightweight GeoJSON layers pulled straight from **OpenStreetMap** via the
Overpass API — no heavy toolchain needed. Each `FeatureCollection` carries
`{ source: "OpenStreetMap", vintage: "2026-07", licence: "ODbL" }` at the root,
and every feature carries `source`, `osm_type`, `osm_id` (+ `website` /
`wikipedia` / `wikidata` when OSM has them).

```bash
# refresh all five (idempotent, self-validating, retries + mirror failover)
node scripts/fetch-explore.mjs

# or a subset
node scripts/fetch-explore.mjs attractions parks
```

The script scopes to Sri Lanka (Overpass area `3600536807`), rounds coordinates
to 5 decimals, and asserts minimum feature counts — it exits non-zero and prints
a summary table if any layer comes back empty/short. Parks are Douglas–Peucker
simplified and re-simplified adaptively to keep the file under ~3 MB.

| File | Geometry | Feature `category` values | OSM selectors | Count (2026-07) |
|---|---|---|---|---|
| `attractions.geojson` | Point | `attraction`, `museum`, `zoo`, `theme_park`, `viewpoint`, `fort`, `castle`, `archaeological_site`, `ruins`, `monument` | `tourism=attraction\|museum\|zoo\|theme_park\|viewpoint`, `historic=fort\|castle\|archaeological_site\|ruins\|monument` (way/relation centroids) | ~1129 |
| `waterfalls.geojson` | Point | `waterfall` | `waterway=waterfall`, `natural=waterfall`; name optional | ~137 |
| `trails.geojson` | (Multi)LineString | `hiking` | relations `route=hiking\|foot\|walking` with a name (incl. all Pekoe Trail stages) | ~24 |
| `cycling.geojson` | (Multi)LineString | `cycling` | relations `route=bicycle\|mtb` (unnamed kept — OSM has very few; curated hill-country routes to augment later) | ~2 |
| `parks.geojson` | Polygon / MultiPolygon | `national_park`, `nature_reserve`, `protected_area` | `boundary=national_park`, `leisure=nature_reserve`, `boundary=protected_area` (`protect_class<=6` or unset) | ~60 |

Property keys: attractions/waterfalls → `name`, `category`, `osm_type`,
`osm_id`, `source` (+ `tourism`/`historic` or `height`); trails/cycling →
`name`, `category`, `ref`, `distance`, `network`, `route`, `osm_id`; parks →
`name`, `category`, `boundary`, `leisure`, `protect_class`, `protection_title`,
`osm_id`. These ship as static assets in `public/data/` (served by the SPA), no
tiling required.
