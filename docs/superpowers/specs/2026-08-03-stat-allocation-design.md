# Stat point allocation on level-up

Date: 2026-08-03

## Decision
- **5 unspent attribute points per level** (option A)
- No automatic ATTR_GAIN_PER_LEVEL on level-up
- Player spends points via Character panel (+ buttons)
- Points bank across levels until spent

## Attributes
strength, agility, stamina, intellect, spirit — one point each click.

## Server
- `PlayerState.unspentAttrPoints`
- SQLite `unspent_attr_points`
- `awardExperience` returns `attrPointsGained = levelsGained * 5`
- Message `allocateAttribute` `{ attr: string }` spends 1 point
- Recompute maxHp / attackPower; heal by maxHp delta on stamina

## Client
- Character panel shows unspent + `+` per attr when points remain
- Level-up banner mentions free points
