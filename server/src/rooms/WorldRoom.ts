import { Room, Client } from "colyseus";
import {
  AnimalState,
  EquipmentSlotState,
  GameState,
  InventorySlotState,
  PickupState,
  PlayerState,
  ProfessionState,
  QuestState,
} from "../schema/GameState.js";
import { playerStore, type StoredPlayer } from "../playerStore.js";
import { authStore } from "../auth/authStore.js";
import {
  CREATURE_KINDS,
  DROP_PICKUP_DELAY_MS,
  PICKUP_RADIUS,
  SIM_INTERVAL_MS,
  type CreatureKind,
} from "../world/creatureConfig.js";
import {
  computeAttackPower,
  computeMoveSpeed,
  EQUIPMENT_SLOT_IDS,
  getClass,
} from "../world/classConfig.js";
import { AnimalAi, type CircleBlocker } from "../world/AnimalAi.js";
import {
  collidersFromMap,
  loadMap,
  type MapCircleCollider,
  type MapDocument,
} from "../maps/loadMap.js";
import {
  addItemToPlayer,
  moveInventorySlot,
  removeItemFromPlayer,
  takeFromSlot,
} from "../world/inventoryOps.js";
import {
  armorOf,
  attributeBonusOf,
  attackSpeedOf,
  damageMaxOf,
  damageMinOf,
  equipSlotOf,
} from "../world/armorConfig.js";
import {
  emptyItemData,
  createItemData,
  normalizeDurability,
  rollLootItem,
  type ItemInstanceData,
} from "../world/itemization.js";
import {
  ARMOR_DURABILITY_LOSS_PER_HIT,
  WEAPON_DURABILITY_LOSS_PER_ACTION,
  deathDurabilityLoss,
  isBroken,
  isRepairable,
  repairCost,
} from "../world/durabilityConfig.js";
import {
  ATTACK_COMMIT_GRACE,
  ATTACK_RANGE,
  attackCooldownMs,
  facingToward,
  rollDamageRange,
  type AttackFacing,
} from "../world/combatConfig.js";
import { inCone } from "../world/cone.js";
import {
  BAG_SLOT_COUNT,
  MAIN_BAG_INDEX,
  bagCapacity,
} from "../world/bagConfig.js";
import {
  buyPriceOf,
  getItemConfig,
  itemIdsMatch,
  sellPriceOf,
} from "../world/itemConfig.js";
import {
  awardProfessionExperience,
  getProfessionConfig,
  getProfessionRecipe,
  PROFESSIONS,
  professionXpForLevel,
} from "../world/professionConfig.js";
import { getQuestConfig, QUESTS } from "../world/questConfig.js";
import type { QuestProgressEvent } from "../world/questEvents.js";
import {
  getSkillConfig,
  skillDamageRange,
  skillUsableByClass,
} from "../world/skillConfig.js";
import { cloneShopStock, getNpcConfig } from "../world/npcConfig.js";
import {
  markCharacterOffline,
  markCharacterOnline,
} from "../world/onlineCharacters.js";
import {
  awardExperience,
  MAX_LEVEL,
  xpForLevel,
} from "../world/progression.js";
import {
  REGEN_OUT_OF_COMBAT_MS,
  REGEN_TICK_MS,
  regenHealAmount,
} from "../world/regenConfig.js";
import {
  DEATH_XP_PENALTY_RATE,
  RESPAWN_DELAY_MS,
  deathExperienceLoss,
} from "../world/deathConfig.js";

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

type WorldAuth = {
  accountId: string;
  characterId: string;
  characterName: string;
  classId: string;
};
type SavePayload = {
  x: number;
  y: number;
};
type MovePayload = { x?: number; y?: number };
type AttackPayload = { animalId?: string; x?: number; y?: number };
type CastSkillPayload = { skillId?: string; targetAnimalId?: string };
type CollectPayload = { pickupId?: string; x?: number; y?: number };
type LootCorpsePayload = {
  animalId?: string;
  slotIndex?: number;
  x?: number;
  y?: number;
};
type LootAllCorpsePayload = {
  animalId?: string;
  x?: number;
  y?: number;
};
type MoveInventorySlotPayload = {
  fromIndex?: number;
  toIndex?: number;
};
type DropPayload = {
  inventoryIndex?: number;
  x?: number;
  y?: number;
};
type UseItemPayload = { slotIndex?: number };
type EquipItemPayload = { inventoryIndex?: number; slotId?: string };
type UnequipItemPayload = { slotId?: string; inventoryIndex?: number };
type EquipBagPayload = { inventoryIndex?: number; bagIndex?: number };
type UnequipBagPayload = { bagIndex?: number; inventoryIndex?: number };
type BuyFromNpcPayload = {
  npcInstanceId?: string;
  itemId?: string;
  quantity?: number;
  x?: number;
  y?: number;
};
type SellToNpcPayload = {
  npcInstanceId?: string;
  inventoryIndex?: number;
  quantity?: number;
  x?: number;
  y?: number;
};
type RepairEquipmentPayload = {
  npcInstanceId?: string;
  slotId?: string;
  x?: number;
  y?: number;
};
type AllocateAttributePayload = { attr?: string };
type CraftRecipePayload = {
  recipeId?: string;
  quantity?: number;
  x?: number;
  y?: number;
};
type AcceptQuestPayload = { questId?: string };
type ClaimQuestRewardPayload = { questId?: string };

const ALLOCATABLE_ATTRS = [
  "strength",
  "agility",
  "stamina",
  "intellect",
  "spirit",
] as const;
type AllocatableAttr = (typeof ALLOCATABLE_ATTRS)[number];

function isAllocatableAttr(value: string): value is AllocatableAttr {
  return (ALLOCATABLE_ATTRS as readonly string[]).includes(value);
}

/** Floating combat text, sent only to the player involved in the exchange. */
type CombatTextEvent = {
  amount: number;
  target: "animal" | "player";
  animalId: string;
  kind?: "damage" | "heal";
};

const RECONNECT_SECONDS = 60;
/** Unlooted corpses are removed after this (replacement already uses spawn slots). */
const CORPSE_DESPAWN_MS = 90_000;
/** Must match client NPC_TALK_RANGE. */
const NPC_TALK_RANGE = 128;
/** Players must stand at a configured cooking node to craft. */
const COOKING_STATION_RANGE = 132;

type ItemSlotLike = {
  itemId: string;
  quantity: number;
  instanceId: string;
  rarity: string;
  affixesJson: string;
  durability: number;
  maxDurability: number;
};

function itemData(slot: ItemSlotLike): ItemInstanceData {
  return {
    itemId: slot.itemId,
    quantity: slot.quantity,
    instanceId: slot.instanceId,
    rarity: slot.rarity as ItemInstanceData["rarity"],
    affixesJson: slot.affixesJson,
    durability: slot.durability,
    maxDurability: slot.maxDurability,
  };
}

function writeItem(slot: ItemSlotLike, item: ItemInstanceData): void {
  slot.itemId = item.itemId;
  slot.quantity = item.quantity;
  slot.instanceId = item.instanceId;
  slot.rarity = item.rarity;
  slot.affixesJson = item.affixesJson;
  slot.durability = item.durability;
  slot.maxDurability = item.maxDurability;
}

function clearItem(slot: ItemSlotLike): void {
  writeItem(slot, emptyItemData());
}

interface AnimalSpawnSlot {
  kind: CreatureKind;
  homeX: number;
  homeY: number;
  /** Living animal occupying this slot; null while waiting to respawn. */
  livingId: string | null;
  /** Unix ms when a new living animal should spawn; 0 when occupied. */
  respawnAt: number;
}

export class WorldRoom extends Room {
  state = new GameState();
  seatReservationTimeout = 20;

  private readonly animalAi = new AnimalAi();
  private readonly spawnSlots: AnimalSpawnSlot[] = [];
  private animalSeq = 0;
  private pickupSeq = 0;
  private readonly corpseDespawnAt = new Map<string, number>();
  /** sessionId → unix ms when the next melee hit is allowed. */
  private readonly attackReadyAt = new Map<string, number>();
  /** `${sessionId}:${itemId}` → unix ms when the next use is allowed. */
  private readonly itemUseReadyAt = new Map<string, number>();
  /** `${sessionId}:${skillId}` → unix ms when the skill may be cast again. */
  private readonly skillReadyAt = new Map<string, number>();
  /** sessionId → next permitted craft timestamp (prevents message spam). */
  private readonly craftReadyAt = new Map<string, number>();
  /** sessionId → last time the player took creature damage. */
  private readonly lastDamageAt = new Map<string, number>();
  /** sessionId → last OOC regen tick. */
  private readonly lastRegenTickAt = new Map<string, number>();
  /** Sessions whose zero-HP transition has already paid the death penalty. */
  private readonly deadSessions = new Set<string>();
  /** Session → death time; used to enforce the short resurrection pause. */
  private readonly diedAt = new Map<string, number>();
  /** Player id → latest ordered PostgreSQL write for that character. */
  private readonly pendingPlayerSaves = new Map<string, Promise<void>>();
  private map!: MapDocument;
  private mapColliders: MapCircleCollider[] = [];
  /** npcInstanceId → itemId → remaining stock (infinite offers omitted). */
  private readonly shopStock = new Map<string, Map<string, number>>();

