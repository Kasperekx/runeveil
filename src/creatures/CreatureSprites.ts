import { Assets, Texture } from "pixi.js";

export type CreatureFacing = "left" | "right" | "up" | "down";

export interface CreatureFrameSet {
  idle: Texture;
  walk: Texture[];
}

export interface CreatureSpritePaths {
  idleSide: string;
  walkSide: string[];
  idleDown: string;
  walkDown: string[];
  idleUp: string;
  walkUp: string[];
  dead: string;
}

/** Loads directional idle/walk textures for a creature kind. */
export class CreatureSprites {
  private readonly byFacing: Record<CreatureFacing, CreatureFrameSet>;
  readonly dead: Texture;

  private constructor(
    byFacing: Record<CreatureFacing, CreatureFrameSet>,
    dead: Texture,
  ) {
    this.byFacing = byFacing;
    this.dead = dead;
  }

  static async load(paths: CreatureSpritePaths): Promise<CreatureSprites> {
    const all = [
      paths.idleSide,
      ...paths.walkSide,
      paths.idleDown,
      ...paths.walkDown,
      paths.idleUp,
      ...paths.walkUp,
      paths.dead,
    ];

    await Assets.load(all);
    for (const path of all) {
      Texture.from(path).source.scaleMode = "nearest";
    }

    const sideIdle = Texture.from(paths.idleSide);
    const sideWalk = paths.walkSide.map((path) => Texture.from(path));
    const downIdle = Texture.from(paths.idleDown);
    const downWalk = paths.walkDown.map((path) => Texture.from(path));
    const upIdle = Texture.from(paths.idleUp);
    const upWalk = paths.walkUp.map((path) => Texture.from(path));

    return new CreatureSprites(
      {
        right: { idle: sideIdle, walk: sideWalk },
        left: { idle: sideIdle, walk: sideWalk },
        down: { idle: downIdle, walk: downWalk },
        up: { idle: upIdle, walk: upWalk },
      },
      Texture.from(paths.dead),
    );
  }

  framesFor(facing: CreatureFacing): CreatureFrameSet {
    return this.byFacing[facing];
  }
}

export function creatureSpritePaths(
  folder: string,
  prefix: string,
): CreatureSpritePaths {
  const base = `assets/creatures/${folder}`;
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
