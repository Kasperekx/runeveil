import {
  Container,
  Graphics,
  Sprite,
  Texture,
  type Application,
} from "pixi.js";
import type { MapDocument } from "../maps/types";

interface StaticLight {
  halo: Sprite;
  core: Sprite;
  haloAlpha: number;
  coreAlpha: number;
  haloScale: number;
  coreScale: number;
  flicker: boolean;
  phase: number;
}

/** One complete day/night rotation, deliberately slow rather than distracting. */
const DAY_CYCLE_SECONDS = 420;
/** Above all world entities, below DOM HUD. */
const LIGHTING_Z = 100_000;
const AMBIENT_COLOR = 0x283955;
const LIGHT_TEXTURE_SIZE = 256;

/**
 * A soft ambient day/night veil with texture-based lights. The radial gradient
 * is continuous, so local lights do not reveal rings at their edges.
 */
export class LightSystem {
  private readonly veil = new Graphics();
  private readonly lightTexture: Texture;
  private readonly staticLights: StaticLight[] = [];
  private readonly layer: Container;
  private readonly isInterior: boolean;
  private readonly interiorAmbientAlpha: number;
  private readonly interiorLightVisibility: number;
  /** Start at midnight to preview the full nighttime lighting. */
  private elapsed = 0;
  private ambientAccumulator = 0;
  private localLightVisibility = 1;

  private constructor(
    private readonly app: Application,
    world: Container,
    map: MapDocument,
  ) {
    this.isInterior = map.lighting?.mode === "interior";
    this.interiorAmbientAlpha = clamp01(map.lighting?.ambientAlpha ?? 0.22);
    this.interiorLightVisibility = clamp01(
      map.lighting?.localLightVisibility ?? 1,
    );
    this.layer = new Container();
    this.layer.zIndex = LIGHTING_Z;
    this.layer.eventMode = "none";
    this.layer.cullable = false;

    world.sortableChildren = true;
    world.addChild(this.layer);

    this.veil.eventMode = "none";
    this.veil
      .rect(0, 0, map.width, map.height)
      .fill(map.lighting?.ambientColor ?? AMBIENT_COLOR);
    this.veil.blendMode = "multiply";
    this.layer.addChild(this.veil);

    this.lightTexture = createRadialLightTexture();

    for (const prop of map.props) {
      const light = map.propTypes[prop.type]?.light;
      if (!light || light.radius <= 0 || light.intensity <= 0) continue;

      const centerX = prop.x + (light.offsetX ?? 0);
      const centerY = prop.y + (light.offsetY ?? 0);
      const haloScale = (light.radius * 2) / LIGHT_TEXTURE_SIZE;
      const coreScale = haloScale * 0.48;
      const haloAlpha = light.intensity * 0.48;
      const coreAlpha = light.intensity * 0.82;

      const halo = createLightSprite(
        this.lightTexture,
        centerX,
        centerY,
        haloScale,
        light.color,
        haloAlpha,
      );
      const core = createLightSprite(
        this.lightTexture,
        centerX,
        centerY,
        coreScale,
        mixColor(light.color, 0xffcf72, 0.42),
        coreAlpha,
      );
      this.layer.addChild(halo, core);

      this.staticLights.push({
        halo,
        core,
        haloAlpha,
        coreAlpha,
        haloScale,
        coreScale,
        flicker: light.flicker ?? false,
        phase: Math.random() * Math.PI * 2,
      });
    }

    this.updateAmbient();
    this.updateLocalLights();
  }

  static create(
    app: Application,
    world: Container,
    map: MapDocument,
  ): LightSystem {
    const system = new LightSystem(app, world, map);
    app.ticker.add(system.update);
    return system;
  }

  dispose(): void {
    this.app.ticker.remove(this.update);
    this.layer.destroy({ children: true });
  }

