import type { ItemAffix, ItemId, ItemRarity } from "../content/items";
import { canonicalItemId, getItem, itemIdsMatch } from "../content/items";
import { INVENTORY_SLOT_COUNT } from "../config/constants";

export interface InventorySlot {
  itemId: ItemId | null;
  quantity: number;
  instanceId: string;
  rarity: ItemRarity;
  affixes: ItemAffix[];
  durability: number;
  maxDurability: number;
}

function emptySlot(): InventorySlot {
  return {
    itemId: null,
    quantity: 0,
    instanceId: "",
    rarity: "common",
    affixes: [],
    durability: 0,
    maxDurability: 0,
  };
}

function isPlainStack(slot: InventorySlot): boolean {
  return (
    !slot.instanceId &&
    slot.rarity === "common" &&
    slot.affixes.length === 0 &&
    slot.durability === 0 &&
    slot.maxDurability === 0
  );
}

/** Inventory data only — no DOM / Pixi. Server snapshots remain authoritative. */
export class Inventory {
  private readonly slots: InventorySlot[];
  private readonly listeners = new Set<() => void>();

  constructor(slotCount = INVENTORY_SLOT_COUNT) {
    this.slots = Array.from({ length: slotCount }, emptySlot);
  }

  getSlots(): readonly InventorySlot[] {
    return this.slots;
  }
  getSlot(index: number): InventorySlot | null {
    return this.slots[index] ?? null;
  }

  /** Offline fallback helper; networked drops always arrive from the server. */
  addItem(itemId: ItemId, quantity = 1): boolean {
    if (quantity <= 0 || this.freeSpaceFor(itemId) < quantity)
      return quantity <= 0;
    const def = getItem(itemId);
    const storeId = canonicalItemId(itemId) as ItemId;
    let remaining = quantity;
    if (def.stackable) {
      for (const slot of this.slots) {
        if (
          !slot.itemId ||
          !isPlainStack(slot) ||
          !itemIdsMatch(slot.itemId, itemId)
        )
          continue;
        const add = Math.min(def.maxStack - slot.quantity, remaining);
        if (add <= 0) continue;
        slot.itemId = storeId;
        slot.quantity += add;
        remaining -= add;
        if (remaining <= 0) {
          this.notify();
          return true;
        }
      }
    }
    while (remaining > 0) {
      const empty = this.slots.find((slot) => slot.itemId === null);
      if (!empty) return false;
      const add = def.stackable ? Math.min(def.maxStack, remaining) : 1;
      Object.assign(empty, {
        itemId: storeId,
        quantity: add,
        instanceId: "",
        rarity: "common" as const,
        affixes: [],
        durability: 0,
        maxDurability: 0,
      });
      remaining -= add;
    }
    this.notify();
    return true;
  }

  private freeSpaceFor(itemId: ItemId): number {
    const def = getItem(itemId);
    const maxStack = def.stackable ? def.maxStack : 1;
    return this.slots.reduce((space, slot) => {
      if (!slot.itemId) return space + maxStack;
      return def.stackable &&
        isPlainStack(slot) &&
        itemIdsMatch(slot.itemId, itemId)
        ? space + Math.max(0, maxStack - slot.quantity)
        : space;
    }, 0);
  }

  transferSlot(fromIndex: number, toIndex: number): boolean {
    if (fromIndex === toIndex) return true;
    const from = this.slots[fromIndex];
    const to = this.slots[toIndex];
    if (!from || !to || !from.itemId) return false;
    if (!to.itemId) {
      Object.assign(to, { ...from, affixes: [...from.affixes] });
      Object.assign(from, emptySlot());
      this.notify();
      return true;
    }
    if (
      itemIdsMatch(to.itemId, from.itemId) &&
      isPlainStack(to) &&
      isPlainStack(from)
    ) {
      const def = getItem(from.itemId);
      if (def.stackable) {
        const moved = Math.min(def.maxStack - to.quantity, from.quantity);
        if (moved > 0) {
          to.itemId = canonicalItemId(to.itemId) as ItemId;
          to.quantity += moved;
          from.quantity -= moved;
          if (from.quantity <= 0) Object.assign(from, emptySlot());
          this.notify();
          return true;
        }
      }
    }
    const tmp = { ...to, affixes: [...to.affixes] };
    Object.assign(to, { ...from, affixes: [...from.affixes] });
    Object.assign(from, tmp);
    this.notify();
    return true;
  }

  /** Kept for offline use; networked world-drop now sends the slot index. */
  takeSlot(index: number): InventorySlot | null {
    const slot = this.slots[index];
    if (!slot?.itemId) return null;
    const taken = { ...slot, affixes: [...slot.affixes] };
    Object.assign(slot, emptySlot());
    this.notify();
    return taken;
  }

  onChange(listener: () => void): void {
    this.listeners.add(listener);
  }

  toSnapshot(): Array<{
    itemId: string;
    quantity: number;
    instanceId: string;
    rarity: ItemRarity;
    affixes: ItemAffix[];
    durability: number;
    maxDurability: number;
  }> {
    return this.slots.map((slot) => ({
      itemId: slot.itemId ?? "",
      quantity: slot.itemId ? slot.quantity : 0,
      instanceId: slot.itemId ? slot.instanceId : "",
      rarity: slot.itemId ? slot.rarity : "common",
      affixes: slot.itemId ? slot.affixes : [],
      durability: slot.itemId ? slot.durability : 0,
      maxDurability: slot.itemId ? slot.maxDurability : 0,
    }));
  }

  applySnapshot(
    slots: Array<{
      itemId: string;
      quantity: number;
      instanceId?: string;
      rarity?: ItemRarity;
      affixes?: ItemAffix[];
      durability?: number;
      maxDurability?: number;
    }>,
  ): void {
    if (slots.length > 0) {
      while (this.slots.length < slots.length) this.slots.push(emptySlot());
      while (this.slots.length > slots.length) this.slots.pop();
    }
    for (let i = 0; i < this.slots.length; i++) {
      const source = slots[i];
      this.slots[i] = source?.itemId
        ? {
            itemId: source.itemId as ItemId,
            quantity: source.quantity || 0,
            instanceId: source.instanceId ?? "",
            rarity: source.rarity ?? "common",
            affixes: source.affixes ?? [],
            durability: Math.max(0, Math.floor(source.durability ?? 0)),
            maxDurability: Math.max(0, Math.floor(source.maxDurability ?? 0)),
          }
        : emptySlot();
    }
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
