import { InventorySlotState, type PlayerState } from "../schema/GameState.js";
import { MAX_STACK } from "./creatureConfig.js";
import { canonicalItemId, getItemConfig, itemIdsMatch } from "./itemConfig.js";
import {
  emptyItemData,
  isPlainStack,
  type ItemInstanceData,
} from "./itemization.js";

export type SlotItem = ItemInstanceData;

function slotItem(slot: InventorySlotState): SlotItem {
  return {
    itemId: slot.itemId,
    quantity: slot.quantity,
    instanceId: slot.instanceId,
    rarity: slot.rarity as SlotItem["rarity"],
    affixesJson: slot.affixesJson,
    durability: slot.durability,
    maxDurability: slot.maxDurability,
  };
}

function writeSlot(slot: InventorySlotState, data: SlotItem): void {
  slot.itemId = data.itemId;
  slot.quantity = data.quantity;
  slot.instanceId = data.instanceId;
  slot.rarity = data.rarity;
  slot.affixesJson = data.affixesJson;
  slot.durability = data.durability;
  slot.maxDurability = data.maxDurability;
}

function clearSlot(slot: InventorySlotState): void {
  writeSlot(slot, emptyItemData());
}

function canMerge(a: SlotItem, b: SlotItem): boolean {
  return itemIdsMatch(a.itemId, b.itemId) && isPlainStack(a) && isPlainStack(b);
}

/** Per-item stack limit; non-stackables (e.g. bags) never merge. */
function maxStackFor(itemId: string): number {
  const config =
    getItemConfig(itemId) ?? getItemConfig(canonicalItemId(itemId));
  if (!config) return MAX_STACK;
  return config.stackable ? config.maxStack : 1;
}

/**
 * How many units of `itemId` still fit (existing stacks + empty slots).
 * Empty slots each contribute a full maxStack.
 * Legacy aliases (health_potion / health_potion_v2) count as the same stack.
 */
export function freeSpaceFor(
  player: PlayerState,
  item: SlotItem,
  slotCount: number,
): number {
  const maxStack = maxStackFor(item.itemId);
  let space = 0;

  for (let i = 0; i < slotCount; i++) {
    const slot = player.slots.at(i);
    if (!slot?.itemId) {
      space += maxStack;
      continue;
    }
    if (maxStack > 1 && canMerge(slotItem(slot), item)) {
      space += Math.max(0, maxStack - slot.quantity);
    }
  }

  return space;
}

/**
 * Add item into player slots. All-or-nothing: if the full quantity does not
 * fit, mutates nothing and returns false (caller should keep the loot).
 */
export function addItemToPlayer(
  player: PlayerState,
  item: SlotItem,
  slotCount: number,
): boolean {
  if (item.quantity <= 0) return true;
  if (freeSpaceFor(player, item, slotCount) < item.quantity) return false;

  let remaining = item.quantity;
  const maxStack = maxStackFor(item.itemId);
  const storeId = canonicalItemId(item.itemId);

  if (maxStack > 1 && isPlainStack(item)) {
    for (let i = 0; i < slotCount; i++) {
      const slot = player.slots.at(i);
      if (!slot?.itemId || !canMerge(slotItem(slot), item)) continue;
      const room = maxStack - slot.quantity;
      if (room <= 0) continue;
      const add = Math.min(room, remaining);
      // Normalize legacy ids onto the canonical stack while merging.
      slot.itemId = storeId;
      slot.quantity += add;
      remaining -= add;
      if (remaining <= 0) return true;
    }
  }

  while (remaining > 0) {
    let emptyIndex = -1;
    for (let i = 0; i < slotCount; i++) {
      let slot = player.slots.at(i);
      if (!slot) {
        slot = new InventorySlotState();
        player.slots.push(slot);
      }
      if (!slot.itemId) {
        emptyIndex = i;
        break;
      }
    }
    // Dry-run guaranteed space; this is a safety net only.
    if (emptyIndex < 0) return false;

    const slot = player.slots.at(emptyIndex)!;
    const add = Math.min(maxStack, remaining);
    writeSlot(slot, {
      ...item,
      itemId: storeId,
      quantity: add,
    });
    remaining -= add;
  }

  return true;
}

/** Remove quantity of itemId from player. Returns false if not enough. */
export function removeItemFromPlayer(
  player: PlayerState,
  itemId: string,
  quantity: number,
): boolean {
  let available = 0;
  for (let i = 0; i < player.slots.length; i++) {
    const slot = player.slots.at(i);
    if (slot?.itemId && itemIdsMatch(slot.itemId, itemId)) {
      available += slot.quantity;
    }
  }
  if (available < quantity) return false;

  let remaining = quantity;
  for (let i = 0; i < player.slots.length; i++) {
    const slot = player.slots.at(i);
    if (!slot?.itemId || !itemIdsMatch(slot.itemId, itemId)) continue;
    const take = Math.min(slot.quantity, remaining);
    slot.quantity -= take;
    remaining -= take;
    if (slot.quantity <= 0) {
      clearSlot(slot);
    }
    if (remaining <= 0) break;
  }
  return true;
}

/** Remove up to `quantity` from a single inventory index. Returns amount removed. */
export function takeFromSlot(
  player: PlayerState,
  slotIndex: number,
  quantity: number,
): SlotItem | null {
  const slot = player.slots.at(slotIndex);
  if (!slot?.itemId || slot.quantity <= 0 || quantity <= 0) return null;

  const take = Math.min(slot.quantity, Math.floor(quantity));
  const taken = { ...slotItem(slot), quantity: take };
  slot.quantity -= take;
  if (slot.quantity <= 0) {
    clearSlot(slot);
  }
  return taken;
}

/**
 * Move / merge / swap between inventory indices (mirrors client Inventory.transferSlot).
 * Returns false if indices are invalid or the source is empty.
 */
export function moveInventorySlot(
  player: PlayerState,
  fromIndex: number,
  toIndex: number,
): boolean {
  if (
    !Number.isInteger(fromIndex) ||
    !Number.isInteger(toIndex) ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= player.slots.length ||
    toIndex >= player.slots.length
  ) {
    return false;
  }
  if (fromIndex === toIndex) return true;

  const from = player.slots.at(fromIndex);
  const to = player.slots.at(toIndex);
  if (!from?.itemId || from.quantity <= 0 || !to) return false;

  if (!to.itemId) {
    writeSlot(to, slotItem(from));
    clearSlot(from);
    return true;
  }

  if (canMerge(slotItem(to), slotItem(from))) {
    const maxStack = maxStackFor(from.itemId);
    if (maxStack > 1) {
      const room = maxStack - to.quantity;
      if (room > 0) {
        const moved = Math.min(room, from.quantity);
        to.itemId = canonicalItemId(to.itemId);
        to.quantity += moved;
        from.quantity -= moved;
        if (from.quantity <= 0) {
          clearSlot(from);
        }
        return true;
      }
    }
  }

  const tmp = slotItem(to);
  writeSlot(to, slotItem(from));
  writeSlot(from, tmp);
  return true;
}
