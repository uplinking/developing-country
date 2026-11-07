-- Append dataset preview registrations; preserve article content and status.
INSERT INTO dc_dataset_previews (dataset_id, preview_url) VALUES
  ('housing-occupancy-tenure', 'https://explore.developing-country.org/datasets/housing-occupancy-tenure/vacant-units?embed=dataset')
ON CONFLICT(dataset_id) DO UPDATE SET preview_url = excluded.preview_url;
