-- Withdraw previews for the reverted project timeline and funding datasets.
-- Keep the applied registration migrations intact.
DELETE FROM dc_dataset_previews
WHERE dataset_id IN (
  'project-event-history',
  'project-funding-observations',
  'project-funding-totals'
);
