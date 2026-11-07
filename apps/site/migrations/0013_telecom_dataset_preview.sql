-- Append dataset preview registrations; preserve article content and status.
INSERT INTO dc_dataset_previews (dataset_id, preview_url) VALUES
  ('telecom-services', 'https://explore.developing-country.org/datasets/telecom-services/mobile-broadband?embed=dataset')
ON CONFLICT(dataset_id) DO UPDATE SET preview_url = excluded.preview_url;
