import type { Client } from "colyseus";
import { canonicalItemId, getItemConfig } from "../../content/itemConfig.js";
import {
  DROP_PICKUP_DELAY_MS,
  PICKUP_RADIUS,
} from "../../content/creatureConfig.js";
import { playerStore } from "../../db/playerStore.js";
import { equipSlotOf } from "../armorConfig.js";
import { BAG_SLOT_COUNT, MAIN_BAG_INDEX, bagCapacity } from "../bagConfig.js";
import {
  addItemToPlayer,
  moveInventorySlot,
  takeFromSlot,
} from "../inventoryOps.js";
import { emptyItemData } from "../itemization.js";
import { clearItem, itemData, writeItem } from "../itemSlot.js";
import type { WorldHost } from "../WorldHost.js";

type CombatTextEvent = {
  amount: number;
  target: "animal" | "player";
  animalId: string;
  kind?: "damage" | "heal";
};

const ALLOCATABLE_ATTRS = [
  "strength",
  "agility",
  "stamina",
  "intellect",
  "spirit",
] as const;
type AllocatableAttr = (typeof ALLOCATABLE_ATTRS)[number];

function isAllocatableAttr(value: string): value is AllocatableAttr {
  return (ALLOCATABLE_ATTRS as readonly string[]).includes(value);
}

export class InventorySystem {
  readonly itemUseReadyAt = new Map<string, number>();
  readonly foodBuffs = new Map<
    string,
    {
      itemId: string;
      expiresAt: number;
      strength: number;
      agility: number;
      stamina: number;
      intellect: number;
      spirit: number;
    }
  >();

  constructor(private readonly host: WorldHost) {}

  clearSession(sessionId: string): void {
    this.clearItemUseCooldowns(sessionId);
  }

  clearItemUseCooldowns(sessionId: string): void {
    const prefix = `${sessionId}:`;
    for (const key of this.itemUseReadyAt.keys()) {
      if (key.startsWith(prefix)) this.itemUseReadyAt.delete(key);
    }
  }

  activeFoodBuff(playerId: string): {
    itemId: string;
    expiresAt: number;
    strength: number;
    agility: number;
    stamina: number;
    intellect: number;
    spirit: number;
  } | null {
    const buff = this.foodBuffs.get(playerId);
    if (!buff) return null;
    if (Date.now() >= buff.expiresAt) {
      this.foodBuffs.delete(playerId);
      return null;
    }
    return buff;
  }

  tickFoodBuffs(now: number): void {
    for (const [playerId, buff] of this.foodBuffs) {
      if (now < buff.expiresAt) continue;
      this.foodBuffs.delete(playerId);
      for (const [sessionId, player] of this.host.state.players) {
        if (player.playerId !== playerId) continue;
        this.host.recomputeGearStats(player);
        const client = this.host.clients.find((c) => c.sessionId === sessionId);
        client?.send("foodBuffExpired", {});
        client?.send("notice", { kind: "food_buff_expired" });
        break;
      }
    }
  }

  sendFoodBuffState(client: Client): void {
    const player = this.host.state.players.get(client.sessionId);
    if (!player) return;
    const buff = this.activeFoodBuff(player.playerId);
    if (!buff) {
      client.send("foodBuffState", {
        itemId: "",
        expiresAt: 0,
        strength: 0,
        agility: 0,
        stamina: 0,
        intellect: 0,
        spirit: 0,
      });
      return;
    }
    client.send("foodBuffState", {
      itemId: buff.itemId,
      expiresAt: buff.expiresAt,
      strength: buff.strength,
      agility: buff.agility,
      stamina: buff.stamina,
      intellect: buff.intellect,
      spirit: buff.spirit,
    });
  }

  handleCancelFoodBuff(client: Client): void {
    const player = this.host.livingPlayer(client);
    if (!player) return;
    if (!this.foodBuffs.delete(player.playerId)) return;
    this.host.recomputeGearStats(player);
    client.send("foodBuffExpired", {});
    client.send("notice", { kind: "food_buff_cancelled" });
  }

  handleMoveSlot(
    client: Client,
    data: { fromIndex?: number; toIndex?: number },
  ): void {
    const player = this.host.livingPlayer(client);
    if (!player || !data) return;
    if (
      typeof data.fromIndex !== "number" ||
      typeof data.toIndex !== "number"
    ) {
      return;
    }
    if (!moveInventorySlot(player, data.fromIndex, data.toIndex)) return;
    player.isNew = false;
    this.host.persistPlayer(player);
  }

