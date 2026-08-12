import { Application, Sprite } from "pixi.js";
import { MAX_DELTA_MS } from "../config/constants";
import type { ItemId } from "../items/catalog";
import { CreatureSprites, type CreatureFacing } from "./CreatureSprites";

const CARDINAL: ReadonlyArray<{
  facing: CreatureFacing;
  x: number;
  y: number;
}> = [
  { facing: "right", x: 1, y: 0 },
  { facing: "left", x: -1, y: 0 },
  { facing: "down", x: 0, y: 1 },
  { facing: "up", x: 0, y: -1 },
];

export interface WanderingAnimalConfig {
  speed: number;
  animFps: number;
  renderScale: number;
  respawnMs: number;
  hitRadius: number;
  dropItem: ItemId;
  dropQuantity: number;
}

/** Cardinal wanderer with idle/walk animation and respawn. */
export class WanderingAnimal {
  readonly config: WanderingAnimalConfig;
  private readonly sprite: Sprite;
  private readonly sprites: CreatureSprites;
  private readonly homeX: number;
  private readonly homeY: number;
  private alive = true;
  private facing: CreatureFacing = "right";
  private dirX = 1;
  private dirY = 0;
  private moving = false;
  private moveTimer = 0;
  private pauseTimer = 0;
  private respawnAt = 0;
  private animTime = 0;
  private walkFrame = 0;
  private lastTextureKey = "";

  private constructor(
    sprite: Sprite,
    sprites: CreatureSprites,
    config: WanderingAnimalConfig,
    x: number,
    y: number,
  ) {
    this.sprite = sprite;
    this.sprites = sprites;
    this.config = config;
    this.homeX = x;
    this.homeY = y;
    this.pickNewDirection();
    this.applyFrame();
  }

  static async create(
    app: Application,
    sprites: CreatureSprites,
    config: WanderingAnimalConfig,
    x: number,
    y: number,
  ): Promise<WanderingAnimal> {
    const sprite = new Sprite(sprites.framesFor("right").idle);
    sprite.anchor.set(0.5);
    sprite.scale.set(config.renderScale);
    sprite.roundPixels = true;
    sprite.position.set(x, y);
    app.stage.addChild(sprite);

    return new WanderingAnimal(sprite, sprites, config, x, y);
  }

  get position(): { x: number; y: number } {
    return { x: this.sprite.position.x, y: this.sprite.position.y };
  }

  get isAlive(): boolean {
    return this.alive;
  }

  get hitRadius(): number {
    return this.config.hitRadius;
  }

  update(app: Application, deltaMS: number): void {
    const dt = Math.min(deltaMS, MAX_DELTA_MS) / 1000;

    if (!this.alive) {
      if (performance.now() >= this.respawnAt) this.respawn();
      return;
    }

    if (this.pauseTimer > 0) {
      this.moving = false;
      this.pauseTimer -= dt;
      if (this.pauseTimer <= 0) this.pickNewDirection();
      this.updateAnimation(dt);
      return;
    }

    this.moveTimer -= dt;
    if (this.moveTimer <= 0) {
      this.moving = false;
      this.pauseTimer = 0.4 + Math.random() * 0.8;
      this.updateAnimation(dt);
      return;
    }

    this.moving = true;
    const distance = this.config.speed * dt;
    let nextX = this.sprite.position.x + this.dirX * distance;
    let nextY = this.sprite.position.y + this.dirY * distance;

    const margin = 40;
    const minX = margin;
    const maxX = app.screen.width - margin;
    const minY = margin;
    const maxY = app.screen.height - margin;

    if (nextX < minX || nextX > maxX) {
      this.reverseHorizontal();
      nextX = Math.min(maxX, Math.max(minX, nextX));
    }
    if (nextY < minY || nextY > maxY) {
      this.reverseVertical();
      nextY = Math.min(maxY, Math.max(minY, nextY));
    }

    this.sprite.position.set(nextX, nextY);
    this.updateAnimation(dt);
  }

  kill(): void {
    if (!this.alive) return;
    this.alive = false;
    this.moving = false;
    this.sprite.visible = false;
    this.respawnAt = performance.now() + this.config.respawnMs;
  }

  private respawn(): void {
    this.alive = true;
    this.sprite.visible = true;
    this.sprite.position.set(this.homeX, this.homeY);
    this.animTime = 0;
    this.walkFrame = 0;
    this.lastTextureKey = "";
    this.pickNewDirection();
    this.applyFrame();
  }

  private pickNewDirection(): void {
    const next = CARDINAL[Math.floor(Math.random() * CARDINAL.length)]!;
    this.facing = next.facing;
    this.dirX = next.x;
    this.dirY = next.y;
    this.moveTimer = 1.2 + Math.random() * 2.2;
    this.moving = true;
    this.animTime = 0;
    this.walkFrame = 0;
    this.applyFrame();
  }

  private reverseHorizontal(): void {
    if (this.dirX === 0) return;
    this.dirX *= -1;
    this.facing = this.dirX > 0 ? "right" : "left";
    this.applyFrame();
  }

  private reverseVertical(): void {
    if (this.dirY === 0) return;
    this.dirY *= -1;
    this.facing = this.dirY > 0 ? "down" : "up";
    this.applyFrame();
  }

  private updateAnimation(dt: number): void {
    if (!this.moving) {
      this.walkFrame = 0;
      this.animTime = 0;
      this.applyFrame();
      return;
    }

    this.animTime += dt;
    const frameDuration = 1 / this.config.animFps;
    while (this.animTime >= frameDuration) {
      this.animTime -= frameDuration;
      const walk = this.sprites.framesFor(this.facing).walk;
      this.walkFrame = (this.walkFrame + 1) % walk.length;
    }
    this.applyFrame();
  }

  private applyFrame(): void {
    const frames = this.sprites.framesFor(this.facing);
    const texture = this.moving ? frames.walk[this.walkFrame]! : frames.idle;
    const direction =
      this.facing === "left" && this.sprites.mirrorLeft ? -1 : 1;
    const scaleX = this.config.renderScale * direction;
    const key = `${this.facing}:${this.moving ? `w${this.walkFrame}` : "idle"}`;

    if (key !== this.lastTextureKey) {
      this.lastTextureKey = key;
      this.sprite.texture = texture;
    }

    if (this.sprite.scale.x !== scaleX) {
      this.sprite.scale.x = scaleX;
    }
    if (this.sprite.scale.y !== this.config.renderScale) {
      this.sprite.scale.y = this.config.renderScale;
    }
  }
}
