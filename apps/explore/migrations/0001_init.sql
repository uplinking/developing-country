-- Platform schema — prospects, issues, contributions.
-- Numbered migration. Never edit once applied; add a new file for changes.

CREATE TABLE IF NOT EXISTS prospects (
  id          TEXT PRIMARY KEY,
  user_email  TEXT NOT NULL,
  title       TEXT,
  url         TEXT,
  lat         REAL,
  lng         REAL,
  notes       TEXT,
  verdict     TEXT,                         -- free text / enum-ish: 'buy' | 'pass' | 'watch' | ...
  visibility  TEXT NOT NULL DEFAULT 'private', -- 'private' | 'link' | 'public'
  metadata    TEXT,                         -- JSON blob (og:title/description/image, scraped lat/lng, source)
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_prospects_user       ON prospects(user_email);
CREATE INDEX IF NOT EXISTS idx_prospects_visibility ON prospects(visibility);
CREATE INDEX IF NOT EXISTS idx_prospects_bbox       ON prospects(lat, lng);

CREATE TABLE IF NOT EXISTS issues (
  id          TEXT PRIMARY KEY,
  user_email  TEXT NOT NULL,
  lat         REAL NOT NULL,
  lng         REAL NOT NULL,
  category    TEXT NOT NULL,                -- 'pothole' | 'flooding' | 'streetlight' | 'culvert' | ...
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'open', -- 'open' | 'in_progress' | 'resolved' | 'closed'
  media       TEXT,                         -- JSON array of media refs (R2 keys / urls) — v4
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_issues_bbox     ON issues(lat, lng);
CREATE INDEX IF NOT EXISTS idx_issues_category ON issues(category);
CREATE INDEX IF NOT EXISTS idx_issues_status   ON issues(status);

CREATE TABLE IF NOT EXISTS contributions (
  id          TEXT PRIMARY KEY,
  issue_id    TEXT NOT NULL REFERENCES issues(id),
  user_email  TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('comment','solution','evidence')),
  body        TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_contrib_issue ON contributions(issue_id);
CREATE INDEX IF NOT EXISTS idx_contrib_user  ON contributions(user_email);
