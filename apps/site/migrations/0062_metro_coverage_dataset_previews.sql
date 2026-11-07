-- Append dataset preview registrations; preserve article content and status.
INSERT INTO dc_dataset_previews (dataset_id, preview_url) VALUES
  ('metro_walksheds', 'https://explore.developing-country.org/?embed=dataset&layers=metro_walksheds&lng=79.923&lat=6.907&zoom=9.8'),
  ('metro-coverage-lines', 'https://explore.developing-country.org/datasets/metro-coverage-lines/residents-per-route-km?embed=dataset'),
  ('metro-coverage-stops', 'https://explore.developing-country.org/datasets/metro-coverage-stops/residents-within-10-minutes?embed=dataset'),
  ('metro-coverage-gnd', 'https://explore.developing-country.org/datasets/metro-coverage-gnd/largest-unserved-divisions?embed=dataset'),
  ('metro-coverage-deciles', 'https://explore.developing-country.org/datasets/metro-coverage-deciles/coverage-by-density-decile?embed=dataset'),
  ('metro-coverage-facilities', 'https://explore.developing-country.org/datasets/metro-coverage-facilities/hospital-walk-to-stop?embed=dataset')
ON CONFLICT(dataset_id) DO UPDATE SET preview_url = excluded.preview_url;