  onCreate(): void {
    this.maxClients = 50;
    this.patchRate = 50;
    this.map = loadMap();
    this.mapColliders = collidersFromMap(this.map);
    this.initShopStock();
    this.animalAi.setBounds(this.map.playable);
    this.animalAi.onPlayerDamaged = (sessionId, amount, animalId) => {
      this.lastDamageAt.set(sessionId, Date.now());
      const player = this.state.players.get(sessionId);
      if (player) this.damageArmorFromHit(player, sessionId);
      this.clients
        .find((c) => c.sessionId === sessionId)
        ?.send("combatText", {
          amount,
          target: "player",
          animalId,
          kind: "damage",
        } satisfies CombatTextEvent);
    };
    this.spawnAnimals();
    this.setSimulationInterval(
      (deltaTime) => this.tick(deltaTime),
      SIM_INTERVAL_MS,
    );
  }

  static async onAuth(token: string): Promise<WorldAuth> {
    if (!token) throw new Error("UNAUTHORIZED");
    const auth = await authStore.consumeGameTicket(token);
    if (!auth) throw new Error("UNAUTHORIZED");
    return auth;
  }

  async onJoin(client: Client): Promise<void> {
    const auth = client.auth as WorldAuth | undefined;
    if (!auth?.characterId) throw new Error("UNAUTHORIZED");
    const playerId = auth.characterId;
    markCharacterOnline(playerId);

    try {
      for (const [sessionId, existing] of this.state.players) {
        if (existing.playerId === playerId && sessionId !== client.sessionId) {
          this.persistPlayer(existing);
          await this.flushPlayerSave(existing.playerId);
          this.state.players.delete(sessionId);
          this.attackReadyAt.delete(sessionId);
          this.clearItemUseCooldowns(sessionId);
          this.clearSkillCooldowns(sessionId);
          this.craftReadyAt.delete(sessionId);
          this.deadSessions.delete(sessionId);
          this.diedAt.delete(sessionId);
        }
      }

      const saved = await playerStore.get(playerId);
      let record = saved;
      if (!record) {
        record = playerStore.createDefault(playerId, 0, 0, {
          name: auth.characterName,
          classId: auth.classId,
        });
        await playerStore.save(record);
      }
      const player = this.hydratePlayer(record, !saved);
      this.state.players.set(client.sessionId, player);
      if (player.hp <= 0) this.deadSessions.add(client.sessionId);
      client.userData = { playerId, accountId: auth.accountId };
    } catch (error) {
      markCharacterOffline(playerId);
      throw error;
    }
  }

  async onDrop(client: Client): Promise<void> {
    const player = this.state.players.get(client.sessionId);
    if (player) this.persistPlayer(player);
    if (player) await this.flushPlayerSave(player.playerId);
    await this.allowReconnection(client, RECONNECT_SECONDS);
  }

  async onLeave(client: Client): Promise<void> {
    const player = this.state.players.get(client.sessionId);
    if (player) {
      this.persistPlayer(player);
      await this.flushPlayerSave(player.playerId);
      this.state.players.delete(client.sessionId);
      markCharacterOffline(player.playerId);
    }
    this.attackReadyAt.delete(client.sessionId);
    this.lastDamageAt.delete(client.sessionId);
    this.lastRegenTickAt.delete(client.sessionId);
    this.clearItemUseCooldowns(client.sessionId);
    this.clearSkillCooldowns(client.sessionId);
    this.craftReadyAt.delete(client.sessionId);
    this.deadSessions.delete(client.sessionId);
    this.diedAt.delete(client.sessionId);
  }

  onDispose(): void {
    for (const player of this.state.players.values()) {
      markCharacterOffline(player.playerId);
    }
  }

  messages = {
    respawn: (client: Client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.hp > 0) return;

      const now = Date.now();
      const deathTime = this.diedAt.get(client.sessionId) ?? 0;
      if (deathTime > 0 && now < deathTime + RESPAWN_DELAY_MS) {
        client.send("notice", { kind: "respawn_too_soon" });
        return;
      }

      const home = this.nearestHome(player.x, player.y);
      player.x = home.x;
      player.y = home.y;
      player.hp = player.maxHp;
      player.isNew = false;
      this.deadSessions.delete(client.sessionId);
      this.diedAt.delete(client.sessionId);
      this.lastDamageAt.delete(client.sessionId);
      this.lastRegenTickAt.delete(client.sessionId);
      this.animalAi.clearAggroOnPlayer(client.sessionId);
      this.persistPlayer(player);

      client.send("playerRespawned", {
        homeId: home.id,
        homeName: home.name,
        x: home.x,
        y: home.y,
        hp: player.hp,
        maxHp: player.maxHp,
      });
    },

    save: (client: Client, data: SavePayload) => {
      const player = this.livingPlayer(client);
      if (!player || !data) return;

      if (typeof data.x === "number") player.x = data.x;
      if (typeof data.y === "number") player.y = data.y;

      // Inventory is server-authoritative (loot / buy / equip / moveInventorySlot).
      // Never apply client slot snapshots — a stale save between loot messages
      // used to wipe every item but the last one on "Zabierz wszystko".

      player.isNew = false;
      this.persistPlayer(player);
    },

    moveInventorySlot: (client: Client, data: MoveInventorySlotPayload) => {
      const player = this.livingPlayer(client);
      if (!player || !data) return;
      if (
        typeof data.fromIndex !== "number" ||
        typeof data.toIndex !== "number"
      ) {
        return;
      }
      if (!moveInventorySlot(player, data.fromIndex, data.toIndex)) return;
      player.isNew = false;
      this.persistPlayer(player);
    },

    /** Lightweight pose sync for collision — does not persist. */
    move: (client: Client, data: MovePayload) => {
      const player = this.livingPlayer(client);
      if (!player || !data) return;
      if (typeof data.x === "number") player.x = data.x;
      if (typeof data.y === "number") player.y = data.y;
    },

    attackAnimal: (client: Client, data: AttackPayload) => {
      const player = this.livingPlayer(client);
      if (!player || !data?.animalId) return;

      // Pose for range comes from move sync — do not trust attack payload coords.
      const animal = this.state.animals.get(data.animalId);
      if (!animal?.alive) return;

      const kind = animal.kind as CreatureKind;
      if (!CREATURE_KINDS[kind]) return;

      const now = Date.now();
      const readyAt = this.attackReadyAt.get(client.sessionId) ?? 0;
      if (now < readyAt) return;

      const dist = Math.hypot(animal.x - player.x, animal.y - player.y);
      if (dist > ATTACK_RANGE + ATTACK_COMMIT_GRACE) return;

      const cooldown = attackCooldownMs(this.weaponAttackSpeed(player));
      this.attackReadyAt.set(client.sessionId, now + cooldown);

      player.attackDir = facingToward(player.x, player.y, animal.x, animal.y);
      player.attackSeq = (player.attackSeq ?? 0) + 1;

      this.applyAnimalHit(
        client,
        player,
        animal,
        rollDamageRange(player.damageMin, player.damageMax),
      );
      this.damageWeaponFromAction(player, client.sessionId);
    },

