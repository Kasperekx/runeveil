import type { Application } from "pixi.js";
import {
  ATTACK_CLICK_RADIUS,
  ATTACK_COOLDOWN_MS,
  ATTACK_RANGE,
  TAB_RANGE,
} from "../config/combat";
import { PICKUP_RADIUS } from "../config/constants";
import { getCreatureName } from "../creatures/catalog";
import type { NetworkAnimalSystem } from "../creatures/NetworkAnimalSystem";
import type { Camera } from "../game/Camera";
import { screenToWorld } from "../game/screenToWorld";
import type { KeyboardInput } from "../input/KeyboardInput";
import type { GameNetwork } from "../network/GameNetwork";
import type { LootWindow } from "../ui/LootWindow";
import type { Player } from "./Player";

/** Must match server lootCorpse range (PICKUP_RADIUS + 16). */
const LOOT_RANGE = PICKUP_RADIUS + 16;
const LOOT_CURSOR_CLASS = "cursor-loot";

/**
 * WoW-lite tab-target sticky autoattack.
 * Swing always finishes; movement is allowed but facing stays on the target.
 */
export class PlayerCombat {
  private targetId: string | null = null;
  private cooldownUntil = 0;
  private lootCursorActive = false;

  constructor(
    private readonly app: Application,
    private readonly camera: Camera,
    private readonly player: Player,
    private readonly animals: NetworkAnimalSystem,
    private readonly network: GameNetwork,
    private readonly lootWindow: LootWindow,
    private readonly input: KeyboardInput,
    private readonly isUiBlockingClear: () => boolean,
    private readonly isGameplayDisabled: () => boolean = () => false,
  ) {}

  start(): void {
    this.app.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.app.canvas.addEventListener("pointermove", this.onPointerMove);
    this.app.canvas.addEventListener("pointerleave", this.onPointerLeave);
    this.app.ticker.add(this.update);
    this.input.onKeyDownPress(this.onKeyDown);
    this.lootWindow.setTakeHandler((animalId, slotIndex) => {
      this.network.lootCorpse(animalId, slotIndex);
    });
    this.lootWindow.setTakeAllHandler((animalId) => {
      this.network.lootAllCorpse(animalId);
    });
    this.animals.onLootChange = (animalId, _kind, loot) => {
      if (this.lootWindow.openAnimalId !== animalId) return;
      const empty = !loot.some((s) => s.itemId && s.quantity > 0);
      if (empty) {
        this.lootWindow.close();
        return;
      }
      this.lootWindow.updateIfOpen(animalId, loot);
    };
  }

  clearTarget(): void {
    this.targetId = null;
    this.animals.setSelected(null);
  }

  getTargetId(): string | null {
    return this.targetId;
  }

  private onKeyDown = (code: string, event: KeyboardEvent): void => {
    if (this.isGameplayDisabled()) {
      if (code === "Tab" || code === "Escape") event.preventDefault();
      return;
    }
    if (code === "Tab") {
      event.preventDefault();
      this.cycleTabTarget();
      return;
    }
    if (code === "Escape") {
      if (event.defaultPrevented) return;
      if (this.isUiBlockingClear()) return;
      if (this.targetId) {
        event.preventDefault();
        this.clearTarget();
      }
    }
  };

  private cycleTabTarget(): void {
    const { x, y } = this.player.position;
    const list = this.animals.listAliveSortedByDistance(x, y, TAB_RANGE);
    if (list.length === 0) {
      this.clearTarget();
      return;
    }

    let nextIndex = 0;
    if (this.targetId) {
      const current = list.findIndex((a) => a.id === this.targetId);
      nextIndex = current >= 0 ? (current + 1) % list.length : 0;
    }

    const next = list[nextIndex]!;
    this.lootWindow.close();
    this.targetId = next.id;
    this.animals.setSelected(next.id);
    this.player.faceToward(next.x, next.y);
    this.trySwing();
  }

