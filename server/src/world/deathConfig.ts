/** A death costs five percent of the XP required for the current level. */
export const DEATH_XP_PENALTY_RATE = 0.05;

/** Short pause so the death state is readable and cannot be skipped accidentally. */
export const RESPAWN_DELAY_MS = 3_000;

/**
 * Death never removes a completed level. The loss is capped at the XP already
 * banked toward the next one and rounded up so a non-zero penalty stays visible.
 */
export function deathExperienceLoss(
  experience: number,
  experienceToLevel: number,
): number {
  const banked = Math.max(0, Math.floor(experience));
  const required = Math.max(0, Math.floor(experienceToLevel));
  if (banked === 0 || required === 0) return 0;
  return Math.min(
    banked,
    Math.max(1, Math.ceil(required * DEATH_XP_PENALTY_RATE)),
  );
}
