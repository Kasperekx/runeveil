ALTER TABLE characters
  ADD COLUMN IF NOT EXISTS name_normalized TEXT,
  ADD COLUMN IF NOT EXISTS customized BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Characters that already entered the world remain playable as legacy
-- characters. Untouched registration placeholders will be completed in the
-- new character creator.
UPDATE characters AS character
SET customized = EXISTS (
  SELECT 1 FROM players WHERE players.player_id = character.id::TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS characters_name_normalized_unique
  ON characters (name_normalized)
  WHERE name_normalized IS NOT NULL;

