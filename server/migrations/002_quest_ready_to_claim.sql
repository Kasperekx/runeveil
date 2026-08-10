ALTER TABLE player_quests
  DROP CONSTRAINT IF EXISTS player_quests_status_check;

ALTER TABLE player_quests
  ADD CONSTRAINT player_quests_status_check
  CHECK (status IN ('active', 'ready_to_claim', 'completed'));
