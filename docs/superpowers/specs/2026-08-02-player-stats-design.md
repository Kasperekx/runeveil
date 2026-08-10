# Player stats, classes, SQLite, character panel

Date: 2026-08-02

## Decisions
- Stats: strength, agility, stamina, intellect, spirit
- Live combat: maxHp from stamina, attack damage from strength
- Storage: SQLite via repository interface (migrate JSON once)
- UI: WoW-like paper-doll (empty slots) + stats; toggle KeyC
- Default class: warrior from `classes.yaml`

## Formulas
- `maxHp = baseHp + stamina * hpPerStamina`
- `attackPower = floor(baseDamage + strength * damagePerStrength)`
