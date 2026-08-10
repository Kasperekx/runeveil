import type { Application, Container } from "pixi.js";
import { PLAYER_COLLISION_RADIUS } from "../config/constants";
import type { GameNetwork, ItemSnapshot } from "../network/GameNetwork";
import { getCreature, hasCreature, listCreatures } from "./catalog";
import { CreatureSprites } from "./CreatureSprites";
import { SyncedAnimalView } from "./SyncedAnimalView";

interface AnimalSnap {
  id: string;
  kind: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  loot: Array<ItemSnapshot>;
}

/** Renders server animals; selection + collision helpers for the local player. */
export class NetworkAnimalSystem {
  private readonly views = new Map<string, SyncedAnimalView>();
  private readonly spritesByKind = new Map<string, CreatureSprites>();
  private readonly lootById = new Map<string, ItemSnapshot[]>();
  private readonly lootKeyById = new Map<string, string>();
  private selectedId: string | null = null;

  constructor(
    private readonly app: Application,
    private readonly world: Container,
    private readonly network: GameNetwork,
  ) {}

  async init(): Promise<void> {
    await Promise.all(
      listCreatures().map(async (def) => {
        const sprites = await CreatureSprites.load(def.sprites);
        this.spritesByKind.set(def.id, sprites);
      }),
    );
  }

  start(): void {
    this.app.ticker.add(this.update);
  }

  setSelected(id: string | null): void {
    if (this.selectedId === id) return;
    if (this.selectedId) {
      this.views.get(this.selectedId)?.setSelected(false);
    }
    this.selectedId = id;
    if (id) {
      this.views.get(id)?.setSelected(true);
    }
    this.onSelectionChange?.(this.getSelectedVitals());
  }

  getSelectedVitals(): {
    id: string;
    kind: string;
    name: string;
    hp: number;
    maxHp: number;
  } | null {
    if (!this.selectedId) return null;
    const view = this.views.get(this.selectedId);
    if (!view?.isAlive) return null;
    const { name, hp, maxHp } = view.vitals;
    return { id: view.id, kind: view.kind, name, hp, maxHp };
  }

  /** Optional UI hook when target selection / vitals change. */
  onSelectionChange:
    | ((vitals: ReturnType<NetworkAnimalSystem["getSelectedVitals"]>) => void)
    | null = null;

  /** Fires when any corpse loot snapshot changes (for open loot window). */
  onLootChange:
    ((animalId: string, kind: string, loot: ItemSnapshot[]) => void) | null =
    null;

  getAlive(id: string): { id: string; x: number; y: number } | null {
    const view = this.views.get(id);
    if (!view?.isAlive) return null;
    const { x, y } = view.position;
    return { id, x, y };
  }

  /** Living animals within maxDist, nearest first (for Tab cycle). */
  listAliveSortedByDistance(
    worldX: number,
    worldY: number,
    maxDist: number,
  ): Array<{ id: string; x: number; y: number }> {
    const list: Array<{ id: string; x: number; y: number; dist: number }> = [];
    for (const view of this.views.values()) {
      if (!view.isAlive) continue;
      const { x, y } = view.position;
      const dist = Math.hypot(x - worldX, y - worldY);
      if (dist > maxDist) continue;
      list.push({ id: view.id, x, y, dist });
    }
    list.sort((a, b) => a.dist - b.dist);
    return list.map(({ id, x, y }) => ({ id, x, y }));
  }

  /** Position regardless of alive state — a killing blow still needs a number. */
  getPosition(id: string): { x: number; y: number } | null {
    const view = this.views.get(id);
    if (!view) return null;
    const { x, y } = view.position;
    return { x, y };
  }

  /** Lightweight projection data for the minimap; corpses are intentionally omitted. */
  listAlivePositions(): Array<{ x: number; y: number; kind: string }> {
    const positions: Array<{ x: number; y: number; kind: string }> = [];
    for (const view of this.views.values()) {
      if (!view.isAlive) continue;
      const { x, y } = view.position;
      positions.push({ x, y, kind: view.kind });
    }
    return positions;
  }

  getLoot(id: string): ItemSnapshot[] {
    return this.lootById.get(id) ?? [];
  }

  getKind(id: string): string | null {
    return this.views.get(id)?.kind ?? null;
  }

  has(id: string): boolean {
    return this.views.has(id);
  }

