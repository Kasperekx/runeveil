import type { Client } from "colyseus";
import {
  buyPriceOf,
  getItemConfig,
  sellPriceOf,
} from "../../content/itemConfig.js";
import { cloneShopStock, getNpcConfig } from "../../content/npcConfig.js";
import { addItemToPlayer, takeFromSlot } from "../inventoryOps.js";
import { createItemData } from "../itemization.js";
import { isRepairable, repairCost } from "../durabilityConfig.js";
import type { WorldHost } from "../WorldHost.js";
import type { PlayerState } from "../../schema/GameState.js";

export class TradeSystem {
  readonly shopStock = new Map<string, Map<string, number>>();

  constructor(private readonly host: WorldHost) {}

  initStock(): void {
    this.shopStock.clear();
    for (const map of this.host.maps.values()) {
      for (const placement of map.npcs ?? []) {
        this.shopStock.set(
          `${map.id}:${placement.id}`,
          cloneShopStock(placement.npcId),
        );
      }
    }
  }

  remainingStock(
    player: PlayerState,
    instanceId: string,
    itemId: string,
  ): number {
    const npcPlacement = this.host.findNpc(player, instanceId);
    if (!npcPlacement) return 0;
    const offer = getNpcConfig(npcPlacement.npcId)?.shop.find(
      (row) => row.itemId === itemId,
    );
    if (!offer) return 0;
    if (offer.stock < 0) return -1;
    return (
      this.shopStock.get(`${player.mapId}:${instanceId}`)?.get(itemId) ?? 0
    );
  }

  handleBuy(
    client: Client,
    data: {
      npcInstanceId?: string;
      itemId?: string;
      quantity?: number;
      x?: number;
      y?: number;
    },
  ): void {
    const player = this.host.livingPlayer(client);
    if (!player || !data?.npcInstanceId || !data.itemId) return;

    this.host.applyClientPosition(player, data.x, data.y);

    const placement = this.host.findNpc(player, data.npcInstanceId);
    if (!placement) return;
    if (!this.host.withinNpcRange(player, placement)) {
      client.send("notice", { kind: "too_far" });
      return;
    }

    const npc = getNpcConfig(placement.npcId);
    if (!npc) {
      client.send("notice", { kind: "shop_unavailable" });
      return;
    }
    const offer = npc.shop.find((row) => row.itemId === data.itemId);
    if (!offer) {
      client.send("notice", { kind: "shop_item_unavailable" });
      return;
    }

    const quantity =
      typeof data.quantity === "number" && data.quantity > 0
        ? Math.min(99, Math.floor(data.quantity))
        : 1;

    const unitPrice = buyPriceOf(data.itemId);
    if (unitPrice <= 0) {
      client.send("notice", { kind: "shop_item_unavailable" });
      return;
    }

    const stockMap = this.shopStock.get(`${player.mapId}:${placement.id}`);
    if (offer.stock >= 0) {
      const left = stockMap?.get(data.itemId) ?? 0;
      if (left < quantity) {
        client.send("notice", { kind: "out_of_stock" });
        return;
      }
    }

    const total = unitPrice * quantity;
    if (player.gold < total) {
      client.send("notice", { kind: "not_enough_gold" });
      return;
    }

    if (
      !addItemToPlayer(
        player,
        createItemData(data.itemId, quantity),
        player.slots.length,
      )
    ) {
      client.send("notice", { kind: "inventory_full" });
      return;
    }

    player.gold -= total;
    if (offer.stock >= 0 && stockMap) {
      stockMap.set(data.itemId, (stockMap.get(data.itemId) ?? 0) - quantity);
    }

    player.isNew = false;
    this.host.persistPlayer(player);
    client.send("tradeResult", {
      kind: "buy",
      itemId: data.itemId,
      quantity,
      goldSpent: total,
      gold: player.gold,
      stock: this.remainingStock(player, placement.id, data.itemId),
    });
  }

