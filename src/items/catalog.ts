import { load } from "js-yaml";
import { ITEM_WORLD_SCALE } from "../config/constants";
import itemsYaml from "../data/items.yaml?raw";

export type ItemId = string;

export type ItemRarity = "poor" | "common" | "uncommon" | "rare" | "epic";

export type ItemAffixStat =
  | "strength"
  | "agility"
  | "stamina"
  | "intellect"
  | "spirit"
  | "armor"
  | "damageMin"
  | "damageMax";

export interface ItemAffix {
  id: string;
  stat: ItemAffixStat;
  value: number;
}

export interface ItemInstance {
  itemId: ItemId;
  quantity: number;
  instanceId: string;
  rarity: ItemRarity;
  affixes: ItemAffix[];
  /** Current item wear; zero means the item is broken. */
  durability: number;
  /** Per-instance maximum copied from the server-authoritative item config. */
  maxDurability: number;
}

const AFFIX_LABELS: Record<ItemAffixStat, string> = {
  strength: "Siły",
  agility: "Zręczności",
  stamina: "Wytrzymałości",
  intellect: "Inteligencji",
  spirit: "Ducha",
  armor: "Pancerza",
  damageMin: "minimalnych obrażeń",
  damageMax: "maksymalnych obrażeń",
};

export function affixLabel(affix: ItemAffix): string {
  return `+${affix.value} ${AFFIX_LABELS[affix.stat]}`;
}

export function itemRarity(
  item: Pick<ItemDefinition, "rarity">,
  instance?: Pick<ItemInstance, "rarity"> | null,
): ItemRarity {
  return instance?.rarity ?? item.rarity;
}

export function itemRarityLabel(rarity: ItemRarity): string {
  return {
    poor: "Słaby",
    common: "Pospolity",
    uncommon: "Niezwykły",
    rare: "Rzadki",
    epic: "Epicki",
  }[rarity];
}

export interface ItemDefinition {
  id: ItemId;
  name: string;
  description: string;
  icon: string;
  /** Pixi scale for world pickups (icons are standardized to 32px content). */
  worldScale: number;
  type: string;
  typeLabel: string;
  rarity: ItemRarity;
  rarityLabel: string;
  stackable: boolean;
  maxStack: number;
  /** Null when the item has no action-bar effect. */
  use: ItemUseEffect | null;
  /** Inventory slots granted when equipped as a bag; 0 for non-containers. */
  capacity: number;
  /** Equipment slot this item fits, or null when it is not wearable. */
  slot: string | null;
  /** Damage-reduction contribution while equipped. */
  armor: number;
  /** Flat attack bonus while equipped (weapons) — average of min/max. */
  damage: number;
  /** Weapon damage floor while equipped. */
  damageMin: number;
  /** Weapon damage ceiling while equipped. */
  damageMax: number;
  /** Swing speed multiplier (1 = normal). */
  attackSpeed: number;
  /** 0 means this item never takes durability damage. */
  maxDurability: number;
  /** Vendor list price; 0 = not sold. */
  buyPrice: number;
  /** What vendors pay the player; 0 = unsellable. */
  sellPrice: number;
}

export interface ItemUseEffect {
  heal: number;
  cooldownMs: number;
}

interface ItemYamlEntry {
  name: string;
  description: string;
  icon: string;
  worldScale?: number;
  type: string;
  typeLabel: string;
  rarity: ItemRarity;
  rarityLabel: string;
  stackable?: boolean;
  maxStack?: number;
  use?: {
    heal?: number;
    cooldownMs?: number;
  };
  capacity?: number;
  slot?: string;
  armor?: number;
  damage?: number;
  damageMin?: number;
  damageMax?: number;
  attackSpeed?: number;
  maxDurability?: number;
  buyPrice?: number;
  sellPrice?: number;
}

interface ItemsYamlFile {
  items: Record<string, ItemYamlEntry>;
}

let catalog: Record<ItemId, ItemDefinition> = {};

const SELL_PRICE_RATIO = 0.35;
/** Must match server/world/durabilityConfig.ts; server validates every charge. */
export const FULL_REPAIR_PRICE_RATE = 0.3;

