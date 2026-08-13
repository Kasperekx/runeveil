import { Room, Client } from "colyseus";
import { StateView, type Schema } from "@colyseus/schema";
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
import { PLACEABLE_CAMPFIRE } from "../world/placeableCampfire.js";
import {
  collidersFromMap,
  knownMapIds,
  loadMapById,
  type MapCircleCollider,
  type MapDocument,
} from "../maps/loadMap.js";
import { findMapTransition, resolveMapArrival } from "../maps/mapTransition.js";
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
  canonicalItemId,
  getItemConfig,
  itemIdsMatch,
  sellPriceOf,
} from "../world/itemConfig.js";
import {
  awardProfessionExperience,
  getProfessionConfig,
  getProfessionGatherNode,
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
import {
  RAGE_DECAY_DELAY_MS,
  RAGE_DECAY_PER_SEC,
  RAGE_ON_AUTO_ATTACK,
  RAGE_ON_DAMAGE_TAKEN,
  RAGE_ON_SKILL_HIT,
  clampResource,
  maxResourceFor,
  parseResourceKind,
  type ResourceKind,
} from "../world/resourceConfig.js";
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
import { rollLootTable } from "../world/lootTable.js";

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
  source?: string;
  slotId?: string;
  inventoryIndex?: number;
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
type MineNodePayload = {
  nodeKey?: string;
  nodeId?: string;
  x?: number;
  y?: number;
};
type AcceptQuestPayload = { questId?: string };
type ClaimQuestRewardPayload = { questId?: string };
type MapTransitionPayload = { requestId?: string; targetMapId?: string };

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
  /** Creature catalog id when an animal is the other party. */
  creatureKind?: string;
  /** True when this hit reduced the animal to 0 HP. */
  killed?: boolean;
};

type ChatSayPayload = { text?: string };

type LootDroppedEvent = {
  creatureKind: string;
  animalId: string;
  items: Array<{ itemId: string; quantity: number }>;
};

type ChatMessageEvent = {
  playerId: string;
  name: string;
  text: string;
  mapId: string;
};

const CHAT_MAX_LEN = 120;
/** Sliding window: at most N say messages per window. */
const CHAT_RATE_LIMIT = 5;
const CHAT_RATE_WINDOW_MS = 10_000;
const CHAT_DUPLICATE_MS = 1_500;

