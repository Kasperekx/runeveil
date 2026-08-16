import type { Client } from "colyseus";
import { PLACEABLE_CAMPFIRE } from "../../content/placeableCampfire.js";
import type { CircleBlocker } from "../AnimalAi.js";
import type { WorldHost } from "../WorldHost.js";

export type PlacedCampfire = {
  id: string;
  mapId: string;
  ownerPlayerId: string;
  x: number;
  y: number;
};

export class CampfireSystem {
  readonly placed = new Map<string, PlacedCampfire>();

  constructor(private readonly host: WorldHost) {}

  blockersForMap(mapId: string): CircleBlocker[] {
    const out: CircleBlocker[] = [];
    for (const campfire of this.placed.values()) {
      if (campfire.mapId !== mapId) continue;
      out.push({
        x: campfire.x,
        y: campfire.y,
        radius: PLACEABLE_CAMPFIRE.collisionRadius,
      });
    }
    return out;
  }

  isNearCooking(player: { mapId: string; x: number; y: number }): boolean {
    for (const campfire of this.placed.values()) {
      if (campfire.mapId !== player.mapId) continue;
      if (
        Math.hypot(player.x - campfire.x, player.y - campfire.y) <=
        PLACEABLE_CAMPFIRE.cookingActivationRadius
      ) {
        return true;
      }
    }
    return false;
  }

  sendState(client: Client): void {
    const player = this.host.state.players.get(client.sessionId);
    if (!player) return;
    const campfires = [...this.placed.values()].filter(
      (campfire) => campfire.mapId === player.mapId,
    );
    client.send("campfiresState", { campfires });
  }

  handlePlace(
    client: Client,
    data: {
      x?: number;
      y?: number;
      playerX?: number;
      playerY?: number;
    },
  ): void {
    const player = this.host.livingPlayer(client);
    if (!player) return;
    if (
      typeof data?.x !== "number" ||
      typeof data?.y !== "number" ||
      !Number.isFinite(data.x) ||
      !Number.isFinite(data.y)
    ) {
      return;
    }

    this.host.applyClientPosition(player, data.playerX, data.playerY);
    const x = Math.round(data.x);
    const y = Math.round(data.y);
    const map = this.host.mapForPlayer(player);
    const placeRange = PLACEABLE_CAMPFIRE.placeRange;
    const campfireRadius = PLACEABLE_CAMPFIRE.collisionRadius;

    if (Math.hypot(x - player.x, y - player.y) > placeRange) {
      client.send("notice", { kind: "campfire_too_far" });
      return;
    }
    if (
      x < map.playable.minX + campfireRadius ||
      x > map.playable.maxX - campfireRadius ||
      y < map.playable.minY + campfireRadius ||
      y > map.playable.maxY - campfireRadius
    ) {
      client.send("notice", { kind: "campfire_blocked" });
      return;
    }

    const colliders = this.host.mapColliders.get(map.id) ?? [];
    for (const collider of colliders) {
      if (
        Math.hypot(x - collider.x, y - collider.y) <
        collider.radius + campfireRadius
      ) {
        client.send("notice", { kind: "campfire_blocked" });
        return;
      }
    }
    for (const campfire of this.placed.values()) {
      if (
        campfire.mapId !== map.id ||
        campfire.ownerPlayerId === player.playerId
      )
        continue;
      if (Math.hypot(x - campfire.x, y - campfire.y) < campfireRadius * 2) {
        client.send("notice", { kind: "campfire_blocked" });
        return;
      }
    }

    for (const [id, campfire] of [...this.placed.entries()]) {
      if (campfire.ownerPlayerId !== player.playerId) continue;
      this.placed.delete(id);
      this.host.broadcast("campfireRemoved", { id });
    }

    const id = `campfire-${player.playerId}`;
    const placed = {
      id,
      mapId: map.id,
      ownerPlayerId: player.playerId,
      x,
      y,
    };
    this.placed.set(id, placed);
    this.host.broadcast("campfirePlaced", placed);
  }
}
