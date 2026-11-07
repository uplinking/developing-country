-- Append dataset preview registrations; preserve article content and status.
INSERT INTO dc_dataset_previews (dataset_id, preview_url) VALUES
  ('metro-gap-clusters', 'https://explore.developing-country.org/datasets/metro-gap-clusters/unserved-residents-by-cluster?embed=dataset'),
  ('metro-stop-uniqueness', 'https://explore.developing-country.org/datasets/metro-stop-uniqueness/least-unique-stops?embed=dataset'),
  ('metro-route-candidates', 'https://explore.developing-country.org/datasets/metro-route-candidates/new-residents-per-km?embed=dataset'),
  ('metro-route-scenarios', 'https://explore.developing-country.org/datasets/metro-route-scenarios/share-within-10-minutes?embed=dataset')
ON CONFLICT(dataset_id) DO UPDATE SET preview_url = excluded.preview_url;
