/**
 * Shared melee combat constants plus server-only swing grace.
 */
export {
  ATTACK_RANGE,
  ATTACK_COOLDOWN_MS,
  rollDamageRange,
  rollMeleeDamage,
  attackCooldownMs,
  facingToward,
  type AttackFacing,
} from "@mmo/shared/combat/combat";

/**
 * Extra distance allowed on the server after a swing is committed.
 * Covers animal movement + move-sync latency during the client wind-up.
 */
export const ATTACK_COMMIT_GRACE = 48;
