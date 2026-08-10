CREATE TABLE IF NOT EXISTS players (
  player_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  class_id TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 1 CHECK (level >= 1),
  experience INTEGER NOT NULL DEFAULT 0 CHECK (experience >= 0),
  x DOUBLE PRECISION NOT NULL DEFAULT 0,
  y DOUBLE PRECISION NOT NULL DEFAULT 0,
  hp INTEGER NOT NULL CHECK (hp >= 0),
  strength INTEGER NOT NULL,
  agility INTEGER NOT NULL,
  stamina INTEGER NOT NULL,
  intellect INTEGER NOT NULL,
  spirit INTEGER NOT NULL,
  gold INTEGER NOT NULL DEFAULT 50 CHECK (gold >= 0),
  unspent_attr_points INTEGER NOT NULL DEFAULT 0 CHECK (unspent_attr_points >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inventory_slots (
  player_id TEXT NOT NULL REFERENCES players(player_id) ON DELETE CASCADE,
  slot_index INTEGER NOT NULL CHECK (slot_index >= 0),
  item_id TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  instance_id TEXT NOT NULL DEFAULT '',
  rarity TEXT NOT NULL DEFAULT 'common',
  affixes_json TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (player_id, slot_index)
);

CREATE TABLE IF NOT EXISTS equipment_slots (
  player_id TEXT NOT NULL REFERENCES players(player_id) ON DELETE CASCADE,
  slot_id TEXT NOT NULL,
  item_id TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  instance_id TEXT NOT NULL DEFAULT '',
  rarity TEXT NOT NULL DEFAULT 'common',
  affixes_json TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (player_id, slot_id)
);

CREATE TABLE IF NOT EXISTS bag_slots (
  player_id TEXT NOT NULL REFERENCES players(player_id) ON DELETE CASCADE,
  slot_index INTEGER NOT NULL CHECK (slot_index >= 0),
  item_id TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (player_id, slot_index)
);

CREATE TABLE IF NOT EXISTS player_professions (
  player_id TEXT NOT NULL REFERENCES players(player_id) ON DELETE CASCADE,
  profession_id TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 1 CHECK (level >= 1),
  experience INTEGER NOT NULL DEFAULT 0 CHECK (experience >= 0),
  PRIMARY KEY (player_id, profession_id)
);

CREATE TABLE IF NOT EXISTS player_quests (
  player_id TEXT NOT NULL REFERENCES players(player_id) ON DELETE CASCADE,
  quest_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0),
  PRIMARY KEY (player_id, quest_id)
);

CREATE INDEX IF NOT EXISTS players_updated_at_idx ON players (updated_at DESC);
