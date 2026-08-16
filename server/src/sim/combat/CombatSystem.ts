import type { Client } from "colyseus";
import {
  CREATURE_KINDS,
  type CreatureKind,
} from "../../content/creatureConfig.js";
import {
  getSkillConfig,
  skillDamageRange,
  skillUsableByClass,
} from "../../content/skillConfig.js";
import { inCone } from "@mmo/shared/combat/cone";
import {
  ATTACK_COMMIT_GRACE,
  ATTACK_RANGE,
  attackCooldownMs,
  facingToward,
  rollDamageRange,
  type AttackFacing,
} from "../combatConfig.js";
import {
  RAGE_DECAY_DELAY_MS,
  RAGE_DECAY_PER_SEC,
  RAGE_ON_AUTO_ATTACK,
  RAGE_ON_SKILL_HIT,
  clampResource,
  maxResourceFor,
  parseResourceKind,
  type ResourceKind,
} from "../resourceConfig.js";
import {
  REGEN_OUT_OF_COMBAT_MS,
  REGEN_TICK_MS,
  regenHealAmount,
} from "../regenConfig.js";
import {
  DEATH_XP_PENALTY_RATE,
  RESPAWN_DELAY_MS,
  deathExperienceLoss,
} from "../deathConfig.js";
import type { AnimalState, PlayerState } from "../../schema/GameState.js";
import type { WorldHost } from "../WorldHost.js";

type CombatTextEvent = {
  amount: number;
  target: "animal" | "player";
  animalId: string;
  kind?: "damage" | "heal";
  creatureKind?: string;
  killed?: boolean;
};

function facingAimPoint(
  x: number,
  y: number,
  dir: AttackFacing | string,
): { x: number; y: number } {
  const d = 100;
  switch (dir) {
    case "up":
      return { x, y: y - d };
    case "down":
      return { x, y: y + d };
    case "left":
      return { x: x - d, y };
    default:
      return { x: x + d, y };
  }
}

export class CombatSystem {
  readonly attackReadyAt = new Map<string, number>();
  readonly skillReadyAt = new Map<string, number>();
  readonly lastDamageAt = new Map<string, number>();
  readonly lastRageCombatAt = new Map<string, number>();
  readonly lastRageDecayAt = new Map<string, number>();
  readonly rageDecayCarry = new Map<string, number>();
  readonly lastRegenTickAt = new Map<string, number>();
  readonly deadSessions = new Set<string>();
  readonly diedAt = new Map<string, number>();

  constructor(private readonly host: WorldHost) {}

  clearSession(sessionId: string): void {
    this.attackReadyAt.delete(sessionId);
    this.lastDamageAt.delete(sessionId);
    this.lastRageCombatAt.delete(sessionId);
    this.lastRageDecayAt.delete(sessionId);
    this.rageDecayCarry.delete(sessionId);
    this.lastRegenTickAt.delete(sessionId);
    this.clearSkillCooldowns(sessionId);
    this.deadSessions.delete(sessionId);
    this.diedAt.delete(sessionId);
  }

  clearSkillCooldowns(sessionId: string): void {
    const prefix = `${sessionId}:`;
    for (const key of this.skillReadyAt.keys()) {
      if (key.startsWith(prefix)) this.skillReadyAt.delete(key);
    }
  }

  noteDamage(sessionId: string): void {
    this.lastDamageAt.set(sessionId, Date.now());
  }

  gainResource(player: PlayerState, sessionId: string, amount: number): void {
    const kind = parseResourceKind(player.resourceKind) as ResourceKind;
    if (kind !== "rage" || amount <= 0) return;
    if (player.hp <= 0) return;

    const max = Math.max(0, player.maxResource || maxResourceFor(kind));
    const next = clampResource(player.resource + amount, max);
    if (next === player.resource) {
      this.lastRageCombatAt.set(sessionId, Date.now());
      return;
    }
    player.resource = next;
    this.lastRageCombatAt.set(sessionId, Date.now());
    this.lastRageDecayAt.delete(sessionId);
    this.rageDecayCarry.delete(sessionId);
  }

  trySpendResource(
    player: PlayerState,
    sessionId: string,
    cost: number,
  ): boolean {
    const need = Math.max(0, Math.floor(cost));
    if (need <= 0) return true;
    const kind = parseResourceKind(player.resourceKind);
    if (kind === "none") return need <= 0;
    if (player.resource < need) return false;
    player.resource = clampResource(player.resource - need, player.maxResource);
    if (kind === "rage") {
      this.lastRageCombatAt.set(sessionId, Date.now());
      this.lastRageDecayAt.delete(sessionId);
      this.rageDecayCarry.delete(sessionId);
    }
    return true;
  }

