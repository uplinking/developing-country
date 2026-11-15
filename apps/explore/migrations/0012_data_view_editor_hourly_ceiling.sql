-- Named editors author multi-figure analysis articles (ADR 0009), which save
-- 15-25 Data Views in one sitting. The Worker now enforces the per-identity
-- hourly limit (VIEW_HOURLY_LIMIT, default 5; VIEW_EDITOR_HOURLY_LIMIT for
-- VIEW_EDITOR_EMAILS, default 60). This trigger stays as the database backstop
-- at the highest limit the Worker can be configured to allow.
DROP TRIGGER IF EXISTS data_views_owner_rate_limit;

CREATE TRIGGER data_views_owner_rate_limit
BEFORE INSERT ON data_views
WHEN (
  SELECT COUNT(*) FROM data_views
  WHERE owner_email = NEW.owner_email
    AND created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour')
) >= 120
BEGIN
  SELECT RAISE(ABORT, 'data view hourly creation limit exceeded');
END;
