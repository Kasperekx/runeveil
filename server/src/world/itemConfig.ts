import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "js-yaml";

export interface ItemUseEffect {
  heal: number;
  cooldownMs: number;
}

/** Fallback when sellPrice is omitted: floor(buyPrice * ratio). */
export const SELL_PRICE_RATIO = 0.35;

export interface ItemConfig {
  id: string;
  name: string;
  stackable: boolean;
  maxStack: number;
  /** Absent when the item cannot be used from the action bar. */
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
  /** Swing speed multiplier (1 = normal); higher = faster swings. */
  attackSpeed: number;
  /** 0 means this item is not repairable and never loses durability. */
  maxDurability: number;
  /** Vendor list price; 0 = not sold by shops. */
  buyPrice: number;
  /** What the vendor pays the player per unit. */
  sellPrice: number;
}

interface ItemYamlEntry {
  name: string;
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

/** Shared with client: src/data/items.yaml */
function loadYaml(): ItemsYamlFile {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = join(here, "../../../src/data/items.yaml");
  const parsed = load(readFileSync(path, "utf8")) as ItemsYamlFile;
  if (!parsed?.items) {
    throw new Error(`Invalid items.yaml at ${path}`);
  }
  return parsed;
}

const yaml = loadYaml();

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

export const ITEMS: Record<string, ItemConfig> = Object.fromEntries(
  Object.entries(yaml.items).map(([id, entry]) => {
    const buyPrice = Math.max(0, Math.floor(entry.buyPrice ?? 0));
    const sellPrice =
      typeof entry.sellPrice === "number"
        ? Math.max(0, Math.floor(entry.sellPrice))
        : Math.floor(buyPrice * SELL_PRICE_RATIO);
    return [
      id,
      {
        id,
        name: entry.name,
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
      },
    ];
  }),
);

export function getItemConfig(itemId: string): ItemConfig | null {
  return ITEMS[itemId] ?? null;
}

/**
 * Legacy remaps so stacks survive id renames
 * (e.g. health_potion ↔ health_potion_v2).
 */
const ITEM_ID_ALIASES: Record<string, string> = {
  health_potion: "health_potion_v2",
};

export function canonicalItemId(itemId: string): string {
  return ITEM_ID_ALIASES[itemId] ?? itemId;
}

export function itemIdsMatch(a: string, b: string): boolean {
  return canonicalItemId(a) === canonicalItemId(b);
}

export function buyPriceOf(itemId: string): number {
  return getItemConfig(itemId)?.buyPrice ?? 0;
}

export function sellPriceOf(itemId: string): number {
  return getItemConfig(itemId)?.sellPrice ?? 0;
}
