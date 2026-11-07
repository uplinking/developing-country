-- Register funding evidence and reconciled snapshot previews.
INSERT INTO dc_dataset_previews (dataset_id, preview_url) VALUES
  ('project-funding-observations', 'https://explore.developing-country.org/datasets/project-funding-observations/funding-records?embed=dataset'),
  ('project-funding-totals', 'https://explore.developing-country.org/datasets/project-funding-totals/approved-record-counts?embed=dataset')
ON CONFLICT(dataset_id) DO UPDATE SET preview_url = excluded.preview_url;
