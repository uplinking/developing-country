-- Append dataset preview registrations; preserve article content and status.
INSERT INTO dc_dataset_previews (dataset_id, preview_url) VALUES
  ('public-transport-capacity', 'https://explore.developing-country.org/datasets/public-transport-capacity/sltb?embed=dataset')
ON CONFLICT(dataset_id) DO UPDATE SET preview_url = excluded.preview_url;
