import { Container, Graphics, Sprite, Text } from "pixi.js";
import { MAX_DELTA_MS } from "../config/constants";
import { getCreatureName } from "./catalog";
import { CreatureSprites, type CreatureFacing } from "./CreatureSprites";

/** How fast the sprite chases the server target (higher = snappier). */
const FOLLOW = 14;
/** Visual speed below this → idle pose. */
const MOVE_EPSILON = 8;

const HP_BAR_W = 44;
const HP_BAR_H = 3;
const HP_BAR_Y = -34;
const NAME_Y = -35;
/**
 * Flat corpses sit on the ground — push their sort key down so standing
 * characters (player / living animals) draw on top when overlapping.
 */
const CORPSE_Z_BIAS = 72;

/** Client visual for a server-driven animal — lerps between sparse patches. */
export class SyncedAnimalView {
  readonly id: string;
  readonly kind: string;
  private readonly root: Container;
  private readonly sprite: Sprite;
  private readonly selection: Graphics;
  private readonly lootSparkles: Graphics;
  private readonly nameLabel: Text;
  private readonly hpBack: Graphics;
  private readonly hpFill: Graphics;
  private readonly hpLabel: Text;
  private readonly sprites: CreatureSprites;
  private readonly animFps: number;
  private readonly renderScale: number;
  private alive = true;
  private selected = false;
  private lootable = false;
  private lootHovered = false;
  private lootPulse = 0;
  private hp = 1;
  private maxHp = 1;
  private facing: CreatureFacing = "right";
  private moving = false;
  private animTime = 0;
  private walkFrame = 0;
  private lastTextureKey = "";
  /** Authoritative target from server (used for combat / collision). */
  private serverX: number;
  private serverY: number;

  constructor(
    world: Container,
    id: string,
    kind: string,
    sprites: CreatureSprites,
    animFps: number,
    renderScale: number,
    x: number,
    y: number,
    alive: boolean,
    hp: number,
    maxHp: number,
  ) {
    this.id = id;
    this.kind = kind;
    this.sprites = sprites;
    this.animFps = animFps;
    this.renderScale = renderScale;
    this.serverX = x;
    this.serverY = y;
    this.alive = alive;
    this.hp = hp;
    this.maxHp = Math.max(1, maxHp);

    this.root = new Container();
    this.root.position.set(x, y);
    this.root.zIndex = this.sortZ(y);
    this.root.visible = true;

    this.selection = new Graphics();
    this.selection
      .ellipse(0, 18, 24, 11)
      .fill({ color: 0xb8954a, alpha: 0.22 })
      .ellipse(0, 18, 24, 11)
      .stroke({ width: 2, color: 0xe6c878, alpha: 0.95 });
    this.selection.visible = false;
    this.root.addChild(this.selection);

    this.sprite = new Sprite(sprites.framesFor("right").idle);
    this.sprite.anchor.set(0.5);
    this.sprite.scale.set(this.renderScale);
    this.sprite.roundPixels = true;
    this.root.addChild(this.sprite);

    this.lootSparkles = new Graphics();
    this.lootSparkles.visible = false;
    this.root.addChild(this.lootSparkles);

    this.nameLabel = new Text({
      text: getCreatureName(kind),
      style: {
        fontFamily: "Cinzel, Georgia, serif",
        fontSize: 9,
        fontWeight: "500",
        fill: 0xd4c9a8,
        stroke: { color: 0x1a140c, width: 1.5 },
        align: "center",
      },
    });
    this.nameLabel.anchor.set(0.5, 1);
    this.nameLabel.position.set(0, NAME_Y);
    this.nameLabel.alpha = 0.82;
    this.nameLabel.roundPixels = true;
    this.root.addChild(this.nameLabel);

    this.hpBack = new Graphics();
    this.hpFill = new Graphics();
    this.hpLabel = new Text({
      text: "",
      style: {
        fontFamily: "Cinzel, Georgia, serif",
        fontSize: 8,
        fontWeight: "500",
        fill: 0xc8b896,
        stroke: { color: 0x1a140c, width: 1.25 },
      },
    });
    this.hpLabel.anchor.set(0.5, 1);
    this.hpLabel.position.set(0, HP_BAR_Y - 1);
    this.hpLabel.alpha = 0.75;
    this.hpLabel.roundPixels = true;
    this.root.addChild(this.hpBack, this.hpFill);
    this.redrawHp();
    this.syncNameVisibility();

    world.sortableChildren = true;
    world.addChild(this.root);
    if (alive) this.applyFrame();
    else this.showCorpsePose();
  }

  /** Server / combat position (not the smoothed sprite). */
  get position(): { x: number; y: number } {
    return { x: this.serverX, y: this.serverY };
  }

