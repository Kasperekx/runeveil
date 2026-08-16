import { getItemConfig } from "../content/itemConfig.js";

/** Slots with no bags equipped (main backpack is bag socket 0). */
export const BASE_SLOTS = 0;

/** Four bag sockets; index 0 is the preferred starter backpack socket. */
export const BAG_SLOT_COUNT = 4;
/** Preferred starter socket — locked; bags unequip only from sockets 1–3. */
export const MAIN_BAG_INDEX = 0;
/** Starter loadout: leather backpack in socket 0 (capacity 8 → 8 inventory slots). */
export const STARTER_BAGS = ["backpack", "", "", ""] as const;

/** Capacity granted by one bag item id; 0 for empty / non-containers. */
export function bagCapacity(itemId: string): number {
  if (!itemId) return 0;
  return getItemConfig(itemId)?.capacity ?? 0;
}

/** Total inventory slots for a set of equipped bag item ids. */
export function totalCapacity(bags: readonly string[]): number {
  let capacity = BASE_SLOTS;
  for (const itemId of bags) capacity += bagCapacity(itemId);
  return capacity;
}