    castSkill: (client: Client, data: CastSkillPayload) => {
      const player = this.livingPlayer(client);
      if (!player || typeof data?.skillId !== "string") return;

      const skill = getSkillConfig(data.skillId);
      if (!skill) return;
      if (!skillUsableByClass(skill, player.classId)) return;

      const targetId =
        typeof data.targetAnimalId === "string"
          ? data.targetAnimalId
          : undefined;
      const target = targetId ? this.state.animals.get(targetId) : undefined;

      if (skill.requiresTarget && !target?.alive) {
        client.send("notice", { kind: "no_target" });
        return;
      }

      if (skill.requiresTarget && target?.alive) {
        const dist = Math.hypot(target.x - player.x, target.y - player.y);
        // Small grace for pose sync lag (skill range is already generous vs melee).
        if (dist > skill.range + 24) {
          client.send("notice", { kind: "out_of_range" });
          return;
        }
      }

      const now = Date.now();
      const cdKey = `${client.sessionId}:${data.skillId}`;
      if (now < (this.skillReadyAt.get(cdKey) ?? 0)) return;
      this.skillReadyAt.set(cdKey, now + skill.cooldownMs);

      let aimX: number;
      let aimY: number;
      let dir: AttackFacing;

      if (target?.alive) {
        aimX = target.x;
        aimY = target.y;
        dir = facingToward(player.x, player.y, aimX, aimY);
      } else {
        dir = (player.attackDir as AttackFacing) || "down";
        const point = facingAimPoint(player.x, player.y, dir);
        aimX = point.x;
        aimY = point.y;
      }

      player.attackDir = dir;
      player.attackSeq = (player.attackSeq ?? 0) + 1;

      const weapon = this.equippedWeaponDamageRange(player);
      const skillRange = skillDamageRange(
        skill,
        player.strength + player.bonusStrength,
        weapon.min,
        weapon.max,
      );

      // Snapshot first — applying hits (death/loot) while iterating MapSchema
      // can skip siblings when two different animals are in the cone.
      const victims: AnimalState[] = [];
      for (const animal of this.state.animals.values()) {
        if (!animal.alive) continue;
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

      for (const animal of victims) {
        if (!animal.alive) continue;
        this.applyAnimalHit(
          client,
          player,
          animal,
          rollDamageRange(skillRange.min, skillRange.max),
        );
      }
      this.damageWeaponFromAction(player, client.sessionId);
    },

    useItem: (client: Client, data: UseItemPayload) => {
      const player = this.livingPlayer(client);
      if (!player) return;
      if (typeof data?.slotIndex !== "number") return;

      const slot = player.slots.at(data.slotIndex);
      if (!slot?.itemId || slot.quantity <= 0) return;

      const config = getItemConfig(slot.itemId);
      if (!config?.use) return;

      const now = Date.now();
      const cooldownKey = `${client.sessionId}:${slot.itemId}`;
      const readyAt = this.itemUseReadyAt.get(cooldownKey) ?? 0;
      if (now < readyAt) {
        client.send("notice", { kind: "item_on_cooldown" });
        return;
      }

      // Nothing to restore at full health — don't burn the item.
      if (config.use.heal > 0 && player.hp >= player.maxHp) {
        client.send("notice", { kind: "already_full_hp" });
        return;
      }

      const itemId = slot.itemId;
      if (config.use.heal > 0) {
        player.hp = Math.min(player.maxHp, player.hp + config.use.heal);
      }

      slot.quantity -= 1;
      if (slot.quantity <= 0) {
        clearItem(slot);
      }

      if (config.use.cooldownMs > 0) {
        this.itemUseReadyAt.set(cooldownKey, now + config.use.cooldownMs);
      }

      player.isNew = false;
      this.persistPlayer(player);

      client.send("itemUsed", {
        slotIndex: data.slotIndex,
        itemId,
        cooldownMs: config.use.cooldownMs,
      });
    },

    equipItem: (client: Client, data: EquipItemPayload) => {
      const player = this.livingPlayer(client);
      if (!player) return;
      if (typeof data?.inventoryIndex !== "number") return;
      if (typeof data?.slotId !== "string") return;

      const source = player.slots.at(data.inventoryIndex);
      if (!source?.itemId) return;

      // The item decides its own slot; the request only says which one to fill.
      const fits = equipSlotOf(source.itemId);
      if (!fits || fits !== data.slotId) return;

      const target = this.equipmentSlot(player, data.slotId);
      if (!target) return;

      // Straight swap: whatever was worn drops into the vacated bag slot.
      const previous = target.itemId;
      const previousData = itemData(target);
      writeItem(target, { ...itemData(source), quantity: 1 });
      writeItem(
        source,
        previous ? { ...previousData, quantity: 1 } : emptyItemData(),
      );

      this.recomputeGearStats(player);
      player.isNew = false;
      this.persistPlayer(player);
    },

    unequipItem: (client: Client, data: UnequipItemPayload) => {
      const player = this.livingPlayer(client);
      if (!player) return;
      if (typeof data?.slotId !== "string") return;

      const target = this.equipmentSlot(player, data.slotId);
      if (!target?.itemId) return;

      // Prefer the slot the player dropped it on, but only if it is free.
      let free = -1;
      const wanted = data.inventoryIndex;
      if (
        typeof wanted === "number" &&
        wanted >= 0 &&
        wanted < player.slots.length &&
        !player.slots.at(wanted)?.itemId
      ) {
        free = wanted;
      } else {
        for (let i = 0; i < player.slots.length; i++) {
          if (!player.slots.at(i)?.itemId) {
            free = i;
            break;
          }
        }
      }

      if (free < 0) {
        client.send("notice", { kind: "inventory_full" });
        return;
      }

      const slot = player.slots.at(free)!;
      writeItem(slot, { ...itemData(target), quantity: 1 });
      clearItem(target);

      this.recomputeGearStats(player);
      player.isNew = false;
      this.persistPlayer(player);
    },

    equipBag: (client: Client, data: EquipBagPayload) => {
      const player = this.livingPlayer(client);
      if (!player) return;
      if (typeof data?.inventoryIndex !== "number") return;
      if (typeof data?.bagIndex !== "number") return;
      if (data.bagIndex < 0 || data.bagIndex >= BAG_SLOT_COUNT) return;
      // Main backpack socket cannot be replaced or emptied.
      if (data.bagIndex === MAIN_BAG_INDEX) return;

      const socket = player.bags.at(data.bagIndex);
      const source = player.slots.at(data.inventoryIndex);
      if (!socket || !source?.itemId) return;

      const incoming = getItemConfig(source.itemId);
      if (!incoming || incoming.capacity <= 0) return;

      const outgoing = socket.itemId; // may be "" (empty socket)
      const newCapacity =
        player.slots.length + incoming.capacity - bagCapacity(outgoing);

      // Swapping a bag back into the shrinking region must stay addressable.
      if (outgoing && data.inventoryIndex >= newCapacity) return;
      if (!this.tailEmpty(player, newCapacity)) return;

      writeItem(
        source,
        outgoing ? emptyItemData(outgoing, 1) : emptyItemData(),
      );
      socket.itemId = incoming.id;
      socket.quantity = 1;
      this.resizeSlots(player, newCapacity);

      player.isNew = false;
      this.persistPlayer(player);
    },

    unequipBag: (client: Client, data: UnequipBagPayload) => {
      const player = this.livingPlayer(client);
      if (!player) return;
      if (typeof data?.bagIndex !== "number") return;
      if (data.bagIndex < 0 || data.bagIndex >= BAG_SLOT_COUNT) return;
      // Main backpack socket stays equipped permanently.
      if (data.bagIndex === MAIN_BAG_INDEX) return;

      const socket = player.bags.at(data.bagIndex);
      if (!socket?.itemId) return;

      const bagItemId = socket.itemId;
      const newCapacity = player.slots.length - bagCapacity(bagItemId);
      if (newCapacity < 0) return;
      if (!this.tailEmpty(player, newCapacity)) return;

      // Prefer the drop target; otherwise first empty slot in the shrinked bag.
      let free = -1;
      if (
        typeof data.inventoryIndex === "number" &&
        data.inventoryIndex >= 0 &&
        data.inventoryIndex < newCapacity
      ) {
        const target = player.slots.at(data.inventoryIndex);
        if (target && !target.itemId) free = data.inventoryIndex;
      }
      if (free < 0) {
        for (let i = 0; i < newCapacity; i++) {
          if (!player.slots.at(i)?.itemId) {
            free = i;
            break;
          }
        }
      }
      if (free < 0) return;

      socket.itemId = "";
      socket.quantity = 0;
      this.resizeSlots(player, newCapacity);
      const target = player.slots.at(free)!;
      writeItem(target, emptyItemData(bagItemId, 1));

      player.isNew = false;
      this.persistPlayer(player);
    },

    lootCorpse: (client: Client, data: LootCorpsePayload) => {
      const player = this.livingPlayer(client);
      if (!player || !data?.animalId) return;
      if (typeof data.slotIndex !== "number" || data.slotIndex < 0) return;

      if (typeof data.x === "number") player.x = data.x;
      if (typeof data.y === "number") player.y = data.y;

      const animal = this.state.animals.get(data.animalId);
      if (!animal || animal.alive) return;

      const dist = Math.hypot(animal.x - player.x, animal.y - player.y);
      if (dist > PICKUP_RADIUS + 16) return;

      const slot = animal.loot.at(data.slotIndex);
      if (!slot?.itemId || slot.quantity <= 0) return;

      const loot = itemData(slot);
      if (!addItemToPlayer(player, loot, player.slots.length)) {
        client.send("notice", { kind: "inventory_full" });
        return;
      }

      clearItem(slot);
      player.isNew = false;
      this.persistPlayer(player);

      if (this.isLootEmpty(animal)) {
        this.removeAnimal(animal.id);
      }
    },

    /** Take every corpse slot that fits; stop on first that does not. */
    lootAllCorpse: (client: Client, data: LootAllCorpsePayload) => {
      const player = this.livingPlayer(client);
      if (!player || !data?.animalId) return;

      if (typeof data.x === "number") player.x = data.x;
      if (typeof data.y === "number") player.y = data.y;

      const animal = this.state.animals.get(data.animalId);
      if (!animal || animal.alive) return;

      const dist = Math.hypot(animal.x - player.x, animal.y - player.y);
      if (dist > PICKUP_RADIUS + 16) return;

      let tookAny = false;
      let full = false;
      for (let i = 0; i < animal.loot.length; i++) {
        const slot = animal.loot.at(i);
        if (!slot?.itemId || slot.quantity <= 0) continue;

        const loot = itemData(slot);
        if (!addItemToPlayer(player, loot, player.slots.length)) {
          full = true;
          break;
        }
        clearItem(slot);
        tookAny = true;
      }

      if (tookAny) {
        player.isNew = false;
        this.persistPlayer(player);
      }
      if (full) {
        client.send("notice", { kind: "inventory_full" });
      }
      if (this.isLootEmpty(animal)) {
        this.removeAnimal(animal.id);
      }
    },

    collectPickup: (client: Client, data: CollectPayload) => {
      const player = this.livingPlayer(client);
      if (!player || !data?.pickupId) return;

      if (typeof data.x === "number") player.x = data.x;
      if (typeof data.y === "number") player.y = data.y;

      const pickup = this.state.pickups.get(data.pickupId);
      if (!pickup) return;
      if (Date.now() < pickup.collectableAt) return;

      const dist = Math.hypot(pickup.x - player.x, pickup.y - player.y);
      if (dist > PICKUP_RADIUS + 16) return;

      if (!addItemToPlayer(player, itemData(pickup), player.slots.length)) {
        client.send("notice", { kind: "inventory_full" });
        return;
      }

      this.state.pickups.delete(data.pickupId);
      player.isNew = false;
      this.persistPlayer(player);
    },

    dropItem: (client: Client, data: DropPayload) => {
      const player = this.livingPlayer(client);
      if (!player) return;
      if (typeof data.x !== "number" || typeof data.y !== "number") return;
      if (typeof data.inventoryIndex !== "number") return;
      const dropped = takeFromSlot(
        player,
        data.inventoryIndex,
        Number.MAX_SAFE_INTEGER,
      );
      if (!dropped) return;
      this.spawnPickup(
        dropped,
        data.x,
        data.y,
        Date.now() + DROP_PICKUP_DELAY_MS,
      );
      player.isNew = false;
      this.persistPlayer(player);
    },

    buyFromNpc: (client: Client, data: BuyFromNpcPayload) => {
      const player = this.livingPlayer(client);
      if (!player || !data?.npcInstanceId || !data.itemId) return;

      if (typeof data.x === "number") player.x = data.x;
      if (typeof data.y === "number") player.y = data.y;

      const placement = this.findNpc(data.npcInstanceId);
      if (!placement) return;
      if (!this.withinNpcRange(player, placement)) {
        client.send("notice", { kind: "too_far" });
        return;
      }

      const npc = getNpcConfig(placement.npcId);
      if (!npc) {
        client.send("notice", { kind: "shop_unavailable" });
        return;
      }
      const offer = npc.shop.find((row) => row.itemId === data.itemId);
      if (!offer) {
        client.send("notice", { kind: "shop_item_unavailable" });
        return;
      }

      const quantity =
        typeof data.quantity === "number" && data.quantity > 0
          ? Math.min(99, Math.floor(data.quantity))
          : 1;

      const unitPrice = buyPriceOf(data.itemId);
      if (unitPrice <= 0) {
        client.send("notice", { kind: "shop_item_unavailable" });
        return;
      }

      const stockMap = this.shopStock.get(placement.id);
      if (offer.stock >= 0) {
        const left = stockMap?.get(data.itemId) ?? 0;
        if (left < quantity) {
          client.send("notice", { kind: "out_of_stock" });
          return;
        }
      }

      const total = unitPrice * quantity;
      if (player.gold < total) {
        client.send("notice", { kind: "not_enough_gold" });
        return;
      }

      if (
        !addItemToPlayer(
          player,
          createItemData(data.itemId, quantity),
          player.slots.length,
        )
      ) {
        client.send("notice", { kind: "inventory_full" });
        return;
      }

      player.gold -= total;
      if (offer.stock >= 0 && stockMap) {
        stockMap.set(data.itemId, (stockMap.get(data.itemId) ?? 0) - quantity);
      }

      player.isNew = false;
      this.persistPlayer(player);
      client.send("tradeResult", {
        kind: "buy",
        itemId: data.itemId,
        quantity,
        goldSpent: total,
        gold: player.gold,
        stock: this.remainingStock(placement.id, data.itemId),
      });
    },

    sellToNpc: (client: Client, data: SellToNpcPayload) => {
      const player = this.livingPlayer(client);
      if (!player || !data?.npcInstanceId) return;
      if (typeof data.inventoryIndex !== "number") return;

      if (typeof data.x === "number") player.x = data.x;
      if (typeof data.y === "number") player.y = data.y;

      const placement = this.findNpc(data.npcInstanceId);
      if (!placement) return;
      if (!this.withinNpcRange(player, placement)) {
        client.send("notice", { kind: "too_far" });
        return;
      }

      // Only NPCs with a shop buy goods.
      const npc = getNpcConfig(placement.npcId);
      if (!npc || npc.shop.length === 0) {
        client.send("notice", { kind: "cannot_sell" });
        return;
      }

      const slot = player.slots.at(data.inventoryIndex);
      if (!slot?.itemId || slot.quantity <= 0) return;

      const unitPrice = sellPriceOf(slot.itemId);
      if (unitPrice <= 0) {
        client.send("notice", { kind: "cannot_sell" });
        return;
      }

      const quantity =
        typeof data.quantity === "number" && data.quantity > 0
          ? Math.min(slot.quantity, Math.floor(data.quantity))
          : slot.quantity;

      const taken = takeFromSlot(player, data.inventoryIndex, quantity);
      if (!taken) return;

      const goldEarned = unitPrice * taken.quantity;
      player.gold += goldEarned;
      player.isNew = false;
      this.persistPlayer(player);
      client.send("tradeResult", {
        kind: "sell",
        itemId: taken.itemId,
        quantity: taken.quantity,
        goldEarned,
        gold: player.gold,
      });
    },

    /** Repair one equipment slot or every damaged worn item at a repair NPC. */
    repairEquipment: (client: Client, data: RepairEquipmentPayload) => {
      const player = this.livingPlayer(client);
      if (!player || !data?.npcInstanceId) return;
      if (typeof data.x === "number") player.x = data.x;
      if (typeof data.y === "number") player.y = data.y;

      const placement = this.findNpc(data.npcInstanceId);
      if (!placement) return;
      if (!this.withinNpcRange(player, placement)) {
        client.send("notice", { kind: "too_far" });
        return;
      }
      const npc = getNpcConfig(placement.npcId);
      if (!npc?.repairService) {
        client.send("notice", { kind: "repair_unavailable" });
        return;
      }

      const candidates = data.slotId
        ? [this.equipmentSlot(player, data.slotId)].filter(
            (slot): slot is EquipmentSlotState => Boolean(slot),
          )
        : Array.from(player.equipment);
      const repairs = candidates.flatMap((slot) => {
        if (!slot.itemId || !isRepairable(slot.maxDurability)) return [];
        const item = getItemConfig(slot.itemId);
        if (!item || slot.durability >= slot.maxDurability) return [];
        const cost = repairCost(item, slot.durability, slot.maxDurability);
        return cost > 0 ? [{ slot, cost }] : [];
      });
      if (repairs.length === 0) {
        client.send("notice", { kind: "nothing_to_repair" });
        return;
      }
      const totalCost = repairs.reduce(
        (total, repair) => total + repair.cost,
        0,
      );
      if (player.gold < totalCost) {
        client.send("notice", { kind: "not_enough_gold" });
        return;
      }

      for (const { slot } of repairs) slot.durability = slot.maxDurability;
      player.gold -= totalCost;
      player.isNew = false;
      this.recomputeGearStats(player);
      this.persistPlayer(player);
      client.send("equipmentRepaired", {
        slotIds: repairs.map(({ slot }) => slot.slotId),
        totalCost,
        gold: player.gold,
      });
    },

    /** Spend one unspent attribute point into a primary stat. */
    allocateAttribute: (client: Client, data: AllocateAttributePayload) => {
      const player = this.livingPlayer(client);
      if (!player || !data?.attr || !isAllocatableAttr(data.attr)) return;
      if (player.unspentAttrPoints <= 0) return;

      const beforeMax = player.maxHp;
      player[data.attr] += 1;
      player.unspentAttrPoints -= 1;

      const attrs = {
        strength: player.strength,
        agility: player.agility,
        stamina: player.stamina,
        intellect: player.intellect,
        spirit: player.spirit,
      };
      const derived = playerStore.derived({
        classId: player.classId,
        attrs,
      });
      player.maxHp = derived.maxHp;
      player.hp = Math.min(
        player.maxHp,
        player.hp + Math.max(0, derived.maxHp - beforeMax),
      );
      this.recomputeGearStats(player);

      player.isNew = false;
      this.persistPlayer(player);
    },

    /** Server-authoritative profession craft: location, level, materials and bag space are checked here. */
    craftRecipe: (client: Client, data: CraftRecipePayload) => {
      const player = this.livingPlayer(client);
      if (!player || typeof data?.recipeId !== "string") return;
      const recipe = getProfessionRecipe(data.recipeId);
      if (!recipe) return;
      const profession = getProfessionConfig(recipe.professionId);
      if (!profession) return;

      if (typeof data.x === "number") player.x = data.x;
      if (typeof data.y === "number") player.y = data.y;
      if (!this.isAtCookingStation(player)) {
        client.send("notice", { kind: "cooking_station_required" });
        return;
      }

      const quantity = Math.min(
        20,
        Math.max(
          1,
          typeof data.quantity === "number" ? Math.floor(data.quantity) : 1,
        ),
      );
      const state = this.professionState(player, recipe.professionId);
      if (state.level < recipe.level) {
        client.send("notice", { kind: "profession_level_too_low" });
        return;
      }
      const now = Date.now();
      if (now < (this.craftReadyAt.get(client.sessionId) ?? 0)) return;

      const ingredients = recipe.ingredients.map((ingredient) => ({
        itemId: ingredient.itemId,
        quantity: ingredient.quantity * quantity,
      }));
      const output = emptyItemData(
        recipe.output.itemId,
        recipe.output.quantity * quantity,
      );
      if (!this.canFitCraftOutput(player, ingredients, output)) {
        client.send("notice", { kind: "inventory_full" });
        return;
      }
      if (
        !ingredients.every((ingredient) =>
          this.hasItemQuantity(player, ingredient.itemId, ingredient.quantity),
        )
      ) {
        client.send("notice", { kind: "missing_ingredients" });
        return;
      }

      // The fit check above makes this all-or-nothing sequence safe.
      for (const ingredient of ingredients) {
        if (
          !removeItemFromPlayer(player, ingredient.itemId, ingredient.quantity)
        )
          return;
      }
      if (!addItemToPlayer(player, output, player.slots.length)) return;

      this.craftReadyAt.set(client.sessionId, now + recipe.craftTimeMs);
      const gainedXp = recipe.xp * quantity;
      const result = awardProfessionExperience(profession, state, gainedXp);
      state.level = result.level;
      state.experience = result.experience;
      state.experienceToLevel = professionXpForLevel(profession, result.level);
      player.isNew = false;
      this.persistPlayer(player);
      client.send("professionCrafted", {
        professionId: recipe.professionId,
        recipeId: recipe.id,
        quantity,
        xp: gainedXp,
        levelsGained: result.levelsGained,
        level: state.level,
      });
      this.recordQuestEvent(client, player, {
        type: "craft",
        target: recipe.id,
        amount: quantity,
      });
    },

    /** Accepting a quest is always verified against its configured quest giver. */
    acceptQuest: (client: Client, data: AcceptQuestPayload) => {
      const player = this.livingPlayer(client);
      const quest = data?.questId ? getQuestConfig(data.questId) : null;
      if (!player || !quest || this.questState(player, quest.id)) return;
      if (!this.prerequisiteCompleted(player, quest.prerequisite)) {
        client.send("notice", { kind: "quest_prerequisite_missing" });
        return;
      }
      if (!quest.giverNpcId || !this.isNearNpcId(player, quest.giverNpcId)) {
        client.send("notice", { kind: "quest_giver_too_far" });
        return;
      }

      this.addQuest(player, quest.id);
      player.isNew = false;
      this.persistPlayer(player);
      client.send("questAccepted", { questId: quest.id });
    },

    /** Rewards are claimed once, at the configured NPC or world station. */
    claimQuestReward: (client: Client, data: ClaimQuestRewardPayload) => {
      const player = this.livingPlayer(client);
      if (!player || !data?.questId) return;
      const state = this.questState(player, data.questId);
      const quest = state ? getQuestConfig(state.questId) : null;
      if (!state || !quest || state.status !== "ready_to_claim") {
        return;
      }
      if (!this.isQuestTurnInReachable(player, quest)) {
        client.send("notice", { kind: "quest_turn_in_too_far" });
        return;
      }

      // Status changes before rewards: duplicate client messages cannot pay twice.
      state.status = "completed";
      player.gold += quest.rewards.gold;
      if (quest.rewards.experience > 0) {
        this.grantExperience(client, player, quest.rewards.experience);
      }
      this.ensureAvailableQuests(player);
      player.isNew = false;
      this.persistPlayer(player);
      client.send("questClaimed", {
        questId: quest.id,
        gold: quest.rewards.gold,
        experience: quest.rewards.experience,
      });
    },
  };

