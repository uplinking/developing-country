#!/usr/bin/env bash
#
# Property Scout — data pipeline (Sri Lanka + southern India).
#
# Generates the PMTiles overlays the app consumes. Idempotent: each stage skips
# if its output already exists (delete a file in data/build/ to regenerate it).
#
# Prerequisites (macOS): brew install osmium-tool tippecanoe gdal pmtiles
#   - osmium / tippecanoe / tile-join  (OSM -> vector PMTiles)
#   - gdal (gdalwarp, gdal_contour, gdal_calc.py)  (climate rasters)
#   - pmtiles (go-pmtiles)  (basemap extract)
#   - node  (road classifier)
#
# Outputs (upload data/build/*.pmtiles to R2):
#   roads.pmtiles     tier-classified roads          (source-layer: roads)
#   water.pmtiles     water polygons + waterways      (source-layers: water, waterways)
#   climate.pmtiles   rainfall/temperature/humidity   (source-layers: rainfall, temperature, humidity)
#   basemap.pmtiles   optional self-hosted basemap
#
# Expressways + developments overlays are produced by the scripts/ node builders.

set -euo pipefail
cd "$(dirname "$0")/.."          # repo root
mkdir -p data/build data/src
BUILD=data/build
SRC=data/src

# Region bounding box: Sri Lanka + southern India (Tamil Nadu + Kerala). W S E N
BBOX_W=74.5; BBOX_S=5.5; BBOX_E=82.5; BBOX_N=13.5

SLK="$SRC/sri-lanka-latest.osm.pbf"
IND="$SRC/india-southern-zone-latest.osm.pbf"
COMBINED="$SRC/combined.osm.pbf"

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }
require() {
  local missing=0
  for t in "$@"; do have "$t" || { echo "  MISSING: $t"; missing=1; }; done
  [ "$missing" = 0 ] || { echo "  (stage skipped — install the tools above)"; return 1; }
}

