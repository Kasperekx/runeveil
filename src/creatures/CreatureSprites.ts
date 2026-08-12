import { Assets, Texture } from "pixi.js";

export type CreatureFacing = "left" | "right" | "up" | "down";

export interface CreatureFrameSet {
  idle: Texture;
  walk: Texture[];
}

export interface CreatureSpritePaths {
  idleSide: string;
  walkSide: string[];
  /** Authored left-facing art; omitted when the right-facing side is mirrored. */
  idleLeft?: string;
  walkLeft?: string[];
  idleDown: string;
  walkDown: string[];
  idleUp: string;
  walkUp: string[];
  dead: string;
  /** Used by static directional sets that do not include dedicated corpse art. */
  deadAngle?: number;
}

/** Loads directional idle/walk textures for a creature kind. */
export class CreatureSprites {
  private readonly byFacing: Record<CreatureFacing, CreatureFrameSet>;
  readonly dead: Texture;
  readonly deadAngle: number;
  readonly mirrorLeft: boolean;

  private constructor(
    byFacing: Record<CreatureFacing, CreatureFrameSet>,
    dead: Texture,
    deadAngle: number,
    mirrorLeft: boolean,
  ) {
    this.byFacing = byFacing;
    this.dead = dead;
    this.deadAngle = deadAngle;
    this.mirrorLeft = mirrorLeft;
  }

  static async load(paths: CreatureSpritePaths): Promise<CreatureSprites> {
    const all = [
      paths.idleSide,
      ...paths.walkSide,
      ...(paths.idleLeft ? [paths.idleLeft] : []),
      ...(paths.walkLeft ?? []),
      paths.idleDown,
      ...paths.walkDown,
      paths.idleUp,
      ...paths.walkUp,
      paths.dead,
    ];
    const unique = [...new Set(all)];

    await Assets.load(unique);
    for (const path of unique) {
      Texture.from(path).source.scaleMode = "nearest";
    }

    const sideIdle = Texture.from(paths.idleSide);
    const sideWalk = paths.walkSide.map((path) => Texture.from(path));
    const leftIdle = Texture.from(paths.idleLeft ?? paths.idleSide);
    const leftWalk = (paths.walkLeft ?? paths.walkSide).map((path) =>
      Texture.from(path),
    );
    const downIdle = Texture.from(paths.idleDown);
    const downWalk = paths.walkDown.map((path) => Texture.from(path));
    const upIdle = Texture.from(paths.idleUp);
    const upWalk = paths.walkUp.map((path) => Texture.from(path));

    return new CreatureSprites(
      {
        right: { idle: sideIdle, walk: sideWalk },
        left: { idle: leftIdle, walk: leftWalk },
        down: { idle: downIdle, walk: downWalk },
        up: { idle: upIdle, walk: upWalk },
      },
      Texture.from(paths.dead),
      paths.deadAngle ?? 0,
      paths.idleLeft === undefined,
    );
  }

  framesFor(facing: CreatureFacing): CreatureFrameSet {
    return this.byFacing[facing];
  }
}

export function creatureSpritePaths(
  folder: string,
  prefix: string,
  layout: "animated-side" | "cardinal-static" = "animated-side",
): CreatureSpritePaths {
  const base = `assets/creatures/${folder}`;
  if (layout === "cardinal-static") {
    const east = `${base}/${prefix}-east.png`;
    const west = `${base}/${prefix}-west.png`;
    const south = `${base}/${prefix}-south.png`;
    const north = `${base}/${prefix}-north.png`;
    return {
      idleSide: east,
      walkSide: [east],
      idleLeft: west,
      walkLeft: [west],
      idleDown: south,
      walkDown: [south],
      idleUp: north,
      walkUp: [north],
      dead: south,
      deadAngle: 90,
    };
  }
  return {
    idleSide: `${base}/${prefix}-idle-side.png`,
    walkSide: [1, 2, 3, 4].map((n) => `${base}/${prefix}-walk-side-${n}.png`),
    idleDown: `${base}/${prefix}-idle-down.png`,
    walkDown: [1, 2, 3, 4].map((n) => `${base}/${prefix}-walk-down-${n}.png`),
    idleUp: `${base}/${prefix}-idle-up.png`,
    walkUp: [1, 2, 3, 4].map((n) => `${base}/${prefix}-walk-up-${n}.png`),
    dead: `${base}/${prefix}-dead.png`,
  };
}
