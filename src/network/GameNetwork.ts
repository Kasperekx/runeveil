import { Client, type Room } from "@colyseus/sdk";
import { AuthApi } from "../auth/AuthApi";
import { MAIN_BAG_INDEX } from "../config/constants";
import type { Inventory } from "../inventory/Inventory";
import type { ItemAffix, ItemRarity } from "../items/catalog";
import type { Player } from "../player/Player";

const DEFAULT_ENDPOINT = "ws://localhost:2567";
const SAVE_THROTTLE_MS = 400;
/** Pose sync for server collision (animals vs player). */
const MOVE_THROTTLE_MS = 50;
const STATE_WAIT_MS = 5000;

export interface NetworkPlayerSnapshot {
  mapId: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  isNew: boolean;
  name: string;
  classId: string;
  level: number;
  experience: number;
  experienceToLevel: number;
  strength: number;
  agility: number;
  stamina: number;
  intellect: number;
  spirit: number;
  bonusStrength?: number;
  bonusAgility?: number;
  bonusStamina?: number;
  bonusIntellect?: number;
  bonusSpirit?: number;
  attackPower: number;
  /** Auto-attack damage floor. */
  damageMin: number;
  /** Auto-attack damage ceiling. */
  damageMax: number;
  /** Walk speed px/s (level-scaled). */
  moveSpeed: number;
  /** Summed armor of worn gear; reduces incoming damage. */
  armor: number;
  /** Vendor currency. */
  gold: number;
  /** Attribute points waiting to be spent after level-ups. */
  unspentAttrPoints: number;
  professions: ProfessionSnapshot[];
  quests: QuestSnapshot[];
  slots: Array<ItemSnapshot>;
  equipment: Array<ItemSnapshot & { slotId: string }>;
  /** Equipped bag itemIds per socket ("" = empty socket). */
  bags: string[];
}

export interface ProfessionSnapshot {
  professionId: string;
  level: number;
  experience: number;
  experienceToLevel: number;
}

export interface QuestSnapshot {
  questId: string;
  status: "available" | "active" | "ready_to_claim" | "completed";
  progress: number;
}

export interface ItemUsedEvent {
  slotIndex: number;
  itemId: string;
  cooldownMs: number;
  buff?: {
    strength: number;
    agility: number;
    stamina: number;
    intellect: number;
    spirit: number;
    durationMs: number;
    expiresAt: number;
  };
}

export interface FoodBuffStateEvent {
  itemId: string;
  expiresAt: number;
  strength: number;
  agility: number;
  stamina: number;
  intellect: number;
  spirit: number;
}

export interface ItemSnapshot {
  itemId: string;
  quantity: number;
  instanceId: string;
  rarity: ItemRarity;
  affixes: ItemAffix[];
  durability: number;
  maxDurability: number;
}

export interface CombatTextEvent {
  amount: number;
  target: "animal" | "player";
  animalId: string;
  /** Default damage; heal = out-of-combat / potion-style green float. */
  kind?: "damage" | "heal";
  /** Creature catalog id when an animal is involved. */
  creatureKind?: string;
  /** True when this hit killed the animal. */
  killed?: boolean;
}

export interface ChatMessageEvent {
  playerId: string;
  name: string;
  text: string;
  mapId: string;
}

export interface LootDroppedEvent {
  creatureKind: string;
  animalId: string;
  items: Array<{ itemId: string; quantity: number }>;
}

export interface NoticeEvent {
  kind: string;
}

export interface TradeResultEvent {
  kind: "buy" | "sell";
  itemId: string;
  quantity: number;
  gold: number;
  goldSpent?: number;
  goldEarned?: number;
  stock?: number;
}

export interface EquipmentRepairedEvent {
  slotIds: string[];
  totalCost: number;
  gold: number;
}

export interface EquipmentBrokenEvent {
  slotIds: string[];
}

export interface LevelUpEvent {
  level: number;
  from: number;
  maxHp: number;
  attackPower: number;
  moveSpeed?: number;
  attrPointsGained: number;
  unspentAttrPoints: number;
}

export interface XpGainEvent {
  amount: number;
  kind: string;
  animalId: string;
}

export interface PlayerDeathEvent {
  lostExperience: number;
  penaltyPercent: number;
  experience: number;
  experienceToLevel: number;
  homeId: string;
  homeName: string;
  respawnDelayMs: number;
}

export interface PlayerRespawnedEvent {
  homeId: string;
  homeName: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
}

export interface ProfessionCraftedEvent {
  professionId: string;
  recipeId: string;
  quantity: number;
  xp: number;
  levelsGained: number;
  level: number;
}

export interface OreMinedEvent {
  professionId: string;
  nodeId: string;
  nodeKey: string;
  itemId: string;
  quantity: number;
  xp: number;
  levelsGained: number;
  level: number;
}

export interface MiningNodeStateEvent {
  nodes: Array<{ nodeKey: string; respawnAt: number }>;
}

export interface MiningNodeDepletedEvent {
  nodeKey: string;
  respawnAt: number;
}

