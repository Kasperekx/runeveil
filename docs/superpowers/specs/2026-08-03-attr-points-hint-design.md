# Unspent attribute points UI hint

Date: 2026-08-03

## Decision (option C)
- Do **not** auto-open Character panel on level-up
- Show unspent points in two places while `unspentAttrPoints > 0`:
  1. Badge count on micro-menu **Postać** button
  2. Clickable chip under the player HUD („N pkt atrybutów · C”)

## Behaviour
- Both update from sheet sync; hide when points hit 0
- Chip click / badge context opens Character panel (C still works)
- Level-up banner still mentions gained points
