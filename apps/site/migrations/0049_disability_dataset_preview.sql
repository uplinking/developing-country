-- Append dataset preview registrations; preserve article content and status.
INSERT INTO dc_dataset_previews (dataset_id, preview_url) VALUES
  ('functional-difficulties-disability', 'https://explore.developing-country.org/datasets/functional-difficulties-disability/disability-prevalence?embed=dataset')
ON CONFLICT(dataset_id) DO UPDATE SET preview_url = excluded.preview_url;
