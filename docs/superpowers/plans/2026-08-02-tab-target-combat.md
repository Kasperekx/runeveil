# Tab-target combat foundation — Implementation Plan

> **For agentic workers:** Execute task-by-task. Steps use checkbox syntax.

**Goal:** Production PvE tab-target autoattack with server-authoritative hits and networked swing anim.

**Architecture:** Shared combat constants; server validates range/cooldown and bumps `attackSeq`; client owns Tab targeting, sticky autoattack, and auto-approach.

**Tech Stack:** Pixi client, Colyseus schema, TypeScript

## Global Constraints

- attackRange = 56, attackCooldownMs = 450, tabRange = 560
- Damage variance ±8%, no crits
- No skills/hotbar in this iteration
- Server position for range checks (ignore attack payload x/y for validation)

---

### Task 1: Shared constants + server combat rules

**Files:**
- Create: `src/config/combat.ts` (client)
- Create or mirror: `server/src/world/combatConfig.ts`
- Modify: `server/src/rooms/WorldRoom.ts` (`attackAnimal`)
- Modify: `server/src/schema/GameState.ts` (attackReadyAt internal + attackSeq/attackDir synced)

- [ ] Add shared constants and variance helper
- [ ] Server cooldown + range 56 + variance damage
- [ ] Ignore attack payload pose for range; set attackSeq/attackDir on accept

### Task 2: Remote attack animation

**Files:**
- Modify: remote player view (find existing OtherPlayer / NetworkPlayers)
- Modify: client Player attack dir encoding if needed

- [ ] On remote `attackSeq` change, play attack clip

### Task 3: Client tab-target + approach + constants

**Files:**
- Modify: `src/player/PlayerCombat.ts`
- Modify: `src/config/constants.ts` (point at combat.ts or replace)
- Modify: `src/game/Game.ts` (Tab / Esc wiring if needed)

- [ ] Tab cycle within tabRange
- [ ] Esc clear
- [ ] Auto-approach when out of range
- [ ] Client cooldown/range = shared constants

### Task 4: Cleanup + verify

- [ ] Remove unused `playerAttackDamage` usage if any
- [ ] `npx tsc --noEmit` (client + server)