  findNearest(
    worldX: number,
    worldY: number,
    maxDist: number,
  ): { id: string; x: number; y: number } | null {
    let best: { id: string; x: number; y: number } | null = null;
    let bestDist = maxDist;

    for (const view of this.views.values()) {
      if (!view.isAlive) continue;
      const { x, y } = view.position;
      const dist = Math.hypot(x - worldX, y - worldY);
      const hitR = hasCreature(view.kind)
        ? getCreature(view.kind).hitRadius
        : 32;
      const pad = hitR * 0.35;
      if (dist > bestDist + pad) continue;
      if (dist < bestDist) {
        bestDist = dist;
        best = { id: view.id, x, y };
      }
    }

    return best;
  }

  findNearestCorpse(
    worldX: number,
    worldY: number,
    maxDist: number,
  ): { id: string; x: number; y: number; kind: string } | null {
    let best: { id: string; x: number; y: number; kind: string } | null = null;
    let bestDist = maxDist;

    for (const view of this.views.values()) {
      if (!view.isCorpse) continue;
      const { x, y } = view.position;
      const dist = Math.hypot(x - worldX, y - worldY);
      if (dist > bestDist) continue;
      bestDist = dist;
      best = { id: view.id, x, y, kind: view.kind };
    }

    return best;
  }

  /**
   * Slide move: full vector, then X-only, then Y-only against animal circles.
   */
  resolvePlayerMove(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    playerRadius = PLAYER_COLLISION_RADIUS,
  ): { x: number; y: number } {
    if (!this.overlapsAnimals(toX, toY, playerRadius)) {
      return { x: toX, y: toY };
    }
    if (!this.overlapsAnimals(toX, fromY, playerRadius)) {
      return { x: toX, y: fromY };
    }
    if (!this.overlapsAnimals(fromX, toY, playerRadius)) {
      return { x: fromX, y: toY };
    }
    return { x: fromX, y: fromY };
  }

  /** Alive animal bodies for combined player collision. */
  collisionCircles(): Array<{ x: number; y: number; radius: number }> {
    const list: Array<{ x: number; y: number; radius: number }> = [];
    for (const view of this.views.values()) {
      if (!view.isAlive) continue;
      const { x, y } = view.position;
      const radius = hasCreature(view.kind)
        ? getCreature(view.kind).collisionRadius
        : 20;
      list.push({ x, y, radius });
    }
    return list;
  }

  private overlapsAnimals(x: number, y: number, playerRadius: number): boolean {
    for (const view of this.views.values()) {
      if (!view.isAlive) continue;
      const body = hasCreature(view.kind)
        ? getCreature(view.kind).collisionRadius
        : 20;
      const radius = body + playerRadius;
      const { x: ax, y: ay } = view.position;
      if (Math.hypot(ax - x, ay - y) < radius) return true;
    }
    return false;
  }

  private update = (): void => {
    const deltaMS = this.app.ticker.deltaMS;
    const animals = this.network.listAnimals();
    const seen = new Set<string>();

    for (const snap of animals) {
      seen.add(snap.id);
      let view = this.views.get(snap.id);
      if (!view) {
        const created = this.createView(snap);
        if (!created) continue;
        view = created;
        this.views.set(snap.id, view);
        if (this.selectedId === snap.id) view.setSelected(true);
      }
      view.setServerState(snap.x, snap.y, snap.alive, snap.hp, snap.maxHp);
      const lootKey = JSON.stringify(snap.loot);
      this.lootById.set(snap.id, snap.loot);
      if (this.lootKeyById.get(snap.id) !== lootKey) {
        this.lootKeyById.set(snap.id, lootKey);
        this.onLootChange?.(snap.id, snap.kind, snap.loot);
      }
      view.update(deltaMS);
    }

    for (const [id, view] of this.views) {
      if (seen.has(id)) continue;
      if (this.selectedId === id) this.selectedId = null;
      view.destroy();
      this.views.delete(id);
      this.lootById.delete(id);
      this.lootKeyById.delete(id);
    }

    if (this.selectedId) {
      const selected = this.views.get(this.selectedId);
      if (!selected?.isAlive) {
        this.setSelected(null);
      } else {
        this.onSelectionChange?.(this.getSelectedVitals());
      }
    }
  };

  private createView(snap: AnimalSnap): SyncedAnimalView | null {
    if (!hasCreature(snap.kind)) return null;
    const def = getCreature(snap.kind);
    const sprites = this.spritesByKind.get(snap.kind);
    if (!sprites) return null;
    return new SyncedAnimalView(
      this.world,
      snap.id,
      snap.kind,
      sprites,
      def.animFps,
      snap.x,
      snap.y,
      snap.alive,
      snap.hp,
      snap.maxHp,
    );
  }
}
