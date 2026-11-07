-- Append dataset preview registrations; preserve article content and status.
INSERT INTO dc_dataset_previews (dataset_id, preview_url) VALUES
  ('computer-digital-literacy', 'https://explore.developing-country.org/datasets/computer-digital-literacy/digital-literacy-district?embed=dataset')
ON CONFLICT(dataset_id) DO UPDATE SET preview_url = excluded.preview_url;
