-- Saved views are evicted oldest-first when an ordinary account is full
-- (src/worker/dataViews.ts), so revoked rows now accumulate. Two changes keep
-- that bounded:
--
-- 1. The platform count ceiling counts live views only. It counted every row,
--    revoked included, so the platform would have filled for good.
-- 2. Revoking a view clears its inline result payload, as revoking already
--    deletes an R2-backed one. The claim (spec, checksum, dataset versions,
--    result_bytes) stays frozen; only result_json may change, and only to ''
--    on a revoked row. '' rather than NULL keeps the table's CHECK satisfied.
--
-- Numbered migration. Never edit once applied; add a new file for changes.

DROP TRIGGER IF EXISTS data_views_platform_count_quota;

CREATE TRIGGER data_views_platform_count_quota
BEFORE INSERT ON data_views
WHEN (SELECT COUNT(*) FROM data_views WHERE revoked_at IS NULL) >= 10000
BEGIN
  SELECT RAISE(ABORT, 'data view platform count quota exceeded');
END;

DROP TRIGGER IF EXISTS data_views_no_claim_update;

CREATE TRIGGER data_views_no_claim_update
BEFORE UPDATE ON data_views
WHEN
  NEW.id IS NOT OLD.id OR
  NEW.query_id IS NOT OLD.query_id OR
  NEW.owner_email IS NOT OLD.owner_email OR
  NEW.kind IS NOT OLD.kind OR
  NEW.country IS NOT OLD.country OR
  NEW.title IS NOT OLD.title OR
  NEW.spec_json IS NOT OLD.spec_json OR
  (NEW.result_json IS NOT OLD.result_json AND NOT (NEW.revoked_at IS NOT NULL AND NEW.result_json = '')) OR
  NEW.result_path IS NOT OLD.result_path OR
  NEW.result_bytes IS NOT OLD.result_bytes OR
  NEW.result_checksum IS NOT OLD.result_checksum OR
  NEW.dataset_version_ids IS NOT OLD.dataset_version_ids OR
  NEW.row_count IS NOT OLD.row_count OR
  NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'data_views are immutable; revoke instead');
END;

UPDATE data_views SET result_json = ''
WHERE revoked_at IS NOT NULL AND result_json IS NOT NULL AND result_json <> '';
