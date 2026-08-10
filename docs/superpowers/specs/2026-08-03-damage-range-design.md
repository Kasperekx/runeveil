# Damage range (WoW-lite min–max)

Date: 2026-08-03

## Decision
Hybrid C: weapons have `damageMin`/`damageMax`; strength/class bonus adds flat to both ends. Each hit rolls uniform integer in `[min, max]`.

## Formulas
- `bonus = floor(baseDamage + strength * damagePerStrength)`
- Auto-attack: `min = weaponMin + bonus`, `max = weaponMax + bonus`
- Skill: `min/max = round(strength * strengthScale + weaponMin/Max * weaponScale)`
- Roll: inclusive uniform integer; no extra ±8% variance
- Legacy YAML `damage`: treated as `min = max = damage`
- `attackPower` kept as average `floor((min+max)/2)` for level-up / legacy UI

## UI
- Character: Obrażenia X–Y
- Weapon tooltip: Obrażenia: min–max
- Skill tooltips use real skill min–max
