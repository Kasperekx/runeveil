import { Container, Sprite, Text, TextStyle } from "pixi.js";
import {
  PLAYER_ANIM_FPS,
  PLAYER_ATTACK_FPS,
  PLAYER_IDLE_FPS,
} from "../config/constants";
import type { AttackFacing } from "../config/combat";
import type { CreatureFacing } from "../creatures/CreatureSprites";
import type { NetworkRemotePlayerSnapshot } from "../network/GameNetwork";
import { PlayerSprites } from "./PlayerSprites";

const NAME_STYLE = new TextStyle({
  fontFamily: "Cinzel, Georgia, serif",
  fontSize: 11,
  fill: 0xe8e0d0,
  stroke: { color: 0x1a1510, width: 3 },
});

/**
 * Other player's avatar: lerp pose, walk/idle, attack on attackSeq bumps.
 */
export class SyncedRemotePlayerView {
  private readonly root = new Container();
  private readonly sprite: Sprite;
  private readonly nameLabel: Text;
  private facing: CreatureFacing = "down";
  private animTime = 0;
  private idleFrame = 0;
  private idleDir = 1;
  private walkFrame = 0;
  private attackFrame = 0;
  private attacking = false;
  private moving = false;
  private dead = false;
  private lastFrameKey = "";
  private lastAttackSeq = 0;
  private targetX: number;
  private targetY: number;
  private displayX: number;
  private displayY: number;

  constructor(
    world: Container,
    private readonly sprites: PlayerSprites,
    name: string,
  ) {
    this.sprite = new Sprite(sprites.framesFor(this.facing).idle[0]);
    this.sprite.anchor.set(0.5);
    this.sprite.roundPixels = true;
    this.nameLabel = new Text({ text: name, style: NAME_STYLE });
    this.nameLabel.anchor.set(0.5, 1);
    this.nameLabel.position.set(0, -36);
    this.root.addChild(this.sprite);
    this.root.addChild(this.nameLabel);
    this.targetX = 0;
    this.targetY = 0;
    this.displayX = 0;
    this.displayY = 0;
    world.addChild(this.root);
  }

  static loadSprites(classId: string): Promise<PlayerSprites> {
    return PlayerSprites.loadForClass(classId);
  }

  setServerState(snap: NetworkRemotePlayerSnapshot): void {
    this.targetX = snap.x;
    this.targetY = snap.y;
    this.nameLabel.text = snap.name;
    this.dead = snap.hp <= 0;
    if (snap.attackSeq !== this.lastAttackSeq && snap.attackSeq > 0) {
      this.lastAttackSeq = snap.attackSeq;
      if (!this.dead) this.beginAttack(snap.attackDir);
    }
  }

  update(deltaMS: number): void {
    const dt = deltaMS / 1000;
    const dx = this.targetX - this.displayX;
    const dy = this.targetY - this.displayY;
    const dist = Math.hypot(dx, dy);
    const wasMoving = this.moving;
    this.moving = !this.dead && !this.attacking && dist > 1.5;

    if (dist > 0.1) {
      const t = Math.min(1, dt * 12);
      this.displayX += dx * t;
      this.displayY += dy * t;
      if (this.moving) {
        this.setFacing(dx, dy);
      }
    } else {
      this.displayX = this.targetX;
      this.displayY = this.targetY;
    }

    this.root.position.set(this.displayX, this.displayY);
    this.root.zIndex = Math.round(this.displayY);

    if (this.dead) {
      this.attacking = false;
      this.applyFrame();
      return;
    }

    if (this.attacking) {
      this.updateAttack(dt);
      return;
    }

    if (!this.moving) {
      this.animTime += dt;
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

    if (!wasMoving) {
      this.animTime = 0;
      this.walkFrame = 0;
    }
    this.idleFrame = 0;
    this.animTime += dt;
    const frameDuration = 1 / PLAYER_ANIM_FPS;
    while (this.animTime >= frameDuration) {
      this.animTime -= frameDuration;
      const frames = this.sprites.framesFor(this.facing).walk;
      this.walkFrame = (this.walkFrame + 1) % frames.length;
    }
    this.applyFrame();
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }

  private beginAttack(dir: AttackFacing | string): void {
    if (dir === "left" || dir === "right" || dir === "up" || dir === "down") {
      this.facing = dir;
    }
    this.attacking = true;
    this.moving = false;
    this.attackFrame = 0;
    this.animTime = 0;
    this.applyFrame();
  }

  private updateAttack(dt: number): void {
    this.animTime += dt;
    const frameDuration = 1 / PLAYER_ATTACK_FPS;
    const frames = this.sprites.framesFor(this.facing).attack;
    while (this.animTime >= frameDuration) {
      this.animTime -= frameDuration;
      this.attackFrame += 1;
      if (this.attackFrame >= frames.length) {
        this.attacking = false;
        this.attackFrame = 0;
        this.animTime = 0;
        this.applyFrame();
        return;
      }
    }
    this.applyFrame();
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
      this.nameLabel.alpha = 0.55;
      return;
    }

    if (this.sprite.rotation !== 0) this.sprite.rotation = 0;
    this.nameLabel.alpha = 1;
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