  handleUseItem(client: Client, data: { slotIndex?: number }): void {
    const player = this.host.livingPlayer(client);
    if (!player) return;
    if (typeof data?.slotIndex !== "number") return;

    const slot = player.slots.at(data.slotIndex);
    if (!slot?.itemId || slot.quantity <= 0) return;

    const config = getItemConfig(slot.itemId);
    if (!config?.use) return;

    const now = Date.now();
    const cooldownKey = `${client.sessionId}:${slot.itemId}`;
    const readyAt = this.itemUseReadyAt.get(cooldownKey) ?? 0;
    if (now < readyAt) {
      client.send("notice", { kind: "item_on_cooldown" });
      return;
    }

    const buff = config.use.buff;
    if (config.use.heal > 0 && player.hp >= player.maxHp && !buff) {
      client.send("notice", { kind: "already_full_hp" });
      return;
    }

    const itemId = slot.itemId;
    let healed = 0;
    if (config.use.heal > 0) {
      const before = player.hp;
      player.hp = Math.min(player.maxHp, player.hp + config.use.heal);
      healed = player.hp - before;
    }
    if (buff) {
      const expiresAt = now + buff.durationMs;
      this.foodBuffs.set(player.playerId, {
        itemId: canonicalItemId(itemId),
        expiresAt,
        strength: buff.strength,
        agility: buff.agility,
        stamina: buff.stamina,
        intellect: buff.intellect,
        spirit: buff.spirit,
      });
      this.host.recomputeGearStats(player);
      client.send("foodBuffState", {
        itemId: canonicalItemId(itemId),
        expiresAt,
        strength: buff.strength,
        agility: buff.agility,
        stamina: buff.stamina,
        intellect: buff.intellect,
        spirit: buff.spirit,
      });
    }

    slot.quantity -= 1;
    if (slot.quantity <= 0) {
      clearItem(slot);
    }

    if (config.use.cooldownMs > 0) {
      this.itemUseReadyAt.set(cooldownKey, now + config.use.cooldownMs);
    }

    player.isNew = false;
    this.host.persistPlayer(player);

    if (healed > 0) {
      client.send("combatText", {
        amount: healed,
        target: "player",
        animalId: "",
        kind: "heal",
      } satisfies CombatTextEvent);
    }

    client.send("itemUsed", {
      slotIndex: data.slotIndex,
      itemId,
      cooldownMs: config.use.cooldownMs,
      ...(buff
        ? {
            buff: {
              strength: buff.strength,
              agility: buff.agility,
              stamina: buff.stamina,
              intellect: buff.intellect,
              spirit: buff.spirit,
              durationMs: buff.durationMs,
              expiresAt: now + buff.durationMs,
            },
          }
        : {}),
    });
  }

  handleEquipItem(
    client: Client,
    data: { inventoryIndex?: number; slotId?: string },
  ): void {
    const player = this.host.livingPlayer(client);
    if (!player) return;
    if (typeof data?.inventoryIndex !== "number") return;
    if (typeof data?.slotId !== "string") return;

    const source = player.slots.at(data.inventoryIndex);
    if (!source?.itemId) return;

    const fits = equipSlotOf(source.itemId);
    if (!fits || fits !== data.slotId) return;

    const incoming = getItemConfig(source.itemId);
    if (!incoming) return;
    if (incoming.requiredLevel > 0 && player.level < incoming.requiredLevel) {
      client.send("notice", { kind: "equip_level_too_low" });
      return;
    }

    const target = this.host.equipmentSlot(player, data.slotId);
    if (!target) return;

    if (incoming.twoHanded && data.slotId === "mainHand") {
      if (
        !this.host.stowEquipmentSlot(player, "offHand", [data.inventoryIndex])
      ) {
        client.send("notice", { kind: "inventory_full" });
        return;
      }
    } else if (data.slotId === "offHand") {
      const main = this.host.equipmentSlot(player, "mainHand");
      if (main?.itemId && getItemConfig(main.itemId)?.twoHanded) {
        if (
          !this.host.stowEquipmentSlot(player, "mainHand", [
            data.inventoryIndex,
          ])
        ) {
          client.send("notice", { kind: "inventory_full" });
          return;
        }
      }
    }

    const previous = target.itemId;
    const previousData = itemData(target);
    writeItem(target, { ...itemData(source), quantity: 1 });
    writeItem(
      source,
      previous ? { ...previousData, quantity: 1 } : emptyItemData(),
    );

    this.host.recomputeGearStats(player);
    player.isNew = false;
    this.host.persistPlayer(player);
  }

