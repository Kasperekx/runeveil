import { emptyItemData, type ItemInstanceData } from "./itemization.js";

export type ItemSlotLike = {
  itemId: string;
  quantity: number;
  instanceId: string;
  rarity: string;
  affixesJson: string;
  durability: number;
  maxDurability: number;
};

export function itemData(slot: ItemSlotLike): ItemInstanceData {
  return {
    itemId: slot.itemId,
    quantity: slot.quantity,
    instanceId: slot.instanceId,
    rarity: slot.rarity as ItemInstanceData["rarity"],
    affixesJson: slot.affixesJson,
    durability: slot.durability,
    maxDurability: slot.maxDurability,
  };
}

export function writeItem(slot: ItemSlotLike, item: ItemInstanceData): void {
  slot.itemId = item.itemId;
  slot.quantity = item.quantity;
  slot.instanceId = item.instanceId;
  slot.rarity = item.rarity;
  slot.affixesJson = item.affixesJson;
  slot.durability = item.durability;
  slot.maxDurability = item.maxDurability;
}

export function clearItem(slot: ItemSlotLike): void {
  writeItem(slot, emptyItemData());
}