  get isAlive(): boolean {
    return this.alive;
  }

  get isCorpse(): boolean {
    return !this.alive;
  }

  get vitals(): { hp: number; maxHp: number; name: string } {
    return {
      hp: this.hp,
      maxHp: this.maxHp,
      name: getCreatureName(this.kind),
    };
  }

  setSelected(selected: boolean): void {
    this.selected = selected;
    this.selection.visible = selected && this.alive;
    this.redrawHp();
  }

  /** True while corpse still has uncollected loot. */
  setLootable(lootable: boolean): void {
    if (this.lootable === lootable) return;
    this.lootable = lootable;
    if (!lootable) this.lootHovered = false;
    this.syncLootVisuals();
  }

  /** Mouse over a lootable corpse — brighter sparkles. */
  setLootHover(hovered: boolean): void {
    if (this.lootHovered === hovered) return;
    this.lootHovered = hovered;
    this.syncLootVisuals();
  }

  /** Push latest networked pose — does not snap the sprite. */
  setServerState(
    x: number,
    y: number,
    alive: boolean,
    hp: number,
    maxHp: number,
  ): void {
    this.serverX = x;
    this.serverY = y;
    this.hp = hp;
    this.maxHp = Math.max(1, maxHp);

    if (alive !== this.alive) {
      this.alive = alive;
      this.root.visible = true;
      if (alive) {
        this.root.position.set(x, y);
        this.root.zIndex = this.sortZ(y);
        this.animTime = 0;
        this.walkFrame = 0;
        this.lastTextureKey = "";
        this.moving = false;
        this.sprite.angle = 0;
        this.lootable = false;
        this.lootHovered = false;
      } else {
        this.selection.visible = false;
        this.moving = false;
        this.showCorpsePose();
      }
    }

    if (!alive) {
      this.moving = false;
      this.root.position.set(x, y);
      this.root.zIndex = this.sortZ(y);
      this.showCorpsePose();
    }

    this.selection.visible = this.selected && this.alive;
    this.redrawHp();
    this.syncNameVisibility();
    this.syncLootVisuals();
  }

  /** Frame update: smooth toward server target + walk cycle. */
  update(deltaMS: number): void {
    const dt = Math.min(deltaMS, MAX_DELTA_MS) / 1000;

    if (!this.alive) {
      this.moving = false;
      if (this.lootable) {
        this.lootPulse += dt;
        this.redrawLootSparkles();
      }
      return;
    }

    const prevX = this.root.position.x;
    const prevY = this.root.position.y;
    const alpha = 1 - Math.exp(-FOLLOW * dt);
    const nextX = prevX + (this.serverX - prevX) * alpha;
    const nextY = prevY + (this.serverY - prevY) * alpha;
    this.root.position.set(nextX, nextY);
    this.root.zIndex = this.sortZ(nextY);

    const vx = (nextX - prevX) / Math.max(dt, 1 / 240);
    const vy = (nextY - prevY) / Math.max(dt, 1 / 240);
    const speed = Math.hypot(vx, vy);
    // Sparse server patches: keep walk cycle while still catching up to target.
    const distToTarget = Math.hypot(this.serverX - nextX, this.serverY - nextY);
    this.moving = speed > MOVE_EPSILON || distToTarget > 2;

    if (this.moving) {
      if (Math.abs(vx) >= Math.abs(vy) && speed > MOVE_EPSILON * 0.25) {
        this.facing = vx >= 0 ? "right" : "left";
      } else if (speed > MOVE_EPSILON * 0.25) {
        this.facing = vy >= 0 ? "down" : "up";
      } else if (distToTarget > 2) {
        const tdx = this.serverX - nextX;
        const tdy = this.serverY - nextY;
        if (Math.abs(tdx) >= Math.abs(tdy)) {
          this.facing = tdx >= 0 ? "right" : "left";
        } else {
          this.facing = tdy >= 0 ? "down" : "up";
        }
      }
    }

    this.updateAnimation(dt);
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }

  private showCorpsePose(): void {
    this.sprite.texture = this.sprites.dead;
    this.sprite.scale.set(this.renderScale);
    this.sprite.angle = this.sprites.deadAngle;
    this.lastTextureKey = "dead";
    this.syncNameVisibility();
  }

  private sortZ(y: number): number {
    const base = Math.round(y);
    return this.alive ? base : base - CORPSE_Z_BIAS;
  }

  private syncNameVisibility(): void {
    this.nameLabel.visible = this.alive;
  }

