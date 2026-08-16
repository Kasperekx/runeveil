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
import { playerStore, type StoredPlayer } from "../db/playerStore.js";
import { authStore } from "../auth/authStore.js";
import {
  CREATURE_KINDS,
  SIM_INTERVAL_MS,
  type CreatureKind,
} from "../content/creatureConfig.js";
import {
  computeAttackPower,
  computeMoveSpeed,
  EQUIPMENT_SLOT_IDS,
  getClass,
} from "../content/classConfig.js";
import { AnimalAi, type CircleBlocker } from "../sim/AnimalAi.js";
import {
  collidersFromMap,
  knownMapIds,
  loadMapById,
  type MapCircleCollider,
  type MapDocument,
} from "../maps/loadMap.js";
import { findMapTransition, resolveMapArrival } from "../maps/mapTransition.js";
import {
  armorOf,
  attributeBonusOf,
  attackSpeedOf,
  damageMaxOf,
  damageMinOf,
} from "../sim/armorConfig.js";
import {
  normalizeDurability,
  rollLootItem,
  type ItemInstanceData,
} from "../sim/itemization.js";
import {
  ARMOR_DURABILITY_LOSS_PER_HIT,
  WEAPON_DURABILITY_LOSS_PER_ACTION,
  deathDurabilityLoss,
  isBroken,
  isRepairable,
} from "../sim/durabilityConfig.js";
import { BAG_SLOT_COUNT } from "../sim/bagConfig.js";
import { getItemConfig, itemIdsMatch } from "../content/itemConfig.js";
import {
  getProfessionConfig,
  PROFESSIONS,
  professionXpForLevel,
} from "../content/professionConfig.js";
import { QUESTS } from "../content/questConfig.js";
import type { QuestProgressEvent } from "../sim/questEvents.js";
import {
  RAGE_ON_DAMAGE_TAKEN,
  maxResourceFor,
  parseResourceKind,
} from "../sim/resourceConfig.js";
import {
  markCharacterOffline,
  markCharacterOnline,
} from "../sim/onlineCharacters.js";
import { awardExperience, MAX_LEVEL, xpForLevel } from "../sim/progression.js";
import { rollLootTable } from "../content/lootTable.js";
import { ChatSystem } from "../sim/chat/ChatSystem.js";
import { CampfireSystem } from "../sim/campfires/CampfireSystem.js";
import { CombatSystem } from "../sim/combat/CombatSystem.js";
import { InventorySystem } from "../sim/inventory/InventorySystem.js";
import { MiningSystem } from "../sim/mining/MiningSystem.js";
import { ProfessionSystem } from "../sim/professions/ProfessionSystem.js";
import { QuestSystem } from "../sim/quests/QuestSystem.js";
import { TradeSystem } from "../sim/trade/TradeSystem.js";
import { clearItem, itemData, writeItem } from "../sim/itemSlot.js";
import type { WorldHost } from "../sim/WorldHost.js";

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

type CombatTextEvent = {
  amount: number;
  target: "animal" | "player";
  animalId: string;
  kind?: "damage" | "heal";
  creatureKind?: string;
  killed?: boolean;
};

type LootDroppedEvent = {
  creatureKind: string;
  animalId: string;
  items: Array<{ itemId: string; quantity: number }>;
};

const RECONNECT_SECONDS = 60;
/** Must match client NPC_TALK_RANGE. */
const NPC_TALK_RANGE = 128;
/** Players must stand at a configured cooking node to craft. */
const COOKING_STATION_RANGE = 132;

interface AnimalSpawnSlot {
  mapId: string;
  kind: CreatureKind;
  homeX: number;
  homeY: number;
  /** Living animal occupying this slot; null while waiting to respawn. */
  livingId: string | null;
  /** Unix ms when a new living animal should spawn; 0 when occupied. */
  respawnAt: number;
}

/**
 * Corpse lifetime is independent of creature respawn (WoW / Tibia).
 * Living animals come back on `config.respawnMs`; bodies stay longer so loot
 * is not yanked out from under the player when the next spawn appears.
 */
const CORPSE_DESPAWN_MS = 120_000;
/** Empty corpses clear sooner so the floor is not littered with husks. */
const EMPTY_CORPSE_DESPAWN_MS = 20_000;

export class WorldRoom extends Room implements WorldHost {
  state = new GameState();
  seatReservationTimeout = 20;

