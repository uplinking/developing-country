-- Make Data Views immutable at the storage layer and allow full result
-- snapshots to live in content-addressed R2 objects. Existing inline rows
-- remain readable; new rows may keep a small inline copy or use result_path.

CREATE TABLE data_views_v2 (
  id                   TEXT PRIMARY KEY,
  query_id             TEXT NOT NULL UNIQUE,
  owner_email          TEXT NOT NULL,
  visibility           TEXT NOT NULL CHECK (visibility IN ('link', 'public')),
  kind                 TEXT NOT NULL CHECK (kind IN ('map', 'chart')),
  country              TEXT NOT NULL,
  title                TEXT NOT NULL,
  spec_json            TEXT NOT NULL,
  result_json          TEXT,
  result_path          TEXT,
  result_bytes         INTEGER NOT NULL CHECK (result_bytes >= 0),
  result_checksum      TEXT NOT NULL,
  dataset_version_ids  TEXT NOT NULL DEFAULT '[]',
  row_count            INTEGER NOT NULL,
  created_at           TEXT NOT NULL,
  revoked_at           TEXT,
  CHECK (result_json IS NOT NULL OR result_path IS NOT NULL)
);

INSERT INTO data_views_v2 (
  id, query_id, owner_email, visibility, kind, country, title, spec_json,
  result_json, result_path, result_bytes, result_checksum,
  dataset_version_ids, row_count, created_at, revoked_at
)
SELECT
  id, query_id, owner_email, visibility, kind, country, title, spec_json,
  result_json, NULL, length(CAST(result_json AS BLOB)), result_checksum,
  '[]', row_count, created_at, NULL
FROM data_views;

DROP TABLE data_views;
ALTER TABLE data_views_v2 RENAME TO data_views;

CREATE INDEX idx_data_views_owner ON data_views(owner_email, created_at DESC);
CREATE INDEX idx_data_views_public ON data_views(visibility, revoked_at, created_at DESC);

-- A Data View is a published claim. All claim-bearing fields are frozen after
-- insert; visibility and revoked_at are the only mutable lifecycle fields.
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
  NEW.result_json IS NOT OLD.result_json OR
  NEW.result_path IS NOT OLD.result_path OR
  NEW.result_bytes IS NOT OLD.result_bytes OR
  NEW.result_checksum IS NOT OLD.result_checksum OR
  NEW.dataset_version_ids IS NOT OLD.dataset_version_ids OR
  NEW.row_count IS NOT OLD.row_count OR
  NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'data_views are immutable; revoke instead');
END;

CREATE TRIGGER data_views_no_delete
BEFORE DELETE ON data_views
BEGIN
  SELECT RAISE(ABORT, 'data_views are immutable; revoke instead');
END;
