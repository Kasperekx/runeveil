# Zamaszysty cios (sweeping strike) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first player skill — frontal cone AoE **Zamaszysty cios** — with YAML catalog, server `castSkill`, action-bar skill slots, slash VFX, and icon.

**Architecture:** Skills live in `src/data/skills.yaml` (client import + server `skillConfig.ts` mirror). One authoritative `castSkill` message hits all animals in a 120° / 72 px cone. Action bar stores `{ type: "item"|"skill", id }` with localStorage migration. Local client plays existing warrior swing + dedicated slash FX; remotes reuse `attackSeq`/`attackDir`.

**Tech Stack:** TypeScript, Pixi.js 8, Colyseus, js-yaml, Vite (`?raw` YAML imports on client)

## Global Constraints

- Skill id: `sweeping_strike`; display name: Zamaszysty cios
- Cone ~120°, range 72 px, damage `1.30 × attackPower` with ±8% variance, cooldown 7000 ms
- Aim: sticky animal target if alive, else player facing
- Skill CD independent of autoattack CD; whiff still consumes skill CD
- No mana, no GCD, no skills panel, no unique warrior frames, no PvP
- Do not commit unless the user asks
- Polish UI copy

---

## File structure

| File | Responsibility |
|------|----------------|
| `src/data/skills.yaml` | Skill catalog source of truth |
| `src/skills/catalog.ts` | Client load + typed accessors |
| `server/src/world/skillConfig.ts` | Server load of same YAML |
| `src/config/cone.ts` + `server/src/world/cone.ts` (or shared copy) | `inCone(px,py, ax,ay, tx,ty, range, coneDegrees)` |
| `server/src/rooms/WorldRoom.ts` | `castSkill` handler + extract `applyAnimalHit` |
| `src/network/GameNetwork.ts` | `castSkill(skillId)` |
| `src/ui/ActionBar.ts` | Slot union, migrate storage, skill activate |
| `src/ui/SkillCooldowns.ts` | Parallel to ItemCooldowns for skills |
| `src/player/PlayerCombat.ts` | Expose `getTargetId()` / aim helper for casts |
| `src/fx/SweepingStrikeFx.ts` | Play 4-frame slash at player |
| `src/game/Game.ts` | Wire cast + VFX + cooldowns |
| `public/assets/skills/sweeping-strike.png` | Action-bar icon |
| `public/assets/fx/sweeping-strike/frame-1..4.png` | Slash VFX |

---

### Task 1: Skills YAML + catalogs + cone math

**Files:**
- Create: `src/data/skills.yaml`
- Create: `src/skills/catalog.ts`
- Create: `server/src/world/skillConfig.ts`
- Create: `src/config/cone.ts`
- Create: `server/src/world/cone.ts` (identical logic; keep in sync comment)

**Interfaces:**
- Produces: `SkillId`, `getSkill(id)`, `hasSkill(id)`, `listSkills()`, `SkillConfig` with `name`, `description`, `icon`, `cooldownMs`, `range`, `coneDegrees`, `damageMultiplier`, `vfx`
- Produces: `export function inCone(originX, originY, aimX, aimY, targetX, targetY, range, coneDegrees): boolean`

- [ ] **Step 1: Write `src/data/skills.yaml`**