export interface MiningNodeRespawnedEvent {
  nodeKey: string;
}

export interface QuestReadyEvent {
  questId: string;
}

export interface QuestAcceptedEvent {
  questId: string;
}

export interface QuestClaimedEvent {
  questId: string;
  gold: number;
  experience: number;
}

export interface MapTransitionEvent {
  requestId: string;
  mapId: string;
  x: number;
  y: number;
}

interface MapTransitionRejectedEvent {
  requestId: string;
  reason: string;
}

export interface NetworkAnimalSnapshot {
  id: string;
  kind: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  loot: Array<ItemSnapshot>;
}

export interface NetworkPickupSnapshot {
  id: string;
  itemId: string;
  quantity: number;
  instanceId: string;
  rarity: ItemRarity;
  affixes: ItemAffix[];
  durability: number;
  maxDurability: number;
  x: number;
  y: number;
  collectableAt: number;
}

export interface NetworkRemotePlayerSnapshot {
  sessionId: string;
  name: string;
  classId: string;
  x: number;
  y: number;
  attackSeq: number;
  attackDir: string;
  hp: number;
}

interface RoomPlayerLike {
  playerId: string;
  mapId: string;
  name: string;
  classId: string;
  level: number;
  experience: number;
  experienceToLevel: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  strength: number;
  agility: number;
  stamina: number;
  intellect: number;
  spirit: number;
  bonusStrength?: number;
  bonusAgility?: number;
  bonusStamina?: number;
  bonusIntellect?: number;
  bonusSpirit?: number;
  attackPower: number;
  damageMin: number;
  damageMax: number;
  moveSpeed: number;
  armor: number;
  gold: number;
  unspentAttrPoints: number;
  professions: ArrayLike<{
    professionId: string;
    level: number;
    experience: number;
    experienceToLevel: number;
  }>;
  quests: ArrayLike<{
    questId: string;
    status: string;
    progress: number;
  }>;
  isNew: boolean;
  attackSeq?: number;
  attackDir?: string;
  slots: ArrayLike<{
    itemId: string;
    quantity: number;
    instanceId?: string;
    rarity?: string;
    affixesJson?: string;
    durability?: number;
    maxDurability?: number;
  }>;
  equipment: ArrayLike<{
    slotId: string;
    itemId: string;
    quantity: number;
    instanceId?: string;
    rarity?: string;
    affixesJson?: string;
    durability?: number;
    maxDurability?: number;
  }>;
  bags: ArrayLike<{ itemId: string; quantity: number }>;
}

interface RoomAnimalLike {
  id: string;
  mapId: string;
  kind: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  respawnAt: number;
  loot: ArrayLike<{
    itemId: string;
    quantity: number;
    instanceId?: string;
    rarity?: string;
    affixesJson?: string;
    durability?: number;
    maxDurability?: number;
  }>;
}

interface RoomPickupLike {
  id: string;
  mapId: string;
  itemId: string;
  quantity: number;
  instanceId?: string;
  rarity?: string;
  affixesJson?: string;
  durability?: number;
  maxDurability?: number;
  x: number;
  y: number;
  collectableAt: number;
}

interface RoomStateLike {
  players?: {
    get(sessionId: string): RoomPlayerLike | undefined;
    forEach(cb: (player: RoomPlayerLike, sessionId: string) => void): void;
  };
  animals?: {
    forEach(cb: (animal: RoomAnimalLike, key: string) => void): void;
  };
  pickups?: {
    forEach(cb: (pickup: RoomPickupLike, key: string) => void): void;
  };
}

/**
 * Authenticated Colyseus client and room world state (animals/pickups).
 */
