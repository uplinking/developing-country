-- Register the map preview for the derived land-cover display grid.
-- Migration 0005 is immutable and remains the snapshot that introduced the
-- registry; this migration extends that registry without rewriting history.

INSERT INTO dc_dataset_previews (dataset_id, preview_url) VALUES
  ('land-cover-grid', 'https://explore.developing-country.org/?embed=dataset&layers=land-cover-grid&lng=80.72&lat=7.85&zoom=6.8')
ON CONFLICT(dataset_id) DO UPDATE SET preview_url = excluded.preview_url;

UPDATE ec_articles
SET dataset_preview_url = (
  SELECT preview_url
  FROM dc_dataset_previews
  WHERE dataset_id = ec_articles.dataset_id
)
WHERE format = 'dataset_note'
  AND dataset_id IN ('land-cover-grid');
