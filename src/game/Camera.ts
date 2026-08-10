import { Application, Container } from "pixi.js";
import { CAMERA_ZOOM, MAX_DELTA_MS } from "../config/constants";
import type { MapPlayableBounds } from "../maps/types";

/** Soft follow strength — higher snaps tighter to the focus. */
const FOLLOW = 14;

/**
 * Keeps a world Container centered on a focus point (the local player).
 * Applies zoom and clamps so the camera does not show empty space outside the map.
 */
export class Camera {
  private mapWidth = 0;
  private mapHeight = 0;
  private readonly zoom = CAMERA_ZOOM;

  constructor(
    private readonly app: Application,
    readonly world: Container,
    private readonly getFocus: () => { x: number; y: number },
  ) {
    this.world.scale.set(this.zoom);
    this.app.stage.addChild(this.world);
  }

  /** Call after map load so clamping knows the world size. */
  setMapSize(width: number, height: number): void {
    this.mapWidth = width;
    this.mapHeight = height;
  }

  start(): void {
    this.snap();
    this.app.ticker.add(this.update);
    this.app.renderer.on("resize", this.snap);
  }

  /** Jump instantly (boot / hydrate / resize). */
  snap = (): void => {
    const focus = this.getFocus();
    const { x, y } = this.clampedWorldOffset(focus.x, focus.y);
    this.world.position.set(x, y);
  };

  /** Convert canvas/screen pixels into world coordinates. */
  screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    return {
      x: (screenX - this.world.x) / this.zoom,
      y: (screenY - this.world.y) / this.zoom,
    };
  }

  /** Current visible world rectangle, used by the minimap viewport outline. */
  getViewportBounds(): { x: number; y: number; width: number; height: number } {
    return {
      x: -this.world.x / this.zoom,
      y: -this.world.y / this.zoom,
      width: this.app.screen.width / this.zoom,
      height: this.app.screen.height / this.zoom,
    };
  }

  private update = (): void => {
    const dt = Math.min(this.app.ticker.deltaMS, MAX_DELTA_MS) / 1000;
    const focus = this.getFocus();
    const target = this.clampedWorldOffset(focus.x, focus.y);
    const alpha = 1 - Math.exp(-FOLLOW * dt);

    this.world.x += (target.x - this.world.x) * alpha;
    this.world.y += (target.y - this.world.y) * alpha;
  };

  private clampedWorldOffset(
    focusX: number,
    focusY: number,
  ): { x: number; y: number } {
    const sw = this.app.screen.width;
    const sh = this.app.screen.height;
    const z = this.zoom;

    // Center the focus on screen, accounting for world scale.
    let x = sw / 2 - focusX * z;
    let y = sh / 2 - focusY * z;

    if (this.mapWidth <= 0 || this.mapHeight <= 0) {
      return { x, y };
    }

    const mapW = this.mapWidth * z;
    const mapH = this.mapHeight * z;

    if (mapW <= sw) {
      x = (sw - mapW) / 2;
    } else {
      x = Math.min(0, Math.max(sw - mapW, x));
    }

    if (mapH <= sh) {
      y = (sh - mapH) / 2;
    } else {
      y = Math.min(0, Math.max(sh - mapH, y));
    }

    return { x, y };
  }
}

/** Re-export for callers that clamp movement to playable area. */
export type { MapPlayableBounds };
