# Movement speed (Tibia-lite, level-only)

Date: 2026-08-03

## Formula

`moveSpeed = baseMoveSpeed + (level - 1) * moveSpeedPerLevel` (px/s)

Warrior defaults: `baseMoveSpeed: 110`, `moveSpeedPerLevel: 2`.

## Notes

- No agility contribution (reserved for dodge/accuracy later).
- Synced on `PlayerState.moveSpeed`; client `PlayerMovement` reads `player.moveSpeed`.
- Shown under Character panel → Pochodne as **Szybkość**.
