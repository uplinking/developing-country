-- Register previews for the money & projects ledger datasets.
INSERT INTO dc_dataset_previews (dataset_id, preview_url) VALUES
  ('lk-initiative-events', 'https://explore.developing-country.org/datasets/lk-initiative-events/events-by-funder?embed=dataset'),
  ('lk-initiative-funding', 'https://explore.developing-country.org/datasets/lk-initiative-funding/approved-by-funder-usd?embed=dataset')
ON CONFLICT(dataset_id) DO UPDATE SET preview_url = excluded.preview_url;