  clearResource(player: PlayerState, sessionId: string): void {
    if (player.resource !== 0) player.resource = 0;
    this.lastRageCombatAt.delete(sessionId);
    this.lastRageDecayAt.delete(sessionId);
    this.rageDecayCarry.delete(sessionId);
  }

  handleAttack(
    client: Client,
    data: { animalId?: string; x?: number; y?: number },
  ): void {
    const player = this.host.livingPlayer(client);
    if (!player || !data?.animalId) return;

    const animal = this.host.state.animals.get(data.animalId);
    if (!animal?.alive || animal.mapId !== player.mapId) return;

    const kind = animal.kind as CreatureKind;
    if (!CREATURE_KINDS[kind]) return;

    const now = Date.now();
    const readyAt = this.attackReadyAt.get(client.sessionId) ?? 0;
    if (now < readyAt) return;

    const dist = Math.hypot(animal.x - player.x, animal.y - player.y);
    if (dist > ATTACK_RANGE + ATTACK_COMMIT_GRACE) return;

    const cooldown = attackCooldownMs(this.host.weaponAttackSpeed(player));
    this.attackReadyAt.set(client.sessionId, now + cooldown);

    player.attackDir = facingToward(player.x, player.y, animal.x, animal.y);
    player.attackSeq = (player.attackSeq ?? 0) + 1;

    this.host.applyAnimalHit(
      client,
      player,
      animal,
      rollDamageRange(player.damageMin, player.damageMax),
    );
    this.gainResource(player, client.sessionId, RAGE_ON_AUTO_ATTACK);
    this.host.damageWeaponFromAction(player, client.sessionId);
  }

  handleCastSkill(
    client: Client,
    data: { skillId?: string; targetAnimalId?: string },
  ): void {
    const player = this.host.livingPlayer(client);
    if (!player || typeof data?.skillId !== "string") return;

    const skill = getSkillConfig(data.skillId);
    if (!skill) return;
    if (!skillUsableByClass(skill, player.classId)) return;

    const targetId =
      typeof data.targetAnimalId === "string" ? data.targetAnimalId : undefined;
    const target = targetId ? this.host.state.animals.get(targetId) : undefined;
    const localTarget = target?.mapId === player.mapId ? target : undefined;

    if (skill.requiresTarget && !localTarget?.alive) {
      client.send("notice", { kind: "no_target" });
      return;
    }

    if (skill.requiresTarget && localTarget?.alive) {
      const dist = Math.hypot(
        localTarget.x - player.x,
        localTarget.y - player.y,
      );
      if (dist > skill.range + 24) {
        client.send("notice", { kind: "out_of_range" });
        return;
      }
    }

    const now = Date.now();
    const cdKey = `${client.sessionId}:${data.skillId}`;
    if (now < (this.skillReadyAt.get(cdKey) ?? 0)) return;

    if (!this.trySpendResource(player, client.sessionId, skill.resourceCost)) {
      client.send("notice", { kind: "not_enough_resource" });
      return;
    }

    this.skillReadyAt.set(cdKey, now + skill.cooldownMs);

    let aimX: number;
    let aimY: number;
    let dir: AttackFacing;

    if (localTarget?.alive) {
      aimX = localTarget.x;
      aimY = localTarget.y;
      dir = facingToward(player.x, player.y, aimX, aimY);
    } else {
      dir = (player.attackDir as AttackFacing) || "down";
      const point = facingAimPoint(player.x, player.y, dir);
      aimX = point.x;
      aimY = point.y;
    }

    player.attackDir = dir;
    player.attackSeq = (player.attackSeq ?? 0) + 1;

    const weapon = this.host.equippedWeaponDamageRange(player);
    const skillRange = skillDamageRange(
      skill,
      player.strength + player.bonusStrength,
      weapon.min,
      weapon.max,
    );

    const victims: AnimalState[] = [];
    for (const animal of this.host.state.animals.values()) {
      if (!animal.alive || animal.mapId !== player.mapId) continue;
      if (
        !inCone(
          player.x,
          player.y,
          aimX,
          aimY,
          animal.x,
          animal.y,
          skill.range,
          skill.coneDegrees,
        )
      ) {
        continue;
      }
      victims.push(animal);
    }

    let hitAny = false;
    for (const animal of victims) {
      if (!animal.alive) continue;
      hitAny = true;
      this.host.applyAnimalHit(
        client,
        player,
        animal,
        rollDamageRange(skillRange.min, skillRange.max),
      );
    }
    if (hitAny) {
      this.gainResource(player, client.sessionId, RAGE_ON_SKILL_HIT);
    }
    this.host.damageWeaponFromAction(player, client.sessionId);
  }

