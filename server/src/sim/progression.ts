import type { PlayerAttributes } from "../content/classConfig.js";

/** Beyond this level XP stops accumulating. */
export const MAX_LEVEL = 60;

/** Free attribute points granted per level (player allocates manually). */
export const ATTR_POINTS_PER_LEVEL = 5;

/**
 * XP needed to advance from `level` to `level + 1`.
 *
 * Quadratic so early levels come quickly (a boar is 25 XP, so level 2 lands
 * after ~4 kills) while later ones stretch out.
 */
export function xpForLevel(level: number): number {
  if (level >= MAX_LEVEL) return 0;
  const l = Math.max(1, Math.floor(level));
  return 100 + (l - 1) * 50 + (l - 1) * (l - 1) * 10;
}

export interface ProgressInput {
  level: number;
  experience: number;
  attrs: PlayerAttributes;
}

export interface ProgressResult {
  level: number;
  experience: number;
  attrs: PlayerAttributes;
  /** How many levels were gained; 0 when the award did not level the player. */
  levelsGained: number;
  /** Unspent attribute points granted by this award. */
  attrPointsGained: number;
}

/**
 * Adds XP and rolls over as many levels as the amount covers.
 * Attributes are NOT auto-raised — the player spends `attrPointsGained`.
 */
export function awardExperience(
  player: ProgressInput,
  amount: number,
): ProgressResult {
  let level = Math.max(1, Math.floor(player.level));
  let experience = Math.max(0, Math.floor(player.experience));
  const attrs = { ...player.attrs };
  let levelsGained = 0;

  if (level >= MAX_LEVEL) {
    return {
      level,
      experience: 0,
      attrs,
      levelsGained: 0,
      attrPointsGained: 0,
    };
  }

  experience += Math.max(0, Math.floor(amount));

  let needed = xpForLevel(level);
  while (level < MAX_LEVEL && needed > 0 && experience >= needed) {
    experience -= needed;
    level += 1;
    levelsGained += 1;
    needed = xpForLevel(level);
  }

  // Max level banks nothing further, so the bar reads as full rather than stale.
  if (level >= MAX_LEVEL) experience = 0;

  return {
    level,
    experience,
    attrs,
    levelsGained,
    attrPointsGained: levelsGained * ATTR_POINTS_PER_LEVEL,
  };
}