```yaml
skills:
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

- [ ] **Step 2: Client catalog** — mirror `src/items/catalog.ts` pattern (`import skillsYaml from "../data/skills.yaml?raw"`, `load` from `js-yaml`). Export `getSkill`, `hasSkill`, `listSkills`, type `SkillId = string`.

- [ ] **Step 3: Server `skillConfig.ts`** — mirror `server/src/world/itemConfig.ts` path to `../../../src/data/skills.yaml`. Export `getSkillConfig(id)` / `SKILLS`.

- [ ] **Step 4: Cone helper (both sides)**

```ts
/** True if target is within range and within ±coneDegrees/2 of the aim vector. */
export function inCone(
  originX: number,
  originY: number,
  aimX: number,
  aimY: number,
  targetX: number,
  targetY: number,
  range: number,
  coneDegrees: number,
): boolean {
  const dx = targetX - originX;
  const dy = targetY - originY;
  const dist = Math.hypot(dx, dy);
  if (dist > range) return false;
  if (dist < 1e-6) return true;
  const adx = aimX - originX;
  const ady = aimY - originY;
  const aimLen = Math.hypot(adx, ady);
  if (aimLen < 1e-6) return true;
  const cos = (dx * adx + dy * ady) / (dist * aimLen);
  const half = (coneDegrees * Math.PI) / 360;
  return Math.acos(Math.min(1, Math.max(-1, cos))) <= half;
}
```

- [ ] **Step 5: Verify** — `npx tsc --noEmit` (client) and `npm --prefix server exec tsc --noEmit` if configured.

---

### Task 2: Server `applyAnimalHit` + `castSkill`

**Files:**
- Modify: `server/src/rooms/WorldRoom.ts`
- Consumes: `getSkillConfig`, `inCone`, `rollMeleeDamage` (or multiply AP then variance), `facingToward`

**Interfaces:**
- Produces: room message `castSkill` `{ skillId: string }`
- Produces: private `skillReadyAt: Map<string, number>` keyed `${sessionId}:${skillId}`
- Produces: private `applyAnimalHit(client, player, animal): void` — HP, aggro, combatText, death/loot/XP/slot (no range/CD checks)

- [ ] **Step 1: Extract hit application** from current `attackAnimal` body (lines that mutate animal / XP) into `applyAnimalHit`. Keep range + attack CD + `attackSeq` bump in `attackAnimal`.

- [ ] **Step 2: Facing vector helper** on server — map `AttackFacing` to a point ahead of player:

```ts
function facingAimPoint(x: number, y: number, dir: string): { x: number; y: number } {
  const d = 100;
  switch (dir) {
    case "up": return { x, y: y - d };
    case "down": return { x, y: y + d };
    case "left": return { x: x - d, y };
    default: return { x: x + d, y }; // right / side
  }
}
```

Store last facing on player via existing `attackDir` (already synced). For aim without target, use `player.attackDir` or default `"down"`.

- [ ] **Step 3: Add `castSkill` handler**

```ts
castSkill: (client: Client, data: { skillId?: string }) => {
  const player = this.state.players.get(client.sessionId);
  if (!player || typeof data?.skillId !== "string") return;
  const skill = getSkillConfig(data.skillId);
  if (!skill) return;

  const now = Date.now();
  const cdKey = `${client.sessionId}:${data.skillId}`;
  if (now < (this.skillReadyAt.get(cdKey) ?? 0)) return;
  this.skillReadyAt.set(cdKey, now + skill.cooldownMs);

  // Aim: optional sticky target is NOT on server today — client-only.
  // Spec says target if alive else facing. Server needs aim from payload OR facing only.
  // v1 fix: payload `{ skillId, targetAnimalId?: string }` — if animal alive, aim at it; else facing.
  let aimX: number;
  let aimY: number;
  let dir: string;
  const targetId = typeof (data as { targetAnimalId?: string }).targetAnimalId === "string"
    ? (data as { targetAnimalId?: string }).targetAnimalId
    : undefined;
  const target = targetId ? this.state.animals.get(targetId) : undefined;
  if (target?.alive) {
    aimX = target.x;
    aimY = target.y;
    dir = facingToward(player.x, player.y, aimX, aimY);
  } else {
    dir = player.attackDir || "down";
    const p = facingAimPoint(player.x, player.y, dir);
    aimX = p.x;
    aimY = p.y;
  }

  player.attackDir = dir;
  player.attackSeq = (player.attackSeq ?? 0) + 1;

  for (const animal of this.state.animals.values()) {
    if (!animal.alive) continue;
    if (!inCone(player.x, player.y, aimX, aimY, animal.x, animal.y, skill.range, skill.coneDegrees)) {
      continue;
    }
    const damage = rollMeleeDamage(player.attackPower * skill.damageMultiplier);
    // applyAnimalHit must accept pre-rolled damage OR roll inside with multiplier — prefer:
    this.applyAnimalHit(client, player, animal, damage);
  }
},
```

**Spec alignment:** extend client payload to `{ skillId, targetAnimalId?: string }` so sticky target aim works server-side (client sends current combat target id). Document this in the cast payload — required for correct aim.

- [ ] **Step 4: Refactor `attackAnimal`** to call `applyAnimalHit(client, player, animal, rollMeleeDamage(player.attackPower))` after validation.

- [ ] **Step 5: Verify** — server starts without error; manual cast later in Task 5.

---

### Task 3: Action bar skill slots + cooldowns + network

**Files:**
- Create: `src/ui/SkillCooldowns.ts` (copy pattern from `ItemCooldowns.ts`)
- Modify: `src/ui/ActionBar.ts`
- Modify: `src/network/GameNetwork.ts`
- Modify: `src/game/Game.ts`
- Modify: `src/player/PlayerCombat.ts` — add `getTargetId(): string | null`

**Interfaces:**
- Produces: `type ActionBarAssignment = { type: "item"; id: string } | { type: "skill"; id: string } | null`
- Produces: `ActionBar` constructor takes `onUseItem` + `onUseSkill: (skillId: string) => void`
- Produces: `GameNetwork.castSkill(skillId: string, targetAnimalId?: string | null)`
- Produces: `SkillCooldowns.start(skillId, cooldownMs)` / `remaining(skillId)`

- [ ] **Step 1: `SkillCooldowns`** — same API as `ItemCooldowns` but keyed by skill id.

- [ ] **Step 2: Migrate `ActionBar` storage**

```ts
function parseAssignment(value: unknown): ActionBarAssignment {
  if (value == null) return null;
  if (typeof value === "string" && value.length > 0) {
    return { type: "item", id: canonicalItemId(value) };
  }
  if (typeof value === "object" && value !== null && "type" in value && "id" in value) {
    const v = value as { type: string; id: string };
    if (v.type === "item" && typeof v.id === "string") {
      return { type: "item", id: canonicalItemId(v.id) };
    }
    if (v.type === "skill" && typeof v.id === "string" && hasSkill(v.id)) {
      return { type: "skill", id: v.id };
    }
  }
  return null;
}
```

After load: if `assignments[0] === null`, set `{ type: "skill", id: "sweeping_strike" }` and save.

- [ ] **Step 3: `activate(index)`** — if skill: if `skillCooldowns.remaining > 0` flash denied; else `skillCooldowns.start(id, getSkill(id).cooldownMs)` + `onUseSkill(id)`. If item: existing path.

- [ ] **Step 4: Render** — skill slots show `getSkill(id).icon` (prefix `/` if needed like items), no qty badge, skill CD overlay from `SkillCooldowns`. Tooltip: name + description + cooldown (extend ItemTooltip lightly or inline title attribute for v1 — prefer small skill tooltip text via existing tooltip if easy, else `title`).

- [ ] **Step 5: `GameNetwork.castSkill`**

```ts
castSkill(skillId: string, targetAnimalId?: string | null): void {
  if (!this.room) return;
  this.room.send("castSkill", {
    skillId,
    ...(targetAnimalId ? { targetAnimalId } : {}),
  });
}
```

- [ ] **Step 6: Wire `Game.ts`** — `onUseSkill` → get target from combat → `network.castSkill` + local swing + VFX (VFX can stub until Task 4).

---

### Task 4: Generate icon + slash VFX + client FX player

**Files:**
- Create: `public/assets/skills/sweeping-strike.png`
- Create: `public/assets/fx/sweeping-strike/frame-1.png` … `frame-4.png`
- Create: `src/fx/SweepingStrikeFx.ts`
- Modify: `src/game/Game.ts` / cast path to spawn FX

**Interfaces:**
- Produces: `SweepingStrikeFx.play(parent: Container, x, y, facing: AttackFacing): void`

- [ ] **Step 1: Generate icon** with `GenerateImage` — ~64×64 feel, painted pixel-fantasy sword slash icon, transparent/dark readable on brass action bar, no text. Save/export to `public/assets/skills/sweeping-strike.png` (resize/crop if needed via shell `sips` or copy).

- [ ] **Step 2: Generate slash frames** — four sequential arc slash frames (same style as game creatures: soft painted, transparent background, horizontal sweep preferred; client rotates/flips by facing). Prompt for consistency: same slash, frames 1→4 wind-up to follow-through. Place under `public/assets/fx/sweeping-strike/`.

- [ ] **Step 3: `SweepingStrikeFx`**

```ts
// Load textures Assets.load([...frames]); AnimatedSprite, fps ~20, loop false,
// anchor 0.5, position at player; flip/rotate for left/right/up/down; destroy on complete.
```

- [ ] **Step 4: On local cast** — `player.beginAttack(dir)` + `SweepingStrikeFx.play(...)`. Facing from target or player facing (same rules as server).

- [ ] **Step 5: Remotes (optional v1)** — skip dedicated VFX; `attackSeq` swing is enough unless wiring is trivial.

---

### Task 5: End-to-end wiring + verification

**Files:**
- Modify: any remaining glue in `Game.ts`, `PlayerCombat.ts`
- Update: `docs/plan.md` (note skill shipped)
- Update: `docs/tasks-2026-08-03_19-25.md` checkboxes as done

- [ ] **Step 1: Ensure cast path** sends `targetAnimalId` from `combat.getTargetId()`, plays FX, starts skill CD only on activate (already).

- [ ] **Step 2: Typecheck** — client `npx tsc --noEmit`, server `npx tsc --noEmit` in `server/`.

- [ ] **Step 3: Manual playtest checklist**
  - [ ] Slot 1 shows Zamaszysty cios icon after load
  - [ ] Hotkey `1` casts; slash VFX + swing play
  - [ ] Two+ animals in front take damage; animal behind does not
  - [ ] 7 s CD blocks spam; autoattack still works on sticky target
  - [ ] Potion slots still work (item type migration)
  - [ ] Whiff (no animals) still starts CD

- [ ] **Step 4: Do not commit** unless user requests.

---

## Spec coverage self-review

| Spec requirement | Task |
|------------------|------|
| skills.yaml + mirror | Task 1 |
| castSkill + cone + 130% + 7s CD | Task 2 |
| Shared hit helper | Task 2 |
| Action bar item\|skill + migrate + pre-bind slot 1 | Task 3 |
| Hotkeys | Task 3 (existing ActionBarHotkeys → activate) |
| Icon + VFX frames | Task 4 |
| Local swing + VFX | Task 4–5 |
| Sticky-target aim | Task 2 payload `targetAnimalId` + Task 3/5 client send |
| No mana / no skills panel | Out of scope — not in tasks |
| Independent of autoattack CD | Task 2 (skillReadyAt only) |

**Payload note:** Spec listed `{ skillId }` only; plan adds optional `targetAnimalId` so server can aim at sticky target without storing client combat state. Required for correct aim.

---

## Execution

Plan saved. Choose:

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — implement in this session with checkpoints  

Which approach?
