# Tab-target combat foundation (autoattack)

Date: 2026-08-02

## Goal

Production-quality PvE autoattack loop with tab targeting. No abilities / hotbar in this iteration. Server-authoritative hits; client handles targeting, approach, and feel.

## Out of scope (v1)

- Skills, GCD, hotbar
- Crits, miss/block/parry, combat log
- Cone / facing hit validation
- Creature attack telegraphs
- PvP
- Threat UI

## Targeting and input

| Input | Behavior |
|-------|----------|
| LMB on living animal | Set sticky target, start autoattack |
| LMB on corpse (in click radius) | Open loot, clear combat target (existing) |
| LMB empty | Clear target, stop autoattack |
| Tab | Cycle living animals within `tabRange`, ordered by distance; after clear, Tab picks nearest |
| Esc | Clear target, stop autoattack |
| WASD during approach | Player movement overrides approach; autoattack resumes when in range if target still set |

**Sticky target:** kept until death, clear, or invalid. Selection ring + Target Frame stay in sync.

**Auto-approach:** if target alive and out of `attackRange`, move toward target. On enter range, stop and swing. No separate “chase forever” beyond that.

**Shift+Tab:** deferred (not v1).

## Shared combat constants

Single source of truth (shared module or mirrored client/server values with one canonical definition):

| Constant | Role | Suggested default |
|----------|------|-------------------|
| `attackRange` | Max distance player↔animal center for a valid hit | `56` (replaces client `52` and server `hitRadius + 24`) |
| `attackCooldownMs` | Min time between accepted hits | `450` ms base |
| `tabRange` | Max distance for Tab cycle | `560` |

Weapon items may expose optional `attackSpeed` (multiplier or ms). If present, it adjusts cooldown; else use base `attackCooldownMs`.

## Server rules

On `attackAnimal`:

1. Resolve animal; must exist and `alive`.
2. Validate distance using **server** player position (ignore attack-payload `x/y` for range checks). Pose updates continue via existing move/save path.
3. Reject if `now < player.attackReadyAt`.
4. On accept: set `attackReadyAt = now + cooldownMs` (from base + weapon).
5. Damage: `max(1, round(attackPower * (1 + variance)))` where variance is uniform in `[-0.08, +0.08]` (no crits).
6. Apply HP, aggro, private `combatText` to attacker, death/loot/XP as today.
7. Broadcast attack anim state for other clients (see below).

Creature → player combat unchanged except it continues to use existing mitigate/armor path.

## Attack animation sync

Add minimal fields on `PlayerState`, e.g.:

- `attackSeq: number` — incremented by the server on each **accepted** hit
- `attackDir: string` — facing for the swing (`up` / `down` / `side`; flip via existing sprite convention)

**Local player:** play swing immediately when starting an in-range, off-cooldown swing (predictive). Server reject → no HP/FCT change; no anim rollback in v1.

**Remote players:** on `attackSeq` change, play the same 3-frame attack clip for `attackDir`.

Note: remotes only animate on **accepted** hits (slightly late vs local predictive swing). Acceptable for v1.

Damage numbers and HP remain server-driven only.

## Client feel

- Mid-frame hit send retained (request at hit frame).
- Client cooldown mirrors server for UX; server remains authoritative.
- Floating combat text + Target Frame + world HP bars: keep; variance will show in numbers.
- Remove / stop relying on unused `creatures.yaml` `playerAttackDamage` for live damage (cleanup if still present).

## Data / config cleanup

- Live damage = `attackPower` (stats + item `damage`), not YAML `playerAttackDamage`.
- Optional item `attackSpeed` wired into cooldown when present (`iron_shortsword` can stay damage-only initially).

## Success criteria

- Tab cycles targets; sticky autoattack + approach feels like classic tab-target melee.
- Spamming `attackAnimal` cannot exceed server cooldown.
- Range checks use server position; client and server agree on melee range.
- Other players see swings.
- No abilities shipped in this iteration.
