import type { ItemConfig } from "./itemConfig.js";

/** One wear point is lost by the active weapon on an accepted attack/cast. */
export const WEAPON_DURABILITY_LOSS_PER_ACTION = 1;
/** One armor piece loses this much when a creature lands a hit. */
export const ARMOR_DURABILITY_LOSS_PER_HIT = 1;
/** Death damage mirrors WoW's meaningful, but non-destructive, repair pressure. */
export const DEATH_DURABILITY_LOSS_RATE = 0.1;
/** Full repair costs 30% of the item's vendor purchase value. */
export const FULL_REPAIR_PRICE_RATE = 0.3;

export function isRepairable(maxDurability: number): boolean {
  return Number.isFinite(maxDurability) && maxDurability > 0;
}

export function isBroken(durability: number, maxDurability: number): boolean {
  return isRepairable(maxDurability) && durability <= 0;
}

export function deathDurabilityLoss(maxDurability: number): number {
  if (!isRepairable(maxDurability)) return 0;
  return Math.max(1, Math.ceil(maxDurability * DEATH_DURABILITY_LOSS_RATE));
}

/** Server and client display use this formula; server remains authoritative. */
export function repairCost(
  item: Pick<ItemConfig, "buyPrice">,
  durability: number,
  maxDurability: number,
): number {
  if (!isRepairable(maxDurability)) return 0;
  const missing = Math.max(
    0,
    Math.min(maxDurability, maxDurability - durability),
  );
  if (missing === 0) return 0;
  const fullRepairPrice = Math.max(
    1,
    Math.ceil(item.buyPrice * FULL_REPAIR_PRICE_RATE),
  );
  return Math.max(1, Math.ceil((fullRepairPrice * missing) / maxDurability));
}