  handleSell(
    client: Client,
    data: {
      npcInstanceId?: string;
      inventoryIndex?: number;
      quantity?: number;
      x?: number;
      y?: number;
    },
  ): void {
    const player = this.host.livingPlayer(client);
    if (!player || !data?.npcInstanceId) return;
    if (typeof data.inventoryIndex !== "number") return;

    this.host.applyClientPosition(player, data.x, data.y);

    const placement = this.host.findNpc(player, data.npcInstanceId);
    if (!placement) return;
    if (!this.host.withinNpcRange(player, placement)) {
      client.send("notice", { kind: "too_far" });
      return;
    }

    const npc = getNpcConfig(placement.npcId);
    if (!npc || npc.shop.length === 0) {
      client.send("notice", { kind: "cannot_sell" });
      return;
    }

    const slot = player.slots.at(data.inventoryIndex);
    if (!slot?.itemId || slot.quantity <= 0) return;

    const unitPrice = sellPriceOf(slot.itemId);
    if (unitPrice <= 0) {
      client.send("notice", { kind: "cannot_sell" });
      return;
    }

    const quantity =
      typeof data.quantity === "number" && data.quantity > 0
        ? Math.min(slot.quantity, Math.floor(data.quantity))
        : slot.quantity;

    const taken = takeFromSlot(player, data.inventoryIndex, quantity);
    if (!taken) return;

    const goldEarned = unitPrice * taken.quantity;
    player.gold += goldEarned;
    player.isNew = false;
    this.host.persistPlayer(player);
    client.send("tradeResult", {
      kind: "sell",
      itemId: taken.itemId,
      quantity: taken.quantity,
      goldEarned,
      gold: player.gold,
    });
  }

  handleRepair(
    client: Client,
    data: {
      npcInstanceId?: string;
      source?: string;
      slotId?: string;
      inventoryIndex?: number;
      x?: number;
      y?: number;
    },
  ): void {
    const player = this.host.livingPlayer(client);
    if (!player || !data?.npcInstanceId) return;
    this.host.applyClientPosition(player, data.x, data.y);

    const placement = this.host.findNpc(player, data.npcInstanceId);
    if (!placement) return;
    if (!this.host.withinNpcRange(player, placement)) {
      client.send("notice", { kind: "too_far" });
      return;
    }
    const npc = getNpcConfig(placement.npcId);
    if (!npc?.repairService) {
      client.send("notice", { kind: "repair_unavailable" });
      return;
    }

    const equipped = Array.from(player.equipment).map((slot) => ({
      slot,
      slotId: slot.slotId,
      inventoryIndex: undefined as number | undefined,
    }));
    const carried = Array.from({ length: player.slots.length }, (_, index) => ({
      slot: player.slots.at(index)!,
      slotId: undefined as string | undefined,
      inventoryIndex: index,
    }));
    const candidates =
      data.source === "equipment" && data.slotId
        ? equipped.filter((entry) => entry.slotId === data.slotId)
        : data.source === "inventory" && Number.isInteger(data.inventoryIndex)
          ? carried.filter(
              (entry) => entry.inventoryIndex === data.inventoryIndex,
            )
          : [...equipped, ...carried];
    const repairs = candidates.flatMap((entry) => {
      const { slot } = entry;
      if (!slot.itemId || !isRepairable(slot.maxDurability)) return [];
      const item = getItemConfig(slot.itemId);
      if (!item || slot.durability >= slot.maxDurability) return [];
      const cost = repairCost(item, slot.durability, slot.maxDurability);
      return cost > 0 ? [{ ...entry, cost }] : [];
    });
    if (repairs.length === 0) {
      client.send("notice", { kind: "nothing_to_repair" });
      return;
    }
    const totalCost = repairs.reduce((total, repair) => total + repair.cost, 0);
    if (player.gold < totalCost) {
      client.send("notice", { kind: "not_enough_gold" });
      return;
    }

    for (const { slot } of repairs) slot.durability = slot.maxDurability;
    player.gold -= totalCost;
    player.isNew = false;
    this.host.recomputeGearStats(player);
    this.host.persistPlayer(player);
    client.send("equipmentRepaired", {
      slotIds: repairs.flatMap(({ slotId }) => (slotId ? [slotId] : [])),
      inventoryIndices: repairs.flatMap(({ inventoryIndex }) =>
        inventoryIndex === undefined ? [] : [inventoryIndex],
      ),
      totalCost,
      gold: player.gold,
    });
  }
}
