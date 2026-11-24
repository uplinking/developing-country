-- Register previews for the company financial statements and history datasets.
-- Append dataset preview registrations; preserve article content and status.
INSERT INTO dc_dataset_previews (dataset_id, preview_url) VALUES
  ('lk-company-financials', 'https://explore.developing-country.org/datasets/lk-company-financials/largest-borrowers?embed=dataset'),
  ('lk-company-history', 'https://explore.developing-country.org/datasets/lk-company-history/ten-year-revenue?embed=dataset')
ON CONFLICT(dataset_id) DO UPDATE SET preview_url = excluded.preview_url;
