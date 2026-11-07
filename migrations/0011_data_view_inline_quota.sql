-- D1 Free databases are capped independently of R2. Keep inline snapshots
-- below 256 MiB so immutable history cannot consume the whole database.
CREATE TRIGGER data_views_platform_inline_bytes_quota
BEFORE INSERT ON data_views
WHEN NEW.result_json IS NOT NULL AND COALESCE((
  SELECT SUM(result_bytes) FROM data_views
  WHERE revoked_at IS NULL AND result_json IS NOT NULL
), 0) + NEW.result_bytes > 268435456
BEGIN
  SELECT RAISE(ABORT, 'data view D1 inline byte quota exceeded');
END;
