# Data API: list, filter and download Indicator Tables

Every Indicator Table on developing-country.org can be read over plain HTTP,
without an account or a key. The same guide is published for students at
<https://developing-country.org/api>.

Base URL: `https://explore.developing-country.org/api/tables`

| Request | Returns |
| --- | --- |
| `GET /api/tables` | every table: id, title, publisher, reuse terms, CSV and metadata URLs |
| `GET /api/tables/{id}` | metadata: fields with labels and units, sources, reuse terms, citation, row count |
| `GET /api/tables/{id}.csv` | the table as CSV |

## CSV

- The first line is the header: stable, lower-case `snake_case` field ids.
  They match the ids in the metadata, the MCP `query_data` tool and the
  explorer.
- One row per record. Empty cells are missing values (`NA` in R, `NaN` in
  pandas). Lines end in CRLF (RFC 4180), UTF-8.
- The body has no comment lines, so `read.csv(url)` and
  `pandas.read_csv(url)` work with no extra arguments. Source, licence and
  version travel in the metadata request and in the response headers:
  `Link: <…/api/tables/{id}>; rel="describedby"`, a `rel="license"` link
  (or `rel="terms-of-service"` when the publisher names no licence),
  `X-Licence-Status`, `X-Row-Count` and, for scheduled sources,
  `X-Dataset-Version`.

## Filters

Filters go in the query string and are checked against the table's fields.
An unknown parameter returns `400` with the list of valid field ids.

| Parameter | Meaning |
| --- | --- |
| `?district=Colombo` | equals |
| `?district=Colombo,Gampaha` | any of these values |
| `?year.gte=2020&year.lte=2024` | from / to (inclusive) |
| `?fields=year,district,value` | only these columns, in this order |
| `?order_by=-year,district` | sort; `-` means descending |
| `?version=dsv_…` | pin a Dataset Version (scheduled sources only) |

At most 8 filters per request. Archived scheduled tables (the
quarter-hourly electricity tables) need a `report_date` window of at most 31
days, for example `?report_date.gte=2026-11-01&report_date.lte=2026-11-14`.

The export uses the same bounded select as the MCP `query_data` tool. It
returns up to 50,000 rows; larger results return `413` and ask for a filter.

## Examples

Both were run, as written, against a local development server
(`bun run cf:dev`) on 2026-11-22 with `API` pointed at it, using R 4 with
jsonlite and Python 3.14 with pandas 3.1.

### Python (pandas)

```python
import json
import urllib.request

import pandas as pd

API = "https://explore.developing-country.org/api/tables"

# 1. List every table
tables = pd.DataFrame(json.load(urllib.request.urlopen(API))["tables"])
print(tables[["dataset_id", "title", "publisher"]].head())

# 2. Fetch one whole table
cpi = pd.read_csv(f"{API}/ccpi-monthly.csv")

# 3. Filter rows and pick columns in the URL
pop = pd.read_csv(
    f"{API}/population-estimates-district.csv"
    "?geography_name=Colombo,Gampaha&year.gte=2022&fields=geography_name,year,sex,population"
)

# 4. Licence, sources and a citation for the same table
meta = json.load(urllib.request.urlopen(f"{API}/ccpi-monthly"))
print(meta["reuse"]["label"], meta["reuse"]["terms_url"])
print(meta["citation"])
```

### R

```r
API <- "https://explore.developing-country.org/api/tables"

# 1. List every table (needs the jsonlite package)
tables <- jsonlite::fromJSON(API)$tables
head(tables[, c("dataset_id", "title", "publisher")])

# 2. Fetch one whole table
cpi <- read.csv(paste0(API, "/ccpi-monthly.csv"))

# 3. Filter rows and pick columns in the URL
pop <- read.csv(paste0(
  API, "/population-estimates-district.csv",
  "?geography_name=Colombo,Gampaha&year.gte=2022&fields=geography_name,year,sex,population"
))

# 4. Licence, sources and a citation for the same table
meta <- jsonlite::fromJSON(paste0(API, "/ccpi-monthly"))
meta$reuse$label
meta$citation
```

## Licences

Each table's `reuse` block records what its publisher states, read on the
publisher's own site, with the URL (`terms_url`) and the date it was checked
(`checked_on`). `status` is one of:

- `open_licence`: the publisher names an open licence, given in `licence`.
- `reuse_with_attribution`: the publisher permits reproduction with
  acknowledgement, without a standard licence; read `statement` for limits.
- `all_rights_reserved`: the publisher's site carries a copyright notice and
  grants no general reuse permission.
- `no_licence_stated`: we found no reuse terms at all.

Most Sri Lankan government publishers state no open licence. Public
availability does not by itself grant permission to redistribute; check
`statement` and the publisher's page before republishing a table. The terms
are recorded per publisher, with per-dataset overrides, in
`packages/datasets/src/reuseTerms.ts`.

## Citing a dataset

Use the `citation` field of the metadata request. It names the publisher, the
table, developing-country.org as distributor, the Dataset Version when there
is one, the dataset page and the access date:

> Department of Census and Statistics, Sri Lanka. Colombo Consumer Price
> Index. Distributed by developing-country.org.
> https://developing-country.org/data/ccpi-monthly (accessed 2026-11-22).

Also credit the publisher the way its terms ask (`reuse.attribution`), and
cite the original publication listed under `sources` when you quote a figure.

## Beyond tables

Spatial layers, aggregation and saved charts are available through the MCP
server; see [MCP.md](MCP.md). `GET /api/catalog` returns the full catalogue
the MCP tools use.
