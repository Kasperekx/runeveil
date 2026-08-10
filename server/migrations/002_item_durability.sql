ALTER TABLE inventory_slots
  ADD COLUMN IF NOT EXISTS durability INTEGER NOT NULL DEFAULT 0 CHECK (durability >= 0),
  ADD COLUMN IF NOT EXISTS max_durability INTEGER NOT NULL DEFAULT 0 CHECK (max_durability >= 0);

ALTER TABLE equipment_slots
  ADD COLUMN IF NOT EXISTS durability INTEGER NOT NULL DEFAULT 0 CHECK (durability >= 0),
  ADD COLUMN IF NOT EXISTS max_durability INTEGER NOT NULL DEFAULT 0 CHECK (max_durability >= 0);
