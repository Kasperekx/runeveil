import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "js-yaml";

export interface ItemUseBuff {
  durationMs: number;
  strength: number;
  agility: number;
  stamina: number;
  intellect: number;
  spirit: number;
}

export interface ItemUseEffect {
  heal: number;
  cooldownMs: number;
  buff: ItemUseBuff | null;
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
  /** Gathering profession tool tag (e.g. mining); empty when not a tool. */
  gatheringTool: string;
}

interface ItemYamlEntry {
  name: string;
  stackable?: boolean;
  maxStack?: number;
  use?: {
    heal?: number;
    cooldownMs?: number;
    buff?: {
      durationMs?: number;
      strength?: number;
      agility?: number;
      stamina?: number;
      intellect?: number;
      spirit?: number;
    };
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
  gatheringTool?: string;
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

function parseUseEffect(
  entry: ItemYamlEntry["use"],
): ItemUseEffect | null {
  if (!entry) return null;
  const buffEntry = entry.buff;
  const durationMs = Math.max(0, Math.floor(buffEntry?.durationMs ?? 0));
  const strength = Math.max(0, Math.floor(buffEntry?.strength ?? 0));
  const agility = Math.max(0, Math.floor(buffEntry?.agility ?? 0));
  const stamina = Math.max(0, Math.floor(buffEntry?.stamina ?? 0));
  const intellect = Math.max(0, Math.floor(buffEntry?.intellect ?? 0));
  const spirit = Math.max(0, Math.floor(buffEntry?.spirit ?? 0));
  const hasBuff =
    durationMs > 0 &&
    (strength > 0 || agility > 0 || stamina > 0 || intellect > 0 || spirit > 0);
  return {
    heal: Math.max(0, Math.floor(entry.heal ?? 0)),
    cooldownMs: Math.max(0, Math.floor(entry.cooldownMs ?? 0)),
    buff: hasBuff
      ? { durationMs, strength, agility, stamina, intellect, spirit }
      : null,
  };
}

export const ITEMS: Record<string, ItemConfig> = Object.fromEntries(
  Object.entries(yaml.items).map(([id, entry]) => {
    const buyPrice = Math.max(0, Math.floor(entry.buyPrice ?? 0));
    const sellPrice =
      typeof entry.sellPrice === "number"
        ? Math.max(0, Math.floor(entry.sellPrice))
        : Math.floor(buyPrice * SELL_PRICE_RATIO);
    const maxDurability = Math.max(0, Math.floor(entry.maxDurability ?? 0));
    if (entry.slot && maxDurability <= 0) {
      throw new Error(
        `Invalid items.yaml: wearable item "${id}" requires maxDurability`,
      );
    }
    return [
      id,
      {
        id,
        name: entry.name,
        stackable: entry.stackable ?? false,
        maxStack: Math.max(1, Math.floor(entry.maxStack ?? 1)),
        use: parseUseEffect(entry.use),
        capacity: Math.max(0, Math.floor(entry.capacity ?? 0)),
        slot: entry.slot ?? null,
        armor: Math.max(0, Math.floor(entry.armor ?? 0)),
        ...parseDamageRange(entry),
        attackSpeed: Math.max(0.1, entry.attackSpeed ?? 1),
        maxDurability,
        buyPrice,
        sellPrice,
        gatheringTool: (entry.gatheringTool ?? "").trim(),
      },
    ];
  }),
);

export function getItemConfig(itemId: string): ItemConfig | null {
  return ITEMS[canonicalItemId(itemId)] ?? ITEMS[itemId] ?? null;
}

/**
 * Legacy remaps so stacks survive id renames
 * (e.g. health_potion ↔ health_potion_v2).
 */
const ITEM_ID_ALIASES: Record<string, string> = {
  health_potion: "health_potion_v2",
  meat: "deer_meat",
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
