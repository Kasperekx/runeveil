import type { Application, Container } from "pixi.js";
import { PICKUP_RADIUS } from "../config/constants";
import type { ItemId } from "../content/items";
import type { GameNetwork } from "../network/GameNetwork";
import type { Player } from "../entities/player/Player";
import { SyncedPickupView } from "./SyncedPickupView";

interface PickupSnap {
  id: string;
  itemId: string;
  quantity: number;
  x: number;
  y: number;
  collectableAt: number;
}

/** Renders server pickups and requests collects when in range. */
export class NetworkPickupSystem {
  private readonly views = new Map<string, SyncedPickupView>();
  private readonly pending = new Set<string>();
  private collectCooldown = new Map<string, number>();

  constructor(
    private readonly app: Application,
    private readonly world: Container,
    private readonly player: Player,
    private readonly network: GameNetwork,
  ) {}

  /** Inventory UI drop → server-authoritative world pickup. */
  dropItem(inventoryIndex: number, x: number, y: number): void {
    this.network.dropItem(inventoryIndex, x, y);
  }

  start(): void {
    this.app.ticker.add(this.update);
  }

  private update = (): void => {
    const pickups = this.network.listPickups();
    const seen = new Set<string>();

    for (const snap of pickups) {
      seen.add(snap.id);
      const existing = this.views.get(snap.id);
      if (existing) {
        existing.setPosition(snap.x, snap.y);
        continue;
      }
      if (this.pending.has(snap.id)) continue;
      this.pending.add(snap.id);
      void this.spawnView(snap);
    }

    for (const [id, view] of this.views) {
      if (seen.has(id)) continue;
      view.destroy();
      this.views.delete(id);
      this.pending.delete(id);
    }

    const { x: px, y: py } = this.player.position;
    const now = performance.now();
    const serverNow = Date.now();

    for (const snap of pickups) {
      if (serverNow < snap.collectableAt) continue;
      const dist = Math.hypot(snap.x - px, snap.y - py);
      if (dist > PICKUP_RADIUS) continue;

      const readyAt = this.collectCooldown.get(snap.id) ?? 0;
      if (now < readyAt) continue;
      this.collectCooldown.set(snap.id, now + 400);
      this.network.collectPickup(snap.id);
    }
  };

  private async spawnView(snap: PickupSnap): Promise<void> {
    try {
      const view = await SyncedPickupView.create(
        this.world,
        snap.id,
        snap.itemId as ItemId,
        snap.quantity,
        snap.x,
        snap.y,
      );
      if (!this.network.listPickups().some((p) => p.id === snap.id)) {
        view.destroy();
        return;
      }
      this.views.set(snap.id, view);
    } catch (err) {
      console.warn("[pickups] failed to spawn", snap.itemId, err);
    } finally {
      this.pending.delete(snap.id);
    }
  }
}