export class GameNetwork {
  private room: Room | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private moveTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSlotsKey = "";
  private lastVitalsKey = "";
  private lastSheetKey = "";
  private lastBagsKey = "";
  /** Last observed own HP; used to detect soft-death revive teleports. */
  private lastHp = -1;
  private activeMapId = "hunting_grounds";
  private transitionSequence = 0;
  private readonly pendingMapTransitions = new Map<
    string,
    {
      resolve: (event: MapTransitionEvent) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private readonly endpoint: string;
  private readonly authApi = new AuthApi();

  /** Fires when own HP / maxHP changes. */
  onVitalsChange: ((hp: number, maxHp: number) => void) | null = null;
  /** Fires when character sheet fields change. */
  onSheetChange: ((snap: NetworkPlayerSnapshot) => void) | null = null;
  /** Fires after the server accepted a use and consumed the item. */
  onItemUsed: ((event: ItemUsedEvent) => void) | null = null;
  /** Fires when a kill pushed the player over the XP threshold. */
  onLevelUp: ((event: LevelUpEvent) => void) | null = null;
  /** Kill XP feedback (floating + toast). */
  onXpGain: ((event: XpGainEvent) => void) | null = null;
  /** Own character reached zero HP and paid the server-side XP penalty. */
  onPlayerDied: ((event: PlayerDeathEvent) => void) | null = null;
  /** Server accepted resurrection and moved the character to a home. */
  onPlayerRespawned: ((event: PlayerRespawnedEvent) => void) | null = null;
  /** Result of a server-authoritative profession craft. */
  onProfessionCrafted: ((event: ProfessionCraftedEvent) => void) | null = null;
  /** Successful mining gather. */
  onOreMined: ((event: OreMinedEvent) => void) | null = null;
  /** Full depleted-node snapshot (join / map sync). */
  onMiningNodesState: ((event: MiningNodeStateEvent) => void) | null = null;
  onMiningNodeDepleted: ((event: MiningNodeDepletedEvent) => void) | null =
    null;
  onMiningNodeRespawned: ((event: MiningNodeRespawnedEvent) => void) | null =
    null;
  /** Active food buff snapshot (join / apply). */
  onFoodBuffState: ((event: FoodBuffStateEvent | null) => void) | null = null;
  /** Objective complete; the player must claim the configured reward. */
  onQuestReady: ((event: QuestReadyEvent) => void) | null = null;
  /** The quest giver accepted the player's request. */
  onQuestAccepted: ((event: QuestAcceptedEvent) => void) | null = null;
  /** Fires once, after a server-verified quest reward was claimed. */
  onQuestClaimed: ((event: QuestClaimedEvent) => void) | null = null;
  /** Fires for damage this player dealt or took; drives floating combat text. */
  onCombatText: ((event: CombatTextEvent) => void) | null = null;
  /** Map-local Say chat from any player on the same map. */
  onChat: ((event: ChatMessageEvent) => void) | null = null;
  /** Corpse loot rolled on kill (chat log — not collect). */
  onLootDropped: ((event: LootDroppedEvent) => void) | null = null;
  /** Fires when the equipped bag loadout changes. */
  onBagsChange: ((bags: string[]) => void) | null = null;
  /** Fires for short server notices (inventory full, …). */
  onNotice: ((event: NoticeEvent) => void) | null = null;
  /** Fires after a successful vendor transaction. */
  onTradeResult: ((event: TradeResultEvent) => void) | null = null;
  /** Successful blacksmith repair; sheet state also carries the durable truth. */
  onEquipmentRepaired: ((event: EquipmentRepairedEvent) => void) | null = null;
  /** One or more worn items reached zero durability. */
  onEquipmentBroken: ((event: EquipmentBrokenEvent) => void) | null = null;
  /** Latest depleted-node snapshot (join can arrive before UI handlers exist). */
  private miningNodesState: MiningNodeStateEvent | null = null;

  constructor(
    private readonly player: Player,
    private readonly inventory: Inventory,
    private readonly characterId: string,
    endpoint = import.meta.env.VITE_COLYSEUS_URL ?? DEFAULT_ENDPOINT,
  ) {
    this.endpoint = endpoint;
  }

  get sessionId(): string | null {
    return this.room?.sessionId ?? null;
  }

  get connected(): boolean {
    return this.room !== null;
  }

  /** Cached join/sync snapshot of depleted mining nodes. */
  getMiningNodesState(): MiningNodeStateEvent | null {
    return this.miningNodesState;
  }

  /** Ask the server to re-send depleted node timers for this room. */
  requestMiningNodesState(): void {
    this.room?.send("requestMiningNodesState");
  }

  /** Ask the server for the active food buff (join race / UI ready). */
  requestFoodBuffState(): void {
    this.room?.send("requestFoodBuffState");
  }

  /** Cancel the active Well Fed buff (click the buff icon). */
  cancelFoodBuff(): void {
    this.room?.send("cancelFoodBuff");
  }

  private foodBuffState: FoodBuffStateEvent | null = null;

  getFoodBuffState(): FoodBuffStateEvent | null {
    return this.foodBuffState;
  }

  async connect(): Promise<NetworkPlayerSnapshot | null> {
    const client = new Client(this.endpoint);
    client.auth.token = await this.authApi.gameTicket(this.characterId);

    this.room = await client.joinOrCreate("world");
    // Register before waiting on state — onJoin may already have sent mining sync.
    this.bindMiningMessages(this.room);

    await this.waitForOwnPlayer();

    this.room.onStateChange(() => {
      this.pullServerInventory();
      this.pullOwnBags();
      this.pullOwnVitals();
      this.pullOwnSheet();
    });

    this.room.onMessage("itemUsed", (event: ItemUsedEvent) => {
      if (event.buff?.expiresAt) {
        this.foodBuffState = {
          itemId: event.itemId,
          expiresAt: event.buff.expiresAt,
          strength: event.buff.strength,
          agility: event.buff.agility,
          stamina: event.buff.stamina,
          intellect: event.buff.intellect,
          spirit: event.buff.spirit,
        };
        this.onFoodBuffState?.(this.foodBuffState);
      }
      this.onItemUsed?.(event);
    });
    this.room.onMessage("foodBuffState", (event: FoodBuffStateEvent) => {
      if (!event?.itemId || !event.expiresAt || event.expiresAt <= Date.now()) {
        this.foodBuffState = null;
        this.onFoodBuffState?.(null);
        return;
      }
      this.foodBuffState = event;
      this.onFoodBuffState?.(event);
    });
    this.room.onMessage("foodBuffExpired", () => {
      this.foodBuffState = null;
      this.onFoodBuffState?.(null);
    });

    this.room.onMessage("levelUp", (event: LevelUpEvent) => {
      this.onLevelUp?.(event);
    });

    this.room.onMessage("xpGain", (event: XpGainEvent) => {
      this.onXpGain?.(event);
    });

    this.room.onMessage("playerDied", (event: PlayerDeathEvent) => {
      this.onPlayerDied?.(event);
    });

    this.room.onMessage("playerRespawned", (event: PlayerRespawnedEvent) => {
      this.player.setPosition(event.x, event.y);
      this.onPlayerRespawned?.(event);
    });

    this.room.onMessage(
      "professionCrafted",
      (event: ProfessionCraftedEvent) => {
        this.onProfessionCrafted?.(event);
      },
    );
    this.room.onMessage("oreMined", (event: OreMinedEvent) => {
      this.onOreMined?.(event);
    });
    this.room.onMessage("questReady", (event: QuestReadyEvent) => {
      this.onQuestReady?.(event);
    });
    this.room.onMessage("questAccepted", (event: QuestAcceptedEvent) => {
      this.onQuestAccepted?.(event);
    });
    this.room.onMessage("questClaimed", (event: QuestClaimedEvent) => {
      this.onQuestClaimed?.(event);
    });

    this.room.onMessage("combatText", (event: CombatTextEvent) => {
      this.onCombatText?.(event);
    });

    this.room.onMessage("chat", (event: ChatMessageEvent) => {
      this.onChat?.(event);
    });

    this.room.onMessage("lootDropped", (event: LootDroppedEvent) => {
      this.onLootDropped?.(event);
    });

    this.room.onMessage("notice", (event: NoticeEvent) => {
      this.onNotice?.(event);
    });

    this.room.onMessage("tradeResult", (event: TradeResultEvent) => {
      this.onTradeResult?.(event);
    });
    this.room.onMessage(
      "equipmentRepaired",
      (event: EquipmentRepairedEvent) => {
        this.onEquipmentRepaired?.(event);
      },
    );
    this.room.onMessage("equipmentBroken", (event: EquipmentBrokenEvent) => {
      this.onEquipmentBroken?.(event);
    });
    this.room.onMessage("mapTransitioned", (event: MapTransitionEvent) => {
      const pending = this.pendingMapTransitions.get(event.requestId);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pendingMapTransitions.delete(event.requestId);
      this.activeMapId = event.mapId;
      pending.resolve(event);
    });
    this.room.onMessage(
      "mapTransitionRejected",
      (event: MapTransitionRejectedEvent) => {
        const pending = this.pendingMapTransitions.get(event.requestId);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pendingMapTransitions.delete(event.requestId);
        pending.reject(new Error(`Map transition rejected: ${event.reason}`));
      },
    );

    // Join-time sync may have raced the early listener; ask again once ready.
    this.requestMiningNodesState();
    this.requestFoodBuffState();

    return this.readOwnSnapshot();
  }

  private bindMiningMessages(room: Room): void {
    room.onMessage("miningNodesState", (event: MiningNodeStateEvent) => {
      this.miningNodesState = event;
      this.onMiningNodesState?.(event);
    });
    room.onMessage("miningNodeDepleted", (event: MiningNodeDepletedEvent) => {
      if (this.miningNodesState) {
        const nodes = this.miningNodesState.nodes.filter(
          (node) => node.nodeKey !== event.nodeKey,
        );
        nodes.push({ nodeKey: event.nodeKey, respawnAt: event.respawnAt });
        this.miningNodesState = { nodes };
      } else {
        this.miningNodesState = {
          nodes: [{ nodeKey: event.nodeKey, respawnAt: event.respawnAt }],
        };
      }
      this.onMiningNodeDepleted?.(event);
    });
    room.onMessage(
      "miningNodeRespawned",
      (event: MiningNodeRespawnedEvent) => {
        if (this.miningNodesState) {
          this.miningNodesState = {
            nodes: this.miningNodesState.nodes.filter(
              (node) => node.nodeKey !== event.nodeKey,
            ),
          };
        }
        this.onMiningNodeRespawned?.(event);
      },
    );
  }

  hydrate(snapshot: NetworkPlayerSnapshot): void {
    this.activeMapId = snapshot.mapId;
    this.applyServerSlots(snapshot.slots);
    this.applyServerBags(snapshot.bags);
    this.lastHp = snapshot.hp;
    this.lastVitalsKey = `${snapshot.hp}:${snapshot.maxHp}`;
    this.lastSheetKey = sheetKey(snapshot);
    if (!snapshot.isNew) {
      this.player.setPosition(snapshot.x, snapshot.y);
    } else {
      this.scheduleSave();
    }
    this.onVitalsChange?.(snapshot.hp, snapshot.maxHp);
    this.onSheetChange?.(snapshot);
  }

  /** Call after wiring `onBagsChange` so the panel catches the current loadout. */
  resyncBags(): void {
    this.lastBagsKey = "";
    this.pullOwnBags();
  }

  syncPosition(): void {
    if (!this.room) return;
    this.scheduleMove();
    this.scheduleSave();
  }

  /** Requests a server-validated door transition and resolves after commit. */
  requestMapTransition(targetMapId: string): Promise<MapTransitionEvent> {
    const room = this.room;
    if (!room) return Promise.reject(new Error("Not connected"));
    this.flushMove();
    this.cancelScheduledSave();
    const requestId = `${room.sessionId}:${++this.transitionSequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingMapTransitions.delete(requestId);
        reject(new Error("Map transition timed out"));
      }, STATE_WAIT_MS);
      this.pendingMapTransitions.set(requestId, { resolve, reject, timer });
      room.send("mapTransition", { requestId, targetMapId });
    });
  }

  listAnimals(): NetworkAnimalSnapshot[] {
    const state = this.room?.state as RoomStateLike | undefined;
    const animals = state?.animals;
    if (!animals) return [];

    const list: NetworkAnimalSnapshot[] = [];
    animals.forEach((animal) => {
      if (animal.mapId !== this.activeMapId) return;
      const loot: NetworkAnimalSnapshot["loot"] = [];
      const rawLoot = animal.loot;
      if (rawLoot) {
        for (let i = 0; i < rawLoot.length; i++) {
          const slot = rawLoot[i];
          loot.push({
            itemId: slot?.itemId ?? "",
            quantity: slot?.quantity ?? 0,
            instanceId: slot?.instanceId ?? "",
            rarity: parseRarity(slot?.rarity),
            affixes: parseAffixes(slot?.affixesJson),
            durability: Math.max(0, Math.floor(slot?.durability ?? 0)),
            maxDurability: Math.max(0, Math.floor(slot?.maxDurability ?? 0)),
          });
        }
      }
      list.push({
        id: animal.id,
        kind: animal.kind,
        x: animal.x,
        y: animal.y,
        hp: animal.hp ?? 0,
        maxHp: animal.maxHp ?? 1,
        alive: Boolean(animal.alive),
        loot,
      });
    });
    return list;
  }

  listPickups(): NetworkPickupSnapshot[] {
    const state = this.room?.state as RoomStateLike | undefined;
    const pickups = state?.pickups;
    if (!pickups) return [];

    const list: NetworkPickupSnapshot[] = [];
    pickups.forEach((pickup) => {
      if (pickup.mapId !== this.activeMapId) return;
      list.push({
        id: pickup.id,
        itemId: pickup.itemId,
        quantity: pickup.quantity,
        instanceId: pickup.instanceId ?? "",
        rarity: parseRarity(pickup.rarity),
        affixes: parseAffixes(pickup.affixesJson),
        durability: Math.max(0, Math.floor(pickup.durability ?? 0)),
        maxDurability: Math.max(0, Math.floor(pickup.maxDurability ?? 0)),
        x: pickup.x,
        y: pickup.y,
        collectableAt: pickup.collectableAt,
      });
    });
    return list;
  }

  attackAnimal(animalId: string): void {
    if (!this.room) return;
    this.flushMove();
    this.flushSave();
    this.room.send("attackAnimal", { animalId });
  }

  /** Requests resurrection; the server chooses and validates the home point. */
  respawn(): void {
    if (!this.room) return;
    this.clearTimers();
    this.room.send("respawn");
  }

  /** Other connected players (excludes local session). */
  listOtherPlayers(): NetworkRemotePlayerSnapshot[] {
    const state = this.room?.state as RoomStateLike | undefined;
    const players = state?.players;
    if (!players || !this.room) return [];

    const list: NetworkRemotePlayerSnapshot[] = [];
    const selfId = this.room.sessionId;
    players.forEach((player, sessionId) => {
      if (sessionId === selfId) return;
      if (player.mapId !== this.activeMapId) return;
      list.push({
        sessionId,
        name: player.name || "Wędrowiec",
        classId: player.classId || "warrior",
        x: player.x,
        y: player.y,
        attackSeq: player.attackSeq ?? 0,
        attackDir: player.attackDir ?? "down",
        hp: player.hp ?? 0,
      });
    });
    return list;
  }

  lootCorpse(animalId: string, slotIndex: number): void {
    if (!this.room) return;
    this.cancelScheduledSave();
    const { x, y } = this.player.position;
    this.room.send("lootCorpse", { animalId, slotIndex, x, y });
  }

  /** Map-local Say (server validates + rate-limits). */
  sendChat(text: string): void {
    if (!this.room) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    this.room.send("chat", { text: trimmed.slice(0, 120) });
  }

  /** Take every loot slot that fits in one server-authoritative pass. */
  lootAllCorpse(animalId: string): void {
    if (!this.room) return;
    this.cancelScheduledSave();
    const { x, y } = this.player.position;
    this.room.send("lootAllCorpse", { animalId, x, y });
  }

  /** Persist a client-side bag rearrange (move / merge / swap). */
  moveInventorySlot(fromIndex: number, toIndex: number): void {
    if (!this.room) return;
    if (fromIndex === toIndex) return;
    this.room.send("moveInventorySlot", { fromIndex, toIndex });
  }

  /** Server validates the slot and applies the effect; it may reject silently. */
  useItem(slotIndex: number): void {
    if (!this.room) return;
    this.flushSave();
    this.room.send("useItem", { slotIndex });
  }

  /** Craft at a world station; server validates level, materials and capacity. */
  craftRecipe(recipeId: string, quantity = 1): void {
    if (!this.room) return;
    this.cancelScheduledSave();
    const { x, y } = this.player.position;
    this.room.send("craftRecipe", { recipeId, quantity, x, y });
  }

  /** Begin a mining channel; server records the completion timestamp. */
  startMine(nodeKey: string, nodeId: string): void {
    if (!this.room) return;
    const { x, y } = this.player.position;
    this.room.send("startMine", { nodeKey, nodeId, x, y });
  }

  /** Finish a mining channel; server awards ore if the channel is ready. */
  completeMine(nodeKey: string, nodeId: string): void {
    if (!this.room) return;
    this.cancelScheduledSave();
    const { x, y } = this.player.position;
    this.room.send("completeMine", { nodeKey, nodeId, x, y });
  }

  acceptQuest(questId: string): void {
    this.room?.send("acceptQuest", { questId });
  }

  claimQuestReward(questId: string): void {
    this.room?.send("claimQuestReward", { questId });
  }

  /** Cast a skill; optional sticky target id for aim. */
  castSkill(skillId: string, targetAnimalId?: string | null): void {
    if (!this.room) return;
    this.flushMove();
    this.flushSave();
    this.room.send("castSkill", {
      skillId,
      ...(targetAnimalId ? { targetAnimalId } : {}),
    });
  }

  /** Wear the item at inventoryIndex in `slotId`; server validates the fit. */
  equipItem(inventoryIndex: number, slotId: string): void {
    if (!this.room) return;
    this.flushSave();
    this.room.send("equipItem", { inventoryIndex, slotId });
  }

  /** Take off `slotId` into inventory (optional target slot; else first free). */
  unequipItem(slotId: string, inventoryIndex?: number): void {
    if (!this.room) return;
    this.flushSave();
    this.room.send("unequipItem", { slotId, inventoryIndex });
  }

  /** Spend one free attribute point into a primary stat. */
  allocateAttribute(
    attr: "strength" | "agility" | "stamina" | "intellect" | "spirit",
  ): void {
    if (!this.room) return;
    this.room.send("allocateAttribute", { attr });
  }

  /** Equip the container at inventoryIndex into the given bag socket. */
  equipBag(inventoryIndex: number, bagIndex: number): void {
    if (!this.room) return;
    if (bagIndex === MAIN_BAG_INDEX) return;
    this.flushSave();
    this.room.send("equipBag", { inventoryIndex, bagIndex });
  }

  /** Unequip a bag into inventory (optional target slot; else first free). */
  unequipBag(bagIndex: number, inventoryIndex?: number): void {
    if (!this.room) return;
    if (bagIndex === MAIN_BAG_INDEX) return; // permanent main backpack
    this.flushSave();
    this.room.send("unequipBag", { bagIndex, inventoryIndex });
  }

  buyFromNpc(npcInstanceId: string, itemId: string, quantity = 1): void {
    if (!this.room) return;
    this.cancelScheduledSave();
    const { x, y } = this.player.position;
    this.room.send("buyFromNpc", {
      npcInstanceId,
      itemId,
      quantity,
      x,
      y,
    });
  }

  sellToNpc(
    npcInstanceId: string,
    inventoryIndex: number,
    quantity?: number,
  ): void {
    if (!this.room) return;
    this.cancelScheduledSave();
    const { x, y } = this.player.position;
    this.room.send("sellToNpc", {
      npcInstanceId,
      inventoryIndex,
      quantity,
      x,
      y,
    });
  }

  repairEquipment(
    npcInstanceId: string,
    target?:
      | { source: "equipment"; slotId: string }
      | { source: "inventory"; inventoryIndex: number },
  ): void {
    if (!this.room) return;
    this.cancelScheduledSave();
    const { x, y } = this.player.position;
    this.room.send("repairEquipment", { npcInstanceId, ...target, x, y });
  }

  collectPickup(pickupId: string): void {
    if (!this.room) return;
    this.cancelScheduledSave();
    const { x, y } = this.player.position;
    this.room.send("collectPickup", { pickupId, x, y });
  }

  dropItem(inventoryIndex: number, x: number, y: number): void {
    if (!this.room) return;
    this.cancelScheduledSave();
    this.room.send("dropItem", { inventoryIndex, x, y });
  }

  dispose(): void {
    this.clearTimers();
    this.rejectPendingMapTransitions();
    this.flushSave();
    this.room = null;
  }

  async disconnect(): Promise<void> {
    this.clearTimers();
    this.rejectPendingMapTransitions();
    const room = this.room;
    if (!room) return;
    this.flushMove();
    this.flushSave();
    this.room = null;
    await room.leave(true);
  }

  private clearTimers(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.moveTimer) {
      clearTimeout(this.moveTimer);
      this.moveTimer = null;
    }
  }

  private rejectPendingMapTransitions(): void {
    for (const pending of this.pendingMapTransitions.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Disconnected during map transition"));
    }
    this.pendingMapTransitions.clear();
  }

  private pullServerInventory(): void {
    const snap = this.readOwnSnapshot();
    if (!snap) return;
    const key = JSON.stringify(snap.slots);
    if (key === this.lastSlotsKey) return;
    this.lastSlotsKey = key;
    this.applyServerSlots(snap.slots);
  }

  private pullOwnBags(): void {
    const snap = this.readOwnSnapshot();
    if (!snap) return;
    this.applyServerBags(snap.bags);
  }

  private applyServerBags(bags: string[]): void {
    const key = JSON.stringify(bags);
    if (key === this.lastBagsKey) return;
    // Don't burn the key before the UI listener is wired (panel mounts later).
    if (!this.onBagsChange) return;
    this.lastBagsKey = key;
    this.onBagsChange(bags);
  }

  /** Sync HP; snap pose only when the server resurrects at a distant home. */
  private pullOwnVitals(): void {
    const snap = this.readOwnSnapshot();
    if (!snap) return;

    const vitalsKey = `${snap.hp}:${snap.maxHp}`;
    if (vitalsKey !== this.lastVitalsKey) {
      this.lastVitalsKey = vitalsKey;
      this.onVitalsChange?.(snap.hp, snap.maxHp);
    }

    const { x: lx, y: ly } = this.player.position;
    const dist = Math.hypot(snap.x - lx, snap.y - ly);
    const sawHpZero = this.lastHp === 0 && snap.hp > 0;
    // Respawn may coalesce into one patch (hp jumps to full at the home).
    const coalescedRevive =
      this.lastHp > 0 &&
      this.lastHp < snap.maxHp &&
      snap.hp >= snap.maxHp &&
      dist > 64;

    if (sawHpZero || coalescedRevive) {
      this.player.setPosition(snap.x, snap.y);
    }

    this.lastHp = snap.hp;
  }

  private pullOwnSheet(): void {
    const snap = this.readOwnSnapshot();
    if (!snap) return;
    const key = sheetKey(snap);
    if (key === this.lastSheetKey) return;
    this.lastSheetKey = key;
    this.onSheetChange?.(snap);
  }

  private applyServerSlots(slots: ItemSnapshot[]): void {
    this.lastSlotsKey = JSON.stringify(slots);
    this.inventory.applySnapshot(slots);
  }

  private waitForOwnPlayer(): Promise<void> {
    return new Promise((resolve) => {
      const room = this.room;
      if (!room) {
        resolve();
        return;
      }

      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        clearInterval(poll);
        room.onStateChange.remove(onChange);
        resolve();
      };

      const onChange = () => {
        if (this.readOwnSnapshot()) finish();
      };

      const timeout = setTimeout(() => {
        console.warn("[network] timed out waiting for player state", {
          sessionId: room.sessionId,
          hasPlayers: Boolean(
            (room.state as RoomStateLike | undefined)?.players,
          ),
        });
        finish();
      }, STATE_WAIT_MS);

      const poll = setInterval(() => {
        if (this.readOwnSnapshot()) finish();
      }, 50);

      room.onStateChange(onChange);
      if (this.readOwnSnapshot()) finish();
    });
  }

  private scheduleSave(): void {
    if (!this.room) return;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flushSave();
    }, SAVE_THROTTLE_MS);
  }

  private cancelScheduledSave(): void {
    if (!this.saveTimer) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
  }

  private scheduleMove(): void {
    if (!this.room) return;
    if (this.moveTimer) return;
    this.moveTimer = setTimeout(() => {
      this.moveTimer = null;
      this.flushMove();
    }, MOVE_THROTTLE_MS);
  }

  private flushMove(): void {
    if (!this.room) return;
    const { x, y } = this.player.position;
    this.room.send("move", { x, y });
  }

  private flushSave(): void {
    if (!this.room) return;
    const { x, y } = this.player.position;
    // Pose only — inventory mutations are server-authoritative.
    this.room.send("save", { x, y });
  }

  private readOwnSnapshot(): NetworkPlayerSnapshot | null {
    if (!this.room) return null;
    const state = this.room.state as RoomStateLike | undefined;
    const players = state?.players;
    if (!players) return null;

    const mine = players.get(this.room.sessionId);
    if (!mine) return null;

    const slots: NetworkPlayerSnapshot["slots"] = [];
    for (let i = 0; i < mine.slots.length; i++) {
      const slot = mine.slots[i];
      slots.push({
        itemId: slot?.itemId ?? "",
        quantity: slot?.quantity ?? 0,
        instanceId: slot?.instanceId ?? "",
        rarity: parseRarity(slot?.rarity),
        affixes: parseAffixes(slot?.affixesJson),
        durability: Math.max(0, Math.floor(slot?.durability ?? 0)),
        maxDurability: Math.max(0, Math.floor(slot?.maxDurability ?? 0)),
      });
    }

    const equipment: NetworkPlayerSnapshot["equipment"] = [];
    const rawEq = mine.equipment;
    if (rawEq) {
      for (let i = 0; i < rawEq.length; i++) {
        const slot = rawEq[i];
        equipment.push({
          slotId: slot?.slotId ?? "",
          itemId: slot?.itemId ?? "",
          quantity: slot?.quantity ?? 0,
          instanceId: slot?.instanceId ?? "",
          rarity: parseRarity(slot?.rarity),
          affixes: parseAffixes(slot?.affixesJson),
          durability: Math.max(0, Math.floor(slot?.durability ?? 0)),
          maxDurability: Math.max(0, Math.floor(slot?.maxDurability ?? 0)),
        });
      }
    }

    const bags: string[] = [];
    const rawBags = mine.bags;
    if (rawBags) {
      for (let i = 0; i < rawBags.length; i++) {
        bags.push(rawBags[i]?.itemId ?? "");
      }
    }

    const professions: ProfessionSnapshot[] = [];
    const rawProfessions = mine.professions;
    if (rawProfessions) {
      for (let i = 0; i < rawProfessions.length; i++) {
        const profession = rawProfessions[i];
        if (!profession?.professionId) continue;
        professions.push({
          professionId: profession.professionId,
          level: profession.level ?? 1,
          experience: profession.experience ?? 0,
          experienceToLevel: profession.experienceToLevel ?? 0,
        });
      }
    }

    const quests: QuestSnapshot[] = [];
    const rawQuests = mine.quests;
    if (rawQuests) {
      for (let i = 0; i < rawQuests.length; i++) {
        const quest = rawQuests[i];
        if (!quest?.questId) continue;
        quests.push({
          questId: quest.questId,
          status:
            quest.status === "completed"
              ? "completed"
              : quest.status === "ready_to_claim"
                ? "ready_to_claim"
                : "active",
          progress: Math.max(0, quest.progress ?? 0),
        });
      }
    }

    return {
      mapId: mine.mapId || "hunting_grounds",
      x: mine.x,
      y: mine.y,
      hp: mine.hp ?? 100,
      maxHp: mine.maxHp ?? 100,
      isNew: Boolean(mine.isNew),
      name: mine.name || "Wędrowiec",
      classId: mine.classId || "warrior",
      level: mine.level ?? 1,
      experience: mine.experience ?? 0,
      experienceToLevel: mine.experienceToLevel ?? 0,
      strength: (mine.strength ?? 10) + (mine.bonusStrength ?? 0),
      agility: (mine.agility ?? 10) + (mine.bonusAgility ?? 0),
      stamina: (mine.stamina ?? 10) + (mine.bonusStamina ?? 0),
      intellect: (mine.intellect ?? 10) + (mine.bonusIntellect ?? 0),
      spirit: (mine.spirit ?? 10) + (mine.bonusSpirit ?? 0),
      attackPower: mine.attackPower ?? 10,
      damageMin: mine.damageMin ?? mine.attackPower ?? 10,
      damageMax: mine.damageMax ?? mine.attackPower ?? 10,
      moveSpeed: mine.moveSpeed ?? 110,
      armor: mine.armor ?? 0,
      gold: mine.gold ?? 0,
      unspentAttrPoints: mine.unspentAttrPoints ?? 0,
      professions,
      quests,
      slots,
      equipment,
      bags,
    };
  }
}

function sheetKey(snap: NetworkPlayerSnapshot): string {
  return JSON.stringify({
    name: snap.name,
    classId: snap.classId,
    level: snap.level,
    experience: snap.experience,
    experienceToLevel: snap.experienceToLevel,
    hp: snap.hp,
    maxHp: snap.maxHp,
    attackPower: snap.attackPower,
    damageMin: snap.damageMin,
    damageMax: snap.damageMax,
    moveSpeed: snap.moveSpeed,
    armor: snap.armor,
    gold: snap.gold,
    unspentAttrPoints: snap.unspentAttrPoints,
    strength: snap.strength,
    agility: snap.agility,
    stamina: snap.stamina,
    intellect: snap.intellect,
    spirit: snap.spirit,
    equipment: snap.equipment,
    professions: snap.professions,
    quests: snap.quests,
  });
}

function parseRarity(value: string | undefined): ItemRarity {
  return value === "uncommon" ||
    value === "rare" ||
    value === "epic" ||
    value === "poor"
    ? value
    : "common";
}

function parseAffixes(raw: string | undefined): ItemAffix[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const candidate = entry as Partial<ItemAffix>;
      if (
        typeof candidate.id !== "string" ||
        typeof candidate.stat !== "string" ||
        typeof candidate.value !== "number"
      )
        return [];
      return [
        {
          id: candidate.id,
          stat: candidate.stat as ItemAffix["stat"],
          value: Math.max(0, Math.floor(candidate.value)),
        },
      ];
    });
  } catch {
    return [];
  }
}
