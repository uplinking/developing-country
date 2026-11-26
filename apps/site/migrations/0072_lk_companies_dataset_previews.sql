-- Register previews for the company map datasets.
-- Append dataset preview registrations; preserve article content and status.
INSERT INTO dc_dataset_previews (dataset_id, preview_url) VALUES
  ('lk-companies', 'https://explore.developing-country.org/datasets/lk-companies/largest-groups?embed=dataset'),
  ('lk-company-sectors', 'https://explore.developing-country.org/datasets/lk-company-sectors/companies-by-sector-family?embed=dataset'),
  ('lk-company-relationships', 'https://explore.developing-country.org/datasets/lk-company-relationships/largest-holdings?embed=dataset'),
  ('lk-company-segments', 'https://explore.developing-country.org/datasets/lk-company-segments/largest-segments?embed=dataset'),
  ('lk-company-shareholders', 'https://explore.developing-country.org/datasets/lk-company-shareholders/largest-state-stakes?embed=dataset')
ON CONFLICT(dataset_id) DO UPDATE SET preview_url = excluded.preview_url;

