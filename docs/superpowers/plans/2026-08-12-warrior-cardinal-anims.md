# Warrior Cardinal Anims Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate warrior walk/attack/dead cardinal frames and swap player warrior sprites to `public/assets/players/warrior/` with dedicated west (no flip).

**Architecture:** AI-generate 29 PNGs from directional idle references into `players/warrior/`. Extend `PlayerSprites` for separate left/right frame sets + `mirrorsLeft`. Point UI previews at `warrior-south.png`.

**Tech Stack:** GenerateImage + sips, Pixi `PlayerSprites`, YAML/UI path updates.

## Global Constraints

- Idle masters unchanged; do not generate idle cycles
- Walk 4×4, attack 3×4, dead 1; all 64×64 RGBA under `public/assets/players/warrior/`
- Naming: `warrior-{walk|attack}-{south|north|east|west}-N.png`, `warrior-dead.png`
- Warrior: no `scale.x` flip; knight unchanged
- No `tmp/imagegen`; no deletion of `human-warrior-v2`

---

### Task 1: Generate walk frames (16)

**Files:**
- Create: `public/assets/players/warrior/warrior-walk-{south,north,east,west}-{1..4}.png`

- [ ] **Step 1:** For each dir, `GenerateImage` ×4 with `reference_image_paths` = that dir’s idle. Prompt: same pixel-art warrior, walk cycle frame N/4, loopable, centered, transparent/black bg, 64×64 style.
- [ ] **Step 2:** `sips` normalize all walk frames to 64×64.
- [ ] **Step 3:** Spot-check loop order; regenerate bad frames.

### Task 2: Generate attack frames (12) + dead (1)

**Files:**
- Create: `public/assets/players/warrior/warrior-attack-{dir}-{1..3}.png`
- Create: `public/assets/players/warrior/warrior-dead.png`

- [ ] **Step 1:** Attack wind-up/strike/recovery per dir with same reference rule as walk.
- [ ] **Step 2:** Dead: fallen on back, new style, sword nearby; refs south (+ east optional).
- [ ] **Step 3:** `sips` normalize to 64×64.

### Task 3: PlayerSprites cardinal left/right

**Files:**
- Modify: `src/player/PlayerSprites.ts`
- Modify: `src/player/Player.ts` (flip via `mirrorsLeft`)
- Modify: `src/player/SyncedRemotePlayerView.ts` (same)

- [ ] **Step 1:** Point `PLAYER_DIR` at `assets/players/warrior`; add left/right path fields; map east=right, west=left, south=down, north=up.
- [ ] **Step 2:** `load()` builds distinct left/right sets; set `mirrorsLeft = false` for warrior, `true` for knight.
- [ ] **Step 3:** Replace hard-coded flip with `this.sprites.mirrorsLeft && facing === "left" ? -1 : 1`.

### Task 4: UI previews

**Files:**
- Modify: `src/data/classes.yaml`
- Modify: `src/ui/CharacterSelectScreen.ts`
- Modify: `src/ui/CharacterPanel.ts`

- [ ] **Step 1:** Preview / figure / select frames → `assets/players/warrior/warrior-south.png`.

### Task 5: Verify

- [ ] **Step 1:** Confirm 29 files exist at 64×64.
- [ ] **Step 2:** Typecheck / smoke that warrior paths resolve.

---

## Spec coverage

| Spec item | Task |
|-----------|------|
| 16 walk | 1 |
| 12 attack + dead | 2 |
| Loader + no flip | 3 |
| UI paths | 4 |
| Success criteria | 5 |
