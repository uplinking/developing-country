-- Opportunistic writes prune expired snapshots for every user, including users
-- who never return. The global timestamp index keeps that cleanup bounded.

CREATE INDEX IF NOT EXISTS idx_stage_snapshots_created_at
  ON stage_snapshots(created_at);

