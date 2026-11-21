export const API_TABLES_URL = 'https://explore.developing-country.org/api/tables'
/** Run verbatim against a local Worker on 2026-11-22; keep docs/DATA_API.md in step. */
export const PYTHON_EXAMPLE = `import json
import urllib.request

import pandas as pd

API = "${API_TABLES_URL}"

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
print(meta["citation"])`
export const R_EXAMPLE = `API <- "${API_TABLES_URL}"

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
meta$citation`
