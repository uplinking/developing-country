-- Late-tab source of truth for agent stage events. Worker waitUntil INSERTs
-- events_json + hull_json only (never street geometry — D1 statement limit).
CREATE TABLE IF NOT EXISTS stage_snapshots (
  id          TEXT PRIMARY KEY,
  user_email  TEXT NOT NULL,
  tool        TEXT NOT NULL,
  events_json TEXT NOT NULL,
  hull_json   TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_stage_snapshots_user
  ON stage_snapshots(user_email, created_at);