export function repairCost(
  item: Pick<ItemDefinition, "buyPrice">,
  instance: Pick<ItemInstance, "durability" | "maxDurability">,
): number {
  if (instance.maxDurability <= 0) return 0;
  const missing = Math.max(
    0,
    Math.min(
      instance.maxDurability,
      instance.maxDurability - instance.durability,
    ),
  );
  if (missing === 0) return 0;
  const fullPrice = Math.max(
    1,
    Math.ceil(item.buyPrice * FULL_REPAIR_PRICE_RATE),
  );
  return Math.max(1, Math.ceil((fullPrice * missing) / instance.maxDurability));
}

/** Parse weapon damage range; legacy `damage` becomes min = max. */
function parseDamageRange(entry: ItemYamlEntry): {
  damageMin: number;
  damageMax: number;
  damage: number;
} {
  let min = 0;
  let max = 0;
  if (
    typeof entry.damageMin === "number" ||
    typeof entry.damageMax === "number"
  ) {
    min = Math.max(0, Math.floor(entry.damageMin ?? entry.damageMax ?? 0));
    max = Math.max(0, Math.floor(entry.damageMax ?? entry.damageMin ?? 0));
  } else if (typeof entry.damage === "number") {
    min = max = Math.max(0, Math.floor(entry.damage));
  }
  if (max < min) {
    const swap = min;
    min = max;
    max = swap;
  }
  return {
    damageMin: min,
    damageMax: max,
    damage: Math.floor((min + max) / 2),
  };
}

export async function loadItemCatalog(): Promise<void> {
  const parsed = load(itemsYaml) as ItemsYamlFile;

  if (!parsed?.items || typeof parsed.items !== "object") {
    throw new Error("Invalid items.yaml: missing items map");
  }

  const next: Record<ItemId, ItemDefinition> = {};

  for (const [id, entry] of Object.entries(parsed.items)) {
    const buyPrice = Math.max(0, Math.floor(entry.buyPrice ?? 0));
    const sellPrice =
      typeof entry.sellPrice === "number"
        ? Math.max(0, Math.floor(entry.sellPrice))
        : Math.floor(buyPrice * SELL_PRICE_RATIO);
    next[id] = {
      id,
      name: entry.name,
      description: entry.description.trim(),
      icon: entry.icon,
      worldScale: entry.worldScale ?? ITEM_WORLD_SCALE,
      type: entry.type,
      typeLabel: entry.typeLabel,
      rarity: entry.rarity,
      rarityLabel: entry.rarityLabel,
      stackable: entry.stackable ?? false,
      maxStack: Math.max(1, Math.floor(entry.maxStack ?? 1)),
      use: entry.use
        ? {
            heal: Math.max(0, Math.floor(entry.use.heal ?? 0)),
            cooldownMs: Math.max(0, Math.floor(entry.use.cooldownMs ?? 0)),
          }
        : null,
      capacity: Math.max(0, Math.floor(entry.capacity ?? 0)),
      slot: entry.slot ?? null,
      armor: Math.max(0, Math.floor(entry.armor ?? 0)),
      ...parseDamageRange(entry),
      attackSpeed: Math.max(0.1, entry.attackSpeed ?? 1),
      maxDurability: Math.max(0, Math.floor(entry.maxDurability ?? 0)),
      buyPrice,
      sellPrice,
    };
  }

  catalog = next;
}

export function getItem(id: ItemId): ItemDefinition {
  const item = catalog[id];
  if (!item) {
    throw new Error(`Unknown item id: ${id}`);
  }
  return item;
}

export function hasItem(id: ItemId): boolean {
  return id in catalog;
}

/** True when the item can be used from the action bar / hotkeys. */
export function isUsableItem(id: ItemId): boolean {
  return Boolean(hasItem(id) && getItem(id).use);
}

/**
 * Legacy id remaps so action-bar bindings survive renames
 * (e.g. health_potion → health_potion_v2).
 */
const ITEM_ID_ALIASES: Record<string, string> = {
  health_potion: "health_potion_v2",
};

export function canonicalItemId(id: string): string {
  return ITEM_ID_ALIASES[id] ?? id;
}

export function itemIdsMatch(a: string, b: string): boolean {
  return canonicalItemId(a) === canonicalItemId(b);
}
