import type { Client } from "colyseus";
import type { AnimalAi } from "./AnimalAi.js";
import type { ItemInstanceData } from "./itemization.js";
import type { MapCircleCollider, MapDocument } from "../maps/loadMap.js";
import type {
  AnimalState,
  EquipmentSlotState,
  GameState,
  PlayerState,
} from "../schema/GameState.js";
import type { QuestProgressEvent } from "./questEvents.js";

/** Facade systems use instead of importing WorldRoom (avoids circular modules). */
export interface WorldHost {
  readonly state: GameState;
  readonly clients: Client[];
  readonly maps: Map<string, MapDocument>;
  readonly mapColliders: Map<string, MapCircleCollider[]>;
  readonly animalAi: AnimalAi;

  livingPlayer(client: Client): PlayerState | null;
  mapForPlayer(player: PlayerState): MapDocument;
  applyClientPosition(player: PlayerState, x: unknown, y: unknown): void;
  persistPlayer(player: PlayerState): void;
  refreshAllClientViews(): void;
  recomputeGearStats(player: PlayerState): void;
  grantExperience(
    client: Client,
    player: PlayerState,
    amount: number,
    source?: { kind: string; animalId: string },
  ): void;
  recordQuestEvent(
    client: Client,
    player: PlayerState,
    event: QuestProgressEvent,
  ): void;
  applyAnimalHit(
    client: Client,
    player: PlayerState,
    animal: AnimalState,
    damage: number,
  ): void;
  spawnPickup(
    item: ItemInstanceData,
    mapId: string,
    x: number,
    y: number,
    collectableAt: number,
  ): void;
  /** Empty corpse → schedule the short despawn; no-op while loot remains. */
  noteCorpseLooted(animal: AnimalState): void;
  broadcast(type: string, message?: unknown): void;
  equipmentSlot(player: PlayerState, slotId: string): EquipmentSlotState | null;
  stowEquipmentSlot(
    player: PlayerState,
    slotId: string,
    reservedIndexes?: number[],
  ): boolean;
  tailEmpty(player: PlayerState, capacity: number): boolean;
  resizeSlots(player: PlayerState, capacity: number): void;
  findNpc(
    player: PlayerState,
    instanceId: string,
  ): { id: string; npcId: string; x: number; y: number } | null;
  withinNpcRange(player: PlayerState, npc: { x: number; y: number }): boolean;
  isNearNpcId(player: PlayerState, npcId: string): boolean;
  hasProfession(player: PlayerState, professionId: string): boolean;
  professionState(
    player: PlayerState,
    professionId: string,
  ): import("../schema/GameState.js").ProfessionState | null;
  learnProfession(
    player: PlayerState,
    professionId: string,
  ): import("../schema/GameState.js").ProfessionState | null;
  hasItemQuantity(
    player: PlayerState,
    itemId: string,
    quantity: number,
  ): boolean;
  canFitCraftOutput(
    player: PlayerState,
    ingredients: Array<{ itemId: string; quantity: number }>,
    output: ItemInstanceData,
  ): boolean;
  isAtCraftStation(
    player: PlayerState,
    stationKind: "cooking" | "forge",
  ): boolean;
  playerHasGatheringTool(player: PlayerState, requiredTool: string): boolean;
  weaponAttackSpeed(player: PlayerState): number;
  equippedWeaponDamageRange(player: PlayerState): { min: number; max: number };
  damageWeaponFromAction(player: PlayerState, sessionId: string): void;
  nearestHome(
    player: PlayerState,
    x: number,
    y: number,
  ): { id: string; name: string; x: number; y: number };
}
