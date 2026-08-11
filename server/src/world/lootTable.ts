export interface LootTableEntry {
  itemId: string;
  /** Percent chance in the inclusive range 0..100. */
  chance: number;
  minQuantity: number;
  maxQuantity: number;
  /** Entries in one group share a single roll and are mutually exclusive. */
  group: string | null;
}

export interface RolledLoot {
  itemId: string;
  quantity: number;
}

export type LootRandom = () => number;

function quantityFor(entry: LootTableEntry, random: LootRandom): number {
  if (entry.maxQuantity <= entry.minQuantity) return entry.minQuantity;
  return (
    entry.minQuantity +
    Math.floor(random() * (entry.maxQuantity - entry.minQuantity + 1))
  );
}

/**
 * Rolls one server-authored loot table exactly once.
 * Ungrouped entries roll independently. A named group consumes one percentile
 * roll and can yield at most one entry; unused probability means no group drop.
 */
export function rollLootTable(
  entries: readonly LootTableEntry[],
  random: LootRandom = Math.random,
): RolledLoot[] {
  const drops: RolledLoot[] = [];
  const groups = new Map<string, LootTableEntry[]>();

  for (const entry of entries) {
    if (entry.group) {
      const group = groups.get(entry.group) ?? [];
      group.push(entry);
      groups.set(entry.group, group);
      continue;
    }
    if (random() * 100 >= entry.chance) continue;
    drops.push({
      itemId: entry.itemId,
      quantity: quantityFor(entry, random),
    });
  }

  for (const group of groups.values()) {
    const roll = random() * 100;
    let threshold = 0;
    for (const entry of group) {
      threshold += entry.chance;
      if (roll >= threshold) continue;
      drops.push({
        itemId: entry.itemId,
        quantity: quantityFor(entry, random),
      });
      break;
    }
  }

  return drops;
}

export function validateLootTable(
  creatureId: string,
  entries: readonly LootTableEntry[],
): void {
  const groupTotals = new Map<string, number>();
  for (const entry of entries) {
    if (!entry.itemId) {
      throw new Error(`Invalid loot table for ${creatureId}: empty item id`);
    }
    if (
      !Number.isFinite(entry.chance) ||
      entry.chance < 0 ||
      entry.chance > 100
    ) {
      throw new Error(
        `Invalid loot table for ${creatureId}/${entry.itemId}: chance must be 0..100`,
      );
    }
    if (
      !Number.isInteger(entry.minQuantity) ||
      !Number.isInteger(entry.maxQuantity) ||
      entry.minQuantity < 1 ||
      entry.maxQuantity < entry.minQuantity
    ) {
      throw new Error(
        `Invalid loot table for ${creatureId}/${entry.itemId}: quantity range is invalid`,
      );
    }
    if (!entry.group) continue;
    groupTotals.set(
      entry.group,
      (groupTotals.get(entry.group) ?? 0) + entry.chance,
    );
  }
  for (const [group, total] of groupTotals) {
    if (total > 100) {
      throw new Error(
        `Invalid loot table for ${creatureId}: group "${group}" totals ${total}%`,
      );
    }
  }
}
