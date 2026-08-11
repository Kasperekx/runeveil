import type { AnimalState, PlayerState } from "../schema/GameState.js";
import { mitigate } from "./armorConfig.js";
import {
  CREATURE_COLLISION,
  CREATURE_KINDS,
  type CreatureKind,
} from "./creatureConfig.js";

const CARDINAL = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
] as const;

interface AiState {
  homeX: number;
  homeY: number;
  dirX: number;
  dirY: number;
  moveTimer: number;
  pauseTimer: number;
  /** Colyseus sessionId of the player this animal is fighting. */
  targetSessionId: string | null;
  attackReadyAt: number;
}

export interface CircleBlocker {
  x: number;
  y: number;
  radius: number;
  /** When set, chase AI can ignore this player while pursuing them. */
  sessionId?: string;
}

export interface PlayableBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Server-side wander / chase / attack / respawn for one animal. */
export class AnimalAi {
  private readonly ai = new Map<string, AiState>();

  /**
   * Reports a landed animal hit. The AI has no room handle, so WorldRoom wires
   * this up to deliver floating combat text to the player who got hit.
   */
  onPlayerDamaged:
    ((sessionId: string, amount: number, animalId: string) => void) | null =
    null;

  register(animal: AnimalState, homeX: number, homeY: number): void {
    const dir = CARDINAL[Math.floor(Math.random() * CARDINAL.length)]!;
    this.ai.set(animal.id, {
      homeX,
      homeY,
      dirX: dir.x,
      dirY: dir.y,
      moveTimer: 1.2 + Math.random() * 2.2,
      pauseTimer: 0,
      targetSessionId: null,
      attackReadyAt: 0,
    });
  }

  unregister(animalId: string): void {
    this.ai.delete(animalId);
  }

  /** Start (or refresh) combat against a player who hit this animal. */
  aggro(animalId: string, sessionId: string): void {
    const ai = this.ai.get(animalId);
    if (!ai) return;
    ai.targetSessionId = sessionId;
    ai.pauseTimer = 0;
  }

  clearAggroOnPlayer(sessionId: string): void {
    for (const ai of this.ai.values()) {
      if (ai.targetSessionId === sessionId) ai.targetSessionId = null;
    }
  }

  tick(
    animal: AnimalState,
    dt: number,
    now: number,
    blockers: readonly CircleBlocker[],
    players: Map<string, PlayerState>,
    bounds: PlayableBounds,
  ): void {
    const kind = animal.kind as CreatureKind;
    const config = CREATURE_KINDS[kind];
    if (!config) return;

    if (!animal.alive) {
      const ai = this.ai.get(animal.id);
      if (ai) ai.targetSessionId = null;
      // Corpses stay until looted / despawned; WorldRoom spawns a new living id.
      return;
    }

    const ai = this.ai.get(animal.id);
    if (!ai) return;

    const target = ai.targetSessionId
      ? players.get(ai.targetSessionId)
      : undefined;

    if (
      ai.targetSessionId &&
      (!target || target.hp <= 0 || target.mapId !== animal.mapId)
    ) {
      ai.targetSessionId = null;
    }

    if (target && target.hp > 0 && target.mapId === animal.mapId) {
      this.tickCombat(animal, ai, config, dt, now, blockers, target, bounds);
      return;
    }

    // Wander — stay clear of trees / props (not players).
    this.separateFromBlockers(animal, blockers, bounds);

    if (ai.pauseTimer > 0) {
      ai.pauseTimer -= dt;
      if (ai.pauseTimer <= 0) this.pickDirection(animal.id);
      return;
    }

    ai.moveTimer -= dt;
    if (ai.moveTimer <= 0) {
      ai.pauseTimer = 0.4 + Math.random() * 0.8;
      return;
    }

    const bodyR = CREATURE_COLLISION[kind] ?? 22;
    const distance = config.speed * dt;
    const nextX = animal.x + ai.dirX * distance;
    const nextY = animal.y + ai.dirY * distance;
    this.clampAndMove(animal, ai, nextX, nextY, bodyR, blockers, bounds);
  }

