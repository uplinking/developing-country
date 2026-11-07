import { datasetExploreUrl, datasetNotes } from './lib/datasets'

const DATASET_PREVIEW_0005_IDS = [
  'attractions',
  'boi-zones',
  'cycling',
  'demographics',
  'developments',
  'expressways',
  'hospitals',
  'metro',
  'metro_catchment',
  'osm_foot_graph',
  'parks',
  'schools',
  'sea-routes',
  'trails',
  'waterfalls',
  'census-age-sex-dsd',
  'census-households-dsd',
  'census-basic-services-district',
  'population-estimates-district',
  'labour-force',
  'employment-by-industry',
  'poverty-headcount-district',
  'gdp-by-industry',
  'inpatient-morbidity-mortality',
  'land-cover-district',
  'merchandise-trade-monthly',
  'merchandise-trade-category-annual',
  'workers-remittances-monthly',
  'government-fiscal-operations-annual',
  'government-revenue-annual',
  'central-government-debt-annual',
] as const

const DATASET_PREVIEW_0008_IDS = [
  'attractions',
  'boi-zones',
  'cycling',
  'demographics',
  'developments',
  'expressways',
  'hospitals',
  'irrigation-gauges',
  'land-cover-grid',
  'metro',
  'metro_catchment',
  'osm_foot_graph',
  'parks',
  'population-change',
  'schools',
  'sea-routes',
  'trails',
  'waterfalls',
  'electricity-generation-quarter-hourly',
  'electricity-generation-daily',
  'census-age-sex-dsd',
  'census-households-dsd',
  'census-basic-services-district',
  'census-ethnicity-district',
  'census-religion-district',
  'census-housing-structure-district',
  'population-estimates-district',
  'population-change-district',
  'labour-force',
  'ccpi-monthly',
  'employment-by-industry',
  'poverty-headcount-district',
  'gdp-by-industry',
  'inpatient-morbidity-mortality',
  'land-cover-district',
  'merchandise-trade-monthly',
  'merchandise-trade-category-annual',
  'workers-remittances-monthly',
  'government-fiscal-operations-annual',
  'government-revenue-annual',
  'central-government-debt-annual',
  'colombo-land-valuation-indicator',
  'colombo-asking-price-indices',
  'exchange-rates-monthly',
  'effective-exchange-rate-indices',
  'tourism-earnings-monthly',
  'registered-motor-vehicles-annual',
  'new-vehicle-registrations-annual',
] as const

const DATASET_PREVIEW_0006_IDS = ['land-cover-grid'] as const

function sqlText(value: string | null): string {
  return value === null ? 'NULL' : `'${value.replaceAll("'", "''")}'`
}

function contractValues(ids: readonly string[], historical = false): string {
  return ids.map((id) => {
    const dataset = datasetNotes.find((candidate) => candidate.id === id)
    if (!dataset) throw new Error(`Missing dataset preview contract for ${id}`)
    const url = historical && id === 'land-cover-district'
      ? 'https://explore.developing-country.org/datasets/land-cover-district/colombo-composition?embed=dataset'
      : dataset.preview ? datasetExploreUrl(dataset.id, true) : null
    return `  (${sqlText(dataset.id)}, ${sqlText(url)})`
  }).join(',\n')
}