  handleRespawn(client: Client): void {
    const player = this.host.state.players.get(client.sessionId);
    if (!player || player.hp > 0) return;

    const now = Date.now();
    const deathTime = this.diedAt.get(client.sessionId) ?? 0;
    if (deathTime > 0 && now < deathTime + RESPAWN_DELAY_MS) {
      client.send("notice", { kind: "respawn_too_soon" });
      return;
    }

    const home = this.host.nearestHome(player, player.x, player.y);
    player.x = home.x;
    player.y = home.y;
    player.hp = player.maxHp;
    player.isNew = false;
    this.deadSessions.delete(client.sessionId);
    this.diedAt.delete(client.sessionId);
    this.lastDamageAt.delete(client.sessionId);
    this.lastRegenTickAt.delete(client.sessionId);
    this.host.animalAi.clearAggroOnPlayer(client.sessionId);
    this.host.persistPlayer(player);

    client.send("playerRespawned", {
      homeId: home.id,
      homeName: home.name,
      x: home.x,
      y: home.y,
      hp: player.hp,
      maxHp: player.maxHp,
    });
  }

  tickResourceDecay(now: number): void {
    for (const [sessionId, player] of this.host.state.players) {
      if (parseResourceKind(player.resourceKind) !== "rage") continue;
      if (player.resource <= 0 || player.hp <= 0) {
        this.rageDecayCarry.delete(sessionId);
        continue;
      }

      const lastCombat = this.lastRageCombatAt.get(sessionId) ?? 0;
      if (now - lastCombat < RAGE_DECAY_DELAY_MS) {
        this.rageDecayCarry.delete(sessionId);
        this.lastRageDecayAt.delete(sessionId);
        continue;
      }

      const lastTick = this.lastRageDecayAt.get(sessionId) ?? now;
      this.lastRageDecayAt.set(sessionId, now);
      const elapsedSec = Math.max(0, (now - lastTick) / 1000);
      if (elapsedSec <= 0) continue;

      const carry =
        (this.rageDecayCarry.get(sessionId) ?? 0) +
        elapsedSec * RAGE_DECAY_PER_SEC;
      const loss = Math.floor(carry);
      if (loss <= 0) {
        this.rageDecayCarry.set(sessionId, carry);
        continue;
      }

      this.rageDecayCarry.set(sessionId, carry - loss);
      player.resource = clampResource(
        player.resource - loss,
        player.maxResource,
      );
      if (player.resource <= 0) {
        this.rageDecayCarry.delete(sessionId);
        this.lastRageDecayAt.delete(sessionId);
      }
    }
  }

  tickPlayerRegen(now: number): void {
    for (const [sessionId, player] of this.host.state.players) {
      if (player.hp <= 0 || player.hp >= player.maxHp) continue;

      const lastHit = this.lastDamageAt.get(sessionId) ?? 0;
      if (now - lastHit < REGEN_OUT_OF_COMBAT_MS) continue;

      const lastTick = this.lastRegenTickAt.get(sessionId) ?? 0;
      const readyAt = Math.max(
        lastHit + REGEN_OUT_OF_COMBAT_MS,
        lastTick + REGEN_TICK_MS,
      );
      if (now < readyAt) continue;

      const amount = regenHealAmount(player.spirit, player.level);
      const before = player.hp;
      player.hp = Math.min(player.maxHp, player.hp + amount);
      const healed = player.hp - before;
      this.lastRegenTickAt.set(sessionId, now);
      if (healed <= 0) continue;

      this.host.clients
        .find((c) => c.sessionId === sessionId)
        ?.send("combatText", {
          amount: healed,
          target: "player",
          animalId: "",
          kind: "heal",
        } satisfies CombatTextEvent);
    }
  }

  resolvePlayerDeaths(
    now: number,
    onDeath: (sessionId: string, player: PlayerState) => void,
  ): void {
    for (const [sessionId, player] of this.host.state.players) {
      if (player.hp > 0) continue;
      if (this.deadSessions.has(sessionId)) continue;

      player.hp = 0;
      this.deadSessions.add(sessionId);
      this.diedAt.set(sessionId, now);
      this.host.animalAi.clearAggroOnPlayer(sessionId);
      this.attackReadyAt.delete(sessionId);
      this.clearSkillCooldowns(sessionId);
      this.clearResource(player, sessionId);
      onDeath(sessionId, player);

      const lostExperience = deathExperienceLoss(
        player.experience,
        player.experienceToLevel,
      );
      player.experience = Math.max(0, player.experience - lostExperience);
      player.isNew = false;
      this.host.persistPlayer(player);

      const home = this.host.nearestHome(player, player.x, player.y);
      this.host.clients
        .find((client) => client.sessionId === sessionId)
        ?.send("playerDied", {
          lostExperience,
          penaltyPercent: Math.round(DEATH_XP_PENALTY_RATE * 100),
          experience: player.experience,
          experienceToLevel: player.experienceToLevel,
          homeId: home.id,
          homeName: home.name,
          respawnDelayMs: RESPAWN_DELAY_MS,
        });
    }
  }
}
