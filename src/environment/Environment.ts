import {
  Assets,
  Container,
  Graphics,
  Sprite,
  TilingSprite,
  type Application,
  type Texture,
} from "pixi.js";
import {
  collidersFromMap,
  type MapCircleCollider,
  type MapDocument,
  type MapWorldInteraction,
} from "../maps/types";

const GROUND_Z = 0;
const SHADOW_LAYER_Z = 1;
/** Draw solid circles from the map (props + NPCs) while tuning collision. */
const DEBUG_COLLIDERS = false;
const DEBUG_COLLIDER_Z = 50_000;

interface SmokePuff {
  offset: number;
  duration: number;
  startX: number;
  drift: number;
  driftSpeed: number;
  phase: number;
  size: number;
  opacity: number;
  rise: number;
}

interface CampfireEffect {
  graphics: Graphics;
  flameX: number;
  flameBaseY: number;
  smokeX: number;
  smokeOriginY: number;
  elapsed: number;
  phase: number;
  puffs: SmokePuff[];
}

/**
 * Renders ground + props from a map document.
 * Props live on `world` with Y-based zIndex so tall trees sort with the player.
 */
export class Environment {
  readonly colliders: readonly MapCircleCollider[];
  /** Clickable world props, separate from their physical collision. */
  readonly interactions: readonly MapWorldInteraction[];

  private constructor(map: MapDocument) {
    this.colliders = collidersFromMap(map);
    this.interactions = map.props.flatMap((prop) => {
      const interaction = map.propTypes[prop.type]?.interaction;
      const station = map.cookingStations?.find(
        (candidate) => candidate.id === interaction?.stationId,
      );
      return interaction && interaction.radius > 0
        ? [
            {
              kind: interaction.kind,
              x: prop.x,
              y: prop.y,
              activationRadius: Math.max(1, station?.radius ?? 96),
              radius: interaction.radius,
              stationId: interaction.stationId,
            },
          ]
        : [];
    });
  }

  /** Returns the closest matching world prop under a world-space pointer. */
  findInteraction(
    kind: MapWorldInteraction["kind"],
    x: number,
    y: number,
  ): MapWorldInteraction | null {
    let nearest: MapWorldInteraction | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const interaction of this.interactions) {
      if (interaction.kind !== kind) continue;
      const distance = Math.hypot(x - interaction.x, y - interaction.y);
      if (distance > interaction.radius || distance >= nearestDistance)
        continue;
      nearest = interaction;
      nearestDistance = distance;
    }
    return nearest;
  }

  static async create(
    app: Application,
    world: Container,
    map: MapDocument,
  ): Promise<Environment> {
    const groundLayer = new Container();
    groundLayer.zIndex = GROUND_Z;
    world.addChild(groundLayer);

    const shadowLayer = new Container();
    shadowLayer.zIndex = SHADOW_LAYER_Z;
    world.addChild(shadowLayer);

    const groundTex = await loadNearestTexture(map.ground.texture);
    const tileScale = map.ground.tileScale ?? 1;
    const ground = new TilingSprite({
      texture: groundTex,
      width: map.width,
      height: map.height,
    });
    ground.tileScale.set(tileScale);
    ground.roundPixels = true;
    groundLayer.addChild(ground);

    for (const patch of map.groundPatches ?? []) {
      const patchTex = await loadNearestTexture(patch.texture);
      const patchSprite = new TilingSprite({
        texture: patchTex,
        width: patch.width,
        height: patch.height,
      });
      patchSprite.position.set(patch.x, patch.y);
      patchSprite.tileScale.set(patch.tileScale ?? 1);
      patchSprite.roundPixels = true;
      groundLayer.addChild(patchSprite);
    }

    const env = new Environment(map);
    const animatedProps: Array<{
      sprite: Sprite;
      frames: Texture[];
      fps: number;
      elapsed: number;
      frameIndex: number;
    }> = [];
    const ambientEffects: CampfireEffect[] = [];

    for (const prop of map.props) {
      const def = map.propTypes[prop.type];
      if (!def) {
        console.warn(`[environment] unknown prop type: ${prop.type}`);
        continue;
      }

      if (def.shadow) {
        const shadow = new Graphics();
        const alpha = def.shadow.alpha ?? 0.35;
        shadow.ellipse(0, 0, def.shadow.radiusX, def.shadow.radiusY);
        shadow.fill({ color: 0x0a0c08, alpha });
        shadow.position.set(prop.x, prop.y + 2);
        shadowLayer.addChild(shadow);
      }

      const frames = def.idleAnimation
        ? await Promise.all(def.idleAnimation.frames.map(loadNearestTexture))
        : [await loadNearestTexture(def.texture)];
      const sprite = new Sprite(frames[0]);
      const scale = def.scale ?? 1;
      sprite.anchor.set(def.anchorX, def.anchorY);
      sprite.scale.set(scale);
      sprite.position.set(prop.x, prop.y);
      sprite.roundPixels = true;

      // Short ground clutter stays under entities; tall props Y-sort with them.
      if (def.layer === "ground") {
        groundLayer.addChild(sprite);
      } else {
        sprite.zIndex = Math.round(prop.y);
        world.addChild(sprite);
      }

      if (def.idleAnimation && frames.length > 1) {
        animatedProps.push({
          sprite,
          frames,
          fps: def.idleAnimation.fps,
          elapsed: 0,
          frameIndex: 0,
        });
      }

      if (def.ambientEffect?.kind === "campfire") {
        const effect = new Graphics();
        effect.zIndex = Math.round(prop.y) + 1;
        effect.roundPixels = true;
        world.addChild(effect);
        ambientEffects.push(
          createCampfireEffect(
            effect,
            prop.x,
            prop.y,
            frames[0]!.width * scale,
            frames[0]!.height * scale,
            def.anchorX,
            def.anchorY,
          ),
        );
      }
    }

    if (animatedProps.length > 0 || ambientEffects.length > 0) {
      app.ticker.add(() => {
        const deltaSeconds = Math.min(app.ticker.deltaMS, 100) / 1000;
        for (const animation of animatedProps) {
          animation.elapsed += deltaSeconds;
          const frameDuration = 1 / animation.fps;
          while (animation.elapsed >= frameDuration) {
            animation.elapsed -= frameDuration;
            animation.frameIndex =
              (animation.frameIndex + 1) % animation.frames.length;
            animation.sprite.texture = animation.frames[animation.frameIndex]!;
          }
        }
        for (const effect of ambientEffects) {
          effect.elapsed += deltaSeconds;
          drawCampfireEffect(effect);
        }
      });
    }

    if (DEBUG_COLLIDERS) {
      const debugLayer = new Graphics();
      debugLayer.zIndex = DEBUG_COLLIDER_Z;
      debugLayer.eventMode = "none";
      for (const c of env.colliders) {
        debugLayer.circle(c.x, c.y, c.radius);
        debugLayer.fill({ color: 0x3399ff, alpha: 0.28 });
        debugLayer.circle(c.x, c.y, c.radius);
        debugLayer.stroke({ width: 1, color: 0x66ccff, alpha: 0.7 });
      }
      world.addChild(debugLayer);
    }

    return env;
  }
}

