ALTER TABLE players
  ADD COLUMN IF NOT EXISTS map_id TEXT NOT NULL DEFAULT 'hunting_grounds';

CREATE INDEX IF NOT EXISTS players_map_id_idx ON players (map_id);
