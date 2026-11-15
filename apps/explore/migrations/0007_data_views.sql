-- developing-country.org — durable, shareable data views.
-- The result snapshot and renderer-agnostic view spec are immutable. Articles,
-- MCP Apps, and the public site all resolve the same id instead of copying data.

CREATE TABLE IF NOT EXISTS data_views (
  id               TEXT PRIMARY KEY,
  query_id         TEXT NOT NULL UNIQUE,
  owner_email      TEXT NOT NULL,
  visibility       TEXT NOT NULL CHECK (visibility IN ('link', 'public')),
  kind             TEXT NOT NULL CHECK (kind IN ('map', 'chart')),
  country          TEXT NOT NULL,
  title            TEXT NOT NULL,
  spec_json        TEXT NOT NULL,
  result_json      TEXT NOT NULL,
  result_checksum  TEXT NOT NULL,
  row_count        INTEGER NOT NULL,
  created_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_data_views_owner ON data_views(owner_email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_data_views_public ON data_views(visibility, created_at DESC);