function createCampfireEffect(
  graphics: Graphics,
  propX: number,
  propY: number,
  width: number,
  height: number,
  anchorX: number,
  anchorY: number,
): CampfireEffect {
  // These are normalized positions inside the authored campfire artwork.
  // Converting them through the prop anchor keeps the effect attached when a
  // map author changes anchorY or scales the prop.
  const sourceCenterX = width * 0.5;
  const flameSourceY = height * 0.65;
  const smokeSourceY = height * 0.42;
  return {
    graphics,
    flameX: propX + sourceCenterX - width * anchorX,
    flameBaseY: propY + flameSourceY - height * anchorY,
    smokeX: propX + sourceCenterX - width * anchorX,
    smokeOriginY: propY + smokeSourceY - height * anchorY,
    elapsed: 0,
    phase: Math.random() * Math.PI * 2,
    // Every wisp has a different cadence and sway, avoiding a repeating,
    // evenly spaced "smoke conveyor belt".
    puffs: Array.from({ length: 3 }, (_, index) => ({
      offset: index / 3 + Math.random() * 0.12,
      duration: 3.1 + Math.random() * 1.35,
      startX: -4 + Math.random() * 8,
      drift: 3 + Math.random() * 4,
      driftSpeed: 0.75 + Math.random() * 0.55,
      phase: Math.random() * Math.PI * 2,
      size: 3 + Math.floor(Math.random() * 2),
      opacity: 0.22 + Math.random() * 0.13,
      rise: 35 + Math.random() * 13,
    })),
  };
}

/** Small pixel clusters keep the animated smoke consistent with the prop art. */
function drawCampfireEffect(effect: CampfireEffect): void {
  const { graphics, flameX, flameBaseY, smokeX, smokeOriginY, elapsed, phase } =
    effect;
  graphics.clear();

  // A subtle bright flicker nestled inside the logs; the static sprite still
  // supplies the fire's main silhouette, so this stays restrained.
  const flutter =
    Math.sin(elapsed * 5.7 + phase) * 0.5 +
    Math.sin(elapsed * 9.1 + phase * 0.7) * 0.3;
  const flicker = 0.2 + Math.max(0, flutter) * 0.1;
  const flameHeight = 7 + Math.round(Math.max(-1, flutter) * 2 + 2);
  graphics.rect(flameX - 3, flameBaseY - flameHeight, 6, flameHeight + 4);
  graphics.fill({ color: 0xffbd4d, alpha: flicker });
  graphics.rect(flameX - 1, flameBaseY - 3 - flameHeight, 3, flameHeight);
  graphics.fill({ color: 0xffe59a, alpha: flicker * 0.75 });

  for (const puff of effect.puffs) {
    const cycle = (elapsed / puff.duration + puff.offset) % 1;
    const riseProgress = 1 - (1 - cycle) ** 1.35;
    const sway =
      Math.sin(
        cycle * Math.PI * 1.25 + elapsed * puff.driftSpeed + puff.phase,
      ) *
      puff.drift *
      (0.3 + riseProgress * 0.7);
    const alpha = Math.sin(cycle * Math.PI) ** 1.35 * puff.opacity;
    const size = puff.size + Math.floor(riseProgress * 2);
    const puffX = Math.round(smokeX + puff.startX + sway);
    const puffY = Math.round(smokeOriginY - riseProgress * puff.rise);

    graphics.rect(puffX, puffY, size, size);
    graphics.fill({
      color: cycle > 0.52 ? 0xaeb9ae : 0xd3dbcf,
      alpha,
    });
    if (cycle > 0.27) {
      graphics.rect(
        puffX - Math.round(sway * 0.22) - 1,
        puffY + 2,
        Math.max(2, size - 1),
        Math.max(2, size - 2),
      );
      graphics.fill({ color: 0x879187, alpha: alpha * 0.58 });
    }
  }
}

async function loadNearestTexture(url: string): Promise<Texture> {
  const texture = (await Assets.load(url)) as Texture;
  const source = texture.source;
  source.scaleMode = "nearest";
  // Ensure PNG alpha is treated as transparency (not opaque fringe).
  if ("alphaMode" in source) {
    (source as { alphaMode: string }).alphaMode = "premultiplied-alpha";
  }
  return texture;
}
