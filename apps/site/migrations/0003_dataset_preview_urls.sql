-- Make each dataset note own the exact map-only preview it publishes. The
-- schema-aware migration wrapper reconciles the seed-owned article fields
-- before this migration runs. The dataset registry still generates these
-- values, while D1 prevents a published note from drifting to another layer
-- or camera.

UPDATE ec_articles
SET dataset_preview_url = CASE dataset_id
  WHEN 'attractions' THEN 'https://explore.developing-country.org/?embed=dataset&layers=attractions&lng=80.7&lat=7.85&zoom=7.1'
  WHEN 'boi-zones' THEN 'https://explore.developing-country.org/?embed=dataset&layers=boi-zones&lng=80.28&lat=7.18&zoom=7.8'
  WHEN 'cycling' THEN 'https://explore.developing-country.org/?embed=dataset&layers=cycling&lng=79.88&lat=6.92&zoom=11.2'
  WHEN 'demographics' THEN 'https://explore.developing-country.org/?embed=dataset&pop=gnd&lng=80.7&lat=7.85&zoom=7.1'
  WHEN 'developments' THEN 'https://explore.developing-country.org/?embed=dataset&layers=developments&lng=80.26&lat=7.15&zoom=8'
  WHEN 'expressways' THEN 'https://explore.developing-country.org/?embed=dataset&layers=expressways&lng=80.12&lat=6.72&zoom=8.3'
  WHEN 'hospitals' THEN 'https://explore.developing-country.org/?embed=dataset&layers=hospitals&lng=80.7&lat=7.85&zoom=7.1'
  WHEN 'metro' THEN 'https://explore.developing-country.org/?embed=dataset&layers=metro&lng=79.88&lat=6.92&zoom=11.2'
  WHEN 'metro_catchment' THEN 'https://explore.developing-country.org/?embed=dataset&layers=metro_catchment&lng=79.88&lat=6.92&zoom=11.2'
  WHEN 'parks' THEN 'https://explore.developing-country.org/?embed=dataset&layers=parks&lng=79.88&lat=6.92&zoom=11.2'
  WHEN 'schools' THEN 'https://explore.developing-country.org/?embed=dataset&layers=schools&lng=80.7&lat=7.85&zoom=7.1'
  WHEN 'sea-routes' THEN 'https://explore.developing-country.org/?embed=dataset&layers=sea-routes&lng=80.2&lat=7.25&zoom=6.25'
  WHEN 'trails' THEN 'https://explore.developing-country.org/?embed=dataset&layers=trails&lng=80.68&lat=7.18&zoom=8.5'
  WHEN 'waterfalls' THEN 'https://explore.developing-country.org/?embed=dataset&layers=waterfalls&lng=80.68&lat=7.15&zoom=8.5'
  ELSE NULL
END
WHERE format = 'dataset_note';

CREATE TRIGGER dc_articles_dataset_preview_insert
BEFORE INSERT ON ec_articles
WHEN NEW.status = 'published'
BEGIN
  SELECT RAISE(ABORT, 'dc_dataset_preview: invalid published dataset preview')
  WHERE
    (NEW.format <> 'dataset_note' AND NEW.dataset_preview_url IS NOT NULL)
    OR (NEW.format = 'dataset_note' AND CASE NEW.dataset_id
      WHEN 'attractions' THEN NEW.dataset_preview_url IS NOT 'https://explore.developing-country.org/?embed=dataset&layers=attractions&lng=80.7&lat=7.85&zoom=7.1'
      WHEN 'boi-zones' THEN NEW.dataset_preview_url IS NOT 'https://explore.developing-country.org/?embed=dataset&layers=boi-zones&lng=80.28&lat=7.18&zoom=7.8'
      WHEN 'cycling' THEN NEW.dataset_preview_url IS NOT 'https://explore.developing-country.org/?embed=dataset&layers=cycling&lng=79.88&lat=6.92&zoom=11.2'
      WHEN 'demographics' THEN NEW.dataset_preview_url IS NOT 'https://explore.developing-country.org/?embed=dataset&pop=gnd&lng=80.7&lat=7.85&zoom=7.1'
      WHEN 'developments' THEN NEW.dataset_preview_url IS NOT 'https://explore.developing-country.org/?embed=dataset&layers=developments&lng=80.26&lat=7.15&zoom=8'
      WHEN 'expressways' THEN NEW.dataset_preview_url IS NOT 'https://explore.developing-country.org/?embed=dataset&layers=expressways&lng=80.12&lat=6.72&zoom=8.3'
      WHEN 'hospitals' THEN NEW.dataset_preview_url IS NOT 'https://explore.developing-country.org/?embed=dataset&layers=hospitals&lng=80.7&lat=7.85&zoom=7.1'
      WHEN 'metro' THEN NEW.dataset_preview_url IS NOT 'https://explore.developing-country.org/?embed=dataset&layers=metro&lng=79.88&lat=6.92&zoom=11.2'
      WHEN 'metro_catchment' THEN NEW.dataset_preview_url IS NOT 'https://explore.developing-country.org/?embed=dataset&layers=metro_catchment&lng=79.88&lat=6.92&zoom=11.2'
      WHEN 'osm_foot_graph' THEN NEW.dataset_preview_url IS NOT NULL
      WHEN 'parks' THEN NEW.dataset_preview_url IS NOT 'https://explore.developing-country.org/?embed=dataset&layers=parks&lng=79.88&lat=6.92&zoom=11.2'
      WHEN 'schools' THEN NEW.dataset_preview_url IS NOT 'https://explore.developing-country.org/?embed=dataset&layers=schools&lng=80.7&lat=7.85&zoom=7.1'
      WHEN 'sea-routes' THEN NEW.dataset_preview_url IS NOT 'https://explore.developing-country.org/?embed=dataset&layers=sea-routes&lng=80.2&lat=7.25&zoom=6.25'
      WHEN 'trails' THEN NEW.dataset_preview_url IS NOT 'https://explore.developing-country.org/?embed=dataset&layers=trails&lng=80.68&lat=7.18&zoom=8.5'
      WHEN 'waterfalls' THEN NEW.dataset_preview_url IS NOT 'https://explore.developing-country.org/?embed=dataset&layers=waterfalls&lng=80.68&lat=7.15&zoom=8.5'
      ELSE 1
    END);
