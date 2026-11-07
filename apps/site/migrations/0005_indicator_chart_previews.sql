-- Replace the map-only preview gate with one registry for map and chart
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
  ('attractions', 'https://explore.developing-country.org/?embed=dataset&layers=attractions&lng=80.72&lat=7.85&zoom=6.8'),
  ('boi-zones', 'https://explore.developing-country.org/?embed=dataset&layers=boi-zones&lng=80.742&lat=7.377&zoom=7'),
  ('cycling', 'https://explore.developing-country.org/?embed=dataset&layers=cycling&lng=81.767&lat=7.224&zoom=10.7'),
  ('demographics', 'https://explore.developing-country.org/?embed=dataset&pop=gnd&lng=80.72&lat=7.85&zoom=6.8'),
  ('developments', 'https://explore.developing-country.org/?embed=dataset&layers=developments&lng=80.554&lat=7.968&zoom=6.8'),
  ('expressways', 'https://explore.developing-country.org/?embed=dataset&layers=expressways&lng=80.471&lat=6.928&zoom=7.5'),
  ('hospitals', 'https://explore.developing-country.org/?embed=dataset&layers=hospitals&lng=80.72&lat=7.85&zoom=6.8'),
  ('metro', 'https://explore.developing-country.org/?embed=dataset&layers=metro&lng=79.923&lat=6.907&zoom=9.8'),
  ('metro_catchment', 'https://explore.developing-country.org/?embed=dataset&layers=metro_catchment&lng=79.923&lat=6.907&zoom=9.8'),
  ('osm_foot_graph', NULL),
  ('parks', 'https://explore.developing-country.org/?embed=dataset&layers=parks&lng=80.857&lat=7.346&zoom=7'),
  ('schools', 'https://explore.developing-country.org/?embed=dataset&layers=schools&lng=80.72&lat=7.85&zoom=6.8'),
  ('sea-routes', 'https://explore.developing-country.org/?embed=dataset&layers=sea-routes&lng=80.2&lat=7.25&zoom=6.25'),
  ('trails', 'https://explore.developing-country.org/?embed=dataset&layers=trails&lng=80.688&lat=6.682&zoom=8'),
  ('waterfalls', 'https://explore.developing-country.org/?embed=dataset&layers=waterfalls&lng=80.556&lat=7.741&zoom=6.9'),
  ('census-age-sex-dsd', 'https://explore.developing-country.org/datasets/census-age-sex-dsd/largest-divisions?embed=dataset'),
  ('census-households-dsd', 'https://explore.developing-country.org/datasets/census-households-dsd/household-size?embed=dataset'),
  ('census-basic-services-district', 'https://explore.developing-country.org/datasets/census-basic-services-district/water-board-access?embed=dataset'),
  ('population-estimates-district', 'https://explore.developing-country.org/datasets/population-estimates-district/population-2024?embed=dataset'),
  ('labour-force', 'https://explore.developing-country.org/datasets/labour-force/unemployment?embed=dataset'),
  ('employment-by-industry', 'https://explore.developing-country.org/datasets/employment-by-industry/industries-2024?embed=dataset'),
  ('poverty-headcount-district', 'https://explore.developing-country.org/datasets/poverty-headcount-district/poverty-2019?embed=dataset'),
  ('gdp-by-industry', 'https://explore.developing-country.org/datasets/gdp-by-industry/real-gdp?embed=dataset'),
  ('inpatient-morbidity-mortality', 'https://explore.developing-country.org/datasets/inpatient-morbidity-mortality/leading-discharges?embed=dataset'),
  ('land-cover-district', 'https://explore.developing-country.org/datasets/land-cover-district/colombo-composition?embed=dataset'),
  ('merchandise-trade-monthly', 'https://explore.developing-country.org/datasets/merchandise-trade-monthly/exports-and-imports?embed=dataset'),
  ('merchandise-trade-category-annual', 'https://explore.developing-country.org/datasets/merchandise-trade-category-annual/export-composition-2025?embed=dataset'),
  ('workers-remittances-monthly', 'https://explore.developing-country.org/datasets/workers-remittances-monthly/remittances-since-2019?embed=dataset'),
  ('government-fiscal-operations-annual', 'https://explore.developing-country.org/datasets/government-fiscal-operations-annual/budget-balance?embed=dataset'),
  ('government-revenue-annual', 'https://explore.developing-country.org/datasets/government-revenue-annual/direct-tax-share?embed=dataset'),
  ('central-government-debt-annual', 'https://explore.developing-country.org/datasets/central-government-debt-annual/debt-to-gdp?embed=dataset');

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
