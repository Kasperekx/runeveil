import { Assets, Texture } from "pixi.js";
import type { CreatureFacing } from "../creatures/CreatureSprites";

const PLAYER_DIR = "assets/players/human-warrior-v2";
const KNIGHT_DIR = "assets/players/leather-knight";

export interface PlayerFrameSet {
  idle: Texture[];
  walk: Texture[];
  attack: Texture[];
}

export interface PlayerSpritePaths {
  dead: string;
  idleSide: string[];
  walkSide: string[];
  attackSide: string[];
  idleDown: string[];
  walkDown: string[];
  attackDown: string[];
  idleUp: string[];
  walkUp: string[];
  attackUp: string[];
}

/** Human warrior — idle / walk / sword attack. */
export const PLAYER_SPRITE_PATHS: PlayerSpritePaths = {
  dead: `${PLAYER_DIR}/warrior-dead.png?v=1`,
  idleSide: [1, 2, 3, 4].map(
    (n) => `${PLAYER_DIR}/warrior-idle-side-${n}.png?v=6`,
  ),
  walkSide: [1, 2, 3, 4].map(
    (n) => `${PLAYER_DIR}/warrior-walk-side-${n}.png?v=6`,
  ),
  attackSide: [1, 2, 3].map(
    (n) => `${PLAYER_DIR}/warrior-attack-side-${n}.png?v=4`,
  ),
  idleDown: [1, 2, 3, 4].map(
    (n) => `${PLAYER_DIR}/warrior-idle-down-${n}.png?v=6`,
  ),
  walkDown: [1, 2, 3, 4].map(
    (n) => `${PLAYER_DIR}/warrior-walk-down-${n}.png?v=6`,
  ),
  attackDown: [1, 2, 3].map(
    (n) => `${PLAYER_DIR}/warrior-attack-down-${n}.png?v=4`,
  ),
  idleUp: [1, 2, 3, 4].map((n) => `${PLAYER_DIR}/warrior-idle-up-${n}.png?v=6`),
  walkUp: [1, 2, 3, 4].map((n) => `${PLAYER_DIR}/warrior-walk-up-${n}.png?v=6`),
  attackUp: [1, 2, 3].map(
    (n) => `${PLAYER_DIR}/warrior-attack-up-${n}.png?v=4`,
  ),
};

export const KNIGHT_SPRITE_PATHS: PlayerSpritePaths = {
  dead: `${KNIGHT_DIR}/knight-dead.png?v=1`,
  idleSide: [`${KNIGHT_DIR}/knight-idle-side.png`],
  walkSide: [1, 2, 3, 4].map((n) => `${KNIGHT_DIR}/knight-walk-side-${n}.png`),
  attackSide: [1, 2, 3].map((n) => `${KNIGHT_DIR}/knight-attack-side-${n}.png`),
  idleDown: [`${KNIGHT_DIR}/knight-idle-down.png`],
  walkDown: [1, 2, 3, 4].map((n) => `${KNIGHT_DIR}/knight-walk-down-${n}.png`),
  attackDown: [1, 2, 3].map((n) => `${KNIGHT_DIR}/knight-attack-down-${n}.png`),
  idleUp: [`${KNIGHT_DIR}/knight-idle-up.png`],
  walkUp: [1, 2, 3, 4].map((n) => `${KNIGHT_DIR}/knight-walk-up-${n}.png`),
  attackUp: [1, 2, 3].map((n) => `${KNIGHT_DIR}/knight-attack-up-${n}.png`),
};

export function playerSpritePaths(classId: string): PlayerSpritePaths {
  return classId === "knight" ? KNIGHT_SPRITE_PATHS : PLAYER_SPRITE_PATHS;
}

/** Loads directional textures including attack swings. */
export class PlayerSprites {
  readonly dead: Texture;
  readonly deadRotation: number;
  private readonly byFacing: Record<CreatureFacing, PlayerFrameSet>;

  private constructor(
    byFacing: Record<CreatureFacing, PlayerFrameSet>,
    dead: Texture,
    deadRotation: number,
  ) {
    this.byFacing = byFacing;
    this.dead = dead;
    this.deadRotation = deadRotation;
  }

  static async load(
    paths: PlayerSpritePaths = PLAYER_SPRITE_PATHS,
  ): Promise<PlayerSprites> {
    const all = [
      paths.dead,
      ...paths.idleSide,
      ...paths.walkSide,
      ...paths.attackSide,
      ...paths.idleDown,
      ...paths.walkDown,
      ...paths.attackDown,
      ...paths.idleUp,
      ...paths.walkUp,
      ...paths.attackUp,
    ];

    await Assets.load(all);
    for (const path of all) {
      Texture.from(path).source.scaleMode = "nearest";
    }

    const side: PlayerFrameSet = {
      idle: paths.idleSide.map((p) => Texture.from(p)),
      walk: paths.walkSide.map((p) => Texture.from(p)),
      attack: paths.attackSide.map((p) => Texture.from(p)),
    };
    const down: PlayerFrameSet = {
      idle: paths.idleDown.map((p) => Texture.from(p)),
      walk: paths.walkDown.map((p) => Texture.from(p)),
      attack: paths.attackDown.map((p) => Texture.from(p)),
    };
    const up: PlayerFrameSet = {
      idle: paths.idleUp.map((p) => Texture.from(p)),
      walk: paths.walkUp.map((p) => Texture.from(p)),
      attack: paths.attackUp.map((p) => Texture.from(p)),
    };

    return new PlayerSprites(
      {
        right: side,
        left: side,
        down,
        up,
      },
      Texture.from(paths.dead),
      0,
    );
  }

  static loadForClass(classId: string): Promise<PlayerSprites> {
    return PlayerSprites.load(playerSpritePaths(classId));
  }

  framesFor(facing: CreatureFacing): PlayerFrameSet {
    return this.byFacing[facing];
  }
}
