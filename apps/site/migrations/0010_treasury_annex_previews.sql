-- Append dataset preview registrations; preserve article content and status.
INSERT INTO dc_dataset_previews (dataset_id, preview_url) VALUES
  ('treasury-guarantees', 'https://explore.developing-country.org/datasets/treasury-guarantees/reported-values?embed=dataset'),
  ('treasury-letters-of-comfort', 'https://explore.developing-country.org/datasets/treasury-letters-of-comfort/reported-values?embed=dataset')
ON CONFLICT(dataset_id) DO UPDATE SET preview_url = excluded.preview_url;
