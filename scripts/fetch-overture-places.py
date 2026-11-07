"""Extract Overture Maps Places for the Colombo Metro Bus study area.

Prerequisite: uv (https://docs.astral.sh/uv/). DuckDB is not a repo dependency;
uv provides it for this one run, like gdal/tippecanoe for the heavy pipeline:

    uvx --with duckdb python -I scripts/fetch-overture-places.py [--refresh]

Reads the pinned public release (anonymous S3, no auth) with DuckDB httpfs and
keeps places whose bbox starts inside the study bbox. Writes, under the
gitignored data/src/overture/:

    places-<release>-colombo.parquet  raw extract (re-used unless --refresh)
    places-<release>-colombo.json     compact, sorted rows for scripts/build-workplaces.mjs

The extract is data only: names and categories are copied as strings and never
evaluated. Idempotent: the JSON is rewritten only when its bytes change, and the
script validates row count, id uniqueness, coordinates and licences first.
"""

import json
import os
import sys

import duckdb

RELEASE = "2026-09-23.1"
BBOX = {"xmin": 79.82, "xmax": 80.06, "ymin": 6.62, "ymax": 7.12}
SOURCE = f"s3://overturemaps-us-west-2/release/{RELEASE}/theme=places/type=place/*"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "data", "src", "overture")
PARQUET = os.path.join(OUT_DIR, f"places-{RELEASE}-colombo.parquet")
JSON_OUT = os.path.join(OUT_DIR, f"places-{RELEASE}-colombo.json")
MIN_ROWS = 40_000
COLUMNS = [
    "id", "name", "basic_category", "taxonomy_primary", "taxonomy_hierarchy",
    "confidence", "operating_status", "lng", "lat", "licenses", "datasets",
]


def extract(con):
    os.makedirs(OUT_DIR, exist_ok=True)
    tmp = PARQUET + ".tmp"
    con.execute("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial; SET s3_region='us-west-2';")
    con.execute(f"""
        COPY (
          SELECT id,
                 names.primary AS name,
                 basic_category,
                 taxonomy.primary AS taxonomy_primary,
                 taxonomy.hierarchy AS taxonomy_hierarchy,
                 confidence,
                 operating_status,
                 ST_X(geometry) AS lng,
                 ST_Y(geometry) AS lat,
                 list_transform(sources, s -> s.license) AS licenses,
                 list_transform(sources, s -> s.dataset) AS datasets
          FROM read_parquet('{SOURCE}', hive_partitioning = 1)
          WHERE bbox.xmin BETWEEN {BBOX['xmin']} AND {BBOX['xmax']}
            AND bbox.ymin BETWEEN {BBOX['ymin']} AND {BBOX['ymax']}
        ) TO '{tmp}' (FORMAT parquet)
    """)
    os.replace(tmp, PARQUET)


def main():
    con = duckdb.connect()
    if "--refresh" in sys.argv or not os.path.exists(PARQUET):
        print(f"fetch-overture-places: reading {SOURCE} (bbox {BBOX}) …")
        extract(con)
    rows = con.execute(
        f"SELECT {', '.join(COLUMNS)} FROM read_parquet(?) ORDER BY id", [PARQUET]
    ).fetchall()

    problems = []
    if len(rows) < MIN_ROWS:
        problems.append(f"only {len(rows)} places (expected ≥ {MIN_ROWS})")
    ids = [r[0] for r in rows]
    if len(set(ids)) != len(ids):
        problems.append("duplicate place ids")
    for r in rows:
        lng, lat = r[7], r[8]
        if lng is None or lat is None or not (79.7 < lng < 80.2 and 6.5 < lat < 7.25):
            problems.append(f"{r[0]}: coordinates {lng},{lat} outside the study area")
        if not r[9]:
            problems.append(f"{r[0]}: no source licence")
        if len(problems) > 20:
            break
    if problems:
        print("fetch-overture-places: FAILED\n  " + "\n  ".join(problems), file=sys.stderr)
        sys.exit(1)

    def clean(r):
        return [
            r[0],
            r[1],
            r[2],
            r[3],
            list(r[4] or []),
            None if r[5] is None else round(float(r[5]), 4),
            r[6],
            round(float(r[7]), 6),
            round(float(r[8]), 6),
            list(r[9] or []),
            list(r[10] or []),
        ]

    payload = {
        "source": "Overture Maps Foundation — Places",
        "release": RELEASE,
        "url": f"https://docs.overturemaps.org/release/{RELEASE}/",
        "licence": "CDLA-Permissive-2.0 (per-row source licences retained)",
        "bbox": BBOX,
        "columns": COLUMNS,
        "count": len(rows),
        "rows": [clean(r) for r in rows],
    }
    text = json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n"
    previous = None
    if os.path.exists(JSON_OUT):
        with open(JSON_OUT, encoding="utf-8") as fh:
            previous = fh.read()
    if previous == text:
        print(f"fetch-overture-places: unchanged — {len(rows)} places ({JSON_OUT})")
        return
    with open(JSON_OUT, "w", encoding="utf-8") as fh:
        fh.write(text)
    print(f"fetch-overture-places: wrote {len(rows)} places → {JSON_OUT}")


if __name__ == "__main__":
    main()
