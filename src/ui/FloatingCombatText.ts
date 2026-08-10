import { Container, Text, type Application } from "pixi.js";

/** Numbers spawned within this radius get nudged apart so they stay readable. */
const STACK_RADIUS = 18;
const STACK_OFFSET = 13;

export type CombatTextVariant = "dealt" | "taken" | "xp" | "heal";

interface FloatingNumber {
  text: Text;
  bornAt: number;
  originX: number;
  originY: number;
  driftX: number;
  lifetimeMs: number;
  rise: number;
}

const STYLES: Record<
  CombatTextVariant,
  {
    fill: number;
    stroke: number;
    size: number;
    lifetimeMs: number;
    rise: number;
  }
> = {
  dealt: {
    fill: 0xf5e3b0,
    stroke: 0x2a1d08,
    size: 15,
    lifetimeMs: 900,
    rise: 34,
  },
  taken: {
    fill: 0xff6a58,
    stroke: 0x2a0a06,
    size: 17,
    lifetimeMs: 900,
    rise: 34,
  },
  // Kill XP: violet, a touch slower so it reads after the damage tick.
  xp: {
    fill: 0xc9a0ff,
    stroke: 0x1a0a2a,
    size: 14,
    lifetimeMs: 1400,
    rise: 42,
  },
  heal: {
    fill: 0x6adf7a,
    stroke: 0x0a1a0c,
    size: 15,
    lifetimeMs: 1000,
    rise: 30,
  },
};

/**
 * WoW/Tibia-style floating damage numbers.
 *
 * Lives inside the world container so numbers inherit the camera transform and
 * stay pinned to where the hit landed instead of to the screen.
 */
export class FloatingCombatText {
  private readonly layer = new Container();
  private readonly active: FloatingNumber[] = [];
  private readonly pool: Text[] = [];

  constructor(
    private readonly app: Application,
    world: Container,
  ) {
    this.layer.zIndex = 10_000;
    this.layer.sortableChildren = false;
    world.addChild(this.layer);
  }

  start(): void {
    this.app.ticker.add(this.update);
  }

  stop(): void {
    this.app.ticker.remove(this.update);
  }

  spawn(
    worldX: number,
    worldY: number,
    amount: number,
    variant: CombatTextVariant,
  ): void {
    const style = STYLES[variant];
    const text = this.take();

    if (variant === "taken") {
      text.text = `-${amount}`;
    } else if (variant === "xp") {
      text.text = `+${amount} PD`;
    } else if (variant === "heal") {
      text.text = `+${amount}`;
    } else {
      text.text = String(amount);
    }
    text.style.fontSize = style.size;
    text.style.fill = style.fill;
    text.style.stroke = { color: style.stroke, width: 4 };
    text.alpha = 1;
    text.scale.set(1);
    text.visible = true;

    // Fan out simultaneous hits on the same spot instead of overprinting them.
    const nearby = this.active.filter(
      (n) =>
        Math.abs(n.originX - worldX) < STACK_RADIUS &&
        Math.abs(n.originY - worldY) < STACK_RADIUS,
    ).length;
    const driftX =
      nearby === 0 ? 0 : (nearby % 2 === 1 ? 1 : -1) * STACK_OFFSET;

    text.position.set(worldX + driftX, worldY);
    this.layer.addChild(text);

    this.active.push({
      text,
      bornAt: performance.now(),
      originX: worldX,
      originY: worldY,
      driftX,
      lifetimeMs: style.lifetimeMs,
      rise: style.rise,
    });
  }

  dispose(): void {
    this.stop();
    for (const entry of this.active) entry.text.destroy();
    for (const text of this.pool) text.destroy();
    this.active.length = 0;
    this.pool.length = 0;
    this.layer.destroy({ children: true });
  }

  private update = (): void => {
    if (this.active.length === 0) return;
    const now = performance.now();

    for (let i = this.active.length - 1; i >= 0; i--) {
      const entry = this.active[i]!;
      const t = (now - entry.bornAt) / entry.lifetimeMs;

      if (t >= 1) {
        this.release(entry.text);
        this.active.splice(i, 1);
        continue;
      }

      // Ease-out rise, fading only over the back half so the number reads first.
      const eased = 1 - (1 - t) * (1 - t);
      entry.text.y = entry.originY - entry.rise * eased;
      entry.text.x = entry.originX + entry.driftX;
      entry.text.alpha = t < 0.5 ? 1 : 1 - (t - 0.5) / 0.5;

      // Brief pop on appearance.
      const pop = t < 0.14 ? 1 + (0.14 - t) * 2 : 1;
      entry.text.scale.set(pop);
    }
  };

  private take(): Text {
    const pooled = this.pool.pop();
    if (pooled) return pooled;

    const text = new Text({
      text: "",
      style: {
        fontFamily: "Cinzel, Georgia, serif",
        fontSize: 15,
        fontWeight: "700",
        fill: 0xffffff,
        stroke: { color: 0x000000, width: 4 },
      },
    });
    text.anchor.set(0.5, 1);
    text.roundPixels = true;
    return text;
  }

  private release(text: Text): void {
    text.visible = false;
    this.layer.removeChild(text);
    this.pool.push(text);
  }
}
