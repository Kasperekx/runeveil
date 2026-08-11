-- Gear saved before the durability rollout received the schema default 0/0.
-- Backfill only those legacy rows; genuinely damaged items already have max > 0.
WITH durability(item_id, max_value) AS (
  VALUES
    ('leather_helm', 55),
    ('leather_shoulders', 65),
    ('leather_chest', 90),
    ('leather_legs', 75),
    ('leather_boots', 50),
    ('iron_shortsword', 100)
)
UPDATE inventory_slots AS slot
SET durability = durability.max_value,
    max_durability = durability.max_value
FROM durability
WHERE slot.item_id = durability.item_id
  AND slot.max_durability = 0;

WITH durability(item_id, max_value) AS (
  VALUES
    ('leather_helm', 55),
    ('leather_shoulders', 65),
    ('leather_chest', 90),
    ('leather_legs', 75),
    ('leather_boots', 50),
    ('iron_shortsword', 100)
)
UPDATE equipment_slots AS slot
SET durability = durability.max_value,
    max_durability = durability.max_value
FROM durability
WHERE slot.item_id = durability.item_id
  AND slot.max_durability = 0;
