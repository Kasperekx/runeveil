import { Assets, Sprite, Texture, type Application, type Container } from "pixi.js";
import type { Environment } from "../environment/Environment";
import type { Camera } from "../game/Camera";
import { screenToWorld } from "../game/screenToWorld";
import type { GameToast } from "../ui/GameToast";
import { PLACEABLE_CAMPFIRE } from "./placeableCampfire";

export type PlaceCampfireHandler = (x: number, y: number) => void;

/**
 * WoW / New World style ghost placement for a personal cooking campfire.
 * Collision / range come from `placeableCampfire.yaml` (same as runtime prop).
 */
export class CampfirePlacementMode {
  private active = false;
  private ghost: Sprite | null = null;
  private valid = false;
  private cursor = { x: 0, y: 0 };

  constructor(
    private readonly app: Application,
    private readonly camera: Camera,
    private readonly world: Container,
    private environment: Environment,
    private readonly getPlayerPosition: () => { x: number; y: number },
    private readonly toast: GameToast,
    private readonly onPlace: PlaceCampfireHandler,
    private readonly isBlocked: () => boolean,
  ) {}

  get isActive(): boolean {
    return this.active;
  }

  setEnvironment(environment: Environment): void {
    this.environment = environment;
    if (this.active) this.refreshValidity();
  }

  async start(): Promise<void> {
    if (this.active || this.isBlocked()) return;
    const ghostPath = PLACEABLE_CAMPFIRE.ghostTexture;
    await Assets.load(ghostPath);
    const texture = Texture.from(ghostPath);
    texture.source.scaleMode =
      PLACEABLE_CAMPFIRE.prop.filter === "linear" ? "linear" : "nearest";

    this.ghost?.destroy();
    this.ghost = new Sprite(texture);
    const def = PLACEABLE_CAMPFIRE.prop;
    this.ghost.anchor.set(def.anchorX, def.anchorY);
    this.ghost.scale.set(def.scale ?? 1);
    this.ghost.alpha = 0.72;
    this.ghost.roundPixels = true;
    this.ghost.eventMode = "none";
    this.world.addChild(this.ghost);

    this.active = true;
    this.app.canvas.style.cursor = "crosshair";
    this.app.canvas.addEventListener("pointermove", this.onPointerMove);
    this.app.canvas.addEventListener("pointerdown", this.onPointerDown, true);
    this.app.canvas.addEventListener("contextmenu", this.onContextMenu);
    window.addEventListener("keydown", this.onKeyDown);
    const player = this.getPlayerPosition();
    this.cursor = { x: Math.round(player.x), y: Math.round(player.y + 40) };
    this.ghost.position.set(this.cursor.x, this.cursor.y);
    this.ghost.zIndex = Math.round(this.cursor.y);
    this.refreshValidity();
  }

  cancel(): void {
    if (!this.active) return;
    this.active = false;
    this.app.canvas.style.cursor = "";
    this.app.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.app.canvas.removeEventListener("pointerdown", this.onPointerDown, true);
    this.app.canvas.removeEventListener("contextmenu", this.onContextMenu);
    window.removeEventListener("keydown", this.onKeyDown);
    this.ghost?.destroy();
    this.ghost = null;
  }

  private onContextMenu = (event: Event): void => {
    if (this.active) event.preventDefault();
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.active || !this.ghost) return;
    const world = screenToWorld(
      this.app,
      this.camera,
      event.clientX,
      event.clientY,
    );
    this.cursor = { x: Math.round(world.x), y: Math.round(world.y) };
    this.ghost.position.set(this.cursor.x, this.cursor.y);
    this.ghost.zIndex = Math.round(this.cursor.y);
    this.refreshValidity();
  };

  private onPointerDown = (event: PointerEvent): void => {
    if (!this.active) return;
    event.preventDefault();
    event.stopImmediatePropagation();

    if (event.button === 2 || event.button === 1) {
      this.cancel();
      this.toast.show("Anulowano stawianie paleniska.");
      return;
    }
    if (event.button !== 0) return;

    this.refreshValidity();
    if (!this.valid) {
      this.toast.show("Nie możesz tu postawić paleniska.");
      return;
    }
    const { x, y } = this.cursor;
    this.cancel();
    this.onPlace(x, y);
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (!this.active) return;
    if (event.code === "Escape") {
      event.preventDefault();
      this.cancel();
      this.toast.show("Anulowano stawianie paleniska.");
    }
  };

  private refreshValidity(): void {
    if (!this.ghost) return;
    this.valid = this.canPlaceAt(this.cursor.x, this.cursor.y);
    this.ghost.tint = this.valid ? 0x88ff88 : 0xff6666;
  }

  private canPlaceAt(x: number, y: number): boolean {
    const radius = PLACEABLE_CAMPFIRE.prop.collisionRadius;
    const player = this.getPlayerPosition();
    if (Math.hypot(x - player.x, y - player.y) > PLACEABLE_CAMPFIRE.placeRange) {
      return false;
    }
    const bounds = this.environment.playableBounds;
    if (
      x < bounds.minX + radius ||
      x > bounds.maxX - radius ||
      y < bounds.minY + radius ||
      y > bounds.maxY - radius
    ) {
      return false;
    }
    for (const collider of this.environment.colliders) {
      if (Math.hypot(x - collider.x, y - collider.y) < collider.radius + radius) {
        return false;
      }
    }
    return true;
  }
}