  readonly animalAi = new AnimalAi();
  readonly chat = new ChatSystem(this);
  readonly campfires = new CampfireSystem(this);
  readonly combat = new CombatSystem(this);
  readonly inventory = new InventorySystem(this);
  readonly mining = new MiningSystem(this);
  readonly professions = new ProfessionSystem(this);
  readonly quests = new QuestSystem(this);
  readonly trade = new TradeSystem(this);
  private readonly spawnSlots: AnimalSpawnSlot[] = [];
  private animalSeq = 0;
  private pickupSeq = 0;
  /** Player id → latest ordered PostgreSQL write for that character. */
  private readonly pendingPlayerSaves = new Map<string, Promise<void>>();
  /** Entity membership currently encoded into each client's interest view. */
  private readonly viewEntities = new Map<string, Set<Schema>>();
  readonly maps = new Map<string, MapDocument>();
  readonly mapColliders = new Map<string, MapCircleCollider[]>();

  onCreate(): void {
    this.maxClients = 50;
    this.patchRate = 50;
    for (const mapId of knownMapIds()) {
      const map = loadMapById(mapId);
      this.maps.set(map.id, map);
      this.mapColliders.set(map.id, collidersFromMap(map));
    }
    this.trade.initStock();
    this.animalAi.onPlayerDamaged = (sessionId, amount, animalId) => {
      this.combat.noteDamage(sessionId);
      const player = this.state.players.get(sessionId);
      if (player) {
        this.damageArmorFromHit(player, sessionId);
        this.combat.gainResource(player, sessionId, RAGE_ON_DAMAGE_TAKEN);
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
          this.combat.clearSession(sessionId);
          this.inventory.clearSession(sessionId);
          this.professions.clearSession(sessionId);
          this.mining.clearSession(sessionId);
          this.chat.clearSession(sessionId);
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
      if (player.hp <= 0) this.combat.deadSessions.add(client.sessionId);
      client.userData = { playerId, accountId: auth.accountId };
      this.mining.sendState(client);
      this.campfires.sendState(client);
      this.inventory.sendFoodBuffState(client);
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
    this.combat.clearSession(client.sessionId);
    this.inventory.clearSession(client.sessionId);
    this.professions.clearSession(client.sessionId);
    this.mining.clearSession(client.sessionId);
    this.chat.clearSession(client.sessionId);
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
      this.combat.attackReadyAt.delete(client.sessionId);
      this.combat.clearSkillCooldowns(client.sessionId);
      this.professions.clearSession(client.sessionId);
      this.mining.clearSession(client.sessionId);
      this.refreshAllClientViews();
      this.persistPlayer(player);

      client.send("mapTransitioned", {
        requestId,
        mapId: targetMap.id,
        x: player.x,
        y: player.y,
      });
      this.mining.sendState(client);
      this.campfires.sendState(client);
    },

    requestMiningNodesState: (client: Client) => {
      this.mining.sendState(client);
    },
    requestCampfiresState: (client: Client) => {
      this.campfires.sendState(client);
    },
    placeCampfire: (
      client: Client,
      data: Parameters<CampfireSystem["handlePlace"]>[1],
    ) => {
      this.campfires.handlePlace(client, data);
    },
    requestFoodBuffState: (client: Client) => {
      this.inventory.sendFoodBuffState(client);
    },
    cancelFoodBuff: (client: Client) => {
      this.inventory.handleCancelFoodBuff(client);
    },
    chat: (client: Client, data: { text?: string }) => {
      this.chat.handleSay(client, data);
    },
    respawn: (client: Client) => {
      this.combat.handleRespawn(client);
    },
    save: (client: Client, data: SavePayload) => {
      const player = this.livingPlayer(client);
      if (!player || !data) return;
      this.applyClientPosition(player, data.x, data.y);
      player.isNew = false;
      this.persistPlayer(player);
    },
    moveInventorySlot: (client: Client, data: MoveInventorySlotPayload) => {
      this.inventory.handleMoveSlot(client, data);
    },
    move: (client: Client, data: MovePayload) => {
      const player = this.livingPlayer(client);
      if (!player || !data) return;
      this.applyClientPosition(player, data.x, data.y);
    },
    attackAnimal: (client: Client, data: AttackPayload) => {
      this.combat.handleAttack(client, data);
    },
    castSkill: (client: Client, data: CastSkillPayload) => {
      this.combat.handleCastSkill(client, data);
    },
    useItem: (client: Client, data: UseItemPayload) => {
      this.inventory.handleUseItem(client, data);
    },
    equipItem: (client: Client, data: EquipItemPayload) => {
      this.inventory.handleEquipItem(client, data);
    },
    unequipItem: (client: Client, data: UnequipItemPayload) => {
      this.inventory.handleUnequipItem(client, data);
    },
    equipBag: (client: Client, data: EquipBagPayload) => {
      this.inventory.handleEquipBag(client, data);
    },
    unequipBag: (client: Client, data: UnequipBagPayload) => {
      this.inventory.handleUnequipBag(client, data);
    },
    lootCorpse: (client: Client, data: LootCorpsePayload) => {
      this.inventory.handleLootCorpse(client, data);
    },
    lootAllCorpse: (client: Client, data: LootAllCorpsePayload) => {
      this.inventory.handleLootAllCorpse(client, data);
    },
    collectPickup: (client: Client, data: CollectPayload) => {
      this.inventory.handleCollectPickup(client, data);
    },
    dropItem: (client: Client, data: DropPayload) => {
      this.inventory.handleDropItem(client, data);
    },
    buyFromNpc: (client: Client, data: BuyFromNpcPayload) => {
      this.trade.handleBuy(client, data);
    },
    sellToNpc: (client: Client, data: SellToNpcPayload) => {
      this.trade.handleSell(client, data);
    },
    repairEquipment: (client: Client, data: RepairEquipmentPayload) => {
      this.trade.handleRepair(client, data);
    },
    allocateAttribute: (client: Client, data: AllocateAttributePayload) => {
      this.inventory.handleAllocateAttribute(client, data);
    },
    craftRecipe: (client: Client, data: CraftRecipePayload) => {
      this.professions.handleCraft(client, data);
    },
    startMine: (client: Client, data: MineNodePayload) => {
      this.mining.handleStart(client, data);
    },
    completeMine: (client: Client, data: MineNodePayload) => {
      this.mining.handleComplete(client, data);
    },
    acceptQuest: (client: Client, data: AcceptQuestPayload) => {
      this.quests.handleAccept(client, data);
    },
    claimQuestReward: (client: Client, data: ClaimQuestRewardPayload) => {
      this.quests.handleClaim(client, data);
    },
  };

  /** Every gameplay message except resurrection is rejected at zero HP. */
  livingPlayer(client: Client): PlayerState | null {
    const player = this.state.players.get(client.sessionId);
    return player && player.hp > 0 ? player : null;
  }

  private requireMap(mapId: string): MapDocument {
    const map = this.maps.get(mapId);
    if (!map) throw new Error(`Unknown map id: ${mapId}`);
    return map;
  }

  mapForPlayer(player: PlayerState): MapDocument {
    return this.maps.get(player.mapId) ?? this.requireMap("hunting_grounds");
  }

  /** Interest management: only entities in the character's current zone are encoded. */
  refreshAllClientViews(): void {
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
  applyClientPosition(player: PlayerState, x: unknown, y: unknown): void {
    const map = this.mapForPlayer(player);
    if (typeof x === "number" && Number.isFinite(x)) {
      player.x = Math.min(map.playable.maxX, Math.max(map.playable.minX, x));
    }
    if (typeof y === "number" && Number.isFinite(y)) {
      player.y = Math.min(map.playable.maxY, Math.max(map.playable.minY, y));
    }
  }

  /** Selects the closest configured settlement, falling back to map spawn. */
  nearestHome(
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
    this.processCorpseDespawns(now);

    // Players are not solid — walking into a creature must not shove it around.
    // Combat still uses `state.players` for aggro / chase / attacks.
    for (const [, animal] of this.state.animals) {
      const map = this.maps.get(animal.mapId);
      if (!map) continue;
      const blockers: CircleBlocker[] = (
        this.mapColliders.get(animal.mapId) ?? []
      ).map((c) => ({ x: c.x, y: c.y, radius: c.radius }));
      blockers.push(...this.campfires.blockersForMap(animal.mapId));
      this.animalAi.tick(
        animal,
        dt,
        now,
        blockers,
        this.state.players,
        map.playable,
      );
    }
    this.combat.tickPlayerRegen(now);
    this.combat.tickResourceDecay(now);
    this.combat.resolvePlayerDeaths(now, (sessionId, player) => {
      this.inventory.clearSession(sessionId);
      this.professions.clearSession(sessionId);
      this.mining.clearSession(sessionId);
      this.damageEquipmentOnDeath(player, sessionId);
    });
    this.mining.tickRespawns(now);
    this.inventory.tickFoodBuffs(now);
  }

  private initPlayerResource(player: PlayerState, classId: string): void {
    const kind = parseResourceKind(getClass(classId).resource);
    player.resourceKind = kind;
    player.maxResource = maxResourceFor(kind);
    player.resource = 0;
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

  playerHasGatheringTool(player: PlayerState, requiredTool: string): boolean {
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
  private processSpawnSlots(now: number): void {
    for (const slot of this.spawnSlots) {
      if (slot.livingId !== null) continue;
      if (slot.respawnAt <= 0 || now < slot.respawnAt) continue;
      this.spawnLivingAnimal(slot);
    }
  }

  /** Drop timed-out corpses; living respawns never force this. */
  private processCorpseDespawns(now: number): void {
    const expired: string[] = [];
    for (const [id, animal] of this.state.animals) {
      if (animal.alive) continue;
      if (animal.respawnAt <= 0 || now < animal.respawnAt) continue;
      expired.push(id);
    }
    if (expired.length === 0) return;
    for (const id of expired) this.removeAnimal(id);
    this.refreshAllClientViews();
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
          respawnAt: 0,
        };
        this.spawnSlots.push(slot);
        this.spawnLivingAnimal(slot, `${map.id}:${spawn.id}`);
      }
    }
  }

  private spawnLivingAnimal(slot: AnimalSpawnSlot, preferredId?: string): void {
    const config = CREATURE_KINDS[slot.kind];
    // Always a fresh id on respawn so an existing corpse can keep its own.
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

  private corpseHasLoot(animal: AnimalState): boolean {
    for (let i = 0; i < animal.loot.length; i++) {
      const slot = animal.loot.at(i);
      if (slot?.itemId && slot.quantity > 0) return true;
    }
    return false;
  }

  /** After a loot take: empty husks despawn on the short timer. */
  noteCorpseLooted(animal: AnimalState): void {
    if (animal.alive || this.corpseHasLoot(animal)) return;
    const sooner = Date.now() + EMPTY_CORPSE_DESPAWN_MS;
    if (animal.respawnAt <= 0 || sooner < animal.respawnAt) {
      animal.respawnAt = sooner;
    }
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

  spawnPickup(
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
    this.quests.ensureAvailable(player);

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
  recomputeGearStats(player: PlayerState): void {
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
    const food = this.inventory.activeFoodBuff(player.playerId);
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
  weaponAttackSpeed(player: PlayerState): number {
    let best = 1;
    for (const slot of player.equipment) {
      if (isBroken(slot.durability, slot.maxDurability)) continue;
      const speed = attackSpeedOf(slot.itemId ?? "");
      if (speed > best) best = speed;
    }
    return best;
  }

  /** Sum of weapon damageMin/Max on equipped items. */
  equippedWeaponDamageRange(player: PlayerState): {
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
  damageWeaponFromAction(player: PlayerState, sessionId: string): void {
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

  equipmentSlot(
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
  stowEquipmentSlot(
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
  tailEmpty(player: PlayerState, capacity: number): boolean {
    for (let i = capacity; i < player.slots.length; i++) {
      if (player.slots.at(i)?.itemId) return false;
    }
    return true;
  }

  /** Grows with empties / trims the (verified empty) tail to `capacity`. */
  resizeSlots(player: PlayerState, capacity: number): void {
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
  grantExperience(
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

  persistPlayer(player: PlayerState): void {
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

  professionState(player: PlayerState, professionId: string): ProfessionState {
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

  isAtCraftStation(
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
    return this.campfires.isNearCooking(player);
  }

  hasItemQuantity(
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
  canFitCraftOutput(
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

  recordQuestEvent(
    client: Client,
    player: PlayerState,
    event: QuestProgressEvent,
  ): void {
    this.quests.recordEvent(client, player, event);
  }

  applyAnimalHit(
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
    animal.respawnAt =
      Date.now() +
      (this.corpseHasLoot(animal) ? CORPSE_DESPAWN_MS : EMPTY_CORPSE_DESPAWN_MS);

    this.grantExperience(client, player, config.xp, {
      kind: animal.kind,
      animalId: animal.id,
    });
    this.quests.recordEvent(client, player, {
      type: "kill",
      target: animal.kind,
    });

    const slot = this.spawnSlots.find((s) => s.livingId === animal.id);
    if (slot) {
      slot.livingId = null;
      slot.respawnAt = Date.now() + config.respawnMs;
    }
  }

  findNpc(player: PlayerState, instanceId: string) {
    return (
      (this.mapForPlayer(player).npcs ?? []).find(
        (npc) => npc.id === instanceId,
      ) ?? null
    );
  }

  withinNpcRange(player: PlayerState, npc: { x: number; y: number }): boolean {
    return Math.hypot(npc.x - player.x, npc.y - player.y) <= NPC_TALK_RANGE;
  }

  isNearNpcId(player: PlayerState, npcId: string): boolean {
    return (this.mapForPlayer(player).npcs ?? []).some(
      (npc) => npc.npcId === npcId && this.withinNpcRange(player, npc),
    );
  }
}
