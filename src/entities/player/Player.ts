import { Container, Sprite, Text, TextStyle } from "pixi.js";
import {
  PLAYER_ANIM_FPS,
  PLAYER_ATTACK_FPS,
  PLAYER_ATTACK_HIT_FRAME,
  PLAYER_IDLE_FPS,
} from "../../config/constants";
import type { CreatureFacing } from "../creatures/CreatureSprites";
import { PlayerSprites } from "./PlayerSprites";

/** Default world spawn when no save exists (near animal hunting grounds). */
const DEFAULT_SPAWN = { x: 640, y: 360 };

const NAME_STYLE = new TextStyle({
  fontFamily: "Cinzel, Georgia, serif",
  fontSize: 8,
  fill: 0xe8e0d0,
  stroke: { color: 0x1a1510, width: 3 },
});

/** World entity: sprite lifecycle, movement pose, and sword swings. */
export class Player {
  private readonly root = new Container();
  private sprite!: Sprite;
  private nameLabel!: Text;
  private sprites!: PlayerSprites;
  private facing: CreatureFacing = "down";
  private animTime = 0;
  private idleFrame = 0;
  private idleDir = 1;
  private walkFrame = 0;
  private attackFrame = 0;
  private moving = false;
  private attacking = false;
  private dead = false;
  private hitDelivered = false;
  private lastFrameKey = "";
  private onAttackHit: (() => void) | null = null;
  private onAttackEnd: (() => void) | null = null;
  /** Walk speed px/s — synced from server (level-scaled). */
  private walkSpeed = 110;

  private constructor(
    private readonly world: Container,
    private readonly spawn: { x: number; y: number },
  ) {}

  static async create(
    world: Container,
    spawn: { x: number; y: number } = DEFAULT_SPAWN,
    classId = "warrior",
    name = "Wędrowiec",
  ): Promise<Player> {
    const player = new Player(world, spawn);
    await player.load(classId, name);
    return player;
  }

  get position(): { x: number; y: number } {
    return { x: this.root.position.x, y: this.root.position.y };
  }

  get isAttacking(): boolean {
    return this.attacking;
  }

  get isDead(): boolean {
    return this.dead;
  }

  getFacing(): CreatureFacing {
    return this.facing;
  }

  get moveSpeed(): number {
    return this.walkSpeed;
  }

  setMoveSpeed(speed: number): void {
    this.walkSpeed = Math.max(1, speed);
  }

  setName(name: string): void {
    const trimmed = name.trim() || "Wędrowiec";
    if (this.nameLabel.text === trimmed) return;
    this.nameLabel.text = trimmed;
  }

  moveBy(dx: number, dy: number): void {
    if (this.dead) return;
    this.root.position.x += dx;
    this.root.position.y += dy;
    this.root.zIndex = Math.round(this.root.position.y);
    // Facing during a swing is owned by combat (toward the target).
    if (!this.attacking) this.setFacing(dx, dy);
  }

  faceToward(x: number, y: number): void {
    const dx = x - this.root.position.x;
    const dy = y - this.root.position.y;
    if (dx === 0 && dy === 0) return;
    this.setFacing(dx, dy);
    this.applyFrame();
  }

  /**
   * Start a sword swing. Returns false if already attacking.
   * Swing always plays to the end — movement does not cancel it (WoW-lite).
   */
  beginAttack(onHit?: () => void, onEnd?: () => void): boolean {
    if (this.dead || this.attacking) return false;
    this.attacking = true;
    this.moving = false;
    this.hitDelivered = false;
    this.idleFrame = 0;
    this.idleDir = 1;
    this.attackFrame = 0;
    this.animTime = 0;
    this.onAttackHit = onHit ?? null;
    this.onAttackEnd = onEnd ?? null;
    this.applyFrame();
    return true;
  }

  updateAnimation(deltaSeconds: number, moving: boolean): void {
    if (this.dead) {
      this.applyFrame();
      return;
    }
    if (this.attacking) {
      this.updateAttack(deltaSeconds);
      return;
    }

    if (!moving) {
      this.moving = false;
      this.animTime += deltaSeconds;
      const frameDuration = 1 / PLAYER_IDLE_FPS;
      const frames = this.sprites.framesFor(this.facing).idle;
      while (this.animTime >= frameDuration) {
        this.animTime -= frameDuration;
        this.advanceIdle(frames.length);
      }
      this.walkFrame = 0;
      this.applyFrame();
      return;
    }

    if (!this.moving) {
      this.animTime = 0;
      this.walkFrame = 0;
    }
    this.moving = true;
    this.idleFrame = 0;
    this.animTime += deltaSeconds;
    const frameDuration = 1 / PLAYER_ANIM_FPS;
    while (this.animTime >= frameDuration) {
      this.animTime -= frameDuration;
      const frames = this.sprites.framesFor(this.facing).walk;
      this.walkFrame = (this.walkFrame + 1) % frames.length;
    }
    this.applyFrame();
  }

