-- Append dataset preview registrations; preserve article content and status.
INSERT INTO dc_dataset_previews (dataset_id, preview_url) VALUES
  ('treasury-public-debt', 'https://explore.developing-country.org/datasets/treasury-public-debt/reported-values?embed=dataset'),
  ('treasury-domestic-debt', 'https://explore.developing-country.org/datasets/treasury-domestic-debt/reported-values?embed=dataset'),
  ('treasury-external-creditors', 'https://explore.developing-country.org/datasets/treasury-external-creditors/reported-values?embed=dataset'),
  ('treasury-province-debt', 'https://explore.developing-country.org/datasets/treasury-province-debt/reported-values?embed=dataset'),
  ('treasury-soe-finances', 'https://explore.developing-country.org/datasets/treasury-soe-finances/reported-values?embed=dataset'),
  ('treasury-soe-sector-outturn', 'https://explore.developing-country.org/datasets/treasury-soe-sector-outturn/reported-values?embed=dataset'),
  ('treasury-revenue-budget-outturn', 'https://explore.developing-country.org/datasets/treasury-revenue-budget-outturn/reported-values?embed=dataset'),
  ('treasury-fiscal-performance', 'https://explore.developing-country.org/datasets/treasury-fiscal-performance/reported-values?embed=dataset'),
  ('treasury-fiscal-in-year', 'https://explore.developing-country.org/datasets/treasury-fiscal-in-year/reported-values?embed=dataset'),
  ('treasury-financial-soundness', 'https://explore.developing-country.org/datasets/treasury-financial-soundness/reported-values?embed=dataset'),
  ('treasury-procurement-status', 'https://explore.developing-country.org/datasets/treasury-procurement-status/reported-values?embed=dataset'),
  ('treasury-procurement-bids', 'https://explore.developing-country.org/datasets/treasury-procurement-bids/reported-values?embed=dataset'),
  ('treasury-procurement-competitiveness', 'https://explore.developing-country.org/datasets/treasury-procurement-competitiveness/reported-values?embed=dataset'),
  ('treasury-province-transfers', 'https://explore.developing-country.org/datasets/treasury-province-transfers/reported-values?embed=dataset'),
  ('treasury-women-msme-finance', 'https://explore.developing-country.org/datasets/treasury-women-msme-finance/reported-values?embed=dataset')
ON CONFLICT(dataset_id) DO UPDATE SET preview_url = excluded.preview_url;