  /** Every gameplay message except resurrection is rejected at zero HP. */
  private livingPlayer(client: Client): PlayerState | null {
    const player = this.state.players.get(client.sessionId);
    return player && player.hp > 0 ? player : null;
  }

  /** Selects the closest configured settlement, falling back to map spawn. */
  private nearestHome(
    x: number,
    y: number,
  ): { id: string; name: string; x: number; y: number } {
    const fallback = {
      id: "map-spawn",
      name: "Najbliższe schronienie",
      x: this.map.spawns.player.x,
      y: this.map.spawns.player.y,
    };
    const homes = (this.map.homes ?? []).filter(
      (home) =>
        home.id &&
        home.name &&
        Number.isFinite(home.x) &&
        Number.isFinite(home.y),
    );
    if (homes.length === 0) return fallback;

    let closest = homes[0]!;
    let closestDistance = Math.hypot(closest.x - x, closest.y - y);
    for (let i = 1; i < homes.length; i++) {
      const candidate = homes[i]!;
      const distance = Math.hypot(candidate.x - x, candidate.y - y);
      if (distance >= closestDistance) continue;
      closest = candidate;
      closestDistance = distance;
    }
    return closest;
  }

  private tick(deltaTime: number): void {
    const dt = Math.min(deltaTime, 50) / 1000;
    const now = Date.now();
    this.processSpawnSlots(now);
    this.despawnExpiredCorpses(now);

    const blockers: CircleBlocker[] = this.mapColliders.map((c) => ({
      x: c.x,
      y: c.y,
      radius: c.radius,
    }));
    // Players are not solid — walking into a creature must not shove it around.
    // Combat still uses `state.players` for aggro / chase / attacks.
    for (const [, animal] of this.state.animals) {
      this.animalAi.tick(animal, dt, now, blockers, this.state.players);
    }
    this.tickPlayerRegen(now);
    this.resolvePlayerDeaths(now);
  }