  setPosition(x: number, y: number): void {
    this.root.position.set(x, y);
    this.root.zIndex = Math.round(y);
  }

  setDead(dead: boolean): void {
    if (dead === this.dead) return;
    this.dead = dead;
    this.attacking = false;
    this.moving = false;
    this.onAttackHit = null;
    this.onAttackEnd = null;
    this.animTime = 0;
    this.lastFrameKey = "";
    this.nameLabel.alpha = dead ? 0.55 : 1;
    this.applyFrame();
  }

  center(): void {
    this.root.position.set(this.spawn.x, this.spawn.y);
    this.root.zIndex = Math.round(this.spawn.y);
  }

  private updateAttack(deltaSeconds: number): void {
    this.animTime += deltaSeconds;
    const frameDuration = 1 / PLAYER_ATTACK_FPS;
    const frames = this.sprites.framesFor(this.facing).attack;

    while (this.animTime >= frameDuration) {
      this.animTime -= frameDuration;
      this.attackFrame += 1;

      if (!this.hitDelivered && this.attackFrame >= PLAYER_ATTACK_HIT_FRAME) {
        this.hitDelivered = true;
        this.onAttackHit?.();
      }

      if (this.attackFrame >= frames.length) {
        this.attacking = false;
        this.attackFrame = 0;
        this.animTime = 0;
        this.onAttackHit = null;
        const end = this.onAttackEnd;
        this.onAttackEnd = null;
        this.applyFrame();
        end?.();
        return;
      }
    }

    this.applyFrame();
  }

  private async load(classId: string, name: string): Promise<void> {
    this.sprites = await PlayerSprites.loadForClass(classId);

    this.sprite = new Sprite(this.sprites.framesFor(this.facing).idle[0]);
    this.sprite.anchor.set(0.5);
    this.sprite.roundPixels = true;

    this.nameLabel = new Text({
      text: name.trim() || "Wędrowiec",
      style: NAME_STYLE,
    });
    this.nameLabel.anchor.set(0.5, 1);
    this.nameLabel.position.set(0, -36);
    this.nameLabel.roundPixels = true;

    this.root.addChild(this.sprite);
    this.root.addChild(this.nameLabel);
    this.center();
    this.world.sortableChildren = true;
    this.world.addChild(this.root);
  }

  private advanceIdle(frameCount: number): void {
    if (frameCount <= 1) {
      this.idleFrame = 0;
      return;
    }
    const next = this.idleFrame + this.idleDir;
    if (next <= 0) {
      this.idleFrame = 0;
      this.idleDir = 1;
    } else if (next >= frameCount - 1) {
      this.idleFrame = frameCount - 1;
      this.idleDir = -1;
    } else {
      this.idleFrame = next;
    }
  }

  private setFacing(dx: number, dy: number): void {
    if (Math.abs(dx) >= Math.abs(dy)) {
      this.facing = dx >= 0 ? "right" : "left";
    } else {
      this.facing = dy >= 0 ? "down" : "up";
    }
  }

  private applyFrame(): void {
    if (this.dead) {
      if (this.lastFrameKey !== "dead") {
        this.lastFrameKey = "dead";
        this.sprite.texture = this.sprites.dead;
      }
      this.sprite.rotation = this.sprites.deadRotation;
      this.sprite.scale.x = 1;
      return;
    }

    if (this.sprite.rotation !== 0) this.sprite.rotation = 0;
    const frames = this.sprites.framesFor(this.facing);
    let texture = frames.idle[this.idleFrame]!;
    let key = `${this.facing}:idle${this.idleFrame}`;

    if (this.attacking) {
      const idx = Math.min(this.attackFrame, frames.attack.length - 1);
      texture = frames.attack[idx]!;
      key = `${this.facing}:atk${idx}`;
    } else if (this.moving) {
      texture = frames.walk[this.walkFrame]!;
      key = `${this.facing}:w${this.walkFrame}`;
    }

    if (key !== this.lastFrameKey) {
      this.lastFrameKey = key;
      this.sprite.texture = texture;
    }

    const scaleX = this.facing === "left" ? -1 : 1;
    if (this.sprite.scale.x !== scaleX) this.sprite.scale.x = scaleX;
  }
}