  private update = (): void => {
    const deltaSeconds = Math.min(this.app.ticker.deltaMS, 100) / 1_000;
    this.elapsed += deltaSeconds;
    this.ambientAccumulator += deltaSeconds;

    if (this.ambientAccumulator >= 0.1) {
      this.ambientAccumulator = 0;
      this.updateAmbient();
    }

    this.updateLocalLights();
  };

  private updateAmbient(): void {
    if (this.isInterior) {
      this.veil.alpha = this.interiorAmbientAlpha;
      this.localLightVisibility = this.interiorLightVisibility;
      return;
    }

    const cycle = (this.elapsed % DAY_CYCLE_SECONDS) / DAY_CYCLE_SECONDS;
    const daylight = (Math.cos((cycle - 0.5) * Math.PI * 2) + 1) / 2;
    const easedDaylight = daylight * daylight * (3 - 2 * daylight);

    // Multiplication preserves texture contrast and avoids a milky fog layer.
    this.veil.alpha = 0.045 + (1 - easedDaylight) * 0.675;

    // Fire glow fades in throughout dusk and disappears completely in daylight.
    const duskProgress = Math.max(0, Math.min(1, (0.72 - daylight) / 0.5));
    this.localLightVisibility =
      duskProgress * duskProgress * (3 - 2 * duskProgress);
  }

  private updateLocalLights(): void {
    for (const light of this.staticLights) {
      const slowPulse = light.flicker
        ? Math.sin(this.elapsed * 3.7 + light.phase)
        : 0;
      const fastPulse = light.flicker
        ? Math.sin(this.elapsed * 8.3 + light.phase * 1.7)
        : 0;
      const shimmer = slowPulse * 0.035 + fastPulse * 0.018;

      light.halo.alpha =
        light.haloAlpha * this.localLightVisibility * (1 + shimmer * 0.7);
      light.core.alpha =
        light.coreAlpha * this.localLightVisibility * (1 + shimmer);
      light.halo.scale.set(light.haloScale * (1 + shimmer * 0.2));
      light.core.scale.set(light.coreScale * (1 + shimmer * 0.32));
    }
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function createLightSprite(
  texture: Texture,
  x: number,
  y: number,
  scale: number,
  color: number,
  alpha: number,
): Sprite {
  const sprite = new Sprite(texture);
  sprite.anchor.set(0.5);
  sprite.position.set(x, y);
  sprite.scale.set(scale);
  sprite.tint = color;
  sprite.alpha = alpha;
  sprite.blendMode = "add";
  sprite.eventMode = "none";
  return sprite;
}

function mixColor(first: number, second: number, amount: number): number {
  const mixChannel = (shift: number): number => {
    const from = (first >> shift) & 0xff;
    const to = (second >> shift) & 0xff;
    return Math.round(from + (to - from) * amount);
  };

  return (mixChannel(16) << 16) | (mixChannel(8) << 8) | mixChannel(0);
}

function createRadialLightTexture(): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = LIGHT_TEXTURE_SIZE;
  canvas.height = LIGHT_TEXTURE_SIZE;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Nie udało się utworzyć tekstury światła.");
  }

  const center = LIGHT_TEXTURE_SIZE / 2;
  const gradient = context.createRadialGradient(
    center,
    center,
    0,
    center,
    center,
    center,
  );

  gradient.addColorStop(0, "rgba(255, 255, 255, 0.96)");
  gradient.addColorStop(0.12, "rgba(255, 255, 255, 0.78)");
  gradient.addColorStop(0.32, "rgba(255, 255, 255, 0.44)");
  gradient.addColorStop(0.58, "rgba(255, 255, 255, 0.16)");
  gradient.addColorStop(0.82, "rgba(255, 255, 255, 0.045)");
  gradient.addColorStop(1, "rgba(255, 255, 255, 0)");

  context.fillStyle = gradient;
  context.fillRect(0, 0, LIGHT_TEXTURE_SIZE, LIGHT_TEXTURE_SIZE);

  const texture = Texture.from(canvas);
  texture.source.scaleMode = "linear";
  return texture;
}