# ---------------------------------------------------------------------------
# 0. Source OSM extracts + combined region pbf
# ---------------------------------------------------------------------------
fetch_osm() {
  [ -f "$SLK" ] || { log "Downloading Sri Lanka OSM (Geofabrik)"; curl -L --fail -o "$SLK" \
    https://download.geofabrik.de/asia/sri-lanka-latest.osm.pbf; }
  [ -f "$IND" ] || { log "Downloading India Southern Zone OSM (~529 MB)"; curl -L --fail -o "$IND" \
    https://download.geofabrik.de/asia/india/southern-zone-latest.osm.pbf; }
}

build_combined() {
  [ -f "$COMBINED" ] && { echo "  have $COMBINED"; return; }
  require osmium || return 1
  log "Clipping southern-India bbox + merging with Sri Lanka"
  osmium extract -b "$BBOX_W,$BBOX_S,$BBOX_E,$BBOX_N" "$IND" -o "$BUILD/_india-bbox.osm.pbf" --overwrite
  osmium merge "$BUILD/_india-bbox.osm.pbf" "$SLK" -o "$COMBINED" --overwrite
}

# ---------------------------------------------------------------------------
# 1. Roads — tier-classified network (whole region)
# ---------------------------------------------------------------------------
build_roads() {
  local out="$BUILD/roads.pmtiles"
  [ -f "$out" ] && { echo "  have $out"; return; }
  require osmium tippecanoe node || return 1
  log "Filtering + classifying roads"
  osmium tags-filter -o "$BUILD/roads.osm.pbf" --overwrite "$COMBINED" w/highway
  osmium export "$BUILD/roads.osm.pbf" -f geojsonseq --overwrite \
    | node scripts/classify-roads.mjs > "$BUILD/roads.geojsonseq"
  tippecanoe -o "$out" --force -z13 -Z4 \
    --drop-densest-as-needed --extend-zooms-if-still-dropping \
    --coalesce-densest-as-needed --simplification=4 --maximum-tile-bytes=500000 \
    -l roads -n "Region roads" "$BUILD/roads.geojsonseq"
}

# ---------------------------------------------------------------------------
# 2. Water — polygons (reservoirs/tanks/lagoons) + waterways (rivers/canals)
# ---------------------------------------------------------------------------
build_water() {
  local out="$BUILD/water.pmtiles"
  [ -f "$out" ] && { echo "  have $out"; return; }
  require osmium tippecanoe tile-join || return 1
  log "Filtering water bodies + waterways"
  osmium tags-filter -o "$BUILD/water_poly.osm.pbf" --overwrite "$COMBINED" nwr/natural=water nwr/water
  osmium tags-filter -o "$BUILD/waterways.osm.pbf" --overwrite "$COMBINED" w/waterway=river,stream,canal
  osmium export "$BUILD/water_poly.osm.pbf" -f geojsonseq --overwrite > "$BUILD/water_poly.geojsonseq"
  osmium export "$BUILD/waterways.osm.pbf" -f geojsonseq --overwrite > "$BUILD/waterways.geojsonseq"
  tippecanoe -o "$BUILD/_water.pmtiles" --force -z12 -Z4 --drop-densest-as-needed \
    --coalesce-densest-as-needed --maximum-tile-bytes=500000 -l water "$BUILD/water_poly.geojsonseq"
  tippecanoe -o "$BUILD/_waterways.pmtiles" --force -z12 -Z4 --drop-densest-as-needed \
    --maximum-tile-bytes=500000 -l waterways "$BUILD/waterways.geojsonseq"
  tile-join -o "$out" --force "$BUILD/_water.pmtiles" "$BUILD/_waterways.pmtiles"
}

# ---------------------------------------------------------------------------
# 3. Climate normals — rainfall, temperature, humidity (WorldClim 2.1, 2.5 arc-min)
# ---------------------------------------------------------------------------
fetch_worldclim() {
  local base=https://geodata.ucdavis.edu/climate/worldclim/2_1/base
  # bio = annual bioclim (bio_1 mean temp, bio_12 annual precip);
  # tavg/prec/vapr = 12 monthly rasters (mean temp, precipitation, vapour pressure).
  for v in bio tavg prec vapr; do
    [ -f "$SRC/.wc_${v}_done" ] && continue
    local zip="$SRC/wc2.1_2.5m_${v}.zip"
    [ -f "$zip" ] || { log "Downloading WorldClim 2.5m $v"; curl -L --fail -o "$zip" "$base/wc2.1_2.5m_${v}.zip"; }
    unzip -o -q "$zip" -d "$SRC" && touch "$SRC/.wc_${v}_done"
  done
}

# Climate = rainfall / temperature / humidity, each as ANNUAL (_00) plus the 12
# monthly means (_01..12) — 39 contour layers in one climate.pmtiles. The app
# ships every timestep in the file, so scrubbing months is instant (no refetch).
build_climate() {
  local out="$BUILD/climate.pmtiles"
  [ -f "$out" ] && { echo "  have $out"; return; }
  require gdalwarp gdal_contour gdal_calc.py tippecanoe tile-join unzip || return 1
  fetch_worldclim || { echo "  (climate skipped — WorldClim download failed)"; return 1; }
  log "Building climate normals — annual + 12 months (WorldClim 2.5m)"

  local parts=()
  # Clip a (global) source raster to the region bbox → small tif.
  _clip() { gdalwarp -q -overwrite -te "$BBOX_W" "$BBOX_S" "$BBOX_E" "$BBOX_N" "$1" "$2"; }
  # Relative humidity (%) from vapour pressure (kPa, A) + mean temp (°C, B).
  _rh() { gdal_calc.py --quiet --overwrite -A "$1" -B "$2" --outfile="$3" \
    --calc="minimum(100.0, 100.0*A/(0.61121*exp(17.502*B/(240.97+B))))"; }
  # Filled polygon bands (amin/amax = the band's value range) so the app renders
  # them as choropleth fills; one tippecanoe layer per (variable, timestep).
  _contour() { # <clipped.tif> <interval> <layername>
    gdal_contour -q -p -amin value -amax value_max -i "$2" "$1" "$BUILD/_$3.geojson"
    tippecanoe -o "$BUILD/_$3.pmtiles" --force -z10 -Z4 --drop-densest-as-needed -l "$3" "$BUILD/_$3.geojson"
    parts+=("$BUILD/_$3.pmtiles")
  }

  # --- Monthly (_01..12): clip prec/tavg/vapr, derive RH, contour each --------
  local letters=(A B C D E F G H I J K L) vArgs="" tArgs="" vCalc="" tCalc="" i=0
  for mm in 01 02 03 04 05 06 07 08 09 10 11 12; do
    _clip "$SRC/wc2.1_2.5m_prec_${mm}.tif" "$BUILD/_p${mm}.tif"
    _clip "$SRC/wc2.1_2.5m_tavg_${mm}.tif" "$BUILD/_tv${mm}.tif"
    _clip "$SRC/wc2.1_2.5m_vapr_${mm}.tif" "$BUILD/_vp${mm}.tif"
    _rh "$BUILD/_vp${mm}.tif" "$BUILD/_tv${mm}.tif" "$BUILD/_h${mm}.tif"
    _contour "$BUILD/_p${mm}.tif"  50 "rainfall_${mm}"
    _contour "$BUILD/_tv${mm}.tif" 1  "temperature_${mm}"
    _contour "$BUILD/_h${mm}.tif"  5  "humidity_${mm}"
    # Accumulate annual-mean expressions for vapr/tavg from the clips.
    vArgs="$vArgs -${letters[$i]} $BUILD/_vp${mm}.tif"; vCalc="${vCalc:+$vCalc+}${letters[$i]}"
    tArgs="$tArgs -${letters[$i]} $BUILD/_tv${mm}.tif"; tCalc="${tCalc:+$tCalc+}${letters[$i]}"
    i=$((i+1))
  done

  # --- Annual (_00): bio_12 precip, bio_1 mean temp, RH from 12-month means ----
  _clip "$SRC/wc2.1_2.5m_bio_12.tif" "$BUILD/_r00.tif"; _contour "$BUILD/_r00.tif" 250 rainfall_00
  _clip "$SRC/wc2.1_2.5m_bio_1.tif"  "$BUILD/_t00.tif"; _contour "$BUILD/_t00.tif" 1   temperature_00
  gdal_calc.py --quiet --overwrite $vArgs --outfile="$BUILD/_vmean.tif" --calc="($vCalc)/12.0"
  gdal_calc.py --quiet --overwrite $tArgs --outfile="$BUILD/_tmean.tif" --calc="($tCalc)/12.0"
  _rh "$BUILD/_vmean.tif" "$BUILD/_tmean.tif" "$BUILD/_h00.tif"; _contour "$BUILD/_h00.tif" 5 humidity_00

  tile-join -o "$out" --force "${parts[@]}"
}

# ---------------------------------------------------------------------------
# 4. Basemap — optional self-hosted Protomaps region extract
# ---------------------------------------------------------------------------
build_basemap() {
  local out="$BUILD/basemap.pmtiles"
  [ -f "$out" ] && { echo "  have $out"; return; }
  require pmtiles || return 1
  log "Extracting region basemap from Protomaps planet build"
  pmtiles extract https://build.protomaps.com/20240101.pmtiles "$out" \
    --bbox="$BBOX_W,$BBOX_S,$BBOX_E,$BBOX_N" --maxzoom=13 || {
      echo "  NOTE: update the planet build date to a current one from https://maps.protomaps.com/builds/"
      return 1
    }
}

# ---------------------------------------------------------------------------
main() {
  fetch_osm
  build_combined
  build_roads   || echo "  (roads skipped)"
  build_water   || echo "  (water skipped)"
  build_climate || echo "  (climate skipped)"
  [ "${1:-}" = "--basemap" ] && { build_basemap || echo "  (basemap skipped)"; }
  log "Done. Upload data/build/*.pmtiles to R2; ensure VITE_TILES lists the files."
  ls -lh "$BUILD"/*.pmtiles 2>/dev/null || true
}

main "$@"
