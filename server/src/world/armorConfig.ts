import { getItemConfig } from "./itemConfig.js";
import { affixTotal, type AffixStat } from "./itemization.js";

/**
 * Diminishing-returns constant: reduction = armor / (armor + K).
 * At K = 100 the full starter leather set (29) shaves ~22%, and stacking never
 * reaches immunity.
 */
const ARMOR_K = 100;

/** Equipment slot an item may be worn in, or null when it is not gear. */
export function equipSlotOf(itemId: string): string | null {
  if (!itemId) return null;
  return getItemConfig(itemId)?.slot ?? null;
}

/** Armor contributed by a single item id. */
export function armorOf(itemId: string, affixesJson = "[]"): number {
  if (!itemId) return 0;
  return (getItemConfig(itemId)?.armor ?? 0) + affixTotal(affixesJson, "armor");
}

/** Flat weapon damage contributed by a single item id (average of range). */
export function damageOf(itemId: string): number {
  if (!itemId) return 0;
  return getItemConfig(itemId)?.damage ?? 0;
}

/** Weapon damage floor for a single item id. */
export function damageMinOf(itemId: string, affixesJson = "[]"): number {
  if (!itemId) return 0;
  return (
    (getItemConfig(itemId)?.damageMin ?? 0) +
    affixTotal(affixesJson, "damageMin")
  );
}

/** Weapon damage ceiling for a single item id. */
export function damageMaxOf(itemId: string, affixesJson = "[]"): number {
  if (!itemId) return 0;
  return (
    (getItemConfig(itemId)?.damageMax ?? 0) +
    affixTotal(affixesJson, "damageMax")
  );
}

/** Bonus primary attribute on a rolled item. */
export function attributeBonusOf(
  affixesJson: string,
  stat: Extract<
    AffixStat,
    "strength" | "agility" | "stamina" | "intellect" | "spirit"
  >,
): number {
  return affixTotal(affixesJson, stat);
}

/** Swing speed multiplier for a weapon item; 1 when missing. */
export function attackSpeedOf(itemId: string): number {
  if (!itemId) return 1;
  return getItemConfig(itemId)?.attackSpeed ?? 1;
}

/** Fraction of incoming damage removed by this much armor (0..1). */
export function damageReduction(armor: number): number {
  if (armor <= 0) return 0;
  return armor / (armor + ARMOR_K);
}

/** Applies armor to a raw hit; always leaves at least 1 damage. */
export function mitigate(rawDamage: number, armor: number): number {
  if (rawDamage <= 0) return 0;
  const reduced = rawDamage * (1 - damageReduction(armor));
  return Math.max(1, Math.round(reduced));
}
