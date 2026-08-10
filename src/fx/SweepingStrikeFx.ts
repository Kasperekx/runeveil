import {
  AnimatedSprite,
  Assets,
  Texture,
  type Container,
} from "pixi.js";
import type { CreatureFacing } from "../creatures/CreatureSprites";

const FRAME_URLS = [
  "/assets/fx/sweeping-strike/frame-1-v2.png",
  "/assets/fx/sweeping-strike/frame-2-v2.png",
  "/assets/fx/sweeping-strike/frame-3-v2.png",
  "/assets/fx/sweeping-strike/frame-4-v2.png",
];

const OFFSET = 28;
/** ~0.7s for 4 frames at 60fps (dusty physical slash). */
const ANIM_SPEED = 0.2;
const FADE_OUT_MS = 220;

let ready = false;

/** One-shot frontal slash VFX for Zamaszysty cios. */
export class SweepingStrikeFx {
  static async preload(): Promise<void> {
    if (ready) return;
    await Assets.load(FRAME_URLS);
    for (const url of FRAME_URLS) {
      Texture.from(url).source.scaleMode = "linear";
    }
    ready = true;
  }

  static play(
    world: Container,
    x: number,
    y: number,
    facing: CreatureFacing,
  ): void {
    if (!ready) return;

    const frames = FRAME_URLS.map((url) => Texture.from(url));
    const sprite = new AnimatedSprite(frames);
    sprite.anchor.set(0.5);
    sprite.animationSpeed = ANIM_SPEED;
    sprite.loop = false;
    sprite.scale.set(0.45);
    sprite.zIndex = Math.round(y) + 2;
    // v2 frames are dusty physical trails on transparent BG (legacy v1 used additive gold).
    sprite.blendMode = "normal";

    const { ox, oy, rotation, flipX } = poseForFacing(facing);
    sprite.position.set(x + ox, y + oy);
    sprite.rotation = rotation;
    if (flipX) sprite.scale.x *= -1;

    world.addChild(sprite);
    sprite.onComplete = () => {
      const started = performance.now();
      const tick = (): void => {
        if (sprite.destroyed) return;
        const t = (performance.now() - started) / FADE_OUT_MS;
        if (t >= 1) {
          sprite.destroy();
          return;
        }
        sprite.alpha = 1 - t;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };
    sprite.play();
  }
}

function poseForFacing(facing: CreatureFacing): {
  ox: number;
  oy: number;
  rotation: number;
  flipX: boolean;
} {
  switch (facing) {
    case "left":
      return { ox: -OFFSET, oy: -4, rotation: 0, flipX: true };
    case "right":
      return { ox: OFFSET, oy: -4, rotation: 0, flipX: false };
    case "up":
      return { ox: 0, oy: -OFFSET, rotation: -Math.PI / 2, flipX: false };
    default:
      return { ox: 0, oy: OFFSET, rotation: Math.PI / 2, flipX: false };
  }
}
