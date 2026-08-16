/** Shared melee combat constants used by client prediction and server authority. */
export const ATTACK_RANGE = 56;
/** Base time between accepted melee hits (Tibia-ish pace). */
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
export function rollMeleeDamage(
  attackPower: number,
  random = Math.random,
): number {
  return rollDamageRange(attackPower, attackPower, random);
}

/** Cooldown from optional weapon attackSpeed multiplier (1 = normal). */
export function attackCooldownMs(attackSpeed = 1): number {
  const speed =
    Number.isFinite(attackSpeed) && attackSpeed > 0 ? attackSpeed : 1;
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