  /** WoW-lite OOC regen: after delay without damage, heal on an interval. */
  private tickPlayerRegen(now: number): void {
    for (const [sessionId, player] of this.state.players) {
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

      this.clients
        .find((c) => c.sessionId === sessionId)
        ?.send("combatText", {
          amount: healed,
          target: "player",
          animalId: "",
          kind: "heal",
        } satisfies CombatTextEvent);
    }
  }

  /** Applies the penalty once and leaves the corpse in place until resurrection. */
  private resolvePlayerDeaths(now: number): void {
    for (const [sessionId, player] of this.state.players) {
      if (player.hp > 0) continue;
      if (this.deadSessions.has(sessionId)) continue;

      player.hp = 0;
      this.deadSessions.add(sessionId);
      this.diedAt.set(sessionId, now);
      this.animalAi.clearAggroOnPlayer(sessionId);
      this.attackReadyAt.delete(sessionId);
      this.clearItemUseCooldowns(sessionId);
      this.clearSkillCooldowns(sessionId);
      this.craftReadyAt.delete(sessionId);

      const lostExperience = deathExperienceLoss(
        player.experience,
        player.experienceToLevel,
      );
      player.experience = Math.max(0, player.experience - lostExperience);
      this.damageEquipmentOnDeath(player, sessionId);
      player.isNew = false;
      this.persistPlayer(player);

      const home = this.nearestHome(player.x, player.y);
      this.clients
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

  private processSpawnSlots(now: number): void {
    for (const slot of this.spawnSlots) {
      if (slot.livingId !== null) continue;
      if (slot.respawnAt <= 0 || now < slot.respawnAt) continue;
      this.spawnLivingAnimal(slot);
    }
  }

  private despawnExpiredCorpses(now: number): void {
    for (const [id, at] of this.corpseDespawnAt) {
      if (now < at) continue;
      const animal = this.state.animals.get(id);
      if (animal && !animal.alive) {
        this.removeAnimal(id);
      } else {
        this.corpseDespawnAt.delete(id);
      }
    }
  }

  private spawnAnimals(): void {
    for (const spawn of this.map.spawns.animals) {
      const kind = spawn.kind as CreatureKind;
      const slot: AnimalSpawnSlot = {
        kind,
        homeX: spawn.x,
        homeY: spawn.y,
        livingId: null,
        respawnAt: 0,
      };
      this.spawnSlots.push(slot);
      this.spawnLivingAnimal(slot, spawn.id);
    }
  }

  private spawnLivingAnimal(slot: AnimalSpawnSlot, preferredId?: string): void {
    const config = CREATURE_KINDS[slot.kind];
    const id = preferredId ?? `${slot.kind}-n${++this.animalSeq}`;
    const animal = new AnimalState();
    animal.id = id;
    animal.kind = slot.kind;
    animal.x = slot.homeX;
    animal.y = slot.homeY;
    animal.maxHp = config?.maxHp ?? 1;
    animal.hp = animal.maxHp;
    animal.alive = true;
    animal.respawnAt = 0;
    this.state.animals.set(id, animal);
    this.animalAi.register(animal, slot.homeX, slot.homeY);
    slot.livingId = id;
    slot.respawnAt = 0;
  }

  private removeAnimal(id: string): void {
    this.state.animals.delete(id);
    this.animalAi.unregister(id);
    this.corpseDespawnAt.delete(id);
  }

  private isLootEmpty(animal: AnimalState): boolean {
    for (const slot of animal.loot) {
      if (slot.itemId && slot.quantity > 0) return false;
    }
    return true;
  }

  private fillCorpseLoot(
    animal: AnimalState,
    loot: Array<{ itemId: string; quantity: number }>,
  ): void {
    while (animal.loot.length > 0) {
      animal.loot.pop();
    }
    for (const entry of loot) {
      if (!entry.itemId || entry.quantity <= 0) continue;
      const slot = new InventorySlotState();
      writeItem(slot, rollLootItem(entry.itemId, entry.quantity));
      animal.loot.push(slot);
    }
  }

  private spawnPickup(
    item: ItemInstanceData,
    x: number,
    y: number,
    collectableAt: number,
  ): void {
    const id = `pickup-${++this.pickupSeq}`;
    const pickup = new PickupState();
    pickup.id = id;
    writeItem(pickup, item);
    pickup.x = x;
    pickup.y = y;
    pickup.collectableAt = collectableAt;
    this.state.pickups.set(id, pickup);
  }

  private hydratePlayer(saved: StoredPlayer, isNew: boolean): PlayerState {
    const derived = playerStore.derived(saved);
    const player = new PlayerState();
    player.playerId = saved.playerId;
    player.name = saved.name;
    player.classId = saved.classId;
    player.level = saved.level;
    player.experience = saved.experience;
    player.experienceToLevel = xpForLevel(saved.level);
    player.x = saved.x;
    player.y = saved.y;
    player.strength = saved.attrs.strength;
    player.agility = saved.attrs.agility;
    player.stamina = saved.attrs.stamina;
    player.intellect = saved.attrs.intellect;
    player.spirit = saved.attrs.spirit;
    player.unspentAttrPoints = Math.max(0, saved.unspentAttrPoints ?? 0);
    player.maxHp = derived.maxHp;
    player.attackPower = derived.attackPower;
    player.damageMin = Math.max(1, derived.attackPower);
    player.damageMax = Math.max(1, derived.attackPower);
    player.moveSpeed = computeMoveSpeed(
      saved.level,
      getClass(saved.classId).derived,
    );
    player.hp =
      saved.hp <= 0 ? 0 : Math.min(Math.max(1, saved.hp), derived.maxHp);
    player.isNew = isNew;

    // rowToPlayer already sized slots to the capacity of the equipped bags.
    for (const source of saved.slots) {
      const slot = new InventorySlotState();
      writeItem(slot, {
        itemId: source?.itemId ?? "",
        quantity: source?.quantity ?? 0,
        instanceId: source?.instanceId ?? "",
        rarity: (source?.rarity ?? "common") as ItemInstanceData["rarity"],
        affixesJson: source?.affixesJson ?? "[]",
        ...normalizeDurability(
          source?.itemId ?? "",
          source?.durability,
          source?.maxDurability,
        ),
      });
      player.slots.push(slot);
    }

    for (let i = 0; i < BAG_SLOT_COUNT; i++) {
      const bag = new InventorySlotState();
      bag.itemId = saved.bags[i] ?? "";
      bag.quantity = bag.itemId ? 1 : 0;
      player.bags.push(bag);
    }

    // Create missing professions at rank 1 so additions to professions.yaml
    // become available automatically to existing characters.
    for (const profession of Object.values(PROFESSIONS)) {
      const stored = saved.professions[profession.id];
      const state = new ProfessionState();
      state.professionId = profession.id;
      state.level = Math.min(
        profession.maxLevel,
        Math.max(1, Math.floor(stored?.level ?? 1)),
      );
      state.experience = Math.max(0, Math.floor(stored?.experience ?? 0));
      state.experienceToLevel = professionXpForLevel(profession, state.level);
      player.professions.push(state);
    }

    for (const quest of Object.values(QUESTS)) {
      const stored = saved.quests[quest.id];
      if (!stored) continue;
      const state = new QuestState();
      state.questId = quest.id;
      state.definitionVersion = quest.version;
      const versionMatches = stored.definitionVersion === quest.version;
      state.status =
        stored.status === "completed"
          ? "completed"
          : versionMatches &&
              (stored.status === "ready_to_claim" ||
                stored.progress >= quest.objective.quantity)
            ? "ready_to_claim"
            : "active";
      state.progress = versionMatches
        ? Math.min(
            quest.objective.quantity,
            Math.max(0, Math.floor(stored.progress)),
          )
        : 0;
      player.quests.push(state);
    }
    this.ensureAvailableQuests(player);

    for (const slotId of EQUIPMENT_SLOT_IDS) {
      const slot = new EquipmentSlotState();
      slot.slotId = slotId;
      const source = saved.equipment[slotId];
      writeItem(slot, {
        itemId: source?.itemId ?? "",
        quantity: source?.quantity ?? 0,
        instanceId: source?.instanceId ?? "",
        rarity: (source?.rarity ?? "common") as ItemInstanceData["rarity"],
        affixesJson: source?.affixesJson ?? "[]",
        ...normalizeDurability(
          source?.itemId ?? "",
          source?.durability,
          source?.maxDurability,
        ),
      });
      player.equipment.push(slot);
    }

    this.recomputeGearStats(player);
    player.gold = Math.max(0, Math.floor(saved.gold ?? 0));
    return player;
  }

  /**
   * Armor + auto-attack damage range from class strength bonus and weapon min/max.
   * attackPower = average of the range (legacy displays).
   */
  private recomputeGearStats(player: PlayerState): void {
    const beforeMaxHp = player.maxHp;
    let armor = 0;
    let weaponMin = 0;
    let weaponMax = 0;
    for (const slot of player.equipment) {
      if (isBroken(slot.durability, slot.maxDurability)) continue;
      const itemId = slot.itemId ?? "";
      armor += armorOf(itemId, slot.affixesJson);
      weaponMin += damageMinOf(itemId, slot.affixesJson);
      weaponMax += damageMaxOf(itemId, slot.affixesJson);
    }
    player.armor = armor;

    const attrs = {
      strength: player.strength,
      agility: player.agility,
      stamina: player.stamina,
      intellect: player.intellect,
      spirit: player.spirit,
    };
    player.bonusStrength = 0;
    player.bonusAgility = 0;
    player.bonusStamina = 0;
    player.bonusIntellect = 0;
    player.bonusSpirit = 0;
    for (const slot of player.equipment) {
      if (isBroken(slot.durability, slot.maxDurability)) continue;
      player.bonusStrength += attributeBonusOf(slot.affixesJson, "strength");
      player.bonusAgility += attributeBonusOf(slot.affixesJson, "agility");
      player.bonusStamina += attributeBonusOf(slot.affixesJson, "stamina");
      player.bonusIntellect += attributeBonusOf(slot.affixesJson, "intellect");
      player.bonusSpirit += attributeBonusOf(slot.affixesJson, "spirit");
    }
    attrs.strength += player.bonusStrength;
    attrs.agility += player.bonusAgility;
    attrs.stamina += player.bonusStamina;
    attrs.intellect += player.bonusIntellect;
    attrs.spirit += player.bonusSpirit;
    const derived = getClass(player.classId).derived;
    player.maxHp = playerStore.derived({
      classId: player.classId,
      attrs,
    }).maxHp;
    player.hp = Math.min(
      player.maxHp,
      player.hp + Math.max(0, player.maxHp - beforeMaxHp),
    );
    const bonus = computeAttackPower(attrs, derived);
    const min = Math.max(1, bonus + weaponMin);
    const max = Math.max(min, bonus + weaponMax);
    player.damageMin = min;
    player.damageMax = max;
    player.attackPower = Math.floor((min + max) / 2);
  }

  /** Fastest equipped weapon attackSpeed (usually mainHand). */
  private weaponAttackSpeed(player: PlayerState): number {
    let best = 1;
    for (const slot of player.equipment) {
      if (isBroken(slot.durability, slot.maxDurability)) continue;
      const speed = attackSpeedOf(slot.itemId ?? "");
      if (speed > best) best = speed;
    }
    return best;
  }

  /** Sum of weapon damageMin/Max on equipped items. */
  private equippedWeaponDamageRange(player: PlayerState): {
    min: number;
    max: number;
  } {
    let min = 0;
    let max = 0;
    for (const slot of player.equipment) {
      if (isBroken(slot.durability, slot.maxDurability)) continue;
      const itemId = slot.itemId ?? "";
      min += damageMinOf(itemId, slot.affixesJson);
      max += damageMaxOf(itemId, slot.affixesJson);
    }
    return { min, max };
  }

  /** Apply wear to equipped weapons only once for an accepted player action. */
  private damageWeaponFromAction(player: PlayerState, sessionId: string): void {
    const weapons = Array.from(player.equipment).filter((slot) => {
      const item = getItemConfig(slot.itemId);
      return Boolean(
        item && item.damageMax > 0 && isRepairable(slot.maxDurability),
      );
    });
    this.applyDurabilityLoss(
      player,
      weapons,
      WEAPON_DURABILITY_LOSS_PER_ACTION,
      sessionId,
    );
  }

  /** A creature hit wears one eligible armor piece, avoiding punitive all-slot loss. */
  private damageArmorFromHit(player: PlayerState, sessionId: string): boolean {
    const armor = Array.from(player.equipment).filter((slot) => {
      const item = getItemConfig(slot.itemId);
      return Boolean(
        item && item.armor > 0 && isRepairable(slot.maxDurability),
      );
    });
    const chosen = armor[Math.floor(Math.random() * armor.length)];
    if (!chosen) return false;
    return this.applyDurabilityLoss(
      player,
      [chosen],
      ARMOR_DURABILITY_LOSS_PER_HIT,
      sessionId,
    );
  }

  /** Dying damages all repairable worn gear but never deletes it. */
  private damageEquipmentOnDeath(player: PlayerState, sessionId: string): void {
    const broken: string[] = [];
    let changed = false;
    for (const slot of player.equipment) {
      if (!isRepairable(slot.maxDurability) || slot.durability <= 0) continue;
      const before = slot.durability;
      slot.durability = Math.max(
        0,
        before - deathDurabilityLoss(slot.maxDurability),
      );
      changed ||= slot.durability !== before;
      if (before > 0 && slot.durability === 0) broken.push(slot.slotId);
    }
    if (!changed) return;
    this.recomputeGearStats(player);
    this.notifyBrokenEquipment(sessionId, broken);
  }

  private applyDurabilityLoss(
    player: PlayerState,
    slots: EquipmentSlotState[],
    amount: number,
    sessionId: string,
  ): boolean {
    const broken: string[] = [];
    let changed = false;
    for (const slot of slots) {
      if (slot.durability <= 0 || slot.maxDurability <= 0) continue;
      const before = slot.durability;
      slot.durability = Math.max(0, before - Math.max(1, Math.floor(amount)));
      changed ||= slot.durability !== before;
      if (before > 0 && slot.durability === 0) broken.push(slot.slotId);
    }
    if (!changed) return false;
    this.recomputeGearStats(player);
    player.isNew = false;
    this.persistPlayer(player);
    this.notifyBrokenEquipment(sessionId, broken);
    return true;
  }

  private notifyBrokenEquipment(sessionId: string, slotIds: string[]): void {
    if (slotIds.length === 0) return;
    this.clients
      .find((client) => client.sessionId === sessionId)
      ?.send("equipmentBroken", { slotIds });
  }

  private equipmentSlot(
    player: PlayerState,
    slotId: string,
  ): EquipmentSlotState | null {
    for (const slot of player.equipment) {
      if (slot.slotId === slotId) return slot;
    }
    return null;
  }

  /** True when every slot at index >= capacity is empty. */
  private tailEmpty(player: PlayerState, capacity: number): boolean {
    for (let i = capacity; i < player.slots.length; i++) {
      if (player.slots.at(i)?.itemId) return false;
    }
    return true;
  }

  /** Grows with empties / trims the (verified empty) tail to `capacity`. */
  private resizeSlots(player: PlayerState, capacity: number): void {
    while (player.slots.length < capacity) {
      player.slots.push(new InventorySlotState());
    }
    while (player.slots.length > capacity) {
      player.slots.pop();
    }
  }

  /**
   * Banks kill XP and applies any level-ups. Attributes are not auto-raised —
   * free points are banked for the character panel (`allocateAttribute`).
   */
  private grantExperience(
    client: Client,
    player: PlayerState,
    amount: number,
    source?: { kind: string; animalId: string },
  ): void {
    if (amount <= 0) return;

    const before = { maxHp: player.maxHp, level: player.level };
    const result = awardExperience(
      {
        level: player.level,
        experience: player.experience,
        attrs: {
          strength: player.strength,
          agility: player.agility,
          stamina: player.stamina,
          intellect: player.intellect,
          spirit: player.spirit,
        },
      },
      amount,
    );

    player.level = result.level;
    player.experience = result.experience;
    player.experienceToLevel = xpForLevel(result.level);
    player.moveSpeed = computeMoveSpeed(
      result.level,
      getClass(player.classId).derived,
    );

    if (result.attrPointsGained > 0) {
      player.unspentAttrPoints =
        Math.max(0, player.unspentAttrPoints) + result.attrPointsGained;
    }

    if (result.levelsGained > 0) {
      // Classic MMO feel: level-up restores the full health bar.
      player.hp = player.maxHp;

      client.send("levelUp", {
        level: player.level,
        from: before.level,
        maxHp: player.maxHp,
        attackPower: player.attackPower,
        moveSpeed: player.moveSpeed,
        attrPointsGained: result.attrPointsGained,
        unspentAttrPoints: player.unspentAttrPoints,
      });
    }

    if (before.level < MAX_LEVEL) {
      client.send("xpGain", {
        amount,
        kind: source?.kind ?? "",
        animalId: source?.animalId ?? "",
      });
    }

    player.isNew = false;
    this.persistPlayer(player);
  }

  private persistPlayer(player: PlayerState): void {
    const equipment: StoredPlayer["equipment"] = {};
    for (const slotId of EQUIPMENT_SLOT_IDS) {
      equipment[slotId] = {
        itemId: "",
        quantity: 0,
        instanceId: "",
        rarity: "common",
        affixesJson: "[]",
        durability: 0,
        maxDurability: 0,
      };
    }
    for (const slot of player.equipment) {
      if (!slot.slotId) continue;
      equipment[slot.slotId] = {
        itemId: slot.itemId ?? "",
        quantity: slot.quantity ?? 0,
        instanceId: slot.instanceId ?? "",
        rarity: slot.rarity ?? "common",
        affixesJson: slot.affixesJson ?? "[]",
        durability: slot.durability ?? 0,
        maxDurability: slot.maxDurability ?? 0,
      };
    }

    const record: StoredPlayer = {
      playerId: player.playerId,
      name: player.name,
      classId: player.classId,
      level: player.level,
      experience: player.experience,
      x: player.x,
      y: player.y,
      hp: player.hp,
      attrs: {
        strength: player.strength,
        agility: player.agility,
        stamina: player.stamina,
        intellect: player.intellect,
        spirit: player.spirit,
      },
      slots: Array.from({ length: player.slots.length }, (_, i) => {
        const slot = player.slots.at(i);
        return {
          itemId: slot?.itemId ?? "",
          quantity: slot?.quantity ?? 0,
          instanceId: slot?.instanceId ?? "",
          rarity: slot?.rarity ?? "common",
          affixesJson: slot?.affixesJson ?? "[]",
          durability: slot?.durability ?? 0,
          maxDurability: slot?.maxDurability ?? 0,
        };
      }),
      equipment,
      bags: Array.from(
        { length: BAG_SLOT_COUNT },
        (_, i) => player.bags.at(i)?.itemId ?? "",
      ),
      gold: Math.max(0, Math.floor(player.gold)),
      unspentAttrPoints: Math.max(0, Math.floor(player.unspentAttrPoints)),
      professions: Array.from(player.professions).reduce<
        StoredPlayer["professions"]
      >((all, profession) => {
        if (!profession.professionId) return all;
        all[profession.professionId] = {
          level: Math.max(1, Math.floor(profession.level)),
          experience: Math.max(0, Math.floor(profession.experience)),
        };
        return all;
      }, {}),
      quests: Array.from(player.quests).reduce<StoredPlayer["quests"]>(
        (all, quest) => {
          if (!quest.questId) return all;
          all[quest.questId] = {
            status:
              quest.status === "completed"
                ? "completed"
                : quest.status === "ready_to_claim"
                  ? "ready_to_claim"
                  : "active",
            progress: Math.max(0, Math.floor(quest.progress)),
            definitionVersion: Math.max(1, Math.floor(quest.definitionVersion)),
          };
          return all;
        },
        {},
      ),
    };

    const previous =
      this.pendingPlayerSaves.get(player.playerId) ?? Promise.resolve();
    const pending = previous
      .catch(() => undefined)
      .then(() => playerStore.save(record));
    this.pendingPlayerSaves.set(player.playerId, pending);
    void pending.catch((error: unknown) => {
      console.error(`[playerStore] failed to save ${player.playerId}`, error);
    });
  }

  private async flushPlayerSave(playerId: string): Promise<void> {
    const pending = this.pendingPlayerSaves.get(playerId);
    if (!pending) return;
    await pending;
    if (this.pendingPlayerSaves.get(playerId) === pending) {
      this.pendingPlayerSaves.delete(playerId);
    }
  }

  private professionState(
    player: PlayerState,
    professionId: string,
  ): ProfessionState {
    for (const state of player.professions) {
      if (state.professionId === professionId) return state;
    }
    const config = getProfessionConfig(professionId);
    const state = new ProfessionState();
    state.professionId = professionId;
    state.level = 1;
    state.experience = 0;
    state.experienceToLevel = config ? professionXpForLevel(config, 1) : 0;
    player.professions.push(state);
    return state;
  }

  /** Adds configured auto-start quests once their prerequisite is claimed. */
  private ensureAvailableQuests(player: PlayerState): void {
    let added = true;
    while (added) {
      added = false;
      for (const quest of Object.values(QUESTS)) {
        if (this.questState(player, quest.id)) continue;
        if (!quest.autoStart) continue;
        if (!this.prerequisiteCompleted(player, quest.prerequisite)) continue;
        this.addQuest(player, quest.id);
        added = true;
      }
    }
  }

  private questState(player: PlayerState, questId: string): QuestState | null {
    for (const state of player.quests) {
      if (state.questId === questId) return state;
    }
    return null;
  }

  private addQuest(player: PlayerState, questId: string): QuestState {
    const quest = getQuestConfig(questId);
    const state = new QuestState();
    state.questId = questId;
    state.definitionVersion = quest?.version ?? 1;
    state.status = "active";
    state.progress = 0;
    player.quests.push(state);
    return state;
  }

  private prerequisiteCompleted(
    player: PlayerState,
    prerequisite?: string,
  ): boolean {
    return (
      prerequisite === undefined ||
      this.questState(player, prerequisite)?.status === "completed"
    );
  }

  /** Routes one trusted gameplay event through all matching active objectives. */
  private recordQuestEvent(
    client: Client,
    player: PlayerState,
    event: QuestProgressEvent,
  ): void {
    const delta = Math.max(1, Math.floor(event.amount ?? 1));
    let changed = false;

    for (const state of player.quests) {
      if (state.status !== "active") continue;
      const quest = getQuestConfig(state.questId);
      if (
        !quest ||
        quest.objective.type !== event.type ||
        quest.objective.target !== event.target
      ) {
        continue;
      }

      const before = state.progress;
      state.progress = Math.min(quest.objective.quantity, before + delta);
      if (state.progress === before) continue;
      changed = true;

      if (state.progress < quest.objective.quantity) continue;
      state.status = "ready_to_claim";
      client.send("questReady", {
        questId: quest.id,
      });
    }

    if (!changed) return;
    player.isNew = false;
    this.persistPlayer(player);
  }

  private isAtCookingStation(player: PlayerState): boolean {
    return (this.map.cookingStations ?? []).some(
      (station) =>
        Math.hypot(player.x - station.x, player.y - station.y) <=
        Math.max(1, station.radius ?? COOKING_STATION_RANGE),
    );
  }

  private hasItemQuantity(
    player: PlayerState,
    itemId: string,
    quantity: number,
  ): boolean {
    let found = 0;
    for (const slot of player.slots) {
      if (slot.itemId && itemIdsMatch(slot.itemId, itemId))
        found += slot.quantity;
    }
    return found >= quantity;
  }

  /** Simulates removing ingredients before checking output stack capacity. */
  private canFitCraftOutput(
    player: PlayerState,
    ingredients: Array<{ itemId: string; quantity: number }>,
    output: ItemInstanceData,
  ): boolean {
    const slots = Array.from(player.slots, (slot) => ({
      itemId: slot.itemId,
      quantity: slot.quantity,
      instanceId: slot.instanceId,
      rarity: slot.rarity,
      affixesJson: slot.affixesJson,
    }));
    for (const ingredient of ingredients) {
      let remaining = ingredient.quantity;
      for (const slot of slots) {
        if (!slot.itemId || !itemIdsMatch(slot.itemId, ingredient.itemId))
          continue;
        const taken = Math.min(slot.quantity, remaining);
        slot.quantity -= taken;
        remaining -= taken;
        if (slot.quantity <= 0) {
          slot.itemId = "";
          slot.quantity = 0;
          slot.instanceId = "";
          slot.rarity = "common";
          slot.affixesJson = "[]";
        }
        if (remaining <= 0) break;
      }
      if (remaining > 0) return false;
    }

    const config = getItemConfig(output.itemId);
    const maxStack = config?.stackable ? config.maxStack : 1;
    let space = 0;
    for (const slot of slots) {
      if (!slot.itemId) {
        space += maxStack;
      } else if (
        maxStack > 1 &&
        itemIdsMatch(slot.itemId, output.itemId) &&
        !slot.instanceId &&
        slot.rarity === "common" &&
        slot.affixesJson === "[]"
      ) {
        space += Math.max(0, maxStack - slot.quantity);
      }
    }
    return space >= output.quantity;
  }

  private initShopStock(): void {
    this.shopStock.clear();
    for (const placement of this.map.npcs ?? []) {
      this.shopStock.set(placement.id, cloneShopStock(placement.npcId));
    }
  }

  private clearItemUseCooldowns(sessionId: string): void {
    const prefix = `${sessionId}:`;
    for (const key of this.itemUseReadyAt.keys()) {
      if (key.startsWith(prefix)) this.itemUseReadyAt.delete(key);
    }
  }

  private clearSkillCooldowns(sessionId: string): void {
    const prefix = `${sessionId}:`;
    for (const key of this.skillReadyAt.keys()) {
      if (key.startsWith(prefix)) this.skillReadyAt.delete(key);
    }
  }

  /** Apply HP / aggro / FCT / death — no range or cooldown checks. */
  private applyAnimalHit(
    client: Client,
    player: PlayerState,
    animal: AnimalState,
    damage: number,
  ): void {
    const kind = animal.kind as CreatureKind;
    const config = CREATURE_KINDS[kind];
    if (!config || !animal.alive) return;

    const dealt = Math.min(animal.hp, damage);
    animal.hp = Math.max(0, animal.hp - damage);
    this.animalAi.aggro(animal.id, client.sessionId);

    client.send("combatText", {
      amount: dealt,
      target: "animal",
      animalId: animal.id,
    } satisfies CombatTextEvent);

    if (animal.hp > 0) return;

    animal.alive = false;
    animal.respawnAt = 0;
    this.fillCorpseLoot(animal, config.loot);
    this.corpseDespawnAt.set(animal.id, Date.now() + CORPSE_DESPAWN_MS);

    this.grantExperience(client, player, config.xp, {
      kind: animal.kind,
      animalId: animal.id,
    });
    this.recordQuestEvent(client, player, {
      type: "kill",
      target: animal.kind,
    });

    const slot = this.spawnSlots.find((s) => s.livingId === animal.id);
    if (slot) {
      slot.livingId = null;
      slot.respawnAt = Date.now() + config.respawnMs;
    }
  }

  private findNpc(instanceId: string) {
    return (this.map.npcs ?? []).find((n) => n.id === instanceId) ?? null;
  }

  private withinNpcRange(
    player: PlayerState,
    npc: { x: number; y: number },
  ): boolean {
    return Math.hypot(npc.x - player.x, npc.y - player.y) <= NPC_TALK_RANGE;
  }

  private isNearNpcId(player: PlayerState, npcId: string): boolean {
    return (this.map.npcs ?? []).some(
      (npc) => npc.npcId === npcId && this.withinNpcRange(player, npc),
    );
  }

  private isQuestTurnInReachable(
    player: PlayerState,
    quest: NonNullable<ReturnType<typeof getQuestConfig>>,
  ): boolean {
    if (quest.turnIn.kind === "npc") {
      return this.isNearNpcId(player, quest.turnIn.target);
    }
    const station = (this.map.cookingStations ?? []).find(
      (candidate) => candidate.id === quest.turnIn.target,
    );
    return (
      station !== undefined &&
      Math.hypot(player.x - station.x, player.y - station.y) <=
        Math.max(1, station.radius ?? COOKING_STATION_RANGE)
    );
  }

  private remainingStock(instanceId: string, itemId: string): number {
    const npcPlacement = this.findNpc(instanceId);
    if (!npcPlacement) return 0;
    const offer = getNpcConfig(npcPlacement.npcId)?.shop.find(
      (row) => row.itemId === itemId,
    );
    if (!offer) return 0;
    if (offer.stock < 0) return -1;
    return this.shopStock.get(instanceId)?.get(itemId) ?? 0;
  }
}
