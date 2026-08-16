import type { ItemAffix, ItemRarity } from "../content/items";

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
  /** Class combat resource kind (`none` / `rage` / `mana` / `energy`). */
  resourceKind: string;
  resource: number;
  maxResource: number;
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

export interface CampfirePlacedEvent {
  id: string;
  mapId: string;
  x: number;
  y: number;
  ownerPlayerId: string;
}

export interface CampfireRemovedEvent {
  id: string;
}

export interface CampfiresStateEvent {
  campfires: CampfirePlacedEvent[];
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

export interface MapTransitionRejectedEvent {
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