  handleUnequipItem(
    client: Client,
    data: { slotId?: string; inventoryIndex?: number },
  ): void {
    const player = this.host.livingPlayer(client);
    if (!player) return;
    if (typeof data?.slotId !== "string") return;

    const target = this.host.equipmentSlot(player, data.slotId);
    if (!target?.itemId) return;

    let free = -1;
    const wanted = data.inventoryIndex;
    if (
      typeof wanted === "number" &&
      wanted >= 0 &&
      wanted < player.slots.length &&
      !player.slots.at(wanted)?.itemId
    ) {
      free = wanted;
    } else {
      for (let i = 0; i < player.slots.length; i++) {
        if (!player.slots.at(i)?.itemId) {
          free = i;
          break;
        }
      }
    }

    if (free < 0) {
      client.send("notice", { kind: "inventory_full" });
      return;
    }

    const slot = player.slots.at(free)!;
    writeItem(slot, { ...itemData(target), quantity: 1 });
    clearItem(target);

    this.host.recomputeGearStats(player);
    player.isNew = false;
    this.host.persistPlayer(player);
  }

  handleEquipBag(
    client: Client,
    data: { inventoryIndex?: number; bagIndex?: number },
  ): void {
    const player = this.host.livingPlayer(client);
    if (!player) return;
    if (typeof data?.inventoryIndex !== "number") return;
    if (typeof data?.bagIndex !== "number") return;
    if (data.bagIndex < 0 || data.bagIndex >= BAG_SLOT_COUNT) return;
    if (data.bagIndex === MAIN_BAG_INDEX) return;

    const socket = player.bags.at(data.bagIndex);
    const source = player.slots.at(data.inventoryIndex);
    if (!socket || !source?.itemId) return;

    const incoming = getItemConfig(source.itemId);
    if (!incoming || incoming.capacity <= 0) return;

    const outgoing = socket.itemId;
    const newCapacity =
      player.slots.length + incoming.capacity - bagCapacity(outgoing);

    if (outgoing && data.inventoryIndex >= newCapacity) return;
    if (!this.host.tailEmpty(player, newCapacity)) return;

    writeItem(source, outgoing ? emptyItemData(outgoing, 1) : emptyItemData());
    socket.itemId = incoming.id;
    socket.quantity = 1;
    this.host.resizeSlots(player, newCapacity);

    player.isNew = false;
    this.host.persistPlayer(player);
  }

  handleUnequipBag(
    client: Client,
    data: { bagIndex?: number; inventoryIndex?: number },
  ): void {
    const player = this.host.livingPlayer(client);
    if (!player) return;
    if (typeof data?.bagIndex !== "number") return;
    if (data.bagIndex < 0 || data.bagIndex >= BAG_SLOT_COUNT) return;
    if (data.bagIndex === MAIN_BAG_INDEX) return;

    const socket = player.bags.at(data.bagIndex);
    if (!socket?.itemId) return;

    const bagItemId = socket.itemId;
    const newCapacity = player.slots.length - bagCapacity(bagItemId);
    if (newCapacity < 0) return;
    if (!this.host.tailEmpty(player, newCapacity)) return;

    let free = -1;
    if (
      typeof data.inventoryIndex === "number" &&
      data.inventoryIndex >= 0 &&
      data.inventoryIndex < newCapacity
    ) {
      const target = player.slots.at(data.inventoryIndex);
      if (target && !target.itemId) free = data.inventoryIndex;
    }
    if (free < 0) {
      for (let i = 0; i < newCapacity; i++) {
        if (!player.slots.at(i)?.itemId) {
          free = i;
          break;
        }
      }
    }
    if (free < 0) return;

    socket.itemId = "";
    socket.quantity = 0;
    this.host.resizeSlots(player, newCapacity);
    const target = player.slots.at(free)!;
    writeItem(target, emptyItemData(bagItemId, 1));

    player.isNew = false;
    this.host.persistPlayer(player);
  }

