#!/usr/bin/env bash
# Build demographics.pmtiles — one vector tileset with four source-layers
# (province / district / dsd / gnd), each at a zoom range suited to its size,
# so the population level slider can switch between them. Coarse levels live at
# low zoom; GND (~14k polygons) only at high zoom to keep tiles sane.
#
# Prereqs: tippecanoe, tile-join, pmtiles (brew install tippecanoe pmtiles).
# Input:   $OUT_DIR/{province,district,dsd,gnd}.geojsonl (scripts/build-demographics.mjs)
# Output:  data/build/demographics.pmtiles  → upload to R2 (developing-country-tiles),
#          then add demographics.pmtiles to VITE_TILES.
set -euo pipefail
OUT="${OUT_DIR:-/tmp/demo}"
BUILD="data/build"
mkdir -p "$BUILD"

TIP() {
  tippecanoe --force --detect-shared-borders --simplification=8 --no-tile-size-limit \
    --include=id --include=name --include=pop --include=pop_2012 --include=dens \
    --include=area --include=parent --include=vintage \
    "$@"
}

# Every level spans the full interactive zoom range (app min zoom ~5), so the
# slider — not the zoom — decides which level shows. tippecanoe simplifies
# geometry hard at low zoom, so even the ~14k GND polygons tile at z4.
echo "Tiling province / district / dsd / gnd (all at z4–14) …"
TIP -o "$BUILD/_prov.pmtiles"  -l province -Z4 -z14 "$OUT/province.geojsonl"
TIP -o "$BUILD/_dist.pmtiles"  -l district -Z4 -z14 "$OUT/district.geojsonl"
TIP -o "$BUILD/_dsd.pmtiles"   -l dsd      -Z4 -z14 "$OUT/dsd.geojsonl"
TIP -o "$BUILD/_gnd.pmtiles"   -l gnd      -Z4 -z14 "$OUT/gnd.geojsonl"

# --no-tile-size-limit is REQUIRED here too: at z6–z7 all of Sri Lanka's ~14k GND
# polygons land in one/two tiles that exceed tile-join's default 500 KB cap, so
# without this it silently drops those tiles — leaving a z6–7 hole (blank at the
# ~z7 default view) while z4–5 and z8+ survive. Keep it in sync with TIP() above.
tile-join --force --no-tile-size-limit -o "$BUILD/demographics.pmtiles" \
  "$BUILD/_prov.pmtiles" "$BUILD/_dist.pmtiles" "$BUILD/_dsd.pmtiles" "$BUILD/_gnd.pmtiles"
rm -f "$BUILD/_prov.pmtiles" "$BUILD/_dist.pmtiles" "$BUILD/_dsd.pmtiles" "$BUILD/_gnd.pmtiles"

echo "=== demographics.pmtiles ==="
ls -lh "$BUILD/demographics.pmtiles" | awk '{print $5}'
pmtiles show "$BUILD/demographics.pmtiles" 2>/dev/null | grep -iE "layer|min zoom|max zoom|tile count" | head -20
