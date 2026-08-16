import { getItemConfig } from "../content/itemConfig.js";

export type ItemRarity = "common" | "uncommon" | "rare" | "epic";
export type AffixStat =
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
  stat: AffixStat;
  value: number;
}

export interface ItemInstanceData {
  itemId: string;
  quantity: number;
  instanceId: string;
  rarity: ItemRarity;
  affixesJson: string;
  durability: number;
  maxDurability: number;
}

interface AffixDefinition {
  id: string;
  stat: AffixStat;
  min: number;
  max: number;
  only?: "armor" | "weapon";
}

const AFFIXES: readonly AffixDefinition[] = [
  { id: "strength", stat: "strength", min: 1, max: 3 },
  { id: "agility", stat: "agility", min: 1, max: 3 },
  { id: "stamina", stat: "stamina", min: 1, max: 3 },
  { id: "intellect", stat: "intellect", min: 1, max: 3 },
  { id: "spirit", stat: "spirit", min: 1, max: 3 },
  { id: "reinforced", stat: "armor", min: 1, max: 3, only: "armor" },
  { id: "sharp", stat: "damageMin", min: 1, max: 2, only: "weapon" },
  { id: "deadly", stat: "damageMax", min: 1, max: 3, only: "weapon" },
];

/** Initial tuning: one in four wearable drops becomes green (uncommon). */
export const UNCOMMON_DROP_CHANCE = 0.25;

let nextInstanceId = 0;

export function emptyItemData(itemId = "", quantity = 0): ItemInstanceData {
  return {
    itemId,
    quantity,
    instanceId: "",
    rarity: "common",
    affixesJson: "[]",
    durability: 0,
    maxDurability: 0,
  };
}

/** Create an unrolled item from a vendor, quest, or authored reward. */
export function createItemData(
  itemId: string,
  quantity: number,
): ItemInstanceData {
  const item = getItemConfig(itemId);
  const base = emptyItemData(itemId, Math.max(1, Math.floor(quantity)));
  if (item?.maxDurability && item.maxDurability > 0) {
    base.maxDurability = item.maxDurability;
    base.durability = item.maxDurability;
  }
  return base;
}

export function parseAffixes(raw: string | null | undefined): ItemAffix[] {
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
        typeof candidate.value !== "number" ||
        !Number.isFinite(candidate.value)
      ) {
        return [];
      }
      return [
        {
          id: candidate.id,
          stat: candidate.stat as AffixStat,
          value: Math.max(0, Math.floor(candidate.value)),
        },
      ];
    });
  } catch {
    return [];
  }
}

export function affixTotal(
  raw: string | null | undefined,
  stat: AffixStat,
): number {
  return parseAffixes(raw)
    .filter((affix) => affix.stat === stat)
    .reduce((total, affix) => total + affix.value, 0);
}

/** Roll a server-authoritative instance. Consumables and containers stay plain. */
export function rollLootItem(
  itemId: string,
  quantity: number,
): ItemInstanceData {
  const item = getItemConfig(itemId);
  const base = createItemData(itemId, quantity);
  if (!item || item.stackable || item.capacity > 0 || !item.slot) return base;
  if (Math.random() >= UNCOMMON_DROP_CHANCE) return base;

  const eligible = AFFIXES.filter((affix) => {
    if (affix.only === "armor") return item.armor > 0;
    if (affix.only === "weapon") return item.damageMax > 0;
    return true;
  });
  if (eligible.length === 0) return base;

  const chosen = eligible[Math.floor(Math.random() * eligible.length)]!;
  const value =
    chosen.min + Math.floor(Math.random() * (chosen.max - chosen.min + 1));
  const affixes: ItemAffix[] = [{ id: chosen.id, stat: chosen.stat, value }];
  nextInstanceId += 1;
  return {
    ...base,
    instanceId: `itm_${Date.now().toString(36)}_${nextInstanceId.toString(36)}`,
    rarity: "uncommon",
    affixesJson: JSON.stringify(affixes),
  };
}

/** Unmodified stock / legacy items are intentionally stack-compatible. */
export function isPlainStack(
  data: Pick<
    ItemInstanceData,
    "instanceId" | "rarity" | "affixesJson" | "durability" | "maxDurability"
  >,
): boolean {
  return (
    !data.instanceId &&
    data.rarity === "common" &&
    parseAffixes(data.affixesJson).length === 0 &&
    data.durability === 0 &&
    data.maxDurability === 0
  );
}

/** Makes saves predating durability compatible with the current item definition. */
export function normalizeDurability(
  itemId: string,
  durability: number | null | undefined,
  maxDurability: number | null | undefined,
): Pick<ItemInstanceData, "durability" | "maxDurability"> {
  const configured = getItemConfig(itemId)?.maxDurability ?? 0;
  const persistedMax = Math.max(0, Math.floor(maxDurability ?? 0));
  const max = persistedMax > 0 ? persistedMax : configured;
  if (max <= 0) return { durability: 0, maxDurability: 0 };
  // Existing rows have 0/0 after the migration; they must not become broken.
  const current =
    persistedMax > 0
      ? Math.max(0, Math.min(max, Math.floor(durability ?? max)))
      : max;
  return {
    durability: current,
    maxDurability: max,
  };
}
