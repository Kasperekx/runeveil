import { Application } from "pixi.js";
import { APP_BACKGROUND } from "../config/constants";

export async function createApp(): Promise<Application> {
  const app = new Application();

  await app.init({
    background: APP_BACKGROUND,
    resizeTo: window,
    resolution: window.devicePixelRatio,
    autoDensity: true,
    antialias: false,
  });

  const container = document.getElementById("pixi-container");
  if (!container) {
    throw new Error("Missing #pixi-container");
  }

  container.appendChild(app.canvas);
  return app;
}
