-- Append dataset preview registrations; preserve article content and status.
INSERT INTO dc_dataset_previews (dataset_id, preview_url) VALUES
  ('road-crashes-fatalities', 'https://explore.developing-country.org/datasets/road-crashes-fatalities/crash-history?embed=dataset')
ON CONFLICT(dataset_id) DO UPDATE SET preview_url = excluded.preview_url;