  private tickCombat(
    animal: AnimalState,
    ai: AiState,
    config: (typeof CREATURE_KINDS)[string],
    dt: number,
    now: number,
    blockers: readonly CircleBlocker[],
    target: PlayerState,
    bounds: PlayableBounds,
  ): void {
    const dx = target.x - animal.x;
    const dy = target.y - animal.y;
    const dist = Math.hypot(dx, dy);
    const loseAggro = config.aggroRange * 1.6;

    if (dist > loseAggro) {
      ai.targetSessionId = null;
      this.pickDirection(animal.id);
      return;
    }

    const kind = animal.kind as CreatureKind;
    const bodyR = CREATURE_COLLISION[kind] ?? 22;

    if (dist > config.attackRange * 0.85 && dist > 1e-3) {
      const distance = config.speed * 1.15 * dt;
      const nextX = animal.x + (dx / dist) * distance;
      const nextY = animal.y + (dy / dist) * distance;
      this.clampAndMove(animal, ai, nextX, nextY, bodyR, blockers, bounds);
    } else {
      this.separateFromBlockers(animal, blockers, bounds);
    }

    const distAfter = Math.hypot(target.x - animal.x, target.y - animal.y);
    if (distAfter <= config.attackRange && now >= ai.attackReadyAt) {
      // Worn gear soaks part of the hit; the number the player sees is the
      // post-mitigation one, so armor is legible without a combat log.
      const damage = mitigate(config.attackDamage, target.armor ?? 0);
      const dealt = Math.min(target.hp, damage);
      target.hp = Math.max(0, target.hp - damage);
      ai.attackReadyAt = now + config.attackCooldownMs;
      if (dealt > 0 && ai.targetSessionId) {
        this.onPlayerDamaged?.(ai.targetSessionId, dealt, animal.id);
      }
    }
  }

  private clampAndMove(
    animal: AnimalState,
    ai: AiState,
    nextX: number,
    nextY: number,
    bodyR: number,
    blockers: readonly CircleBlocker[],
    bounds: PlayableBounds,
  ): void {
    const { minX, maxX, minY, maxY } = bounds;

    if (nextX < minX || nextX > maxX) {
      ai.dirX *= -1;
      nextX = Math.min(maxX, Math.max(minX, nextX));
    }
    if (nextY < minY || nextY > maxY) {
      ai.dirY *= -1;
      nextY = Math.min(maxY, Math.max(minY, nextY));
    }

    const resolved = this.resolveMove(
      animal.x,
      animal.y,
      nextX,
      nextY,
      bodyR,
      blockers,
    );

    if (
      resolved.x === animal.x &&
      resolved.y === animal.y &&
      !ai.targetSessionId
    ) {
      ai.dirX *= -1;
      ai.dirY *= -1;
      if (ai.dirX === 0 && ai.dirY === 0) this.pickDirection(animal.id);
      return;
    }

    animal.x = resolved.x;
    animal.y = resolved.y;
  }

  private resolveMove(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    bodyR: number,
    blockers: readonly CircleBlocker[],
  ): { x: number; y: number } {
    if (!this.overlaps(toX, toY, bodyR, blockers)) {
      return { x: toX, y: toY };
    }
    if (!this.overlaps(toX, fromY, bodyR, blockers)) {
      return { x: toX, y: fromY };
    }
    if (!this.overlaps(fromX, toY, bodyR, blockers)) {
      return { x: fromX, y: toY };
    }
    return { x: fromX, y: fromY };
  }

  private overlaps(
    x: number,
    y: number,
    bodyR: number,
    blockers: readonly CircleBlocker[],
  ): boolean {
    for (const b of blockers) {
      if (Math.hypot(b.x - x, b.y - y) < b.radius + bodyR) return true;
    }
    return false;
  }

  private separateFromBlockers(
    animal: AnimalState,
    blockers: readonly CircleBlocker[],
    bounds: PlayableBounds,
  ): void {
    const kind = animal.kind as CreatureKind;
    const bodyR = CREATURE_COLLISION[kind] ?? 22;
    for (let i = 0; i < 8; i++) {
      let pushed = false;
      for (const b of blockers) {
        let dx = animal.x - b.x;
        let dy = animal.y - b.y;
        let dist = Math.hypot(dx, dy);
        const min = b.radius + bodyR;
        if (dist >= min) continue;
        if (dist < 1e-4) {
          dx = 1;
          dy = 0;
          dist = 1;
        }
        const push = (min - dist) / dist;
        animal.x += dx * push;
        animal.y += dy * push;
        pushed = true;
      }
      if (!pushed) break;
    }
    const { minX, maxX, minY, maxY } = bounds;
    animal.x = Math.min(maxX, Math.max(minX, animal.x));
    animal.y = Math.min(maxY, Math.max(minY, animal.y));
  }

  private pickDirection(id: string): void {
    const ai = this.ai.get(id);
    if (!ai) return;
    const next = CARDINAL[Math.floor(Math.random() * CARDINAL.length)]!;
    ai.dirX = next.x;
    ai.dirY = next.y;
    ai.moveTimer = 1.2 + Math.random() * 2.2;
  }
}
