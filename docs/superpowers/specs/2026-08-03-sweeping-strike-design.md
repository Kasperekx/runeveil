# Zamaszysty cios — first AoE skill

Date: 2026-08-03

## Goal

Add the first player skill **Zamaszysty cios** (`sweeping_strike`): a frontal cone AoE cleave, cast from the action bar, with a dedicated slash VFX. Establishes a minimal skills pipeline (YAML + `castSkill` + action-bar skill slots) without a full talent/skills UI.

## Out of scope (v1)

- Skills panel / talent tree / learning gated by level
- Mana / rage / resource cost
- Global cooldown (GCD) separate from per-skill cooldown
- Unique warrior attack frames for this skill (reuse existing swing)
- PvP / hitting other players
- Max-target cap (small herds only)
- Cone telegraph / ground indicator while casting

## Gameplay

| Property | Value |
|----------|-------|
| Id | `sweeping_strike` |
| Display name | Zamaszysty cios |
| Shape | Frontal cone |
| Cone angle | ~120° |
| Range | 72 px (from player center to animal center) |
| Damage | `1.30 × attackPower` per hit, same ±8% variance as melee (`rollMeleeDamage`-style) |
| Cooldown | 7000 ms (skill-specific; independent of autoattack CD) |
| Resource | None |
| Target required | No |

**Aim direction**

1. If sticky combat target exists, is alive, and is an animal → aim toward that animal’s position.
2. Else → use the player’s current facing (last move / attack facing).

Casting with no animals in the cone still consumes the skill cooldown and plays anim + VFX (whiff allowed).

Autoattack continues on its own sticky-target loop; this skill does not replace or pause autoattack beyond sharing the visual swing on the local player for the cast moment.

## Data

New catalog: `src/data/skills.yaml` (mirrored on server like items/combat config).

Example entry:

```yaml
sweeping_strike:
  name: Zamaszysty cios
  description: "Tnie półkolem przed sobą, raniąc wszystkich wrogów w zasięgu."
  icon: assets/skills/sweeping-strike.png
  cooldownMs: 7000
  range: 72
  coneDegrees: 120
  damageMultiplier: 1.3
  vfx: sweeping_strike
```

Client + server load the same fields; server is authoritative for range, cone, damage, cooldown.

## Server

New room message: `castSkill` with payload `{ skillId: string }`.

On receive:

1. Resolve skill def; reject unknown ids.
2. Reject if `now < player.skillReadyAt[skillId]` (per-skill map on room session / player runtime).
3. Resolve aim: sticky target animal if valid, else player facing vector from `attackDir` / last facing.
4. Set skill ready-at to `now + cooldownMs`.
5. Increment `attackSeq` once; set `attackDir` from aim (so remotes play one swing).
6. For each alive animal with distance ≤ `range` and angle within half-cone of aim axis:
   - Damage = `max(1, round(attackPower * damageMultiplier * (1 + variance)))`
   - Apply via **shared hit helper** extracted from `attackAnimal` (HP, aggro, `combatText`, death → loot/XP/corpse timer).
7. Do **not** apply autoattack cooldown from this cast (skill CD only). Autoattack may still fire on its own timer.

Client must not fan-out N `attackAnimal` messages for AoE.

## Client

### Action bar

Slots become discriminated unions:

```ts
type ActionBarSlot =
  | { type: "item"; id: ItemId }
  | { type: "skill"; id: SkillId }
  | null;
```

- Persist under existing `mmo.actionBar` key with a small migration: legacy bare item-id strings → `{ type: "item", id }`.
- Drop target accepts skills (from a temporary default bind or future skills UI) and usable items.
- v1: on first load / empty bar, **pre-bind** `sweeping_strike` to slot 1 (index 0) if that slot is empty — so the skill is immediately usable. Player can rearrange.
- Hotkeys `1`–`0` activate the bound item **or** skill.
- Skill activation → `network.castSkill(skillId)`; local predictive swing + VFX; start local skill CD overlay from catalog `cooldownMs` (server remains authoritative; reject = no damage, CD may still show — accept minor desync like melee).

### Combat feel

- Local: face toward aim, `Player.beginAttack`, spawn slash VFX at player in aim direction.
- Remotes: existing `attackSeq` / `attackDir` swing; optionally show same VFX when remote casts (nice-to-have if cheap — prefer yes if skill cast is distinguishable; if not, remotes only swing is OK for v1).
- Floating combat text: one event per animal hit (existing `combatText` path).

### VFX + icon assets

| Asset | Path | Notes |
|-------|------|-------|
| Skill icon | `public/assets/skills/sweeping-strike.png` | ~64×64, readable on action bar |
| Slash frames | `public/assets/fx/sweeping-strike/frame-1.png` … `frame-4.png` | Arc/slash in front of caster; transparent BG; play once ~150–200 ms total |

Art style: match existing pixel / soft painted look of warrior and creature assets. Generated via image pipeline, then placed under `public/assets/`.

## Integration points (files)

| Area | Likely touch |
|------|----------------|
| Skill catalog | `src/data/skills.yaml`, client loader, `server` skill config mirror |
| Server cast | `WorldRoom.ts` — `castSkill`, shared apply-hit helper |
| Network | `GameNetwork.ts` — `castSkill` |
| Action bar | `ActionBar.ts`, `ActionBarHotkeys.ts`, cooldowns helper (extend or parallel `SkillCooldowns`) |
| Game wiring | `Game.ts` |
| VFX | small FX player near player sprite |
| Combat constants | optional shared cone math helper client (preview later) / server |

## Success criteria

- Player can bind and press Zamaszysty cios from the action bar / hotkey.
- Multiple animals in the frontal cone take damage in one cast; animals behind/outside do not.
- 7 s cooldown gates spam; autoattack still works independently.
- Slash VFX and icon are visible and on-theme.
- No regression to single-target autoattack, loot, XP, or consumable action-bar slots.