END;

CREATE TRIGGER dc_articles_dataset_preview_update
BEFORE UPDATE ON ec_articles
WHEN NEW.status = 'published'
BEGIN
  SELECT RAISE(ABORT, 'dc_dataset_preview: invalid published dataset preview')
  WHERE
    (NEW.format <> 'dataset_note' AND NEW.dataset_preview_url IS NOT NULL)
    OR (NEW.format = 'dataset_note' AND CASE NEW.dataset_id
      WHEN 'attractions' THEN NEW.dataset_preview_url IS NOT 'https://explore.developing-country.org/?embed=dataset&layers=attractions&lng=80.7&lat=7.85&zoom=7.1'
      WHEN 'boi-zones' THEN NEW.dataset_preview_url IS NOT 'https://explore.developing-country.org/?embed=dataset&layers=boi-zones&lng=80.28&lat=7.18&zoom=7.8'
      WHEN 'cycling' THEN NEW.dataset_preview_url IS NOT 'https://explore.developing-country.org/?embed=dataset&layers=cycling&lng=79.88&lat=6.92&zoom=11.2'
      WHEN 'demographics' THEN NEW.dataset_preview_url IS NOT 'https://explore.developing-country.org/?embed=dataset&pop=gnd&lng=80.7&lat=7.85&zoom=7.1'
      WHEN 'developments' THEN NEW.dataset_preview_url IS NOT 'https://explore.developing-country.org/?embed=dataset&layers=developments&lng=80.26&lat=7.15&zoom=8'
      WHEN 'expressways' THEN NEW.dataset_preview_url IS NOT 'https://explore.developing-country.org/?embed=dataset&layers=expressways&lng=80.12&lat=6.72&zoom=8.3'
      WHEN 'hospitals' THEN NEW.dataset_preview_url IS NOT 'https://explore.developing-country.org/?embed=dataset&layers=hospitals&lng=80.7&lat=7.85&zoom=7.1'
      WHEN 'metro' THEN NEW.dataset_preview_url IS NOT 'https://explore.developing-country.org/?embed=dataset&layers=metro&lng=79.88&lat=6.92&zoom=11.2'
      WHEN 'metro_catchment' THEN NEW.dataset_preview_url IS NOT 'https://explore.developing-country.org/?embed=dataset&layers=metro_catchment&lng=79.88&lat=6.92&zoom=11.2'
      WHEN 'osm_foot_graph' THEN NEW.dataset_preview_url IS NOT NULL
      WHEN 'parks' THEN NEW.dataset_preview_url IS NOT 'https://explore.developing-country.org/?embed=dataset&layers=parks&lng=79.88&lat=6.92&zoom=11.2'
      WHEN 'schools' THEN NEW.dataset_preview_url IS NOT 'https://explore.developing-country.org/?embed=dataset&layers=schools&lng=80.7&lat=7.85&zoom=7.1'
      WHEN 'sea-routes' THEN NEW.dataset_preview_url IS NOT 'https://explore.developing-country.org/?embed=dataset&layers=sea-routes&lng=80.2&lat=7.25&zoom=6.25'
      WHEN 'trails' THEN NEW.dataset_preview_url IS NOT 'https://explore.developing-country.org/?embed=dataset&layers=trails&lng=80.68&lat=7.18&zoom=8.5'
      WHEN 'waterfalls' THEN NEW.dataset_preview_url IS NOT 'https://explore.developing-country.org/?embed=dataset&layers=waterfalls&lng=80.68&lat=7.15&zoom=8.5'
      ELSE 1
    END);
END;
