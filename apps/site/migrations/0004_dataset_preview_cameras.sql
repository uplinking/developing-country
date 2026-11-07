-- Advance every visual dataset note to its verified overview camera. The
-- original migration is immutable, so replace its validation triggers before
-- updating published rows that the old camera contract would reject.

DROP TRIGGER IF EXISTS dc_articles_dataset_preview_insert;
DROP TRIGGER IF EXISTS dc_articles_dataset_preview_update;

UPDATE ec_articles
SET dataset_preview_url = CASE dataset_id
  WHEN 'attractions' THEN 'https://explore.developing-country.org/?embed=dataset&layers=attractions&lng=80.72&lat=7.85&zoom=6.8'
  WHEN 'boi-zones' THEN 'https://explore.developing-country.org/?embed=dataset&layers=boi-zones&lng=80.742&lat=7.377&zoom=7'
  WHEN 'cycling' THEN 'https://explore.developing-country.org/?embed=dataset&layers=cycling&lng=81.767&lat=7.224&zoom=10.7'
  WHEN 'demographics' THEN 'https://explore.developing-country.org/?embed=dataset&pop=gnd&lng=80.72&lat=7.85&zoom=6.8'
  WHEN 'developments' THEN 'https://explore.developing-country.org/?embed=dataset&layers=developments&lng=80.554&lat=7.968&zoom=6.8'
  WHEN 'expressways' THEN 'https://explore.developing-country.org/?embed=dataset&layers=expressways&lng=80.471&lat=6.928&zoom=7.5'
  WHEN 'hospitals' THEN 'https://explore.developing-country.org/?embed=dataset&layers=hospitals&lng=80.72&lat=7.85&zoom=6.8'
  WHEN 'metro' THEN 'https://explore.developing-country.org/?embed=dataset&layers=metro&lng=79.923&lat=6.907&zoom=9.8'
  WHEN 'metro_catchment' THEN 'https://explore.developing-country.org/?embed=dataset&layers=metro_catchment&lng=79.923&lat=6.907&zoom=9.8'
  WHEN 'parks' THEN 'https://explore.developing-country.org/?embed=dataset&layers=parks&lng=80.857&lat=7.346&zoom=7'
  WHEN 'schools' THEN 'https://explore.developing-country.org/?embed=dataset&layers=schools&lng=80.72&lat=7.85&zoom=6.8'
  WHEN 'sea-routes' THEN 'https://explore.developing-country.org/?embed=dataset&layers=sea-routes&lng=80.2&lat=7.25&zoom=6.25'
  WHEN 'trails' THEN 'https://explore.developing-country.org/?embed=dataset&layers=trails&lng=80.688&lat=6.682&zoom=8'
  WHEN 'waterfalls' THEN 'https://explore.developing-country.org/?embed=dataset&layers=waterfalls&lng=80.556&lat=7.741&zoom=6.9'
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
      WHEN 'attractions' THEN NEW.dataset_preview_url IS NOT 'https://explore.developing-country.org/?embed=dataset&layers=attractions&lng=80.72&lat=7.85&zoom=6.8'
      WHEN 'boi-zones' THEN NEW.dataset_preview_url IS NOT 'https://explore.developing-country.org/?embed=dataset&layers=boi-zones&lng=80.742&lat=7.377&zoom=7'
      WHEN 'cycling' THEN NEW.dataset_preview_url IS NOT 'https://explore.developing-country.org/?embed=dataset&layers=cycling&lng=81.767&lat=7.224&zoom=10.7'
      WHEN 'demographics' THEN NEW.dataset_preview_url IS NOT 'https://explore.developing-country.org/?embed=dataset&pop=gnd&lng=80.72&lat=7.85&zoom=6.8'
      WHEN 'developments' THEN NEW.dataset_preview_url IS NOT 'https://explore.developing-country.org/?embed=dataset&layers=developments&lng=80.554&lat=7.968&zoom=6.8'
      WHEN 'expressways' THEN NEW.dataset_preview_url IS NOT 'https://explore.developing-country.org/?embed=dataset&layers=expressways&lng=80.471&lat=6.928&zoom=7.5'
      WHEN 'hospitals' THEN NEW.dataset_preview_url IS NOT 'https://explore.developing-country.org/?embed=dataset&layers=hospitals&lng=80.72&lat=7.85&zoom=6.8'
      WHEN 'metro' THEN NEW.dataset_preview_url IS NOT 'https://explore.developing-country.org/?embed=dataset&layers=metro&lng=79.923&lat=6.907&zoom=9.8'
      WHEN 'metro_catchment' THEN NEW.dataset_preview_url IS NOT 'https://explore.developing-country.org/?embed=dataset&layers=metro_catchment&lng=79.923&lat=6.907&zoom=9.8'
      WHEN 'osm_foot_graph' THEN NEW.dataset_preview_url IS NOT NULL
      WHEN 'parks' THEN NEW.dataset_preview_url IS NOT 'https://explore.developing-country.org/?embed=dataset&layers=parks&lng=80.857&lat=7.346&zoom=7'
      WHEN 'schools' THEN NEW.dataset_preview_url IS NOT 'https://explore.developing-country.org/?embed=dataset&layers=schools&lng=80.72&lat=7.85&zoom=6.8'
      WHEN 'sea-routes' THEN NEW.dataset_preview_url IS NOT 'https://explore.developing-country.org/?embed=dataset&layers=sea-routes&lng=80.2&lat=7.25&zoom=6.25'
      WHEN 'trails' THEN NEW.dataset_preview_url IS NOT 'https://explore.developing-country.org/?embed=dataset&layers=trails&lng=80.688&lat=6.682&zoom=8'
      WHEN 'waterfalls' THEN NEW.dataset_preview_url IS NOT 'https://explore.developing-country.org/?embed=dataset&layers=waterfalls&lng=80.556&lat=7.741&zoom=6.9'
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
      WHEN 'attractions' THEN NEW.dataset_preview_url IS NOT 'https://explore.developing-country.org/?embed=dataset&layers=attractions&lng=80.72&lat=7.85&zoom=6.8'
      WHEN 'boi-zones' THEN NEW.dataset_preview_url IS NOT 'https://explore.developing-country.org/?embed=dataset&layers=boi-zones&lng=80.742&lat=7.377&zoom=7'
      WHEN 'cycling' THEN NEW.dataset_preview_url IS NOT 'https://explore.developing-country.org/?embed=dataset&layers=cycling&lng=81.767&lat=7.224&zoom=10.7'
      WHEN 'demographics' THEN NEW.dataset_preview_url IS NOT 'https://explore.developing-country.org/?embed=dataset&pop=gnd&lng=80.72&lat=7.85&zoom=6.8'
      WHEN 'developments' THEN NEW.dataset_preview_url IS NOT 'https://explore.developing-country.org/?embed=dataset&layers=developments&lng=80.554&lat=7.968&zoom=6.8'
      WHEN 'expressways' THEN NEW.dataset_preview_url IS NOT 'https://explore.developing-country.org/?embed=dataset&layers=expressways&lng=80.471&lat=6.928&zoom=7.5'
      WHEN 'hospitals' THEN NEW.dataset_preview_url IS NOT 'https://explore.developing-country.org/?embed=dataset&layers=hospitals&lng=80.72&lat=7.85&zoom=6.8'
      WHEN 'metro' THEN NEW.dataset_preview_url IS NOT 'https://explore.developing-country.org/?embed=dataset&layers=metro&lng=79.923&lat=6.907&zoom=9.8'
      WHEN 'metro_catchment' THEN NEW.dataset_preview_url IS NOT 'https://explore.developing-country.org/?embed=dataset&layers=metro_catchment&lng=79.923&lat=6.907&zoom=9.8'
      WHEN 'osm_foot_graph' THEN NEW.dataset_preview_url IS NOT NULL
      WHEN 'parks' THEN NEW.dataset_preview_url IS NOT 'https://explore.developing-country.org/?embed=dataset&layers=parks&lng=80.857&lat=7.346&zoom=7'
      WHEN 'schools' THEN NEW.dataset_preview_url IS NOT 'https://explore.developing-country.org/?embed=dataset&layers=schools&lng=80.72&lat=7.85&zoom=6.8'
      WHEN 'sea-routes' THEN NEW.dataset_preview_url IS NOT 'https://explore.developing-country.org/?embed=dataset&layers=sea-routes&lng=80.2&lat=7.25&zoom=6.25'
      WHEN 'trails' THEN NEW.dataset_preview_url IS NOT 'https://explore.developing-country.org/?embed=dataset&layers=trails&lng=80.688&lat=6.682&zoom=8'
      WHEN 'waterfalls' THEN NEW.dataset_preview_url IS NOT 'https://explore.developing-country.org/?embed=dataset&layers=waterfalls&lng=80.556&lat=7.741&zoom=6.9'
      ELSE 1
    END);
END;
