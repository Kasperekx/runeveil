# HP regeneration (WoW-lite)

Date: 2026-08-06

## Decision
Out-of-combat HP regen only. Combat = took damage from a creature. After 6s without damage, regen ticks every 2s. Amount scales with spirit + level. Server authoritative.

## Rules
- In combat: no regen
- Leave combat: 6s delay after last damage taken
- Tick interval: 2s
- `heal = max(1, floor(1 + spirit * 0.25 + level * 0.15))`
- Cap at `maxHp`; no ticks at full HP
- Taking damage resets the OOC timer
- Potions / level-up heal unchanged

## Client
- HP bar via existing vitals sync
- Green floating `+N` on regen tick (same channel as combat text / heal)
- Character panel: Spirit flavor mentions out-of-combat regen

## Out of scope
- Mana, food/sit bonuses, creature regen