  private onPointerLeave = (): void => {
    this.clearLootHover();
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (this.isGameplayDisabled()) {
      this.clearLootHover();
      return;
    }
    if (
      event.target instanceof Element &&
      (event.target.closest("#inventory") ||
        event.target.closest("#loot-window") ||
        event.target.closest("#character-panel") ||
        event.target.closest("#dialogue-window"))
    ) {
      this.clearLootHover();
      return;
    }

    const world = screenToWorld(
      this.app,
      this.camera,
      event.clientX,
      event.clientY,
    );
    const corpse = this.animals.findNearestLootableCorpse(
      world.x,
      world.y,
      ATTACK_CLICK_RADIUS,
    );
    if (corpse) {
      this.animals.setLootHover(corpse.id);
      this.setLootCursor(true);
      return;
    }
    this.clearLootHover();
  };

  private clearLootHover(): void {
    this.animals.setLootHover(null);
    this.setLootCursor(false);
  }

  private setLootCursor(active: boolean): void {
    const canvas = this.app.canvas;
    if (active) {
      // Re-apply every move: other handlers may overwrite style.cursor with "pointer".
      this.lootCursorActive = true;
      canvas.style.removeProperty("cursor");
      canvas.classList.add(LOOT_CURSOR_CLASS);
      return;
    }
    if (!this.lootCursorActive) return;
    this.lootCursorActive = false;
    canvas.classList.remove(LOOT_CURSOR_CLASS);
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    if (this.isGameplayDisabled()) return;
    if (
      event.target instanceof Element &&
      (event.target.closest("#inventory") ||
        event.target.closest("#loot-window") ||
        event.target.closest("#character-panel") ||
        event.target.closest("#dialogue-window"))
    ) {
      return;
    }

    const world = screenToWorld(
      this.app,
      this.camera,
      event.clientX,
      event.clientY,
    );

    const corpse = this.animals.findNearestLootableCorpse(
      world.x,
      world.y,
      ATTACK_CLICK_RADIUS,
    );
    if (corpse) {
      this.clearTarget();
      this.lootWindow.open(
        corpse.id,
        `Łup — ${getCreatureName(corpse.kind)}`,
        this.animals.getLoot(corpse.id),
      );
      return;
    }

    const hit = this.animals.findNearest(world.x, world.y, ATTACK_CLICK_RADIUS);
    if (!hit) {
      this.clearTarget();
      this.lootWindow.close();
      return;
    }

    this.lootWindow.close();
    this.targetId = hit.id;
    this.animals.setSelected(hit.id);
    this.player.faceToward(hit.x, hit.y);
    this.trySwing();
  };

  private update = (): void => {
    if (this.isGameplayDisabled()) {
      this.clearTarget();
      this.clearLootHover();
      return;
    }
    if (this.lootWindow.isOpen) {
      const id = this.lootWindow.openAnimalId;
      if (
        id &&
        (!this.animals.has(id) ||
          this.animals.getAlive(id) ||
          !this.animals.hasLoot(id))
      ) {
        this.lootWindow.close();
      } else if (id) {
        const corpse = this.animals.getPosition(id);
        const { x: px, y: py } = this.player.position;
        if (!corpse || Math.hypot(corpse.x - px, corpse.y - py) > LOOT_RANGE) {
          this.lootWindow.close();
        }
      }
    }

    if (!this.targetId) return;

    const target = this.animals.getAlive(this.targetId);
    if (!target) {
      this.clearTarget();
      return;
    }

    // Sticky target: keep facing the mob (strafe/backpedal while looking at it).
    this.player.faceToward(target.x, target.y);

    if (this.player.isAttacking) return;

    const { x: px, y: py } = this.player.position;
    if (Math.hypot(target.x - px, target.y - py) > ATTACK_RANGE) return;

    this.trySwing();
  };

  private trySwing(): void {
    if (!this.targetId || this.player.isAttacking) return;
    if (performance.now() < this.cooldownUntil) return;

    const target = this.animals.getAlive(this.targetId);
    if (!target) {
      this.clearTarget();
      return;
    }

    const { x: px, y: py } = this.player.position;
    if (Math.hypot(target.x - px, target.y - py) > ATTACK_RANGE) {
      return;
    }

    const animalId = this.targetId;
    this.player.faceToward(target.x, target.y);
    const started = this.player.beginAttack(undefined, () => {
      this.cooldownUntil = performance.now() + ATTACK_COOLDOWN_MS;
    });
    if (started) {
      this.network.attackAnimal(animalId);
    }
  }
}