  private syncLootVisuals(): void {
    const show = !this.alive && this.lootable;
    this.lootSparkles.visible = show;
    if (show) this.redrawLootSparkles();
    else this.lootSparkles.clear();
  }

  private redrawLootSparkles(): void {
    const hover = this.lootHovered;
    const t = this.lootPulse;
    // Body-centered sparkles (not a ground ring).
    const sparks = hover
      ? [
          [-12, -18, 1.15],
          [10, -22, 1.0],
          [0, -28, 1.35],
          [-16, -6, 0.9],
          [14, -8, 1.05],
          [4, -14, 0.8],
        ]
      : [
          [-10, -18, 1.0],
          [9, -24, 1.15],
          [0, -12, 0.85],
          [12, -8, 0.95],
        ];

    this.lootSparkles.clear();
    for (const [sx, sy, size] of sparks) {
      const twinkle = 0.45 + 0.55 * Math.sin(t * 4.2 + sx! * 0.35 + sy! * 0.2);
      const alpha = (hover ? 0.95 : 0.72) * twinkle;
      const arm = (hover ? 3.2 : 2.6) * size!;
      this.drawLootSpark(sx!, sy!, arm, alpha);
    }
  }

  /** Classic 4-point sparkle (WoW corpse glitter). */
  private drawLootSpark(
    x: number,
    y: number,
    arm: number,
    alpha: number,
  ): void {
    const color = 0xfff1b0;
    const core = 0xffffff;
    this.lootSparkles
      .moveTo(x, y - arm)
      .lineTo(x + arm * 0.28, y)
      .lineTo(x, y + arm)
      .lineTo(x - arm * 0.28, y)
      .closePath()
      .fill({ color, alpha })
      .moveTo(x - arm, y)
      .lineTo(x, y + arm * 0.28)
      .lineTo(x + arm, y)
      .lineTo(x, y - arm * 0.28)
      .closePath()
      .fill({ color, alpha: alpha * 0.9 })
      .circle(x, y, Math.max(0.7, arm * 0.22))
      .fill({ color: core, alpha: Math.min(1, alpha + 0.15) });
  }

  private redrawHp(): void {
    const show = this.alive && (this.selected || this.hp < this.maxHp);
    this.hpBack.visible = show;
    this.hpFill.visible = show;
    this.hpLabel.visible = show;
    if (!show) return;

    const ratio = Math.max(0, Math.min(1, this.hp / this.maxHp));
    const fillW = Math.max(0, HP_BAR_W * ratio);
    const color = ratio > 0.55 ? 0x6b8f5c : ratio > 0.3 ? 0xb8944a : 0xa04a42;

    const trackX = -HP_BAR_W / 2;
    const trackY = HP_BAR_Y;
    const radius = 2;

    this.hpBack.clear();
    this.hpBack
      .roundRect(trackX - 1, trackY, HP_BAR_W + 2, HP_BAR_H + 2, radius)
      .fill({ color: 0x100c08, alpha: 0.5 })
      .stroke({ width: 1, color: 0x8a7a52, alpha: 0.28 });

    this.hpFill.clear();
    if (fillW > 0.5) {
      this.hpFill
        .roundRect(trackX, trackY + 1, fillW, HP_BAR_H, radius - 0.5)
        .fill({ color, alpha: 0.88 });
    }

    this.hpLabel.text = `${Math.ceil(this.hp)}`;
  }

  private updateAnimation(dt: number): void {
    if (!this.moving) {
      this.walkFrame = 0;
      this.animTime = 0;
      this.applyFrame();
      return;
    }

    this.animTime += dt;
    const frameDuration = 1 / this.animFps;
    while (this.animTime >= frameDuration) {
      this.animTime -= frameDuration;
      const walk = this.sprites.framesFor(this.facing).walk;
      this.walkFrame = (this.walkFrame + 1) % walk.length;
    }
    this.applyFrame();
  }

  private applyFrame(): void {
    if (!this.alive) {
      this.showCorpsePose();
      return;
    }

    const frames = this.sprites.framesFor(this.facing);
    const texture = this.moving ? frames.walk[this.walkFrame]! : frames.idle;
    const direction =
      this.facing === "left" && this.sprites.mirrorLeft ? -1 : 1;
    const scaleX = this.renderScale * direction;
    const key = `${this.facing}:${this.moving ? `w${this.walkFrame}` : "idle"}`;

    if (key !== this.lastTextureKey) {
      this.lastTextureKey = key;
      this.sprite.texture = texture;
    }

    if (this.sprite.scale.x !== scaleX) {
      this.sprite.scale.x = scaleX;
    }
    if (this.sprite.scale.y !== this.renderScale) {
      this.sprite.scale.y = this.renderScale;
    }
  }
}
