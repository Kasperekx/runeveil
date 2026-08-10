import type { Application } from "pixi.js";
import type { Camera } from "./Camera";

/**
 * Client (page) coordinates to world coordinates, accounting for the canvas
 * being scaled by CSS from its internal render resolution.
 */
export function screenToWorld(
  app: Application,
  camera: Camera,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const bounds = app.canvas.getBoundingClientRect();
  const scaleX = app.screen.width / bounds.width;
  const scaleY = app.screen.height / bounds.height;
  const screenX = (clientX - bounds.left) * scaleX;
  const screenY = (clientY - bounds.top) * scaleY;
  return camera.screenToWorld(screenX, screenY);
}
