-- Append dataset preview registrations; preserve article content and status.
INSERT INTO dc_dataset_previews (dataset_id, preview_url) VALUES
  ('workplaces', 'https://explore.developing-country.org/?embed=dataset&layers=workplaces&lng=79.923&lat=6.907&zoom=9.8')
ON CONFLICT(dataset_id) DO UPDATE SET preview_url = excluded.preview_url;
