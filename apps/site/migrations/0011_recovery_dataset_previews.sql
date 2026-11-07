-- Append dataset preview registrations; preserve article content and status.
INSERT INTO dc_dataset_previews (dataset_id, preview_url) VALUES
  ('worldbank-economic-outlook', 'https://explore.developing-country.org/datasets/worldbank-economic-outlook/gdp-outlook?embed=dataset'),
  ('worldbank-poverty-estimates', 'https://explore.developing-country.org/datasets/worldbank-poverty-estimates/poverty-outlook?embed=dataset'),
  ('worldbank-poverty-province', 'https://explore.developing-country.org/datasets/worldbank-poverty-province/province-poverty?embed=dataset'),
  ('labour-force-sex-history', 'https://explore.developing-country.org/datasets/labour-force-sex-history/annual-participation?embed=dataset'),
  ('labour-employment-profile-history', 'https://explore.developing-country.org/datasets/labour-employment-profile-history/own-account-employment?embed=dataset'),
  ('ncpi-monthly', 'https://explore.developing-country.org/datasets/ncpi-monthly/price-index?embed=dataset'),
  ('child-nutrition-annual', 'https://explore.developing-country.org/datasets/child-nutrition-annual/underweight-history?embed=dataset'),
  ('agricultural-production-index', 'https://explore.developing-country.org/datasets/agricultural-production-index/overall-volume?embed=dataset'),
  ('paddy-sown-area-history', 'https://explore.developing-country.org/datasets/paddy-sown-area-history/national-season-history?embed=dataset'),
  ('paddy-harvested-area-history', 'https://explore.developing-country.org/datasets/paddy-harvested-area-history/national-season-history?embed=dataset'),
  ('paddy-yield-history', 'https://explore.developing-country.org/datasets/paddy-yield-history/national-season-history?embed=dataset'),
  ('paddy-production-history', 'https://explore.developing-country.org/datasets/paddy-production-history/national-season-history?embed=dataset')
ON CONFLICT(dataset_id) DO UPDATE SET preview_url = excluded.preview_url;
