-- Hard storage ceilings for the passion-project deployment. Application checks
-- provide friendly errors; these triggers are the race-safe final guard before
-- a row can make its R2 object durable.

CREATE TRIGGER data_views_owner_count_quota
BEFORE INSERT ON data_views
WHEN (
  SELECT COUNT(*) FROM data_views
  WHERE owner_email = NEW.owner_email AND revoked_at IS NULL
) >= 50
BEGIN
  SELECT RAISE(ABORT, 'data view owner count quota exceeded');
END;

CREATE TRIGGER data_views_owner_bytes_quota
BEFORE INSERT ON data_views
WHEN COALESCE((
  SELECT SUM(result_bytes) FROM data_views
  WHERE owner_email = NEW.owner_email AND revoked_at IS NULL
), 0)
     + NEW.result_bytes > 134217728
BEGIN
  SELECT RAISE(ABORT, 'data view owner byte quota exceeded');
END;

CREATE TRIGGER data_views_owner_rate_limit
BEFORE INSERT ON data_views
WHEN (
  SELECT COUNT(*) FROM data_views
  WHERE owner_email = NEW.owner_email
    AND created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour')
) >= 5
BEGIN
  SELECT RAISE(ABORT, 'data view hourly creation limit exceeded');
END;

CREATE TRIGGER data_views_platform_count_quota
BEFORE INSERT ON data_views
WHEN (SELECT COUNT(*) FROM data_views) >= 10000
BEGIN
  SELECT RAISE(ABORT, 'data view platform count quota exceeded');
END;

CREATE TRIGGER data_views_platform_bytes_quota
BEFORE INSERT ON data_views
WHEN COALESCE((SELECT SUM(result_bytes) FROM data_views WHERE revoked_at IS NULL), 0)
     + NEW.result_bytes > 2147483648
BEGIN
  SELECT RAISE(ABORT, 'data view platform byte quota exceeded');
END;
