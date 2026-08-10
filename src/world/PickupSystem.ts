import type { Application } from "pixi.js";
import { DROP_PICKUP_DELAY_MS, PICKUP_RADIUS } from "../config/constants";
import type { Inventory } from "../inventory/Inventory";
import type { ItemId } from "../items/catalog";
import type { Player } from "../player/Player";
import { ItemPickup } from "./ItemPickup";

/** Auto-collects nearby pickups into the inventory. */
export class PickupSystem {
  private readonly pickups: ItemPickup[] = [];

  constructor(
    private readonly app: Application,
    private readonly player: Player,
    private readonly inventory: Inventory,
  ) {}

  add(pickup: ItemPickup): void {
    this.pickups.push(pickup);
  }

  async dropItem(
    itemId: ItemId,
    quantity: number,
    worldX: number,
    worldY: number,
  ): Promise<void> {
    const pickup = await ItemPickup.create(
      this.app,
      itemId,
      worldX,
      worldY,
      quantity,
      DROP_PICKUP_DELAY_MS,
    );
    this.add(pickup);
  }

  start(): void {
    this.app.ticker.add(this.update);
  }

  private update = (): void => {
    const { x: px, y: py } = this.player.position;

    for (const pickup of this.pickups) {
      if (!pickup.isCollectable) continue;

      const { x, y } = pickup.position;
      const dist = Math.hypot(x - px, y - py);
      if (dist > PICKUP_RADIUS) continue;

      if (!this.inventory.addItem(pickup.itemId, pickup.quantity)) continue;
      pickup.collect();
    }
  };
}