/** Reproduce the immutable 0005 snapshot from its registered dataset ids. */
export function datasetPreviewMigrationSql(): string {
  const values = contractValues(DATASET_PREVIEW_0005_IDS, true)

  return `-- Replace the map-only preview gate with one registry for map and chart
-- dataset previews. Apply this migration before syncing the new indicator
-- dataset notes: the 0004 triggers intentionally reject unknown dataset ids.

DROP TRIGGER IF EXISTS dc_articles_dataset_preview_insert;
DROP TRIGGER IF EXISTS dc_articles_dataset_preview_update;

CREATE TABLE IF NOT EXISTS dc_dataset_previews (
  dataset_id TEXT PRIMARY KEY,
  preview_url TEXT
) WITHOUT ROWID;

DELETE FROM dc_dataset_previews;
INSERT INTO dc_dataset_previews (dataset_id, preview_url) VALUES
${values};

UPDATE ec_articles
SET dataset_preview_url = (
  SELECT preview_url
  FROM dc_dataset_previews
  WHERE dataset_id = ec_articles.dataset_id
)
WHERE format = 'dataset_note';

UPDATE _emdash_fields
SET label = 'Dataset preview URL'
WHERE slug = 'dataset_preview_url'
  AND collection_id IN (
    SELECT id FROM _emdash_collections WHERE slug = 'articles'
  );

CREATE TRIGGER dc_articles_dataset_preview_insert
BEFORE INSERT ON ec_articles
WHEN NEW.status = 'published'
BEGIN
  SELECT RAISE(ABORT, 'dc_dataset_contract: invalid published dataset preview or evidence')
  WHERE
    (NEW.format <> 'dataset_note' AND NEW.dataset_preview_url IS NOT NULL)
    OR (
      NEW.format = 'dataset_note'
      AND NOT EXISTS (
        SELECT 1
        FROM dc_dataset_previews AS preview
        WHERE preview.dataset_id = NEW.dataset_id
          AND NEW.dataset_preview_url IS preview.preview_url
      )
    )
    OR (
      NEW.format = 'dataset_note'
      AND NOT EXISTS (
        SELECT 1
        FROM json_each(NEW.evidence_bundle, '$.datasetVersions') AS version
        WHERE json_extract(version.value, '$.datasetId') = NEW.dataset_id
      )
    );
END;

CREATE TRIGGER dc_articles_dataset_preview_update
BEFORE UPDATE ON ec_articles
WHEN NEW.status = 'published'
BEGIN
  SELECT RAISE(ABORT, 'dc_dataset_contract: invalid published dataset preview or evidence')
  WHERE
    (NEW.format <> 'dataset_note' AND NEW.dataset_preview_url IS NOT NULL)
    OR (
      NEW.format = 'dataset_note'
      AND NOT EXISTS (
        SELECT 1
        FROM dc_dataset_previews AS preview
        WHERE preview.dataset_id = NEW.dataset_id
          AND NEW.dataset_preview_url IS preview.preview_url
      )
    )
    OR (
      NEW.format = 'dataset_note'
      AND NOT EXISTS (
        SELECT 1
        FROM json_each(NEW.evidence_bundle, '$.datasetVersions') AS version
        WHERE json_extract(version.value, '$.datasetId') = NEW.dataset_id
      )
    );
END;
`
}

/** Frozen 0008 snapshot; new datasets need an append-only migration. */
export function datasetPreviewCurrentMigrationSql(): string {
  return `-- Bring the preview registry up to date, including NSO electricity tables.
-- Existing article content and publication status are preserved.
INSERT INTO dc_dataset_previews (dataset_id, preview_url) VALUES
${contractValues(DATASET_PREVIEW_0008_IDS)}
ON CONFLICT(dataset_id) DO UPDATE SET preview_url = excluded.preview_url;

UPDATE ec_articles SET dataset_preview_url = (
  SELECT preview_url FROM dc_dataset_previews WHERE dataset_id = ec_articles.dataset_id
)
WHERE format = 'dataset_note' AND dataset_id IN (SELECT dataset_id FROM dc_dataset_previews);
`
}

/** Generate an append-only registry extension without rewriting an applied migration. */
export function datasetPreviewAdditionMigrationSql(): string {
  const values = contractValues(DATASET_PREVIEW_0006_IDS)
  const ids = DATASET_PREVIEW_0006_IDS.map(sqlText).join(', ')

  return `-- Register the map preview for the derived land-cover display grid.
-- Migration 0005 is immutable and remains the snapshot that introduced the
-- registry; this migration extends that registry without rewriting history.

INSERT INTO dc_dataset_previews (dataset_id, preview_url) VALUES
${values}
ON CONFLICT(dataset_id) DO UPDATE SET preview_url = excluded.preview_url;

UPDATE ec_articles
SET dataset_preview_url = (
  SELECT preview_url
  FROM dc_dataset_previews
  WHERE dataset_id = ec_articles.dataset_id
)
WHERE format = 'dataset_note'
  AND dataset_id IN (${ids});
`
}

/** Produce a new migration for explicit new Dataset IDs; never rewrite a prior file. */
export function datasetPreviewExtensionSql(ids: Parameters<typeof contractValues>[0]): string {
  return `-- Append dataset preview registrations; preserve article content and status.
INSERT INTO dc_dataset_previews (dataset_id, preview_url) VALUES
${contractValues(ids)}
ON CONFLICT(dataset_id) DO UPDATE SET preview_url = excluded.preview_url;
`
}