  handleLootCorpse(
    client: Client,
    data: { animalId?: string; slotIndex?: number; x?: number; y?: number },
  ): void {
    const player = this.host.livingPlayer(client);
    if (!player || !data?.animalId) return;
    if (typeof data.slotIndex !== "number" || data.slotIndex < 0) return;

    this.host.applyClientPosition(player, data.x, data.y);

    const animal = this.host.state.animals.get(data.animalId);
    if (!animal || animal.alive || animal.mapId !== player.mapId) return;

    const dist = Math.hypot(animal.x - player.x, animal.y - player.y);
    if (dist > PICKUP_RADIUS + 16) return;

    const slot = animal.loot.at(data.slotIndex);
    if (!slot?.itemId || slot.quantity <= 0) return;

    const loot = itemData(slot);
    if (!addItemToPlayer(player, loot, player.slots.length)) {
      client.send("notice", { kind: "inventory_full" });
      return;
    }

    clearItem(slot);
    player.isNew = false;
    this.host.persistPlayer(player);
    this.host.noteCorpseLooted(animal);
  }

  handleLootAllCorpse(
    client: Client,
    data: { animalId?: string; x?: number; y?: number },
  ): void {
    const player = this.host.livingPlayer(client);
    if (!player || !data?.animalId) return;

    this.host.applyClientPosition(player, data.x, data.y);

    const animal = this.host.state.animals.get(data.animalId);
    if (!animal || animal.alive || animal.mapId !== player.mapId) return;

    const dist = Math.hypot(animal.x - player.x, animal.y - player.y);
    if (dist > PICKUP_RADIUS + 16) return;

    let tookAny = false;
    let full = false;
    for (let i = 0; i < animal.loot.length; i++) {
      const slot = animal.loot.at(i);
      if (!slot?.itemId || slot.quantity <= 0) continue;

      const loot = itemData(slot);
      if (!addItemToPlayer(player, loot, player.slots.length)) {
        full = true;
        break;
      }
      clearItem(slot);
      tookAny = true;
    }

    if (tookAny) {
      player.isNew = false;
      this.host.persistPlayer(player);
      this.host.noteCorpseLooted(animal);
    }
    if (full) {
      client.send("notice", { kind: "inventory_full" });
    }
  }

  handleCollectPickup(
    client: Client,
    data: { pickupId?: string; x?: number; y?: number },
  ): void {
    const player = this.host.livingPlayer(client);
    if (!player || !data?.pickupId) return;

    this.host.applyClientPosition(player, data.x, data.y);

    const pickup = this.host.state.pickups.get(data.pickupId);
    if (!pickup || pickup.mapId !== player.mapId) return;
    if (Date.now() < pickup.collectableAt) return;

    const dist = Math.hypot(pickup.x - player.x, pickup.y - player.y);
    if (dist > PICKUP_RADIUS + 16) return;

    const loot = itemData(pickup);
    if (!addItemToPlayer(player, loot, player.slots.length)) {
      client.send("notice", { kind: "inventory_full" });
      return;
    }

    this.host.state.pickups.delete(data.pickupId);
    this.host.refreshAllClientViews();
    player.isNew = false;
    this.host.persistPlayer(player);
  }

  handleDropItem(
    client: Client,
    data: { inventoryIndex?: number; x?: number; y?: number },
  ): void {
    const player = this.host.livingPlayer(client);
    if (!player) return;
    if (typeof data.x !== "number" || typeof data.y !== "number") return;
    if (typeof data.inventoryIndex !== "number") return;
    this.host.applyClientPosition(player, data.x, data.y);
    const dropped = takeFromSlot(
      player,
      data.inventoryIndex,
      Number.MAX_SAFE_INTEGER,
    );
    if (!dropped) return;
    this.host.spawnPickup(
      dropped,
      player.mapId,
      player.x,
      player.y,
      Date.now() + DROP_PICKUP_DELAY_MS,
    );
    player.isNew = false;
    this.host.persistPlayer(player);
  }

  handleAllocateAttribute(client: Client, data: { attr?: string }): void {
    const player = this.host.livingPlayer(client);
    if (!player || !data?.attr || !isAllocatableAttr(data.attr)) return;
    if (player.unspentAttrPoints <= 0) return;

    const beforeMax = player.maxHp;
    player[data.attr] += 1;
    player.unspentAttrPoints -= 1;

    const attrs = {
      strength: player.strength,
      agility: player.agility,
      stamina: player.stamina,
      intellect: player.intellect,
      spirit: player.spirit,
    };
    const derived = playerStore.derived({
      classId: player.classId,
      attrs,
    });
    player.maxHp = derived.maxHp;
    player.hp = Math.min(
      player.maxHp,
      player.hp + Math.max(0, derived.maxHp - beforeMax),
    );
    this.host.recomputeGearStats(player);

    player.isNew = false;
    this.host.persistPlayer(player);
  }
}
