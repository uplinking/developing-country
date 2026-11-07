-- Analysis logging.
-- Every analyze_location run (web Analyze mode + the MCP tool) is recorded here
-- against the identity that ran it, so a user's account shows a visible
-- trace of the places they (or their AI assistant) analysed.
-- Numbered migration. Never edit once applied; add a new file for changes.

CREATE TABLE IF NOT EXISTS analyses (
  id          TEXT PRIMARY KEY,
  user_email  TEXT NOT NULL,
  lat         REAL NOT NULL,
  lng         REAL NOT NULL,
  radius_km   REAL NOT NULL,
  source      TEXT NOT NULL DEFAULT 'web',   -- 'web' | 'mcp'
  source_url  TEXT,                          -- the listing link, when the run came from a URL
  title       TEXT,                          -- human label (listing title / place name)
  summary     TEXT,                          -- short server-built one-liner of the readout
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_analyses_user    ON analyses(user_email);
CREATE INDEX IF NOT EXISTS idx_analyses_created ON analyses(created_at);
