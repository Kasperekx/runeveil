import { schema, type SchemaType } from "@colyseus/schema";

/** Empty itemId means empty slot. */
export const InventorySlotState = schema({
  itemId: { type: "string", default: "" },
  quantity: { type: "number", default: 0 },
  /** Stable id for rolled / non-stackable item instances. */
  instanceId: { type: "string", default: "" },
  /** Quality generated for this exact item instance. */
  rarity: { type: "string", default: "common" },
  /** Serialized affix list; strings keep the wire schema compact and stable. */
  affixesJson: { type: "string", default: "[]" },
  durability: { type: "number", default: 0 },
  maxDurability: { type: "number", default: 0 },
});
export type InventorySlotState = SchemaType<typeof InventorySlotState>;

export const EquipmentSlotState = schema({
  slotId: { type: "string", default: "" },
  itemId: { type: "string", default: "" },
  quantity: { type: "number", default: 0 },
  instanceId: { type: "string", default: "" },
  rarity: { type: "string", default: "common" },
  affixesJson: { type: "string", default: "[]" },
  durability: { type: "number", default: 0 },
  maxDurability: { type: "number", default: 0 },
});
export type EquipmentSlotState = SchemaType<typeof EquipmentSlotState>;

/** One independently levelled trade profession. */
export const ProfessionState = schema({
  professionId: { type: "string", default: "" },
  level: { type: "number", default: 1 },
  /** XP banked toward this profession's next level. */
  experience: { type: "number", default: 0 },
  /** XP needed for the next rank; 0 at profession cap. */
  experienceToLevel: { type: "number", default: 0 },
});
export type ProfessionState = SchemaType<typeof ProfessionState>;

/** Server-authoritative progress for one accepted quest. */
export const QuestState = schema({
  questId: { type: "string", default: "" },
  /** YAML content version used to create this progress record. */
  definitionVersion: { type: "number", default: 1 },
  /** active | ready_to_claim | completed */
  status: { type: "string", default: "active" },
  progress: { type: "number", default: 0 },
});
export type QuestState = SchemaType<typeof QuestState>;

export const PlayerState = schema({
  playerId: { type: "string", default: "" },
  /** Authoritative zone/map membership. */
  mapId: { type: "string", default: "hunting_grounds" },
  name: { type: "string", default: "Wędrowiec" },
  classId: { type: "string", default: "warrior" },
  level: { type: "number", default: 1 },
  /** XP banked toward the next level (resets each level-up). */
  experience: { type: "number", default: 0 },
  /** XP required to reach the next level; 0 once max level is reached. */
  experienceToLevel: { type: "number", default: 0 },
  x: { type: "number", default: 0 },
  y: { type: "number", default: 0 },
  hp: { type: "number", default: 100 },
  maxHp: { type: "number", default: 100 },
  strength: { type: "number", default: 10 },
  agility: { type: "number", default: 10 },
  stamina: { type: "number", default: 10 },
  intellect: { type: "number", default: 10 },
  spirit: { type: "number", default: 10 },
  /** Primary-attribute bonuses supplied by equipped rolled items. */
  bonusStrength: { type: "number", default: 0 },
  bonusAgility: { type: "number", default: 0 },
  bonusStamina: { type: "number", default: 0 },
  bonusIntellect: { type: "number", default: 0 },
  bonusSpirit: { type: "number", default: 0 },
  /** Derived melee damage from strength (+ class base) — average of range. */
  attackPower: { type: "number", default: 10 },
  /** Auto-attack damage floor (bonus + weapon min). */
  damageMin: { type: "number", default: 1 },
  /** Auto-attack damage ceiling (bonus + weapon max). */
  damageMax: { type: "number", default: 1 },
  /** Walk speed in px/s (level-scaled, server authoritative). */
  moveSpeed: { type: "number", default: 110 },
  /** Sum of equipped gear armor; reduces incoming damage. */
  armor: { type: "number", default: 0 },
  /**
   * Class combat resource (rage / mana / energy).
   * Kind is "none" for classes without a bar; value is ephemeral (not DB-persisted).
   */
  resourceKind: { type: "string", default: "none" },
  resource: { type: "number", default: 0 },
  maxResource: { type: "number", default: 0 },
  /** True when no save exists yet — client should keep local spawn and persist. */
  isNew: { type: "boolean", default: false },
  slots: { array: InventorySlotState },
  equipment: { array: EquipmentSlotState },
  /** Equipped bags (itemId per socket, "" = empty); drives slots capacity. */
  bags: { array: InventorySlotState },
  /** Trade-profession progression (separate from combat level). */
  professions: { array: ProfessionState },
  /** Accepted and completed quests, synchronized to the journal. */
  quests: { array: QuestState },
  /** Wallet — vendor currency. */
  gold: { type: "number", default: 0 },
  /** Attribute points waiting to be spent after level-ups. */
  unspentAttrPoints: { type: "number", default: 0 },
  /** Bumped on each accepted melee hit — remotes play swing anim. */
  attackSeq: { type: "number", default: 0 },
  /** Facing used for the last accepted swing. */
  attackDir: { type: "string", default: "down" },
});
export type PlayerState = SchemaType<typeof PlayerState>;

export const AnimalState = schema({
  id: { type: "string", default: "" },
  mapId: { type: "string", default: "hunting_grounds" },
  kind: { type: "string", default: "" },
  x: { type: "number", default: 0 },
  y: { type: "number", default: 0 },
  hp: { type: "number", default: 1 },
  maxHp: { type: "number", default: 1 },
  alive: { type: "boolean", default: true },
  /**
   * While dead: unix ms when this corpse should despawn.
   * Living animals keep 0. Independent of the spawn slot's respawn timer —
   * a new living id can appear while the corpse is still on the ground.
   */
  respawnAt: { type: "number", default: 0 },
  /** Corpse loot (only meaningful while dead). */
  loot: { array: InventorySlotState },
});
export type AnimalState = SchemaType<typeof AnimalState>;

export const PickupState = schema({
  id: { type: "string", default: "" },
  mapId: { type: "string", default: "hunting_grounds" },
  itemId: { type: "string", default: "" },
  quantity: { type: "number", default: 1 },
  instanceId: { type: "string", default: "" },
  rarity: { type: "string", default: "common" },
  affixesJson: { type: "string", default: "[]" },
  durability: { type: "number", default: 0 },
  maxDurability: { type: "number", default: 0 },
  x: { type: "number", default: 0 },
  y: { type: "number", default: 0 },
  /** Unix ms when pickup becomes collectable. */
  collectableAt: { type: "number", default: 0 },
});
export type PickupState = SchemaType<typeof PickupState>;

export const GameState = schema({
  /** View-scoped collections: clients receive entities from their map only. */
  players: { map: PlayerState, view: true },
  animals: { map: AnimalState, view: true },
  pickups: { map: PickupState, view: true },
});
export type GameState = SchemaType<typeof GameState>;
