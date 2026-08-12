# Design: Warrior cardinal walk / attack / dead + player loader swap

Date: 2026-08-12

## Goal

Replace the in-game warrior visuals with the new cardinal model under `public/assets/players/warrior/`, generating walk, attack, and dead frames the same way we did for skeleton, then wiring `PlayerSprites` (and related UI) to that folder with dedicated east/west (no horizontal flip).

## Context

- New idle masters (64×64 RGBA): `warrior-{east,west,north,south}.png` in `public/assets/players/warrior/`.
- Skeleton precedent: 4 walk frames × 4 cardinal dirs via `GenerateImage` + directional reference; east/west authored separately; loader uses west for left with `mirrorLeft: false`.
- Current player warrior loads `assets/players/human-warrior-v2` with `side`/`down`/`up` naming; `Player.ts` / `SyncedRemotePlayerView.ts` set `scale.x = -1` when `facing === "left"`.
- Existing dead reference style (old set): character lying down with sword on the ground — new dead should match the **new** armor/palette, same pose idea.

## Decisions (locked)

| Topic | Choice |
|-------|--------|
| Scope | Full swap to `players/warrior/` (not assets-only) |
| Idle | Keep existing 4 single-frame idles; **do not** generate idle cycles |
| Animations to generate | Walk (4×4), attack (3×4), dead (1) |
| Facing | Dedicated west for left; **no** `scale.x` flip |
| Pipeline | `GenerateImage` + per-direction idle as sole reference; write straight into `public/assets/players/warrior/` (no `tmp/imagegen`) |

## Assets

### Keep (masters / idle)

- `warrior-east.png`, `warrior-west.png`, `warrior-north.png`, `warrior-south.png`

### Generate (29 PNGs)

| Kind | Count | Naming | Size |
|------|-------|--------|------|
| Walk | 16 | `warrior-walk-{south,north,east,west}-{1..4}.png` | 64×64 |
| Attack | 12 | `warrior-attack-{south,north,east,west}-{1..3}.png` | 64×64 |
| Dead | 1 | `warrior-dead.png` | 64×64 |

### Generation rules

For each direction, use **only** that direction’s idle as `reference_image_paths`:

1. **South** ← `warrior-south.png` — front; alternating legs; light torso bob; sword vs free-hand swing.
2. **North** ← `warrior-north.png` — back; same motion rules (hood, straps, hip gear).
3. **East** ← `warrior-east.png` — profile right; stride + weighted sword swing.
4. **West** ← `warrior-west.png` — profile left; **authored frames, not a flip of east**.

Shared constraints:

- Match style, palette, proportions, outline weight of the reference.
- Transparent or solid-black background consistent with masters; character centered on canvas.
- Walk must loop cleanly `1→2→3→4→1`.
- Attack: wind-up → strike → recovery (3 frames), readable sword arc.
- Dead: fallen / on-back pose in new warrior style (armor, beard/hair, sword dropped nearby), readable at 64×64.
- After generation, normalize with `sips` if needed so every frame is exactly 64×64 RGBA.

## Loader / runtime

### `PlayerSprites.ts`

- `PLAYER_DIR` → `assets/players/warrior`.
- Path map (cardinal):
  - **right**: idle `warrior-east.png`; walk `warrior-walk-east-{1..4}`; attack `warrior-attack-east-{1..3}`
  - **left**: idle `warrior-west.png`; walk `warrior-walk-west-{1..4}`; attack `warrior-attack-west-{1..3}`
  - **down**: idle `warrior-south.png`; walk `warrior-walk-south-{1..4}`; attack `warrior-attack-south-{1..3}`
  - **up**: idle `warrior-north.png`; walk `warrior-walk-north-{1..4}`; attack `warrior-attack-north-{1..3}`
  - **dead**: `warrior-dead.png`, `deadRotation: 0`
- Idle arrays are length 1 (single texture per facing).
- `load()` must assign **distinct** `PlayerFrameSet` for `left` and `right` (today both point at `side`).
- Extend `PlayerSpritePaths` so left/right are first-class (e.g. `idleLeft`/`walkLeft`/`attackLeft` + right/east counterparts, or embed left arrays explicitly) — do not reuse a shared `side` for both.
- Cache-bust query (`?v=…`) bumped once for the new set.

Knight paths and `playerSpritePaths("knight")` stay unchanged (still shared side + flip).

### Facing flip

In `Player.ts` and `SyncedRemotePlayerView.ts`:

- Warrior: always `scale.x = 1` (left uses west textures).
- Knight: keep current `facing === "left" ? -1 : 1` behavior.

Prefer a small helper on `PlayerSprites` (e.g. `mirrorsLeft: boolean`) set at load time from whether left/right frame sets are distinct, so both views share one rule.

### UI / preview paths

Point all warrior previews at `assets/players/warrior/warrior-south.png`:

- `src/data/classes.yaml` (`preview`)
- `src/ui/CharacterSelectScreen.ts` (static south idle; drop the old 4-frame idle-down cycle for warrior)
- `src/ui/CharacterPanel.ts`

## Out of scope

- Regenerating or deleting `human-warrior-v2` assets
- Animated idle cycles
- New attack VFX / skill-specific warrior frames
- Changing move speed, anim FPS, or combat logic
- Procedural pixel warps instead of reference-based generation

## Risks

- Style drift across AI frames → regenerate individual frames with the same directional reference.
- Wrong canvas size → `sips` resize/crop to 64×64.
- Walk loop looks wrong → reorder or regenerate frames 1..4.
- Forgetting UI paths → character select / panel show old art while gameplay shows new.

## Success criteria

1. In-game warrior idle/walk/attack/dead use only `public/assets/players/warrior/*`.
2. Walking left uses west art (sword/handedness correct), not a flipped east.
3. All four walk cycles loop; all four attack swings read clearly.
4. Character select / class preview / character panel show the new south idle.
5. Knight class unchanged.
