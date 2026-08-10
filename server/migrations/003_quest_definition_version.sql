ALTER TABLE player_quests
  ADD COLUMN IF NOT EXISTS definition_version INTEGER NOT NULL DEFAULT 1
  CHECK (definition_version >= 1);
