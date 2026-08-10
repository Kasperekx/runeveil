/**
 * Shared melee combat constants (keep in sync with src/config/combat.ts).
 */
export const ATTACK_RANGE = 56;
/**
 * Extra distance allowed on the server after a swing is committed.
 * Covers animal movement + move-sync latency during the client wind-up.
 */
export const ATTACK_COMMIT_GRACE = 48;
/** Base time between accepted melee hits (keep in sync with client combat.ts). */
export const ATTACK_COOLDOWN_MS = 1000;

/** Inclusive uniform roll in [min, max] (WoW-lite weapon damage). */
export function rollDamageRange(
  min: number,
  max: number,
  random = Math.random,
): number {
  const a = Math.floor(min);
  const b = Math.floor(max);
  const lo = Math.max(1, Math.min(a, b));
  const hi = Math.max(lo, Math.max(a, b));
  if (lo >= hi) return lo;
  return lo + Math.floor(random() * (hi - lo + 1));
}

/** @deprecated Prefer rollDamageRange with explicit min/max. */
export function rollMeleeDamage(attackPower: number, random = Math.random): number {
  return rollDamageRange(attackPower, attackPower, random);
}

export function attackCooldownMs(attackSpeed = 1): number {
  const speed = Number.isFinite(attackSpeed) && attackSpeed > 0 ? attackSpeed : 1;
  return Math.max(100, Math.round(ATTACK_COOLDOWN_MS / speed));
}

export type AttackFacing = "left" | "right" | "up" | "down";

export function facingToward(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): AttackFacing {
  const dx = toX - fromX;
  const dy = toY - fromY;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? "right" : "left";
  }
  return dy >= 0 ? "down" : "up";
}