const RECONNECT_SECONDS = 60;
/** Must match client NPC_TALK_RANGE. */
const NPC_TALK_RANGE = 128;
/** Players must stand at a configured cooking node to craft. */
const COOKING_STATION_RANGE = 132;
/** Default stand distance for mining props when the map omits activationRadius. */
const MINING_ACTIVATION_RANGE = 72;

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
  mapId: string;
  kind: CreatureKind;
  homeX: number;
  homeY: number;
  /** Living animal occupying this slot; null while waiting to respawn. */
  livingId: string | null;
  /** Dead animal kept in the world until this slot spawns its replacement. */
  corpseId: string | null;
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
  /** sessionId → unix ms when the next melee hit is allowed. */
  private readonly attackReadyAt = new Map<string, number>();
  /** `${sessionId}:${itemId}` → unix ms when the next use is allowed. */
  private readonly itemUseReadyAt = new Map<string, number>();
  /** `${sessionId}:${skillId}` → unix ms when the skill may be cast again. */
  private readonly skillReadyAt = new Map<string, number>();
  /** sessionId → next permitted craft timestamp (prevents message spam). */
  private readonly craftReadyAt = new Map<string, number>();
  /** playerId → active Well Fed-style food buff. */
  private readonly foodBuffs = new Map<
    string,
    {
      itemId: string;
      expiresAt: number;
      strength: number;
      agility: number;
      stamina: number;
      intellect: number;
      spirit: number;
    }
  >();
  /** sessionId → in-progress mining channel. */
  private readonly miningChannels = new Map<
    string,
    { nodeKey: string; nodeId: string; completeAt: number }
  >();
  /** nodeKey → unix ms when the vein respawns. */
  private readonly depletedNodes = new Map<string, number>();
  /** Runtime player-placed cooking campfires (in-memory). */
  private readonly placedCampfires = new Map<
    string,
    {
      id: string;
      mapId: string;
      ownerPlayerId: string;
      x: number;
      y: number;
    }
  >();
  /** sessionId → last time the player took creature damage. */
  private readonly lastDamageAt = new Map<string, number>();
  /** sessionId → last rage generation (combat clock for OOC decay). */
  private readonly lastRageCombatAt = new Map<string, number>();
  /** sessionId → last rage decay sample timestamp. */
  private readonly lastRageDecayAt = new Map<string, number>();
  /** sessionId → fractional rage debt waiting to be applied. */
  private readonly rageDecayCarry = new Map<string, number>();
  /** sessionId → last OOC regen tick. */
  private readonly lastRegenTickAt = new Map<string, number>();
  /** Sessions whose zero-HP transition has already paid the death penalty. */
  private readonly deadSessions = new Set<string>();
  /** Session → death time; used to enforce the short resurrection pause. */
  private readonly diedAt = new Map<string, number>();
  /** Player id → latest ordered PostgreSQL write for that character. */
  private readonly pendingPlayerSaves = new Map<string, Promise<void>>();
  /** Entity membership currently encoded into each client's interest view. */
  private readonly viewEntities = new Map<string, Set<Schema>>();
  private readonly maps = new Map<string, MapDocument>();
  private readonly mapColliders = new Map<string, MapCircleCollider[]>();
  /** npcInstanceId → itemId → remaining stock (infinite offers omitted). */
  private readonly shopStock = new Map<string, Map<string, number>>();
  /** sessionId → recent say timestamps (rate limit). */
  private readonly chatSentAt = new Map<string, number[]>();
  /** sessionId → last say text + time (anti-duplicate). */
  private readonly chatLast = new Map<string, { text: string; at: number }>();

  onCreate(): void {
    this.maxClients = 50;
    this.patchRate = 50;
    for (const mapId of knownMapIds()) {
      const map = loadMapById(mapId);
      this.maps.set(map.id, map);
      this.mapColliders.set(map.id, collidersFromMap(map));
    }
    this.initShopStock();
    this.animalAi.onPlayerDamaged = (sessionId, amount, animalId) => {
      this.lastDamageAt.set(sessionId, Date.now());
      const player = this.state.players.get(sessionId);
      if (player) {
        this.damageArmorFromHit(player, sessionId);
        this.gainResource(player, sessionId, RAGE_ON_DAMAGE_TAKEN);
      }
      const animal = this.state.animals.get(animalId);
      this.clients
        .find((c) => c.sessionId === sessionId)
        ?.send("combatText", {
          amount,
          target: "player",
          animalId,
          kind: "damage",
          creatureKind: animal?.kind,
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
          this.miningChannels.delete(sessionId);
          this.lastRageCombatAt.delete(sessionId);
          this.lastRageDecayAt.delete(sessionId);
          this.deadSessions.delete(sessionId);
          this.diedAt.delete(sessionId);
        }
      }

      const saved = await playerStore.get(playerId);
      let record = saved;
      if (!record) {
        const startMap = this.requireMap("hunting_grounds");
        record = playerStore.createDefault(
          playerId,
          startMap.spawns.player.x,
          startMap.spawns.player.y,
          { name: auth.characterName, classId: auth.classId },
        );
        await playerStore.save(record);
      }
      if (!this.maps.has(record.mapId)) {
        const startMap = this.requireMap("hunting_grounds");
        record.mapId = startMap.id;
        record.x = startMap.spawns.player.x;
        record.y = startMap.spawns.player.y;
      }
      const player = this.hydratePlayer(record, !saved);
      this.state.players.set(client.sessionId, player);
      client.view = new StateView();
      this.refreshClientView(client);
      this.refreshAllClientViews();
      if (player.hp <= 0) this.deadSessions.add(client.sessionId);
      client.userData = { playerId, accountId: auth.accountId };
      this.sendMiningNodesState(client);
      this.sendCampfiresState(client);
      this.sendFoodBuffState(client);
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
      this.viewEntities.delete(client.sessionId);
      this.refreshAllClientViews();
      markCharacterOffline(player.playerId);
    }
    this.attackReadyAt.delete(client.sessionId);
    this.lastDamageAt.delete(client.sessionId);
    this.lastRageCombatAt.delete(client.sessionId);
    this.lastRageDecayAt.delete(client.sessionId);
    this.rageDecayCarry.delete(client.sessionId);
    this.lastRegenTickAt.delete(client.sessionId);
    this.clearItemUseCooldowns(client.sessionId);
    this.clearSkillCooldowns(client.sessionId);
    this.craftReadyAt.delete(client.sessionId);
    this.miningChannels.delete(client.sessionId);
    this.deadSessions.delete(client.sessionId);
    this.diedAt.delete(client.sessionId);
    this.chatSentAt.delete(client.sessionId);
    this.chatLast.delete(client.sessionId);
  }

  onDispose(): void {
    for (const player of this.state.players.values()) {
      markCharacterOffline(player.playerId);
    }
  }

  messages = {
    mapTransition: (client: Client, data: MapTransitionPayload) => {
      const player = this.livingPlayer(client);
      const requestId =
        typeof data?.requestId === "string" ? data.requestId.slice(0, 80) : "";
      const targetMapId =
        typeof data?.targetMapId === "string" ? data.targetMapId : "";
      if (!player || !targetMapId) {
        client.send("mapTransitionRejected", {
          requestId,
          reason: "invalid_request",
        });
        return;
      }

      const sourceMap = this.mapForPlayer(player);
      const targetMap = this.maps.get(targetMapId);
      const transition = findMapTransition(
        sourceMap,
        player.x,
        player.y,
        targetMapId,
      );
      if (!targetMap || !transition) {
        client.send("mapTransitionRejected", {
          requestId,
          reason: targetMap ? "too_far" : "unknown_map",
        });
        return;
      }

      const arrival = resolveMapArrival(targetMap, transition.targetEntryId);
      player.mapId = targetMap.id;
      player.x = arrival.x;
      player.y = arrival.y;
      player.isNew = false;
      this.animalAi.clearAggroOnPlayer(client.sessionId);
      this.attackReadyAt.delete(client.sessionId);
      this.clearSkillCooldowns(client.sessionId);
      this.craftReadyAt.delete(client.sessionId);
      this.miningChannels.delete(client.sessionId);
      this.refreshAllClientViews();
      this.persistPlayer(player);

      client.send("mapTransitioned", {
        requestId,
        mapId: targetMap.id,
        x: player.x,
        y: player.y,
      });
      this.sendMiningNodesState(client);
      this.sendCampfiresState(client);
    },

    /** Client re-requests depleted veins after UI is ready (join race). */
    requestMiningNodesState: (client: Client) => {
      this.sendMiningNodesState(client);
    },

    /** Client re-requests placed campfires after UI / map load. */
    requestCampfiresState: (client: Client) => {
      this.sendCampfiresState(client);
    },

    /** Place or replace a personal cooking campfire near the player. */
    placeCampfire: (
      client: Client,
      data: {
        x?: number;
        y?: number;
        playerX?: number;
        playerY?: number;
      },
    ) => {
      const player = this.livingPlayer(client);
      if (!player) return;
      if (
        typeof data?.x !== "number" ||
        typeof data?.y !== "number" ||
        !Number.isFinite(data.x) ||
        !Number.isFinite(data.y)
      ) {
        return;
      }

      this.applyClientPosition(player, data.playerX, data.playerY);
      const x = Math.round(data.x);
      const y = Math.round(data.y);
      const map = this.mapForPlayer(player);
      const placeRange = PLACEABLE_CAMPFIRE.placeRange;
      const campfireRadius = PLACEABLE_CAMPFIRE.collisionRadius;

      if (Math.hypot(x - player.x, y - player.y) > placeRange) {
        client.send("notice", { kind: "campfire_too_far" });
        return;
      }
      if (
        x < map.playable.minX + campfireRadius ||
        x > map.playable.maxX - campfireRadius ||
        y < map.playable.minY + campfireRadius ||
        y > map.playable.maxY - campfireRadius
      ) {
        client.send("notice", { kind: "campfire_blocked" });
        return;
      }

      const colliders = this.mapColliders.get(map.id) ?? [];
      for (const collider of colliders) {
        if (
          Math.hypot(x - collider.x, y - collider.y) <
          collider.radius + campfireRadius
        ) {
          client.send("notice", { kind: "campfire_blocked" });
          return;
        }
      }
      for (const campfire of this.placedCampfires.values()) {
        if (
          campfire.mapId !== map.id ||
          campfire.ownerPlayerId === player.playerId
        )
          continue;
        if (
          Math.hypot(x - campfire.x, y - campfire.y) < campfireRadius * 2
        ) {
          client.send("notice", { kind: "campfire_blocked" });
          return;
        }
      }

      // One personal fire: replace the previous one anywhere.
      for (const [id, campfire] of [...this.placedCampfires.entries()]) {
        if (campfire.ownerPlayerId !== player.playerId) continue;
        this.placedCampfires.delete(id);
        this.broadcast("campfireRemoved", { id });
      }

      const id = `campfire-${player.playerId}`;
      const placed = {
        id,
        mapId: map.id,
        ownerPlayerId: player.playerId,
        x,
        y,
      };
      this.placedCampfires.set(id, placed);
      this.broadcast("campfirePlaced", placed);
    },

    /** Client re-requests active food buff after UI is ready. */
    requestFoodBuffState: (client: Client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      this.sendFoodBuffState(client);
    },

    /** Right-click / click cancel: drop the active Well Fed buff. */
    cancelFoodBuff: (client: Client) => {
      const player = this.livingPlayer(client);
      if (!player) return;
      if (!this.foodBuffs.delete(player.playerId)) return;
      this.recomputeGearStats(player);
      client.send("foodBuffExpired", {});
      client.send("notice", { kind: "food_buff_cancelled" });
    },

    /** Map-local Say chat (validated + rate-limited). */
    chat: (client: Client, data: ChatSayPayload) => {
      const player = this.livingPlayer(client);
      if (!player) return;

      const text = sanitizeChatText(
        typeof data?.text === "string" ? data.text : "",
      );
      if (!text) {
        client.send("notice", { kind: "chat_invalid" });
        return;
      }

      const now = Date.now();
      if (!this.allowChatMessage(client.sessionId, text, now)) {
        client.send("notice", { kind: "chat_rate_limited" });
        return;
      }

      const event: ChatMessageEvent = {
        playerId: player.playerId,
        name: player.name || "Wędrowiec",
        text,
        mapId: player.mapId,
      };
      for (const other of this.clients) {
        const peer = this.state.players.get(other.sessionId);
        if (!peer || peer.mapId !== player.mapId) continue;
        other.send("chat", event);
      }
    },

    respawn: (client: Client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.hp > 0) return;

      const now = Date.now();
      const deathTime = this.diedAt.get(client.sessionId) ?? 0;
      if (deathTime > 0 && now < deathTime + RESPAWN_DELAY_MS) {
        client.send("notice", { kind: "respawn_too_soon" });
        return;
      }

      const home = this.nearestHome(player, player.x, player.y);
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

      this.applyClientPosition(player, data.x, data.y);

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
      this.applyClientPosition(player, data.x, data.y);
    },

    attackAnimal: (client: Client, data: AttackPayload) => {
      const player = this.livingPlayer(client);
      if (!player || !data?.animalId) return;

      // Pose for range comes from move sync — do not trust attack payload coords.
      const animal = this.state.animals.get(data.animalId);
      if (!animal?.alive || animal.mapId !== player.mapId) return;

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
      this.gainResource(player, client.sessionId, RAGE_ON_AUTO_ATTACK);
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
        // Small grace for pose sync lag (skill range is already generous vs melee).
        if (dist > skill.range + 24) {
          client.send("notice", { kind: "out_of_range" });
          return;
        }
      }

      const now = Date.now();
      const cdKey = `${client.sessionId}:${data.skillId}`;
      if (now < (this.skillReadyAt.get(cdKey) ?? 0)) return;

      // Spend resource before committing cooldown / swing (fail closed).
      if (
        !this.trySpendResource(player, client.sessionId, skill.resourceCost)
      ) {
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
        this.applyAnimalHit(
          client,
          player,
          animal,
          rollDamageRange(skillRange.min, skillRange.max),
        );
      }
      if (hitAny) {
        this.gainResource(player, client.sessionId, RAGE_ON_SKILL_HIT);
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

      const buff = config.use.buff;
      // Heal-only items do nothing at full HP; food with a buff may still be eaten.
      if (config.use.heal > 0 && player.hp >= player.maxHp && !buff) {
        client.send("notice", { kind: "already_full_hp" });
        return;
      }

      const itemId = slot.itemId;
      let healed = 0;
      if (config.use.heal > 0) {
        const before = player.hp;
        player.hp = Math.min(player.maxHp, player.hp + config.use.heal);
        healed = player.hp - before;
      }
      if (buff) {
        // One food buff at a time — a new meal replaces the previous Well Fed.
        const expiresAt = now + buff.durationMs;
        this.foodBuffs.set(player.playerId, {
          itemId: canonicalItemId(itemId),
          expiresAt,
          strength: buff.strength,
          agility: buff.agility,
          stamina: buff.stamina,
          intellect: buff.intellect,
          spirit: buff.spirit,
        });
        this.recomputeGearStats(player);
        client.send("foodBuffState", {
          itemId: canonicalItemId(itemId),
          expiresAt,
          strength: buff.strength,
          agility: buff.agility,
          stamina: buff.stamina,
          intellect: buff.intellect,
          spirit: buff.spirit,
        });
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

      if (healed > 0) {
        client.send("combatText", {
          amount: healed,
          target: "player",
          animalId: "",
          kind: "heal",
        } satisfies CombatTextEvent);
      }

      client.send("itemUsed", {
        slotIndex: data.slotIndex,
        itemId,
        cooldownMs: config.use.cooldownMs,
        ...(buff
          ? {
              buff: {
                strength: buff.strength,
                agility: buff.agility,
                stamina: buff.stamina,
                intellect: buff.intellect,
                spirit: buff.spirit,
                durationMs: buff.durationMs,
                expiresAt: now + buff.durationMs,
              },
            }
          : {}),
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

      const incoming = getItemConfig(source.itemId);
      if (!incoming) return;
      if (incoming.requiredLevel > 0 && player.level < incoming.requiredLevel) {
        client.send("notice", { kind: "equip_level_too_low" });
        return;
      }

      const target = this.equipmentSlot(player, data.slotId);
      if (!target) return;

      // Two-handers clear the off-hand; equipping an off-hand clears a 2H main.
      if (incoming.twoHanded && data.slotId === "mainHand") {
        if (!this.stowEquipmentSlot(player, "offHand", [data.inventoryIndex])) {
          client.send("notice", { kind: "inventory_full" });
          return;
        }
      } else if (data.slotId === "offHand") {
        const main = this.equipmentSlot(player, "mainHand");
        if (main?.itemId && getItemConfig(main.itemId)?.twoHanded) {
          if (
            !this.stowEquipmentSlot(player, "mainHand", [data.inventoryIndex])
          ) {
            client.send("notice", { kind: "inventory_full" });
            return;
          }
        }
      }

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

      this.applyClientPosition(player, data.x, data.y);

      const animal = this.state.animals.get(data.animalId);
      if (!animal || animal.alive || animal.mapId !== player.mapId) return;

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
    },

    /** Take every corpse slot that fits; stop on first that does not. */
    lootAllCorpse: (client: Client, data: LootAllCorpsePayload) => {
      const player = this.livingPlayer(client);
      if (!player || !data?.animalId) return;

      this.applyClientPosition(player, data.x, data.y);

      const animal = this.state.animals.get(data.animalId);
      if (!animal || animal.alive || animal.mapId !== player.mapId) return;

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
    },

    collectPickup: (client: Client, data: CollectPayload) => {
      const player = this.livingPlayer(client);
      if (!player || !data?.pickupId) return;

      this.applyClientPosition(player, data.x, data.y);

      const pickup = this.state.pickups.get(data.pickupId);
      if (!pickup || pickup.mapId !== player.mapId) return;
      if (Date.now() < pickup.collectableAt) return;

      const dist = Math.hypot(pickup.x - player.x, pickup.y - player.y);
      if (dist > PICKUP_RADIUS + 16) return;

      const loot = itemData(pickup);
      if (!addItemToPlayer(player, loot, player.slots.length)) {
        client.send("notice", { kind: "inventory_full" });
        return;
      }

      this.state.pickups.delete(data.pickupId);
      this.refreshAllClientViews();
      player.isNew = false;
      this.persistPlayer(player);
    },

    dropItem: (client: Client, data: DropPayload) => {
      const player = this.livingPlayer(client);
      if (!player) return;
      if (typeof data.x !== "number" || typeof data.y !== "number") return;
      if (typeof data.inventoryIndex !== "number") return;
      this.applyClientPosition(player, data.x, data.y);
      const dropped = takeFromSlot(
        player,
        data.inventoryIndex,
        Number.MAX_SAFE_INTEGER,
      );
      if (!dropped) return;
      this.spawnPickup(
        dropped,
        player.mapId,
        player.x,
        player.y,
        Date.now() + DROP_PICKUP_DELAY_MS,
      );
      player.isNew = false;
      this.persistPlayer(player);
    },

    buyFromNpc: (client: Client, data: BuyFromNpcPayload) => {
      const player = this.livingPlayer(client);
      if (!player || !data?.npcInstanceId || !data.itemId) return;

      this.applyClientPosition(player, data.x, data.y);

      const placement = this.findNpc(player, data.npcInstanceId);
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

      const stockMap = this.shopStock.get(`${player.mapId}:${placement.id}`);
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
        stock: this.remainingStock(player, placement.id, data.itemId),
      });
    },

    sellToNpc: (client: Client, data: SellToNpcPayload) => {
      const player = this.livingPlayer(client);
      if (!player || !data?.npcInstanceId) return;
      if (typeof data.inventoryIndex !== "number") return;

      this.applyClientPosition(player, data.x, data.y);

      const placement = this.findNpc(player, data.npcInstanceId);
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
      this.applyClientPosition(player, data.x, data.y);

      const placement = this.findNpc(player, data.npcInstanceId);
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

      const equipped = Array.from(player.equipment).map((slot) => ({
        slot,
        slotId: slot.slotId,
        inventoryIndex: undefined as number | undefined,
      }));
      const carried = Array.from(
        { length: player.slots.length },
        (_, index) => ({
          slot: player.slots.at(index)!,
          slotId: undefined as string | undefined,
          inventoryIndex: index,
        }),
      );
      const candidates =
        data.source === "equipment" && data.slotId
          ? equipped.filter((entry) => entry.slotId === data.slotId)
          : data.source === "inventory" && Number.isInteger(data.inventoryIndex)
            ? carried.filter(
                (entry) => entry.inventoryIndex === data.inventoryIndex,
              )
            : [...equipped, ...carried];
      const repairs = candidates.flatMap((entry) => {
        const { slot } = entry;
        if (!slot.itemId || !isRepairable(slot.maxDurability)) return [];
        const item = getItemConfig(slot.itemId);
        if (!item || slot.durability >= slot.maxDurability) return [];
        const cost = repairCost(item, slot.durability, slot.maxDurability);
        return cost > 0 ? [{ ...entry, cost }] : [];
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
        slotIds: repairs.flatMap(({ slotId }) => (slotId ? [slotId] : [])),
        inventoryIndices: repairs.flatMap(({ inventoryIndex }) =>
          inventoryIndex === undefined ? [] : [inventoryIndex],
        ),
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

      this.applyClientPosition(player, data.x, data.y);
      if (!this.isAtCraftStation(player, recipe.station)) {
        client.send("notice", {
          kind:
            recipe.station === "forge"
              ? "forge_station_required"
              : "cooking_station_required",
        });
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

    /** Begin a mining channel after validating range, tool and node state. */
    startMine: (client: Client, data: MineNodePayload) => {
      const player = this.livingPlayer(client);
      if (!player || typeof data?.nodeKey !== "string") return;
      if (typeof data.nodeId !== "string") return;

      this.applyClientPosition(player, data.x, data.y);
      const spot = this.findMiningSpot(player, data.nodeKey);
      if (!spot || spot.nodeId !== data.nodeId) {
        client.send("notice", { kind: "mining_node_missing" });
        return;
      }
      if (this.isNodeDepleted(data.nodeKey)) {
        client.send("notice", { kind: "mining_node_depleted" });
        return;
      }
      if (
        Math.hypot(player.x - spot.x, player.y - spot.y) > spot.activationRadius
      ) {
        client.send("notice", { kind: "mining_too_far" });
        return;
      }

      const node = getProfessionGatherNode(data.nodeId);
      const profession = node ? getProfessionConfig(node.professionId) : null;
      if (!node || !profession) return;

      const state = this.professionState(player, node.professionId);
      if (state.level < node.level) {
        client.send("notice", { kind: "profession_level_too_low" });
        return;
      }
      if (!this.playerHasGatheringTool(player, node.requiredTool)) {
        client.send("notice", { kind: "mining_pickaxe_required" });
        return;
      }

      this.miningChannels.set(client.sessionId, {
        nodeKey: data.nodeKey,
        nodeId: data.nodeId,
        completeAt: Date.now() + node.gatherTimeMs,
      });
    },

    /** Finish mining once the channel timer elapses. */
    completeMine: (client: Client, data: MineNodePayload) => {
      const player = this.livingPlayer(client);
      if (!player || typeof data?.nodeKey !== "string") return;
      if (typeof data.nodeId !== "string") return;

      const channel = this.miningChannels.get(client.sessionId);
      this.miningChannels.delete(client.sessionId);
      if (
        !channel ||
        channel.nodeKey !== data.nodeKey ||
        channel.nodeId !== data.nodeId
      ) {
        return;
      }

      const now = Date.now();
      if (now < channel.completeAt - 150) return;
      if (now > channel.completeAt + 4000) return;

      this.applyClientPosition(player, data.x, data.y);
      const spot = this.findMiningSpot(player, data.nodeKey);
      if (!spot || spot.nodeId !== data.nodeId) {
        client.send("notice", { kind: "mining_node_missing" });
        return;
      }
      if (this.isNodeDepleted(data.nodeKey)) {
        client.send("notice", { kind: "mining_node_depleted" });
        return;
      }
      if (
        Math.hypot(player.x - spot.x, player.y - spot.y) > spot.activationRadius
      ) {
        client.send("notice", { kind: "mining_too_far" });
        return;
      }

      const node = getProfessionGatherNode(data.nodeId);
      const profession = node ? getProfessionConfig(node.professionId) : null;
      if (!node || !profession) return;

      const state = this.professionState(player, node.professionId);
      if (state.level < node.level) {
        client.send("notice", { kind: "profession_level_too_low" });
        return;
      }
      if (!this.playerHasGatheringTool(player, node.requiredTool)) {
        client.send("notice", { kind: "mining_pickaxe_required" });
        return;
      }

      const quantity =
        node.output.quantityMin +
        Math.floor(
          Math.random() *
            (node.output.quantityMax - node.output.quantityMin + 1),
        );
      const output = emptyItemData(node.output.itemId, quantity);
      if (!this.canFitCraftOutput(player, [], output)) {
        client.send("notice", { kind: "inventory_full" });
        return;
      }
      if (!addItemToPlayer(player, output, player.slots.length)) return;

      const respawnAt = now + node.respawnMs;
      this.depletedNodes.set(data.nodeKey, respawnAt);
      this.broadcast("miningNodeDepleted", {
        nodeKey: data.nodeKey,
        respawnAt,
      });

      const gainedXp = node.xp;
      const result = awardProfessionExperience(profession, state, gainedXp);
      state.level = result.level;
      state.experience = result.experience;
      state.experienceToLevel = professionXpForLevel(profession, result.level);
      player.isNew = false;
      this.persistPlayer(player);
      client.send("oreMined", {
        professionId: node.professionId,
        nodeId: node.id,
        nodeKey: data.nodeKey,
        itemId: node.output.itemId,
        quantity,
        xp: gainedXp,
        levelsGained: result.levelsGained,
        level: state.level,
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

  private requireMap(mapId: string): MapDocument {
    const map = this.maps.get(mapId);
    if (!map) throw new Error(`Unknown map id: ${mapId}`);
    return map;
  }

  private mapForPlayer(player: PlayerState): MapDocument {
    return this.maps.get(player.mapId) ?? this.requireMap("hunting_grounds");
  }

  /** Interest management: only entities in the character's current zone are encoded. */
  private refreshAllClientViews(): void {
    for (const client of this.clients) this.refreshClientView(client);
  }

  private refreshClientView(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const view = client.view ?? (client.view = new StateView());
    const desired = new Set<Schema>();
    for (const candidate of this.state.players.values()) {
      if (candidate.mapId === player.mapId) desired.add(candidate);
    }
    for (const animal of this.state.animals.values()) {
      if (animal.mapId === player.mapId) desired.add(animal);
    }
    for (const pickup of this.state.pickups.values()) {
      if (pickup.mapId === player.mapId) desired.add(pickup);
    }

    const previous = this.viewEntities.get(client.sessionId) ?? new Set();
    for (const entity of previous) {
      if (!desired.has(entity)) view.remove(entity);
    }
    for (const entity of desired) {
      if (!previous.has(entity)) view.add(entity);
    }
    this.viewEntities.set(client.sessionId, desired);
  }

  /** Keeps client pose inside its authoritative zone; mapId is never client supplied. */
  private applyClientPosition(
    player: PlayerState,
    x: unknown,
    y: unknown,
  ): void {
    const map = this.mapForPlayer(player);
    if (typeof x === "number" && Number.isFinite(x)) {
      player.x = Math.min(map.playable.maxX, Math.max(map.playable.minX, x));
    }
    if (typeof y === "number" && Number.isFinite(y)) {
      player.y = Math.min(map.playable.maxY, Math.max(map.playable.minY, y));
    }
  }

  /** Selects the closest configured settlement, falling back to map spawn. */
  private nearestHome(
    player: PlayerState,
    x: number,
    y: number,
  ): { id: string; name: string; x: number; y: number } {
    const map = this.mapForPlayer(player);
    const fallback = {
      id: "map-spawn",
      name: "Najbliższe schronienie",
      x: map.spawns.player.x,
      y: map.spawns.player.y,
    };
    const homes = (map.homes ?? []).filter(
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

    // Players are not solid — walking into a creature must not shove it around.
    // Combat still uses `state.players` for aggro / chase / attacks.
    for (const [, animal] of this.state.animals) {
      const map = this.maps.get(animal.mapId);
      if (!map) continue;
      const blockers: CircleBlocker[] = (
        this.mapColliders.get(animal.mapId) ?? []
      ).map((c) => ({ x: c.x, y: c.y, radius: c.radius }));
      for (const campfire of this.placedCampfires.values()) {
        if (campfire.mapId !== animal.mapId) continue;
        blockers.push({
          x: campfire.x,
          y: campfire.y,
          radius: PLACEABLE_CAMPFIRE.collisionRadius,
        });
      }
      this.animalAi.tick(
        animal,
        dt,
        now,
        blockers,
        this.state.players,
        map.playable,
      );
    }
    this.tickPlayerRegen(now);
    this.tickResourceDecay(now);
    this.resolvePlayerDeaths(now);
    this.tickMiningRespawns(now);
    this.tickFoodBuffs(now);
  }

  private activeFoodBuff(playerId: string): {
    itemId: string;
    expiresAt: number;
    strength: number;
    agility: number;
    stamina: number;
    intellect: number;
    spirit: number;
  } | null {
    const buff = this.foodBuffs.get(playerId);
    if (!buff) return null;
    if (Date.now() >= buff.expiresAt) {
      this.foodBuffs.delete(playerId);
      return null;
    }
    return buff;
  }

  private tickFoodBuffs(now: number): void {
    for (const [playerId, buff] of this.foodBuffs) {
      if (now < buff.expiresAt) continue;
      this.foodBuffs.delete(playerId);
      for (const [sessionId, player] of this.state.players) {
        if (player.playerId !== playerId) continue;
        this.recomputeGearStats(player);
        const client = this.clients.find((c) => c.sessionId === sessionId);
        client?.send("foodBuffExpired", {});
        client?.send("notice", { kind: "food_buff_expired" });
        break;
      }
    }
  }

  private sendFoodBuffState(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const buff = this.activeFoodBuff(player.playerId);
    if (!buff) {
      client.send("foodBuffState", {
        itemId: "",
        expiresAt: 0,
        strength: 0,
        agility: 0,
        stamina: 0,
        intellect: 0,
        spirit: 0,
      });
      return;
    }
    client.send("foodBuffState", {
      itemId: buff.itemId,
      expiresAt: buff.expiresAt,
      strength: buff.strength,
      agility: buff.agility,
      stamina: buff.stamina,
      intellect: buff.intellect,
      spirit: buff.spirit,
    });
  }

  private initPlayerResource(player: PlayerState, classId: string): void {
    const kind = parseResourceKind(getClass(classId).resource);
    player.resourceKind = kind;
    player.maxResource = maxResourceFor(kind);
    player.resource = 0;
  }

  private gainResource(
    player: PlayerState,
    sessionId: string,
    amount: number,
  ): void {
    const kind = parseResourceKind(player.resourceKind) as ResourceKind;
    if (kind !== "rage" || amount <= 0) return;
    if (player.hp <= 0) return;

    const max = Math.max(0, player.maxResource || maxResourceFor(kind));
    const next = clampResource(player.resource + amount, max);
    if (next === player.resource) {
      // Still refresh combat clock at cap so decay doesn't start mid-fight.
      this.lastRageCombatAt.set(sessionId, Date.now());
      return;
    }
    player.resource = next;
    this.lastRageCombatAt.set(sessionId, Date.now());
    this.lastRageDecayAt.delete(sessionId);
    this.rageDecayCarry.delete(sessionId);
  }

  private trySpendResource(
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
    // Spending is a combat action — delay OOC decay.
    if (kind === "rage") {
      this.lastRageCombatAt.set(sessionId, Date.now());
      this.lastRageDecayAt.delete(sessionId);
      this.rageDecayCarry.delete(sessionId);
    }
    return true;
  }

  private clearResource(player: PlayerState, sessionId: string): void {
    if (player.resource !== 0) player.resource = 0;
    this.lastRageCombatAt.delete(sessionId);
    this.lastRageDecayAt.delete(sessionId);
    this.rageDecayCarry.delete(sessionId);
  }

  /**
   * WoW-style trickle: after an OOC delay, drain a few points per second.
   * Fractional carry avoids dumping whole points every sim tick.
   */
  private tickResourceDecay(now: number): void {
    for (const [sessionId, player] of this.state.players) {
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
  private sendLootDropped(client: Client, animal: AnimalState): void {
    const items: Array<{ itemId: string; quantity: number }> = [];
    for (let i = 0; i < animal.loot.length; i++) {
      const slot = animal.loot.at(i);
      if (!slot?.itemId || slot.quantity <= 0) continue;
      items.push({ itemId: slot.itemId, quantity: slot.quantity });
    }
    if (items.length === 0) return;
    client.send("lootDropped", {
      creatureKind: animal.kind,
      animalId: animal.id,
      items,
    } satisfies LootDroppedEvent);
  }

  private allowChatMessage(
    sessionId: string,
    text: string,
    now: number,
  ): boolean {
    const last = this.chatLast.get(sessionId);
    if (last && last.text === text && now - last.at < CHAT_DUPLICATE_MS) {
      return false;
    }

    const windowStart = now - CHAT_RATE_WINDOW_MS;
    const recent = (this.chatSentAt.get(sessionId) ?? []).filter(
      (t) => t >= windowStart,
    );
    if (recent.length >= CHAT_RATE_LIMIT) return false;

    recent.push(now);
    this.chatSentAt.set(sessionId, recent);
    this.chatLast.set(sessionId, { text, at: now });
    return true;
  }

  private tickMiningRespawns(now: number): void {
    for (const [nodeKey, respawnAt] of this.depletedNodes) {
      if (now < respawnAt) continue;
      this.depletedNodes.delete(nodeKey);
      this.broadcast("miningNodeRespawned", { nodeKey });
    }
  }

  private sendMiningNodesState(client: Client): void {
    const nodes = Array.from(this.depletedNodes.entries()).map(
      ([nodeKey, respawnAt]) => ({ nodeKey, respawnAt }),
    );
    client.send("miningNodesState", { nodes });
  }

  private isNodeDepleted(nodeKey: string): boolean {
    const respawnAt = this.depletedNodes.get(nodeKey);
    if (!respawnAt) return false;
    if (Date.now() >= respawnAt) {
      this.depletedNodes.delete(nodeKey);
      return false;
    }
    return true;
  }

  private findMiningSpot(
    player: PlayerState,
    nodeKey: string,
  ): {
    x: number;
    y: number;
    nodeId: string;
    activationRadius: number;
  } | null {
    const map = this.mapForPlayer(player);
    for (const prop of map.props) {
      const interaction = map.propTypes[prop.type]?.interaction;
      if (!interaction || interaction.kind !== "mining") continue;
      const key = `${map.id}:${prop.type}:${prop.x}:${prop.y}`;
      if (key !== nodeKey) continue;
      return {
        x: prop.x + (interaction.offsetX ?? 0),
        y: prop.y + (interaction.offsetY ?? 0),
        nodeId: interaction.nodeId,
        activationRadius: Math.max(
          1,
          interaction.activationRadius ?? MINING_ACTIVATION_RANGE,
        ),
      };
    }
    return null;
  }

  private playerHasGatheringTool(
    player: PlayerState,
    requiredTool: string,
  ): boolean {
    const matches = (
      itemId: string,
      durability: number,
      maxDurability: number,
    ) => {
      if (!itemId) return false;
      if (isBroken(durability, maxDurability)) return false;
      return getItemConfig(itemId)?.gatheringTool === requiredTool;
    };
    for (const slot of player.equipment) {
      if (matches(slot.itemId, slot.durability, slot.maxDurability))
        return true;
    }
    for (const slot of player.slots) {
      if (matches(slot.itemId, slot.durability, slot.maxDurability))
        return true;
    }
    return false;
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
      this.miningChannels.delete(sessionId);
      this.clearResource(player, sessionId);

      const lostExperience = deathExperienceLoss(
        player.experience,
        player.experienceToLevel,
      );
      player.experience = Math.max(0, player.experience - lostExperience);
      this.damageEquipmentOnDeath(player, sessionId);
      player.isNew = false;
      this.persistPlayer(player);

      const home = this.nearestHome(player, player.x, player.y);
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

  private spawnAnimals(): void {
    for (const map of this.maps.values()) {
      for (const spawn of map.spawns.animals) {
        const kind = spawn.kind as CreatureKind;
        if (!CREATURE_KINDS[kind]) continue;
        const slot: AnimalSpawnSlot = {
          mapId: map.id,
          kind,
          homeX: spawn.x,
          homeY: spawn.y,
          livingId: null,
          corpseId: null,
          respawnAt: 0,
        };
        this.spawnSlots.push(slot);
        this.spawnLivingAnimal(slot, `${map.id}:${spawn.id}`);
      }
    }
  }

  private spawnLivingAnimal(slot: AnimalSpawnSlot, preferredId?: string): void {
    if (slot.corpseId) {
      this.removeAnimal(slot.corpseId);
      slot.corpseId = null;
    }

    const config = CREATURE_KINDS[slot.kind];
    const id = preferredId ?? `${slot.mapId}:${slot.kind}-n${++this.animalSeq}`;
    const animal = new AnimalState();
    animal.id = id;
    animal.mapId = slot.mapId;
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
    this.refreshAllClientViews();
  }

  private removeAnimal(id: string): void {
    this.state.animals.delete(id);
    this.animalAi.unregister(id);
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
    mapId: string,
    x: number,
    y: number,
    collectableAt: number,
  ): void {
    const id = `pickup-${++this.pickupSeq}`;
    const pickup = new PickupState();
    pickup.id = id;
    pickup.mapId = mapId;
    writeItem(pickup, item);
    pickup.x = x;
    pickup.y = y;
    pickup.collectableAt = collectableAt;
    this.state.pickups.set(id, pickup);
    this.refreshAllClientViews();
  }

  private hydratePlayer(saved: StoredPlayer, isNew: boolean): PlayerState {
    const derived = playerStore.derived(saved);
    const player = new PlayerState();
    player.playerId = saved.playerId;
    player.mapId = saved.mapId;
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
    this.initPlayerResource(player, saved.classId);
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
    const food = this.activeFoodBuff(player.playerId);
    if (food) {
      player.bonusStrength += food.strength;
      player.bonusAgility += food.agility;
      player.bonusStamina += food.stamina;
      player.bonusIntellect += food.intellect;
      player.bonusSpirit += food.spirit;
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

  /**
   * Moves an equipment piece into the bag so a two-hander / off-hand swap can
   * proceed. Returns false when there is no free inventory slot.
   */
  private stowEquipmentSlot(
    player: PlayerState,
    slotId: string,
    reservedIndexes: number[] = [],
  ): boolean {
    const worn = this.equipmentSlot(player, slotId);
    if (!worn?.itemId) return true;
    const reserved = new Set(reservedIndexes);
    let free = -1;
    for (let i = 0; i < player.slots.length; i++) {
      if (reserved.has(i)) continue;
      if (!player.slots.at(i)?.itemId) {
        free = i;
        break;
      }
    }
    if (free < 0) return false;
    writeItem(player.slots.at(free)!, { ...itemData(worn), quantity: 1 });
    clearItem(worn);
    return true;
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
      mapId: player.mapId,
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

  private isAtCraftStation(
    player: PlayerState,
    stationKind: "cooking" | "forge",
  ): boolean {
    const map = this.mapForPlayer(player);
    if (
      (map.cookingStations ?? []).some((station) => {
        const kind = station.kind === "forge" ? "forge" : "cooking";
        if (kind !== stationKind) return false;
        return (
          Math.hypot(player.x - station.x, player.y - station.y) <=
          Math.max(1, station.radius ?? COOKING_STATION_RANGE)
        );
      })
    ) {
      return true;
    }
    // Player-placed campfires are cooking stations only.
    if (stationKind !== "cooking") return false;
    for (const campfire of this.placedCampfires.values()) {
      if (campfire.mapId !== map.id) continue;
      if (
        Math.hypot(player.x - campfire.x, player.y - campfire.y) <=
        PLACEABLE_CAMPFIRE.cookingActivationRadius
      ) {
        return true;
      }
    }
    return false;
  }

  private sendCampfiresState(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const mapId = player.mapId;
    const campfires = [...this.placedCampfires.values()].filter(
      (campfire) => campfire.mapId === mapId,
    );
    client.send("campfiresState", { campfires });
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
    for (const map of this.maps.values()) {
      for (const placement of map.npcs ?? []) {
        this.shopStock.set(
          `${map.id}:${placement.id}`,
          cloneShopStock(placement.npcId),
        );
      }
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
    if (!config || !animal.alive || animal.mapId !== player.mapId) return;

    const dealt = Math.min(animal.hp, damage);
    animal.hp = Math.max(0, animal.hp - damage);
    this.animalAi.aggro(animal.id, client.sessionId);
    const killed = animal.hp <= 0;

    client.send("combatText", {
      amount: dealt,
      target: "animal",
      animalId: animal.id,
      creatureKind: animal.kind,
      killed: killed || undefined,
    } satisfies CombatTextEvent);

    if (!killed) return;

    animal.alive = false;
    this.fillCorpseLoot(animal, rollLootTable(config.loot));
    this.sendLootDropped(client, animal);

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
      const respawnAt = Date.now() + config.respawnMs;
      slot.livingId = null;
      slot.corpseId = animal.id;
      slot.respawnAt = respawnAt;
      animal.respawnAt = respawnAt;
    }
  }

  private findNpc(player: PlayerState, instanceId: string) {
    return (
      (this.mapForPlayer(player).npcs ?? []).find(
        (npc) => npc.id === instanceId,
      ) ?? null
    );
  }

  private withinNpcRange(
    player: PlayerState,
    npc: { x: number; y: number },
  ): boolean {
    return Math.hypot(npc.x - player.x, npc.y - player.y) <= NPC_TALK_RANGE;
  }

  private isNearNpcId(player: PlayerState, npcId: string): boolean {
    return (this.mapForPlayer(player).npcs ?? []).some(
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
    const station = (this.mapForPlayer(player).cookingStations ?? []).find(
      (candidate) => candidate.id === quest.turnIn.target,
    );
    return (
      station !== undefined &&
      Math.hypot(player.x - station.x, player.y - station.y) <=
        Math.max(1, station.radius ?? COOKING_STATION_RANGE)
    );
  }

  private remainingStock(
    player: PlayerState,
    instanceId: string,
    itemId: string,
  ): number {
    const npcPlacement = this.findNpc(player, instanceId);
    if (!npcPlacement) return 0;
    const offer = getNpcConfig(npcPlacement.npcId)?.shop.find(
      (row) => row.itemId === itemId,
    );
    if (!offer) return 0;
    if (offer.stock < 0) return -1;
    return (
      this.shopStock.get(`${player.mapId}:${instanceId}`)?.get(itemId) ?? 0
    );
  }
}

function sanitizeChatText(raw: string): string {
  return raw
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, CHAT_MAX_LEN);
}
